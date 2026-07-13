import { describe, expect, it, vi } from "vitest";
import { AssistantOrchestrator, createRepositoryRequestScopeValidator } from "@/lib/assistant/orchestration/assistantOrchestrator";
import { createChatPostHandler, createChatService } from "@/lib/assistant/server/chatService";
import { createAnalysisToolRegistry, type AnalysisToolRegistry } from "@/lib/assistant/tools/registry";
import type { AIProviderAdapter } from "@/lib/assistant/providers/types";
import type { SearchIndex } from "@/lib/assistant/search/directIndex";

const profile = { id: "p1", name: "Fake", provider: "openai", baseUrl: "https://api.openai.com/v1", modelId: "m1", enabled: true, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true, detectedContextWindow: 10_000, capabilitiesSource: "detected" } as const;
const emptyRegistry = { names: [], execute: vi.fn() } as unknown as AnalysisToolRegistry;
const allowScope = vi.fn(async () => undefined);
const adapter = (countTokens: AIProviderAdapter["countTokens"], streamResponse?: AIProviderAdapter["streamResponse"]): AIProviderAdapter => ({ listModels: vi.fn(), getModelMetadata: vi.fn(), countTokens, probeCapabilities: vi.fn(), planTools: vi.fn(async () => ({ toolCalls: [] })), streamResponse: streamResponse ?? vi.fn(async function* () { yield { type: "done", finishReason: "stop" } as const; }) } as AIProviderAdapter);
const events = async (response: Response) => (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const baseBody = { phase: "plan", executionId: "11111111-1111-4111-8111-111111111111", conversationId: "c1", analysisId: "a1", roundId: "r1", roundNumber: 1, modelProfileId: "p1", modelId: "m1", profile, responseMode: "strict", contextStrategy: "automatic", question: "Resumen", tools: [], contextCandidates: [{ id: "old", kind: "message", content: "HISTORIA-LARGA", tokens: 1, relevance: 1, sourceId: "s1", sanitizedHash: "h1", factKey: "history:old", scope: { type: "analysis", analysisId: "a1" } }], compactionLineage: { decisions: ["Mantener criterio"], figures: [125], sourceIds: ["s1"], actionIds: ["ac1"], personIds: ["10048"], analysisVersion: "v7" } } as const;

describe("phase 4 final review regressions", () => {
  it("preserves complete compaction lineage and rejects a second plan that remains at 85 percent", async () => {
    const compacting = adapter(vi.fn(async ({ text }) => ({ tokens: text.includes("Resumen de contexto") ? 200 : text.includes("HISTORIA-LARGA") ? 6_000 : 100, estimated: false })));
    const successful = await events(await createChatPostHandler(createChatService(async () => ({ adapter: compacting, apiKey: "key" })))(new Request("http://local/chat", { method: "POST", body: JSON.stringify(baseBody) })));
    expect(successful).toEqual(expect.arrayContaining([expect.objectContaining({ type: "status", code: "context_compacted", snapshot: expect.objectContaining({ decisions: ["Mantener criterio"], figures: [125], sourceIds: ["s1"], actionIds: ["ac1"], personIds: ["10048"], analysisVersion: "v7" }) })]));
    const stillLarge = adapter(vi.fn(async ({ text }) => ({ tokens: text.includes("HISTORIA-LARGA") || text.includes("Resumen de contexto") ? 6_000 : 100, estimated: false })));
    const rejected = await events(await createChatPostHandler(createChatService(async () => ({ adapter: stillLarge, apiKey: "key" })))(new Request("http://local/chat", { method: "POST", body: JSON.stringify(baseBody) })));
    expect(rejected).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: "context_compacted" })]));
    expect(rejected.at(-1)).toMatchObject({ type: "error", classification: "context" });
    expect(stillLarge.planTools).not.toHaveBeenCalled();
  });

  it("raises output_too_large before a partial can exceed continuationContext", async () => {
    const huge = adapter(vi.fn(async () => ({ tokens: 100, estimated: false })), vi.fn(async function* () { yield { type: "text_delta", delta: "x".repeat(16_384) } as const; yield { type: "text_delta", delta: "y" } as const; }));
    const result = await events(await createChatPostHandler(createChatService(async () => ({ adapter: huge, apiKey: "key" })))(new Request("http://local/chat", { method: "POST", body: JSON.stringify({ ...baseBody, contextCandidates: [], compactionLineage: undefined }) })));
    expect(result.at(-1)).toMatchObject({ type: "error", code: "output_too_large", classification: "context" });
    expect(result.filter((event) => event.type === "text_delta").reduce((sum, event) => sum + event.delta.length, 0)).toBeLessThanOrEqual(16_384);
  });

  it("rejects foreign candidates, absent tool sources and invented chunk ids against local authority", async () => {
    const records = { conversations: { get: vi.fn(async () => ({ id: "c1", type: "analysis", analysisId: "a1" })) }, messages: { get: vi.fn(async () => undefined) }, documents: { get: vi.fn(async (id: string) => id === "foreign" ? ({ id, scope: { type: "analysis", analysisId: "a2" }, status: "ready" }) : ({ id, scope: { type: "analysis", analysisId: "a1" }, status: "ready" })) }, chunks: { get: vi.fn(async () => undefined) }, sources: { get: vi.fn(async () => undefined) } };
    const validate = createRepositoryRequestScopeValidator(records as never); const context = { signal: new AbortController().signal, executionId: "e1", generation: 1 };
    await expect(validate({ conversationId: "c1", analysisId: "a1", contextCandidates: [{ id: "x", sourceId: "foreign", scope: { type: "analysis", analysisId: "a1" } }] }, context)).rejects.toMatchObject({ classification: "privacy" });
    await expect(validate({ conversationId: "c1", analysisId: "a1", toolResults: [{ sources: [{ id: "missing", conversationId: "c1", analysisId: "a1", availability: "available", sanitizedHash: "h" }] }] }, context)).rejects.toMatchObject({ classification: "privacy" });
    const searchIndex: SearchIndex = { search: async () => [{ documentId: "d1", chunkId: "invented", sanitizedSourceLabel: "Falso", excerpt: "falso", sanitizedHash: "falso", score: 1 }] };
    const registry = createAnalysisToolRegistry({ conversation: { id: "c1", type: "analysis", analysisId: "a1" }, analysis: { id: "a1", result: { people: [], payrollRecords: [], registroEmployees: [] } as never }, documents: [{ id: "d1", scope: { type: "analysis", analysisId: "a1" }, availability: "available", sanitizedSourceLabel: "Doc", sourceType: "txt", content: "autoritativo", sanitizedHash: "doc-hash" }], chunks: [{ id: "real", documentId: "d1", scope: { type: "analysis", analysisId: "a1" }, availability: "available", content: "fragmento autoritativo", sanitizedHash: "chunk-hash", facets: { sourceType: ["txt"] } }], searchIndex } as never);
    await expect(registry.execute("searchDocumentChunks", { analysisId: "a1", query: "dato", limit: 10 })).resolves.toEqual({ matches: [] });
  });

  it.each(["Jose\u0301 Pe\u0301rez", "JOSÉ\u00a0PÉREZ", "Jo\u200dsé Pérez"])("blocks Unicode-equivalent known name %s", async (variant) => {
    const body = { ...baseBody, contextCandidates: [], compactionLineage: undefined, privacyBlockedTerms: ["  José Pérez  "] };
    const response = await createChatPostHandler({ execute: async function* () { yield { type: "text_delta", roundId: "r1", messageId: "m1", delta: variant } as const; yield { type: "done", roundId: "r1", finishReason: "stop" } as const; } })(new Request("http://local/chat", { method: "POST", body: JSON.stringify(body) }));
    const result = await events(response); expect(result.at(-1)).toMatchObject({ type: "error", classification: "privacy" }); expect(JSON.stringify(result)).not.toContain(variant);
  });

  it("requires an authoritative validator and exposes a repository-bound product factory", async () => {
    expect(() => new AssistantOrchestrator({ transport: vi.fn(), registry: emptyRegistry } as never)).toThrow(/scope|repositorio|validator/i);
    const module = await import("@/lib/assistant/orchestration/assistantOrchestrator"); expect(module.createRepositoryBoundAssistantOrchestrator).toBeTypeOf("function");
  });

  it("keeps a stale regenerate from replacing or aborting a newer run", async () => {
    const transport = vi.fn(async (body: Record<string, unknown>) => new Response(`${JSON.stringify({ type: "text_delta", roundId: body.roundId, messageId: "m", delta: "ok" })}\n${JSON.stringify({ type: "done", roundId: body.roundId, finishReason: "stop" })}\n`));
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); let replacementContext: { signal: AbortSignal } | undefined;
    const orchestrator = new AssistantOrchestrator({ transport, registry: emptyRegistry, validateRequestScope: allowScope, markMessageReplaced: async (_id: string, context: { signal: AbortSignal }) => { replacementContext = context; await gate; } } as never);
    const input = { conversationId: "c1", question: "Resumen", modelProfileId: "p1", modelId: "m1", responseMode: "strict" as const, contextStrategy: "automatic" as const };
    await orchestrator.send(input); const stale = orchestrator.regenerate(); await vi.waitFor(() => expect(replacementContext).toBeDefined()); const current = orchestrator.send(input); release();
    await expect(stale).rejects.toThrow(); await expect(current).resolves.toMatchObject({ text: "ok" }); expect(replacementContext?.signal.aborted).toBe(true); expect(transport).toHaveBeenCalledTimes(2);
  });
});
