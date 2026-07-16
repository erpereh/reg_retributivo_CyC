import { describe, expect, it, vi } from "vitest";
import { AssistantOrchestrator } from "@/lib/assistant/orchestration/assistantOrchestrator";
import { ProviderAdapterError } from "@/lib/assistant/providers/types";
import { assertSafeForProvider } from "@/lib/assistant/privacy/assertions";
import type { AnalysisToolRegistry } from "@/lib/assistant/tools/registry";

function ndjson(events: readonly unknown[]) { return new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(""), { headers: { "content-type": "application/x-ndjson" } }); }
const validateRequestScope = vi.fn(async () => undefined);

describe("assistant client orchestration", () => {
  it("runs plan -> local allowlisted tool -> respond and groups deltas without loss", async () => {
    const providerContext = { kind: "gemini" as const, partIndex: 0, thoughtSignature: "signature-1" };
    const transport = vi.fn(async (body: Record<string, unknown>) => body.phase === "plan"
      ? ndjson([{ type: "tool_request", roundId: String(body.roundId), requestId: "q1", tool: "getPersonProfile", args: { analysisId: "a1", personId: "10048" }, providerContext }, { type: "done", roundId: String(body.roundId), finishReason: "tool_request" }])
      : ndjson([{ type: "tool_result_ack", roundId: String(body.roundId), requestId: "q1" }, { type: "text_delta", roundId: String(body.roundId), messageId: "m1", delta: "Res" }, { type: "text_delta", roundId: String(body.roundId), messageId: "m1", delta: "puesta" }, { type: "done", roundId: String(body.roundId), finishReason: "stop" }]));
    const registry = { names: ["getPersonProfile"], execute: vi.fn(async () => ({ safe: true })) } as unknown as AnalysisToolRegistry;
    const result = await new AssistantOrchestrator({ transport, registry, validateRequestScope }).send({ conversationId: "c1", analysisId: "a1", question: "Consulta matrícula 10048", modelProfileId: "p1", modelId: "fake", responseMode: "strict", contextStrategy: "automatic" });
    expect(result.text).toBe("Respuesta");
    expect(result.rounds).toBe(2);
    expect(registry.execute).toHaveBeenCalledWith("getPersonProfile", { analysisId: "a1", personId: "10048" });
    const settled = { requestId: "q1", tool: "getPersonProfile", args: { analysisId: "a1", personId: "10048" }, providerContext, status: "success", data: { safe: true }, sources: [] };
    expect(transport.mock.calls[1][0]).toEqual(expect.objectContaining({ phase: "respond", toolHistory: [[settled]] }));
    expect(transport.mock.calls[1][0]).not.toHaveProperty("toolResults");
  });

  it("preserves ordered Gemini context across sequential tool rounds", async () => {
    const contexts = [
      { kind: "gemini" as const, partIndex: 0, thoughtSignature: "signature-1" },
      { kind: "gemini" as const, partIndex: 0, thoughtSignature: "signature-2" },
    ];
    const transport = vi.fn(async (body: Record<string, unknown>) => {
      if (body.phase === "plan") return ndjson([{ type: "tool_request", roundId: String(body.roundId), requestId: "q1", tool: "getPersonProfile", args: { analysisId: "a1", personId: "10048" }, providerContext: contexts[0] }, { type: "done", roundId: String(body.roundId), finishReason: "tool_request" }]);
      if (body.phase === "respond") return ndjson([{ type: "tool_request", roundId: String(body.roundId), requestId: "q2", tool: "getPersonConcepts", args: { analysisId: "a1", personId: "10048" }, providerContext: contexts[1] }, { type: "done", roundId: String(body.roundId), finishReason: "tool_request" }]);
      return ndjson([{ type: "text_delta", roundId: String(body.roundId), messageId: "m1", delta: "Respuesta" }, { type: "done", roundId: String(body.roundId), finishReason: "stop" }]);
    });
    const registry = { names: ["getPersonProfile", "getPersonConcepts"], execute: vi.fn(async (tool: string) => ({ tool })) } as unknown as AnalysisToolRegistry;
    const result = await new AssistantOrchestrator({ transport, registry, validateRequestScope }).send({ conversationId: "c1", analysisId: "a1", question: "Consulta matrícula 10048", modelProfileId: "p1", modelId: "gemini-3.1-flash-lite", responseMode: "strict", contextStrategy: "automatic" });

    expect(result.text).toBe("Respuesta");
    const finalBody = transport.mock.calls[2][0] as Record<string, unknown>;
    expect(finalBody).toEqual(expect.objectContaining({ phase: "continue", question: "Consulta matrícula 10048" }));
    expect(finalBody).not.toHaveProperty("interruptedMessageId");
    expect(finalBody).not.toHaveProperty("continuationContext");
    expect(finalBody.toolHistory).toEqual([
      [expect.objectContaining({ requestId: "q1", providerContext: contexts[0] })],
      [expect.objectContaining({ requestId: "q2", providerContext: contexts[1] })],
    ]);
  });

  it("forces final synthesis after a successful complete person profile", async () => {
    const providerContext = { kind: "gemini" as const, partIndex: 0, thoughtSignature: "signature-profile" };
    const transport = vi.fn(async (body: Record<string, unknown>) => {
      if (body.phase === "plan") return ndjson([
        { type: "tool_request", roundId: String(body.roundId), requestId: "q-profile", tool: "getPersonProfile", args: { analysisId: "a1", personId: "10048" }, providerContext },
        { type: "done", roundId: String(body.roundId), finishReason: "tool_request" },
      ]);
      if (body.toolPolicy !== "none") return ndjson([
        { type: "tool_request", roundId: String(body.roundId), requestId: "q-redundant", tool: "getPersonConcepts", args: { analysisId: "a1", personId: "10048" } },
        { type: "done", roundId: String(body.roundId), finishReason: "tool_request" },
      ]);
      return ndjson([{ type: "text_delta", roundId: String(body.roundId), messageId: "m2", delta: "Ficha completa" }, { type: "done", roundId: String(body.roundId), finishReason: "stop" }]);
    });
    const registry = { names: ["getPersonProfile", "getPersonConcepts"], execute: vi.fn(async () => ({ personId: "10048", complete: true })) } as unknown as AnalysisToolRegistry;

    await expect(new AssistantOrchestrator({ transport, registry, validateRequestScope }).send({ conversationId: "c1", analysisId: "a1", question: "Dime todo sobre matrícula 10048", modelProfileId: "p1", modelId: "gemini-3.1-flash-lite", responseMode: "strict", contextStrategy: "associated_people" })).resolves.toMatchObject({ text: "Ficha completa", rounds: 2 });
    expect(transport.mock.calls[1][0]).toEqual(expect.objectContaining({ phase: "respond", toolPolicy: "none" }));
  });

  it("always uses the third request for synthesis instead of asking a fourth tool round", async () => {
    const transport = vi.fn(async (body: Record<string, unknown>) => {
      if (body.toolPolicy === "none") return ndjson([{ type: "text_delta", roundId: String(body.roundId), messageId: "m3", delta: "Síntesis disponible" }, { type: "done", roundId: String(body.roundId), finishReason: "stop" }]);
      const tool = body.phase === "plan" ? "getAnalysisSummary" : "getTopDifferences";
      return ndjson([{ type: "tool_request", roundId: String(body.roundId), requestId: `q-${body.roundNumber}`, tool, args: { analysisId: "a1" } }, { type: "done", roundId: String(body.roundId), finishReason: "tool_request" }]);
    });
    const registry = { names: ["getAnalysisSummary", "getTopDifferences"], execute: vi.fn(async (tool: string) => ({ tool })) } as unknown as AnalysisToolRegistry;

    await expect(new AssistantOrchestrator({ transport, registry, validateRequestScope }).send({ conversationId: "c1", analysisId: "a1", question: "Resumen", modelProfileId: "p1", modelId: "fake", responseMode: "strict", contextStrategy: "automatic" })).resolves.toMatchObject({ text: "Síntesis disponible", rounds: 3 });
    expect(transport.mock.calls.map(([body]) => (body as Record<string, unknown>).toolPolicy)).toEqual(["auto", "auto", "none"]);
  });

  it("accepts a complete person synthesis larger than the legacy text limit", async () => {
    const completeText = "x".repeat(20_000);
    const transport = vi.fn(async (body: Record<string, unknown>) => body.phase === "plan"
      ? ndjson([{ type: "tool_request", roundId: String(body.roundId), requestId: "q-profile", tool: "getPersonProfile", args: { analysisId: "a1", personId: "10048" } }, { type: "done", roundId: String(body.roundId), finishReason: "tool_request" }])
      : ndjson([{ type: "text_delta", roundId: String(body.roundId), messageId: "m2", delta: completeText.slice(0, 10_000) }, { type: "text_delta", roundId: String(body.roundId), messageId: "m2", delta: completeText.slice(10_000) }, { type: "done", roundId: String(body.roundId), finishReason: "stop" }]));
    const registry = { names: ["getPersonProfile"], execute: vi.fn(async () => ({ personId: "10048", complete: true })) } as unknown as AnalysisToolRegistry;

    await expect(new AssistantOrchestrator({ transport, registry, validateRequestScope }).send({ conversationId: "c1", analysisId: "a1", question: "Dime todo sobre matrícula 10048", modelProfileId: "p1", modelId: "fake", responseMode: "strict", contextStrategy: "associated_people" })).resolves.toMatchObject({ text: completeText });
  });

  it("does not audit an opaque Gemini signature as user or tool content", async () => {
    const providerContext = { kind: "gemini" as const, partIndex: 0, thoughtSignature: "sk-opaqueTechnicalSignature123" };
    const transport = vi.fn(async (body: Record<string, unknown>) => body.phase === "plan"
      ? ndjson([{ type: "tool_request", roundId: String(body.roundId), requestId: "q1", tool: "getPersonProfile", args: { analysisId: "a1", personId: "10048" }, providerContext }, { type: "done", roundId: String(body.roundId), finishReason: "tool_request" }])
      : ndjson([{ type: "text_delta", roundId: String(body.roundId), messageId: "m1", delta: "Respuesta" }, { type: "done", roundId: String(body.roundId), finishReason: "stop" }]));
    const registry = { names: ["getPersonProfile"], execute: vi.fn(async () => ({ personId: "10048" })), assertSafeOutput: vi.fn((value: unknown) => assertSafeForProvider(value)) } as unknown as AnalysisToolRegistry;

    await expect(new AssistantOrchestrator({ transport, registry, validateRequestScope }).send({ conversationId: "c1", analysisId: "a1", question: "Consulta matrícula 10048", modelProfileId: "p1", modelId: "gemini-3.1-flash-lite", responseMode: "strict", contextStrategy: "automatic" })).resolves.toMatchObject({ text: "Respuesta" });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("validates privacy client-side and honors AbortSignal", async () => {
    const transport = vi.fn(async (body: Record<string, unknown>) => body.toolPolicy === "none"
      ? ndjson([{ type: "text_delta", roundId: String(body.roundId), messageId: "m2", delta: "Respuesta" }, { type: "done", roundId: String(body.roundId), finishReason: "stop" }])
      : ndjson([{ type: "tool_request", roundId: String(body.roundId), requestId: String(body.roundId), tool: "getPersonProfile", args: { analysisId: "a1", personId: "10048" } }, { type: "done", roundId: String(body.roundId), finishReason: "tool_request" }]));
    const registry = { names: ["getPersonProfile"], execute: vi.fn(async () => ({ safe: true })) } as unknown as AnalysisToolRegistry;
    const orchestrator = new AssistantOrchestrator({ transport, registry, validateRequestScope });
    await expect(orchestrator.send({ conversationId: "c1", analysisId: "a1", question: "Consulta matrícula 10048", modelProfileId: "p1", modelId: "fake", responseMode: "strict", contextStrategy: "automatic" })).resolves.toMatchObject({ text: "Respuesta" });
    await expect(orchestrator.send({ conversationId: "c1", analysisId: "a1", question: "persona@example.com", modelProfileId: "p1", modelId: "fake", responseMode: "strict", contextStrategy: "automatic" })).rejects.toThrow(/sensible|privacidad/i);
    const controller = new AbortController(); controller.abort();
    await expect(orchestrator.send({ conversationId: "c1", analysisId: "a1", question: "Consulta", modelProfileId: "p1", modelId: "fake", responseMode: "strict", contextStrategy: "automatic", signal: controller.signal })).rejects.toThrow();
  });

  it("stops an active request and supports retry and regenerate with fresh AbortControllers", async () => {
    let pendingSignal: AbortSignal | undefined;
    const blockingTransport = vi.fn(async (_body: unknown, signal?: AbortSignal) => {
      pendingSignal = signal;
      await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
      return ndjson([]);
    });
    const registry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
    const stopping = new AssistantOrchestrator({ transport: blockingTransport, registry, validateRequestScope });
    const active = stopping.send({ conversationId: "c1", question: "Consulta", modelProfileId: "p1", modelId: "fake", responseMode: "strict", contextStrategy: "automatic" });
    await vi.waitFor(() => expect(pendingSignal).toBeDefined());
    stopping.stop();
    await expect(active).rejects.toThrow();
    expect(pendingSignal?.aborted).toBe(true);

    let call = 0;
    const transport = vi.fn(async (body: Record<string, unknown>) => {
      call += 1;
      return ndjson([{ type: "text_delta", roundId: String(body.roundId), messageId: `m${call}`, delta: `respuesta-${call}` }, { type: "done", roundId: String(body.roundId), finishReason: "stop" }]);
    });
    const orchestrator = new AssistantOrchestrator({ transport, registry, validateRequestScope });
    const input = { conversationId: "c1", question: "Consulta", modelProfileId: "p1", modelId: "fake", responseMode: "strict" as const, contextStrategy: "automatic" as const };
    await expect(orchestrator.send(input)).resolves.toMatchObject({ text: "respuesta-1" });
    await expect(orchestrator.retry()).resolves.toMatchObject({ text: "respuesta-2" });
    await expect(orchestrator.regenerate()).resolves.toMatchObject({ text: "respuesta-3" });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("aborts the previous run before starting a replacement so requests never overlap", async () => {
    const signals: AbortSignal[] = [];
    let calls = 0;
    const transport = vi.fn(async (body: Record<string, unknown>, signal?: AbortSignal) => {
      calls += 1;
      signals.push(signal!);
      if (calls === 1) await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
      return ndjson([{ type: "text_delta", roundId: String(body.roundId), messageId: "m2", delta: "reemplazo" }, { type: "done", roundId: String(body.roundId), finishReason: "stop" }]);
    });
    const registry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
    const orchestrator = new AssistantOrchestrator({ transport, registry, validateRequestScope });
    const input = { conversationId: "c1", question: "Consulta", modelProfileId: "p1", modelId: "fake", responseMode: "strict" as const, contextStrategy: "automatic" as const };
    const first = orchestrator.send(input);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const second = orchestrator.send(input);
    await expect(first).rejects.toThrow();
    await expect(second).resolves.toMatchObject({ text: "reemplazo" });
    expect(signals[0].aborted).toBe(true);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("ignores events emitted after the first done event for the active request", async () => {
    const transport = vi.fn(async (body: Record<string, unknown>) => ndjson([
      { type: "text_delta", roundId: String(body.roundId), messageId: "m1", delta: "Respuesta válida" },
      { type: "done", roundId: String(body.roundId), finishReason: "stop" },
      { type: "text_delta", roundId: String(body.roundId), messageId: "m1", delta: " tardía" },
    ]));
    const registry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
    const result = await new AssistantOrchestrator({ transport, registry, validateRequestScope }).send({ conversationId: "c1", question: "Consulta", modelProfileId: "p1", modelId: "fake", responseMode: "strict", contextStrategy: "automatic" });
    expect(result.text).toBe("Respuesta válida");
  });

  it("marks an incomplete final NDJSON frame as a truncated stream", async () => {
    const transport = vi.fn(async () => new Response('{"type":"done"', { headers: { "content-type": "application/x-ndjson" } }));
    const registry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
    await expect(new AssistantOrchestrator({ transport, registry, validateRequestScope }).send({ conversationId: "c1", question: "Consulta", modelProfileId: "p1", modelId: "fake", responseMode: "strict", contextStrategy: "automatic" })).rejects.toMatchObject({ code: "stream_truncated", classification: "provider" } satisfies Partial<ProviderAdapterError>);
  });

  it("blocks a second concurrent retry instead of starting another execution", async () => {
    let calls = 0; let releaseRetry: (() => void) | undefined;
    const transport = vi.fn(async (body: Record<string, unknown>, signal?: AbortSignal) => {
      calls += 1;
      if (calls === 2) await new Promise<void>((resolve, reject) => {
        releaseRetry = resolve;
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      return ndjson([{ type: "text_delta", roundId: String(body.roundId), messageId: `m${calls}`, delta: `respuesta-${calls}` }, { type: "done", roundId: String(body.roundId), finishReason: "stop" }]);
    });
    const registry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
    const orchestrator = new AssistantOrchestrator({ transport, registry, validateRequestScope });
    const input = { conversationId: "c1", question: "Consulta", modelProfileId: "p1", modelId: "fake", responseMode: "strict" as const, contextStrategy: "automatic" as const };
    await orchestrator.send(input);
    const retry = orchestrator.retry();
    await vi.waitFor(() => expect(releaseRetry).toBeTypeOf("function"));
    await expect(orchestrator.retry()).rejects.toMatchObject({ code: "retry_in_progress", classification: "cancelled" } satisfies Partial<ProviderAdapterError>);
    releaseRetry?.();
    await expect(retry).resolves.toMatchObject({ text: "respuesta-2" });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
