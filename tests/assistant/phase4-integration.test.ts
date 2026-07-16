import { describe, expect, it, vi } from "vitest";
import { ANALYSIS_TOOL_NAMES, ANALYSIS_TOOL_SCHEMAS } from "@/lib/assistant/tools/registry";
import { AssistantOrchestrator } from "@/lib/assistant/orchestration/assistantOrchestrator";
import { createChatPostHandler, createChatService } from "@/lib/assistant/server/chatService";
import { ProviderAdapterError } from "@/lib/assistant/providers/types";
import type { AIProviderAdapter } from "@/lib/assistant/providers/types";
import type { AnalysisToolRegistry } from "@/lib/assistant/tools/registry";

const ndjson = (events: readonly unknown[]) => new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(""));
const validateRequestScope = vi.fn(async () => undefined);

describe("phase 4 disconnected-path regressions", () => {
  it("publishes functional provider JSON schemas for all 19 tools", () => {
    expect(ANALYSIS_TOOL_NAMES).toHaveLength(19);
    for (const name of ANALYSIS_TOOL_NAMES) {
      const schema = ANALYSIS_TOOL_SCHEMAS[name].provider;
      expect(schema).toMatchObject({ type: "object", additionalProperties: false });
      expect(Object.keys(schema.properties ?? {})).toContain("analysisId");
      expect(schema.required).toContain("analysisId");
    }
  });

  it("uses plan, respond and continue for two tool rounds", async () => {
    const phases: unknown[] = [];
    const transport = vi.fn(async (body: Record<string, unknown>) => {
      phases.push(body.phase);
      if (body.phase !== "continue") return ndjson([
        { type: "tool_request", roundId: body.roundId, requestId: `q-${phases.length}`, tool: "getAnalysisSummary", args: { analysisId: "a1" } },
        { type: "done", roundId: body.roundId, finishReason: "tool_request" },
      ]);
      return ndjson([{ type: "text_delta", roundId: body.roundId, messageId: "m3", delta: "final" }, { type: "done", roundId: body.roundId, finishReason: "stop" }]);
    });
    const registry = { names: ["getAnalysisSummary"], execute: vi.fn(async () => ({ summary: {} })) } as unknown as AnalysisToolRegistry;
    await expect(new AssistantOrchestrator({ transport, registry, validateRequestScope }).send({ conversationId: "c1", analysisId: "a1", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic" })).resolves.toMatchObject({ text: "final", rounds: 3 });
    expect(phases).toEqual(["plan", "respond", "continue"]);
  });

  it("preserves provider auth classification through the NDJSON boundary", async () => {
    const base = { phase: "plan", conversationId: "c1", analysisId: "a1", roundId: "r1", roundNumber: 1, modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic", question: "Resumen", tools: [] };
    const service = { execute: async function* () { throw new ProviderAdapterError("auth"); } };
    const response = await createChatPostHandler(service)(new Request("http://local/chat", { method: "POST", body: JSON.stringify(base) }));
    await expect(response.json()).resolves.toMatchObject({ classification: "auth", retryable: false });
  });

  it("exposes a production route factory for injected adapter resolution", async () => {
    const route = await import("@/lib/assistant/server/chatService");
    expect(route.createAssistantChatRoute).toBeTypeOf("function");
  });

  it("rejects a real adapter call when the recounted payload exceeds the profile window", async () => {
    const planTools = vi.fn();
    const adapter = { countTokens: vi.fn(async () => ({ tokens: 4_000, estimated: false })), planTools } as unknown as AIProviderAdapter;
    const service = createChatService(async () => ({ adapter, apiKey: "test-key" }));
    const profile = { id: "p1", name: "Fake", provider: "openai", baseUrl: "https://api.openai.com/v1", modelId: "m1", enabled: true, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true, detectedContextWindow: 5_000, capabilitiesSource: "detected" };
    const body = { phase: "plan", conversationId: "c1", analysisId: "a1", roundId: "r1", roundNumber: 1, modelProfileId: "p1", modelId: "m1", profile, responseMode: "strict", contextStrategy: "automatic", question: "Resumen", tools: [] };
    const response = await createChatPostHandler(service)(new Request("http://local/chat", { method: "POST", body: JSON.stringify(body) }));
    await expect(response.json()).resolves.toMatchObject({ classification: "context", retryable: false });
    expect(planTools).not.toHaveBeenCalled();
  });

  it("persists a partial real run and retries it as a new continue message", async () => {
    const persisted: unknown[] = []; let call = 0;
    const transport = vi.fn(async (body: Record<string, unknown>) => { call += 1; return call === 1
      ? ndjson([{ type: "text_delta", roundId: body.roundId, messageId: "partial-1", delta: "Parcial" }, { type: "error", roundId: body.roundId, code: "provider_transient", classification: "transient", message: "Temporal", retryable: true }])
      : ndjson([{ type: "text_delta", roundId: body.roundId, messageId: "continued-2", delta: " continuado" }, { type: "done", roundId: body.roundId, finishReason: "stop" }]); });
    const registry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
    const orchestrator = new AssistantOrchestrator({ transport, registry, validateRequestScope, persistMessage: async (message: unknown) => { persisted.push(message); } } as never);
    await expect(orchestrator.send({ conversationId: "c1", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic" })).resolves.toMatchObject({ text: " continuado" });
    expect(transport.mock.calls[1][0]).toMatchObject({ phase: "continue", interruptedMessageId: expect.stringMatching(/:message:1$/), continuationContext: "Parcial" });
    expect(persisted).toEqual([expect.objectContaining({ status: "interrupted", content: "Parcial", modelProfileId: "p1", modelId: "m1" }), expect.objectContaining({ status: "completed", content: " continuado", modelProfileId: "p1", modelId: "m1" })]);
  });

  it("keeps tool identity and sanitized sources in the result envelope", async () => {
    const transport = vi.fn(async (body: Record<string, unknown>) => body.phase === "plan" ? ndjson([{ type: "tool_request", roundId: body.roundId, requestId: "req-1", tool: "getAnalysisSummary", args: { analysisId: "a1" } }, { type: "done", roundId: body.roundId, finishReason: "tool_request" }]) : ndjson([{ type: "text_delta", roundId: body.roundId, messageId: "m2", delta: "Resumen listo" }, { type: "done", roundId: body.roundId, finishReason: "stop" }]));
    const source = { id: "s1", conversationId: "c1", analysisId: "a1", sourceType: "analysis", sanitizedSourceLabel: "Análisis retributivo", availability: "available", conceptIds: [], excerpt: "Resumen estructurado", sanitizedHash: "h1" };
    const registry = { names: ["getAnalysisSummary"], execute: vi.fn(), executeEnvelope: vi.fn(async () => ({ data: { summary: { uniquePeople: 1 } }, sources: [source] })) } as unknown as AnalysisToolRegistry;
    await new AssistantOrchestrator({ transport, registry, validateRequestScope }).send({ conversationId: "c1", analysisId: "a1", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic" });
    expect(transport.mock.calls[1][0]).toEqual(expect.objectContaining({ toolResults: [{ requestId: "req-1", tool: "getAnalysisSummary", args: { analysisId: "a1" }, status: "success", data: { summary: { uniquePeople: 1 } }, sources: [source] }] }));
  });

  it("rejects an event from another round and cancels an oversized NDJSON reader", async () => {
    const registry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
    const mismatched = new AssistantOrchestrator({ transport: async () => ndjson([{ type: "done", roundId: "stale", finishReason: "stop" }]), registry, validateRequestScope });
    await expect(mismatched.send({ conversationId: "c1", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic" })).rejects.toThrow(/ejecución/i);
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(70_000))); }, cancel: cancelled });
    const oversized = new AssistantOrchestrator({ transport: async () => new Response(stream), registry, validateRequestScope });
    await expect(oversized.send({ conversationId: "c1", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic" })).rejects.toThrow(/tamaño/i);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("blocks a known name before accepting or persisting buffered provider output", async () => {
    const persistMessage = vi.fn();
    const registry = { names: [], execute: vi.fn(), assertSafeOutput(value: unknown) { if (JSON.stringify(value).includes("Nombre Privado")) throw new ProviderAdapterError("privacy"); } } as unknown as AnalysisToolRegistry;
    const transport = async (body: Record<string, unknown>) => ndjson([{ type: "text_delta", roundId: body.roundId, messageId: "m1", delta: "Nombre Privado" }, { type: "done", roundId: body.roundId, finishReason: "stop" }]);
    await expect(new AssistantOrchestrator({ transport, registry, validateRequestScope, persistMessage }).send({ conversationId: "c1", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic" })).rejects.toMatchObject({ classification: "privacy" });
    expect(persistMessage).not.toHaveBeenCalled();
  });

  it("enforces the real request byte limit without Content-Length", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ value: "x".repeat(140_000) }));
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.subarray(0, 70_000)); controller.enqueue(bytes.subarray(70_000)); controller.close(); } });
    const response = await createChatPostHandler({ execute: async function* () { yield { type: "done", roundId: "r1", finishReason: "stop" } as const; } })(new Request("http://local/chat", { method: "POST", body, duplex: "half" } as RequestInit));
    expect(response.status).toBe(413);
  });

  it.each(["text", "source", "action", "error"] as const)("blocks known names in provider %s events while preserving only an already-audited prefix", async (kind) => {
    const base = { phase: "plan", conversationId: "c1", analysisId: "a1", roundId: "r1", roundNumber: 1, modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic", question: "Resumen", tools: [], privacyBlockedTerms: ["Nombre Privado"] };
    const offending = kind === "text" ? { type: "text_delta", roundId: "r1", messageId: "m1", delta: "Nombre Privado" }
      : kind === "source" ? { type: "source", roundId: "r1", source: { id: "s1", conversationId: "c1", analysisId: "a1", sourceType: "analysis", sanitizedSourceLabel: "Resumen", availability: "available", conceptIds: [], excerpt: "Nombre Privado", sanitizedHash: "h1" } }
      : kind === "action" ? { type: "action", roundId: "r1", action: { id: "ac1", conversationId: "c1", messageId: "m1", label: "Nombre Privado", description: "Abrir", action: { type: "open_person", analysisId: "a1", personId: "10048" }, status: "pending", createdAt: "2026-07-13" } }
      : { type: "error", roundId: "r1", code: "provider", classification: "provider", message: "Nombre Privado", retryable: false };
    const service = { execute: async function* () { yield { type: "text_delta", roundId: "r1", messageId: "m1", delta: "Texto seguro previo. " } as const; yield offending as never; yield { type: "done", roundId: "r1", finishReason: "stop" } as const; } };
    const response = await createChatPostHandler(service)(new Request("http://local/chat", { method: "POST", body: JSON.stringify(base) }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    if (kind === "text") expect(events).toEqual([expect.objectContaining({ type: "error", classification: "privacy", retryable: false })]);
    else expect(events).toEqual([expect.objectContaining({ type: "text_delta", delta: "Texto seguro previo. " }), expect.objectContaining({ type: "error", classification: "privacy", retryable: false })]);
    expect(JSON.stringify(events)).not.toContain("Nombre Privado");
  });

  it("rejects source/action round mismatches and bounded total events/text before output", async () => {
    const body = { phase: "plan", conversationId: "c1", roundId: "r1", roundNumber: 1, modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic", question: "Resumen", tools: [] };
    const source = { type: "source", roundId: "stale", source: { id: "s1", conversationId: "c1", sourceType: "analysis", sanitizedSourceLabel: "Resumen", availability: "available", conceptIds: [] as string[], excerpt: "Seguro", sanitizedHash: "h1" } } as const;
    const mismatch = await createChatPostHandler({ execute: async function* () { yield source; } })(new Request("http://local/chat", { method: "POST", body: JSON.stringify(body) }));
    const eventsOf = async (response: Response) => (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    expect((await eventsOf(mismatch)).at(-1)).toMatchObject({ code: "round_mismatch", retryable: false });
    const tooMany = await createChatPostHandler({ execute: async function* () { for (let index = 0; index < 1_001; index += 1) yield { type: "status", roundId: "r1", label: `Paso ${index}` } as const; } })(new Request("http://local/chat", { method: "POST", body: JSON.stringify(body) }));
    expect((await eventsOf(tooMany)).at(-1)).toMatchObject({ classification: "context", retryable: false });
    const tooMuchText = await createChatPostHandler({ execute: async function* () { for (let index = 0; index < 17; index += 1) yield { type: "text_delta", roundId: "r1", messageId: "m1", delta: "x".repeat(16_384) } as const; } })(new Request("http://local/chat", { method: "POST", body: JSON.stringify(body) }));
    expect((await eventsOf(tooMuchText)).at(-1)).toMatchObject({ classification: "context", retryable: false });
  });

  it("retry resumes the interrupted message while regenerate replaces the completed target and starts a fresh plan", async () => {
    let call = 0; const bodies: Record<string, unknown>[] = []; const replaced: string[] = [];
    const transport = async (body: Record<string, unknown>) => { bodies.push(body); call += 1; if (call <= 2) return ndjson([{ type: "text_delta", roundId: body.roundId, messageId: `partial-${call}`, delta: `Parcial ${call}` }, { type: "error", roundId: body.roundId, code: "provider_transient", classification: "transient", message: "Temporal", retryable: true }]); return ndjson([{ type: "text_delta", roundId: body.roundId, messageId: `complete-${call}`, delta: "Completa" }, { type: "done", roundId: body.roundId, finishReason: "stop" }]); };
    const registry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
    const orchestrator = new AssistantOrchestrator({ transport, registry, validateRequestScope, markMessageReplaced: async (id) => { replaced.push(id); } });
    const input = { conversationId: "c1", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "strict" as const, contextStrategy: "automatic" as const };
    await expect(orchestrator.send(input)).rejects.toMatchObject({ classification: "transient" });
    await expect(orchestrator.retry()).resolves.toMatchObject({ text: "Completa" });
    expect(bodies[2]).toEqual(expect.objectContaining({ phase: "continue", interruptedMessageId: expect.stringMatching(/:message:2$/), continuationContext: "Parcial 1Parcial 2" }));
    await expect(orchestrator.regenerate()).resolves.toMatchObject({ text: "Completa" });
    expect(replaced[0]).toMatch(/:message:1$/);
    expect(bodies[3]).toEqual(expect.objectContaining({ phase: "plan", question: "Resumen" }));
  });

  it("does not precompact or persist a caller snapshot below a server-reported 85% threshold", async () => {
    const persistedSnapshots: unknown[] = []; const persistedMetadata: unknown[] = [];
    const transport = vi.fn(async (body: Record<string, unknown>) => ndjson([{ type: "text_delta", roundId: body.roundId, messageId: "m1", delta: "Respuesta válida" }, { type: "done", roundId: body.roundId, finishReason: "stop" }]));
    const registry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
    const orchestrator = new AssistantOrchestrator({ transport, registry, validateRequestScope, persistSnapshot: async (snapshot) => { persistedSnapshots.push(snapshot); }, persistRunMetadata: async (metadata) => { persistedMetadata.push(metadata); } });
    await orchestrator.send({ conversationId: "c1", analysisId: "a1", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "flexible", contextStrategy: "optimized", compaction: { messages: [{ id: "old-1", content: "Historia antigua", tokens: 100 }, { id: "recent-1", content: "Historia reciente", tokens: 100 }], summary: "Resumen sanitizado", decisions: ["mantener"], figures: [125], sourceIds: ["s1"], actionIds: [], personIds: ["10048"], analysisVersion: "v1", keepRecent: 1 } });
    expect(persistedSnapshots).toEqual([]);
    expect(transport.mock.calls[0][0]).not.toHaveProperty("compactedContext");
    expect(persistedMetadata).toEqual([expect.objectContaining({ actualStrategy: "optimized", actualResponseMode: "flexible" })]);
    expect(persistedMetadata[0]).not.toHaveProperty("snapshotId");
  });
});
