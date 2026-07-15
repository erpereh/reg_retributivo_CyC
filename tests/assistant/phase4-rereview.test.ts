import { describe, expect, it, vi } from "vitest";
import { AssistantOrchestrator, createRepositoryRequestScopeValidator } from "@/lib/assistant/orchestration/assistantOrchestrator";
import { createChatPostHandler, createChatService } from "@/lib/assistant/server/chatService";
import { ProviderAdapterError, type AIProviderAdapter, type ProviderMessage } from "@/lib/assistant/providers/types";
import type { AnalysisToolRegistry } from "@/lib/assistant/tools/registry";

const profile = { id: "p1", name: "Fake", provider: "openai", baseUrl: "https://api.openai.com/v1", modelId: "m1", enabled: true, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true, detectedContextWindow: 10_000, capabilitiesSource: "detected" } as const;
const registry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
const validateRequestScope = vi.fn(async () => undefined);
function routeTransport(handler: (request: Request) => Promise<Response>) { return (body: Record<string, unknown>, signal?: AbortSignal) => handler(new Request("http://local/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal })); }
function adapter(overrides: Partial<AIProviderAdapter>): AIProviderAdapter { return { listModels: vi.fn(), getModelMetadata: vi.fn(), countTokens: vi.fn(async () => ({ tokens: 100, estimated: false })), probeCapabilities: vi.fn(), planTools: vi.fn(async () => ({ toolCalls: [] })), streamResponse: vi.fn(async function* () { yield { type: "done", finishReason: "stop" } as const; }), ...overrides } as AIProviderAdapter; }

describe("phase 4 rereview integrated regressions", () => {
  it("preserves a real adapter partial through route, persists it, then continues without repeating the question", async () => {
    let streams = 0; const providerMessages: ProviderMessage[][] = []; const persisted: unknown[] = [];
    const fake = adapter({ streamResponse: vi.fn(async function* (request) { streams += 1; providerMessages.push([...request.messages]); if (streams === 1) { yield { type: "text_delta", delta: "Parcial seguro" } as const; throw new ProviderAdapterError("transient"); } yield { type: "text_delta", delta: " continuado" } as const; yield { type: "done", finishReason: "stop" } as const; }) });
    const handler = createChatPostHandler(createChatService(async () => ({ adapter: fake, apiKey: "server-key" })));
    const orchestrator = new AssistantOrchestrator({ transport: routeTransport(handler), registry, validateRequestScope, persistMessage: async (message: unknown) => { persisted.push(message); }, idFactory: () => "11111111-1111-4111-8111-111111111111" } as never);
    await expect(orchestrator.send({ conversationId: "c1", question: "Pregunta original", modelProfileId: "p1", modelId: "m1", profile, responseMode: "strict", contextStrategy: "automatic" })).resolves.toMatchObject({ text: "Parcial seguro continuado" });
    expect(persisted).toEqual([expect.objectContaining({ status: "interrupted", content: "Parcial seguro" }), expect.objectContaining({ status: "completed", content: "Parcial seguro continuado" })]);
    expect(providerMessages[1]).toEqual(expect.arrayContaining([{ role: "assistant", content: "Parcial seguro" }, { role: "user", content: "Pregunta original" }]));
  });

  it("automatically warns and compacts at adapter-counted thresholds without caller-precomputed compaction", async () => {
    const planTools = vi.fn(async () => ({ toolCalls: [] }));
    const fake = adapter({ countTokens: vi.fn(async ({ text }) => ({ tokens: text.includes("Resumen de contexto") ? 200 : text.includes("HISTORIA-LARGA") ? 6_000 : 100, estimated: false })), planTools });
    const body = { phase: "plan", executionId: "11111111-1111-4111-8111-111111111111", conversationId: "c1", roundId: "r1", roundNumber: 1, modelProfileId: "p1", modelId: "m1", profile, responseMode: "strict", contextStrategy: "automatic", question: "Resumen", tools: [], contextCandidates: [{ id: "old", kind: "message", content: "HISTORIA-LARGA", tokens: 1, relevance: 1, sourceId: "s1", sanitizedHash: "h1", factKey: "history:old", scope: { type: "conversation", conversationId: "c1" } }] };
    const response = await createChatPostHandler(createChatService(async () => ({ adapter: fake, apiKey: "key" })))(new Request("http://local/chat", { method: "POST", body: JSON.stringify(body) }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "status", code: "context_warning" }), expect.objectContaining({ type: "status", code: "context_compacted", snapshot: expect.objectContaining({ summarizedMessageIds: ["old"] }) })]));
    expect(planTools).toHaveBeenCalledOnce();
  });

  it("namespaces two sends with distinct execution/round/message ids even when upstream ids repeat", async () => {
    const bodies: Record<string, unknown>[] = []; const persisted: Array<{ id: string }> = []; let id = 0;
    const transport = async (body: Record<string, unknown>) => { bodies.push(body); return new Response(`${JSON.stringify({ type: "text_delta", roundId: body.roundId, messageId: "upstream-repeat", delta: "ok" })}\n${JSON.stringify({ type: "done", roundId: body.roundId, finishReason: "stop" })}\n`); };
    const orchestrator = new AssistantOrchestrator({ transport, registry, validateRequestScope, persistMessage: async (message: { id: string }) => { persisted.push(message); }, idFactory: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` } as never);
    const input = { conversationId: "c1", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "strict" as const, contextStrategy: "automatic" as const };
    await orchestrator.send(input); await orchestrator.send(input);
    expect(bodies[0]?.executionId).not.toBe(bodies[1]?.executionId);
    expect(bodies[0]?.roundId).not.toBe(bodies[1]?.roundId);
    expect(persisted[0]?.id).not.toBe(persisted[1]?.id);
  });

  it("keeps a global maximum of three POSTs across tool rounds, retry and fallback", async () => {
    const transport = vi.fn(async (body: Record<string, unknown>) => new Response(`${JSON.stringify({ type: "text_delta", roundId: body.roundId, messageId: "m", delta: "x" })}\n${JSON.stringify({ type: "error", roundId: body.roundId, code: "provider_transient", classification: "transient", message: "Temporal", retryable: true })}\n`));
    const fallback = { ...profile, id: "p2", modelId: "m2" };
    await expect(new AssistantOrchestrator({ transport, registry, validateRequestScope } as never).send({ conversationId: "c1", question: "Resumen", modelProfileId: "p1", modelId: "m1", profile, compatibleDefaultProfile: fallback, responseMode: "strict", contextStrategy: "automatic" })).rejects.toMatchObject({ classification: "transient" });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("transports a Manual key to the local resolver while excluding it from privacy audit", async () => {
    const manual = { ...profile, provider: "manual" as const, baseUrl: "https://models.example.test/v1" };
    const seen: string[] = [];
    const handler = createChatPostHandler(createChatService(async (input) => { seen.push(input.apiKey ?? ""); return { adapter: adapter({ streamResponse: vi.fn(async function* () { yield { type: "text_delta", delta: "Respuesta válida" } as const; yield { type: "done", finishReason: "stop" } as const; }) }), apiKey: input.apiKey! }; }));
    const result = await new AssistantOrchestrator({ transport: routeTransport(handler), registry, validateRequestScope } as never).send({ conversationId: "c1", question: "Resumen", modelProfileId: "p1", modelId: "m1", profile: manual, apiKey: "manual-secret-value", responseMode: "strict", contextStrategy: "automatic" });
    expect(result).toMatchObject({ text: "Respuesta válida" }); expect(seen).toEqual(["manual-secret-value"]);
  });

  it("does not publish stale state when replacement aborts during persistence", async () => {
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); const metadata: unknown[] = []; let writes = 0;
    const transport = async (body: Record<string, unknown>) => new Response(`${JSON.stringify({ type: "text_delta", roundId: body.roundId, messageId: "m", delta: "ok" })}\n${JSON.stringify({ type: "done", roundId: body.roundId, finishReason: "stop" })}\n`);
    const persistMessage = vi.fn(async (_message: unknown, context?: { signal: AbortSignal }) => { writes += 1; if (writes === 1) await gate; if (context?.signal.aborted) throw context.signal.reason; });
    const orchestrator = new AssistantOrchestrator({ transport, registry, validateRequestScope, persistMessage, persistRunMetadata: async (value: unknown) => { metadata.push(value); } } as never);
    const input = { conversationId: "c1", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "strict" as const, contextStrategy: "automatic" as const };
    const old = orchestrator.send(input); await vi.waitFor(() => expect(persistMessage).toHaveBeenCalledTimes(1)); const current = orchestrator.send(input); release();
    await expect(old).rejects.toThrow(); await expect(current).resolves.toMatchObject({ text: "ok" }); expect(metadata).toHaveLength(1);
  });

  it("streams an audited prefix soon enough for Stop to retain real adapter output", async () => {
    let started!: () => void; const didStart = new Promise<void>((resolve) => { started = resolve; });
    const fake = adapter({ streamResponse: vi.fn(async function* ({ signal }) {
      yield { type: "text_delta", delta: "A".repeat(1_024) } as const; started();
      await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }) });
    const handler = createChatPostHandler(createChatService(async () => ({ adapter: fake, apiKey: "server-key" })));
    const orchestrator = new AssistantOrchestrator({ transport: routeTransport(handler), registry, validateRequestScope } as never);
    const active = orchestrator.send({ conversationId: "c1", question: "Resumen", modelProfileId: "p1", modelId: "m1", profile, responseMode: "strict", contextStrategy: "automatic" });
    await didStart; orchestrator.stop();
    await expect(active).rejects.toMatchObject({ status: "stopped", partialText: expect.stringMatching(/^A{512,}$/) });
  });

  it("binds client requests to authoritative local conversation, message and document records before transport", async () => {
    const records = {
      conversations: { get: vi.fn(async () => ({ id: "c1", type: "analysis", analysisId: "a1" })) },
      messages: { get: vi.fn(async () => ({ id: "m1", conversationId: "c1" })) },
      documents: { get: vi.fn(async () => ({ id: "d1", scope: { type: "analysis", analysisId: "a1" }, status: "ready", sanitizedSourceLabel: "Doc", mediaType: "txt", content: "fragmento", sanitizedHash: "h1" })) },
      chunks: { get: vi.fn(async () => undefined) },
      sources: { get: vi.fn(async () => undefined) },
    };
    const validate = createRepositoryRequestScopeValidator(records as never);
    await expect(validate({ conversationId: "c1", analysisId: "a1", interruptedMessageId: "m1", toolResults: [{ sources: [{ id: "tool-source-c1-d1", conversationId: "c1", analysisId: "a1", documentId: "d1", sourceType: "txt", sanitizedSourceLabel: "Doc", availability: "available", conceptIds: [], excerpt: "fragmento", sanitizedHash: "h1" }] }] }, { signal: new AbortController().signal, executionId: "x", generation: 1 })).resolves.toBeUndefined();
    const transport = vi.fn();
    await expect(new AssistantOrchestrator({ transport, registry, validateRequestScope: validate } as never).send({ conversationId: "c1", analysisId: "a2", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic" })).rejects.toMatchObject({ classification: "privacy" });
    expect(transport).not.toHaveBeenCalled();
  });
});
