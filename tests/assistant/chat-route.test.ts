import { describe, expect, it, vi } from "vitest";
import { chatRequestSchema, createChatPostHandler, createChatService, createProductionChatAdapterResolver } from "@/lib/assistant/server/chatService";
import { assistantStreamEventSchema } from "@/lib/assistant/schemas";
import { createProviderRuntimeService } from "@/lib/assistant/server/providerRuntime";
import type { AIProviderAdapter } from "@/lib/assistant/providers/types";

function request(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
}
const base = { conversationId: "c1", analysisId: "a1", roundId: "r1", roundNumber: 1, modelProfileId: "p1", modelId: "fake-model", responseMode: "strict", contextStrategy: "automatic" } as const;

describe("POST /api/assistant/chat", () => {
  it("resolves a validated provider descriptor in a fresh chat runtime", async () => {
    const provider = { providerId: "provider-gemini", providerType: "gemini", baseUrl: "https://generativelanguage.googleapis.com", envVarName: "GEMINI_API_KEY" } as const;
    const parsed = chatRequestSchema.safeParse({ ...base, phase: "plan", question: "Consulta", tools: [], providerId: provider.providerId, provider });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const adapter = { countTokens: vi.fn(), planTools: vi.fn(), streamResponse: vi.fn() } as unknown as AIProviderAdapter;
    const runtime = createProviderRuntimeService({ env: { GEMINI_API_KEY: "server-only" }, resolveAdapter: () => adapter, production: true });

    await expect(createProductionChatAdapterResolver(runtime)(parsed.data)).resolves.toEqual({ adapter, apiKey: "server-only" });
  });

  it("rejects a provider descriptor whose stable id does not match providerId", () => {
    const provider = { providerId: "provider-other", providerType: "gemini", baseUrl: "https://generativelanguage.googleapis.com", envVarName: "GEMINI_API_KEY" } as const;
    const parsed = chatRequestSchema.safeParse({ ...base, phase: "plan", question: "Consulta", tools: [], providerId: "provider-gemini", provider });

    expect(parsed.success).toBe(false);
  });

  it("validates Gemini native tool history before contacting the provider", () => {
    const provider = { providerId: "provider-gemini", providerType: "gemini", baseUrl: "https://generativelanguage.googleapis.com", envVarName: "GEMINI_API_KEY" } as const;
    const result = { requestId: "q1", tool: "getPersonProfile", args: { analysisId: "a1", personId: "10048" }, status: "success", data: { personId: "10048" }, providerContext: { kind: "gemini", partIndex: 0, thoughtSignature: "signature-1" } } as const;
    const valid = { ...base, phase: "respond", question: "Consulta matrícula 10048", modelId: "gemini-3.1-flash-lite", providerId: provider.providerId, provider, toolResults: [result], toolHistory: [[result]] } as const;

    expect(chatRequestSchema.safeParse(valid).success).toBe(true);
    expect(chatRequestSchema.safeParse({ ...valid, toolResults: [{ ...result, providerContext: { ...result.providerContext, thoughtSignature: "altered" } }] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...valid, toolHistory: [[{ ...result, providerContext: { ...result.providerContext, thoughtSignature: "x".repeat(16_385) } }]] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...valid, provider: { ...provider, providerType: "openai", baseUrl: "https://api.openai.com/v1", envVarName: "OPENAI_API_KEY" } }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...valid, toolHistory: [[{ ...result, providerContext: { kind: "gemini", partIndex: 0 } }]] }).success).toBe(false);
  });

  it("treats a validated Gemini thought signature as opaque technical context", async () => {
    const provider = { providerId: "provider-gemini", providerType: "gemini", baseUrl: "https://generativelanguage.googleapis.com", envVarName: "GEMINI_API_KEY" } as const;
    const result = { requestId: "q1", tool: "getPersonProfile", args: { analysisId: "a1", personId: "10048" }, status: "success", data: { personId: "10048", workplace: "Centro", position: "Técnico", category: "A1", totals: { registro: 1, payroll: 2, difference: 1 }, blocks: { salary: { registro: 1, payroll: 2, difference: 1 }, salaryComplement: { registro: 0, payroll: 0, difference: 0 }, extraSalary: { registro: 0, payroll: 0, difference: 0 } }, status: "OK", periods: [] }, providerContext: { kind: "gemini", partIndex: 0, thoughtSignature: "sk-opaqueTechnicalSignature123" } } as const;
    const execute = vi.fn(async function* () { yield { type: "done", roundId: "r1", finishReason: "stop" } as const; });

    const response = await createChatPostHandler({ execute })(request({ ...base, phase: "respond", question: "Consulta matrícula 10048", modelId: "gemini-3.1-flash-lite", providerId: provider.providerId, provider, toolResults: [result], toolHistory: [[result]] }));

    expect(response.status).toBe(200);
    await response.text();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("skips tool planning for a general request with no available tools", async () => {
    const planTools = vi.fn();
    const streamResponse = vi.fn(async function* () {
      yield { type: "text_delta", delta: "Hola" } as const;
      yield { type: "done", finishReason: "STOP" } as const;
    });
    const adapter = { countTokens: vi.fn(async () => ({ tokens: 1, estimated: true })), planTools, streamResponse };
    const service = createChatService(async () => ({ adapter: adapter as never, apiKey: "server-only" }));
    const profile = { id: "p1", name: "Gemini", provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com", modelId: "gemini-2.5-flash", enabled: true, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: false, detectedContextWindow: 1_048_576, capabilitiesSource: "detected" as const };
    const events = [];
    for await (const event of service.execute({ ...base, phase: "plan", question: "hola", tools: [], profile, privacyBlockedTerms: ["nombre privado"] }, new AbortController().signal)) events.push(event);
    expect(planTools).not.toHaveBeenCalled();
    expect(JSON.stringify(streamResponse.mock.calls)).not.toContain("nombre privado");
    expect(JSON.stringify((adapter.countTokens as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("nombre privado");
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text_delta", delta: "Hola" }),
      expect.objectContaining({ type: "done", finishReason: "STOP" }),
    ]));
  });

  it("accepts more than 200 unique privacy terms within the shared request limits", async () => {
    const execute = vi.fn(async function* (input: { roundId: string }) {
      yield { type: "text_delta", roundId: input.roundId, delta: "Respuesta segura" } as const;
      yield { type: "done", roundId: input.roundId, finishReason: "STOP" } as const;
    });
    const response = await createChatPostHandler({ execute })(request({
      ...base, phase: "plan", question: "Consulta", tools: [],
      privacyBlockedTerms: Array.from({ length: 201 }, (_, index) => `persona-${index}`),
    }));

    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("instructs an analysis request to use the available local tool before answering", async () => {
    const planTools = vi.fn(async () => ({ toolCalls: [] }));
    const adapter = { countTokens: vi.fn(async () => ({ tokens: 1, estimated: true })), planTools, streamResponse: vi.fn(async function* () { yield { type: "text_delta", delta: "Respuesta" } as const; yield { type: "done", finishReason: "STOP" } as const; }) };
    const service = createChatService(async () => ({ adapter: adapter as never, apiKey: "server-only" }));
    const profile = { id: "p1", name: "Gemini", provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com", modelId: "gemini-2.5-flash", enabled: true, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: false, detectedContextWindow: 1_048_576, capabilitiesSource: "detected" as const };

    for await (const _ of service.execute({ ...base, phase: "plan", question: "Matrícula 10048", tools: ["getPersonProfile"], profile }, new AbortController().signal)) { /* consume */ }
    expect(planTools).toHaveBeenCalledWith(expect.objectContaining({ tools: [expect.objectContaining({ name: "getPersonProfile", description: expect.stringContaining("evidencia completa") })], messages: expect.arrayContaining([expect.objectContaining({ role: "system", content: expect.stringMatching(/conceptos descuadrados.*causa probable.*pendiente/is) })]) }));
  });

  it.each(["plan", "respond", "continue"] as const)("accepts strict %s and emits only validated NDJSON", async (phase) => {
    const execute = vi.fn(async function* () {
      yield { type: "status", roundId: "r1", label: "Procesando" } as const;
      yield { type: "done", roundId: "r1", finishReason: "stop" } as const;
    });
    const body = phase === "plan" ? { ...base, phase, question: "Consulta matrícula 10048", tools: ["getPersonProfile"] }
      : phase === "respond" ? { ...base, phase, question: "Consulta matrícula 10048", toolResults: [{ requestId: "q1", tool: "getPersonProfile", result: { personId: "10048", workplace: "Centro", position: "Técnico", category: "A1", totals: { registro: 1, payroll: 2, difference: 1 }, blocks: { salary: { registro: 1, payroll: 2, difference: 1 }, salaryComplement: { registro: 0, payroll: 0, difference: 0 }, extraSalary: { registro: 0, payroll: 0, difference: 0 } }, status: "OK", periods: [] } }] }
      : { ...base, phase, interruptedMessageId: "m1", continuationContext: "Respuesta parcial sanitizada" };
    const response = await createChatPostHandler({ execute })(request(body));
    expect(response.status).toBe(200);
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.every((line) => assistantStreamEventSchema.safeParse(line).success)).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects unknown fields, unknown phases, wrong rounds and PII before the service", async () => {
    const execute = vi.fn(async function* () { yield { type: "done", roundId: "r1", finishReason: "stop" } as const; });
    const handler = createChatPostHandler({ execute });
    for (const body of [
      { ...base, phase: "plan", question: "Consulta", tools: [], unexpected: true },
      { ...base, phase: "other", question: "Consulta" },
      { ...base, phase: "plan", question: "Consulta", tools: [], roundNumber: 4 },
      { ...base, phase: "plan", question: "persona@example.com", tools: [] },
    ]) expect((await handler(request(body))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("propagates cancellation/deadline and returns a sanitized error event", async () => {
    const execute = vi.fn(async function* (_input: unknown, signal: AbortSignal) {
      await new Promise<void>((resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
      yield { type: "done", roundId: "r1", finishReason: "stop" } as const;
    });
    const response = await createChatPostHandler({ execute }, { deadlineMs: 5 })(request({ ...base, phase: "plan", question: "Consulta", tools: [] }));
    const events = (await response.text()).trim().split("\n").map((line) => assistantStreamEventSchema.parse(JSON.parse(line)));
    expect(events.at(-1)).toEqual({ type: "error", roundId: "r1", code: "provider_cancelled", classification: "cancelled", message: "La comprobación fue cancelada.", retryable: false });
  });
});
