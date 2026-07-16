import { describe, expect, it, vi } from "vitest";
import { createRepositoryRequestScopeValidator } from "@/lib/assistant/orchestration/assistantOrchestrator";
import { createChatPostHandler } from "@/lib/assistant/server/chatService";
import { createAnalysisToolRegistry } from "@/lib/assistant/tools/registry";
import type { SearchIndex } from "@/lib/assistant/search/directIndex";
import { sourceReferenceSchema } from "@/lib/assistant/schemas";

const runContext = { signal: new AbortController().signal, executionId: "e1", generation: 1 };
const scope = { type: "analysis", analysisId: "a1" } as const;
const records = () => ({
  conversations: { get: vi.fn(async () => ({ id: "c1", type: "analysis", analysisId: "a1" })) },
  messages: { get: vi.fn(async () => undefined) },
  documents: { get: vi.fn(async (id: string) => id === "d1" ? ({ id, scope, status: "ready", sanitizedSourceLabel: "Doc", mediaType: "txt", content: "fragmento autoritativo", sanitizedHash: "chunk-hash" }) : undefined) },
  chunks: { get: vi.fn(async (id: string) => id === "chunk-1" ? ({ id, documentId: "d1", scope, availability: "available", content: "fragmento autoritativo", sanitizedHash: "chunk-hash", kind: "chunk", factKey: "chunk:chunk-1", sourceId: "d1", facets: { sourceType: ["txt"] } }) : undefined) },
  sources: { get: vi.fn(async () => undefined) },
});
const candidate = { id: "chunk-1", kind: "chunk", content: "fragmento autoritativo", tokens: 10, relevance: 1, sourceId: "d1", sanitizedHash: "chunk-hash", factKey: "chunk:chunk-1", facets: { sourceType: ["txt"] }, scope };

describe("phase 4 last review regressions", () => {
  it.each([
    ["content", { content: "inventado" }], ["hash", { sanitizedHash: "inventado" }], ["kind", { kind: "tool" }],
    ["factKey", { factKey: "inventado" }], ["facets", { facets: { sourceType: ["pdf"] } }],
  ])("rejects a chunk candidate with tampered %s", async (_field, mutation) => {
    const validate = createRepositoryRequestScopeValidator(records() as never);
    await expect(validate({ conversationId: "c1", analysisId: "a1", contextCandidates: [{ ...candidate, ...mutation }] }, runContext)).rejects.toMatchObject({ classification: "privacy" });
  });

  it("does not trust an injected index without authoritative chunks", async () => {
    const searchIndex: SearchIndex = { search: async () => [{ documentId: "d1", chunkId: "invented", sanitizedSourceLabel: "fake", excerpt: "fake", sanitizedHash: "fake", score: 1 }] };
    const registry = createAnalysisToolRegistry({ conversation: { id: "c1", type: "analysis", analysisId: "a1" }, analysis: { id: "a1", result: { people: [], payrollRecords: [], registroEmployees: [] } as never }, documents: [{ id: "d1", scope, availability: "available", sanitizedSourceLabel: "Doc", sourceType: "txt", content: "fragmento autoritativo", sanitizedHash: "chunk-hash" }], searchIndex } as never);
    await expect(registry.execute("searchDocumentChunks", { analysisId: "a1", query: "dato", limit: 10 })).resolves.toEqual({ matches: [] });
  });

  it("blocks a known name split by more than the raw buffer in Unicode format characters", async () => {
    const body = { phase: "plan", conversationId: "c1", roundId: "r1", roundNumber: 1, modelProfileId: "p1", modelId: "m1", responseMode: "strict", contextStrategy: "automatic", question: "Resumen", tools: [], privacyBlockedTerms: ["José Pérez"] };
    const response = await createChatPostHandler({ execute: async function* () { yield { type: "text_delta", roundId: "r1", messageId: "m1", delta: `José${"\u200d".repeat(600)}` } as const; yield { type: "text_delta", roundId: "r1", messageId: "m1", delta: "\u00a0Pérez" } as const; yield { type: "done", roundId: "r1", finishReason: "stop" } as const; } })(new Request("http://local/chat", { method: "POST", body: JSON.stringify(body) }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line)); expect(events.at(-1)).toMatchObject({ type: "error", classification: "privacy" }); expect(events.filter((event) => event.type === "text_delta")).toEqual([]);
  });

  it("rejects tampered document and self-attested synthetic sources and requires tool sources", async () => {
    const validate = createRepositoryRequestScopeValidator(records() as never);
    const base = { conversationId: "c1", analysisId: "a1" };
    const documentSource = { id: "tool-source-c1-d1", conversationId: "c1", analysisId: "a1", documentId: "d1", sourceType: "txt", sanitizedSourceLabel: "Doc", availability: "available", conceptIds: [], excerpt: "inventado", sanitizedHash: "chunk-hash" };
    await expect(validate({ ...base, toolResults: [{ requestId: "q1", tool: "searchDocumentChunks", data: { matches: [] }, sources: [documentSource] }] }, runContext)).rejects.toMatchObject({ classification: "privacy" });
    const synthetic = { id: "tool-source-evil", conversationId: "c1", analysisId: "a1", sourceType: "analysis", sanitizedSourceLabel: "Análisis", availability: "available", conceptIds: [], excerpt: "inventado", sanitizedHash: "evil" };
    await expect(validate({ ...base, toolResults: [{ requestId: "q2", tool: "getAnalysisSummary", data: { summary: { uniquePeople: 1 } }, sources: [synthetic] }] }, runContext)).rejects.toMatchObject({ classification: "privacy" });
    await expect(validate({ ...base, toolResults: [{ requestId: "q3", tool: "getAnalysisSummary", data: {} }] }, runContext)).rejects.toMatchObject({ classification: "privacy" });
    await expect(validate({ ...base, toolResults: [{ requestId: "q4", tool: "getPersonProfile", status: "failed", error: { code: "tool_failed", message: "No se pudo completar la consulta local." }, sources: [] }] }, runContext)).resolves.toBeUndefined();
  });

  it.each(["tool", "metadata", "lexical", "message"] as const)("binds a real strict SourceReference to a %s candidate identity", async (kind) => {
    const source = sourceReferenceSchema.parse({ id: "source-1", conversationId: "c1", analysisId: "a1", sourceType: "analysis", sanitizedSourceLabel: "Hecho", availability: "available", conceptIds: [], excerpt: "contenido autoritativo", sanitizedHash: "hash-1" });
    const repository = records(); repository.sources.get = vi.fn(async (id: string) => id === source.id ? source : undefined) as never;
    const validate = createRepositoryRequestScopeValidator(repository as never);
    const exact = { id: source.id, kind, content: source.excerpt, tokens: 1, relevance: 1, sourceId: source.id, sanitizedHash: source.sanitizedHash, factKey: `${kind}:fact`, scope };
    await expect(validate({ conversationId: "c1", analysisId: "a1", contextCandidates: [exact] }, runContext)).resolves.toBeUndefined();
    await expect(validate({ conversationId: "c1", analysisId: "a1", contextCandidates: [{ ...exact, id: "forged" }] }, runContext)).rejects.toMatchObject({ classification: "privacy" });
  });
});
