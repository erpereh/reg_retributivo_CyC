// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_DB_VERSION, openAssistantDatabase } from "@/lib/assistant/storage/database";
import { DirectSearchIndex, type SearchIndexRecord } from "@/lib/assistant/search/directIndex";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import { createAnalysisToolRegistry } from "@/lib/assistant/tools/registry";

describe("assistant storage v2 and scoped lexical search", () => {
  beforeEach(() => vi.stubGlobal("IDBKeyRange", IDBKeyRange));

  it("migrates v1 in place, preserves records and adds scope/search indexes", async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("assistant-v2-migration", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("conversations", { keyPath: "id" });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("conversations", "readwrite");
        transaction.objectStore("conversations").put({ id: "legacy", type: "general", title: "Conservada" });
        transaction.oncomplete = () => { db.close(); resolve(); };
      };
    });

    const db = await openAssistantDatabase(factory, "assistant-v2-migration");
    expect(db.version).toBe(ASSISTANT_DB_VERSION);
    const legacy = await new Promise((resolve, reject) => {
      const request = db.transaction("conversations").objectStore("conversations").get("legacy");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(legacy).toEqual({ id: "legacy", type: "general", title: "Conservada" });
    const documentIndexes = Array.from(db.transaction("documents").objectStore("documents").indexNames);
    const sourceIndexes = Array.from(db.transaction("sources").objectStore("sources").indexNames);
    expect(documentIndexes).toEqual(expect.arrayContaining(["scopeType", "scopeAnalysisId", "scopeConversationId", "status"]));
    expect(sourceIndexes).toContain("availability");
    db.close();
  });

  it("searches sanitized facets lexically and isolates scope and availability", async () => {
    const records: SearchIndexRecord[] = [
      { id: "a1", scope: { type: "analysis", analysisId: "analysis-1" }, availability: "available", sanitizedHash: "h1", sanitizedSourceLabel: "Registro · hoja Datos", content: "matrícula 10048 periodo enero concepto SAL", facets: { employeeId: ["10048"], period: ["enero"], concept: ["SAL"], position: ["Técnico"], category: ["A1"], family: ["Operaciones"], valuation: ["V1"], grouping: ["Grupo A"], sheet: ["Datos"], row: ["7"], cell: ["B7"], sourceType: ["xlsx"] } },
      { id: "a2", scope: { type: "analysis", analysisId: "analysis-2" }, availability: "available", sanitizedHash: "h2", sanitizedSourceLabel: "Otro", content: "matrícula 10048", facets: { employeeId: ["10048"] } },
      { id: "old", scope: { type: "analysis", analysisId: "analysis-1" }, availability: "historical_unavailable", sanitizedHash: "h3", sanitizedSourceLabel: "Histórico", content: "matrícula 10048", facets: { employeeId: ["10048"] } },
    ];
    const index = new DirectSearchIndex(records);
    const result = await index.search({ scope: { type: "analysis", analysisId: "analysis-1" }, query: "10048 SAL", facets: { sourceType: ["xlsx"], cell: ["B7"] }, limit: 10 });
    expect(result).toEqual([{ documentId: "a1", chunkId: "a1", sanitizedHash: "h1", sanitizedSourceLabel: "Registro · hoja Datos", excerpt: "matrícula 10048 periodo enero concepto SAL", score: expect.any(Number) }]);
  });

  it("rejects PII and unsupported facet keys before searching", async () => {
    const index = new DirectSearchIndex([]);
    await expect(index.search({ scope: { type: "analysis", analysisId: "analysis-1" }, query: "persona@example.com", limit: 10 })).rejects.toThrow(/privacidad|sensible/i);
    await expect(index.search({ scope: { type: "analysis", analysisId: "analysis-1" }, query: "10048", facets: { name: ["Persona"] } as never, limit: 10 })).rejects.toThrow();
  });

  it("persists facet/scope availability and rebuilds the scoped search index after reload", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "assistant-rebuild-search" });
    await repositories.writeIngestionBlock({
      document: { id: "doc-1", sanitizedSourceLabel: "Registro · Datos", scope: { type: "analysis", analysisId: "a1" }, mediaType: "xlsx", status: "ready", createdAt: "2026-07-13", updatedAt: "2026-07-13" },
      chunks: [{ id: "chunk-1", documentId: "doc-1", sequence: 0, content: "matrícula 10048 concepto SAL", snippet: "10048 SAL", sanitizedHash: "hash-1", terms: ["10048", "sal"], facets: { employeeId: ["10048"], concept: ["SAL"], cell: ["B7"], sourceType: ["xlsx"] } }],
      searchTerms: [{ id: "term-1", documentId: "doc-1", chunkId: "chunk-1", term: "10048", positions: [10], facets: { employeeId: ["10048"], cell: ["B7"] } }],
      indexJob: { id: "job-1", documentId: "doc-1", status: "ready", indexedChunkIds: ["chunk-1"] },
    });
    const storedChunk = await repositories.chunks.get("chunk-1");
    expect(storedChunk).toEqual(expect.objectContaining({ scope: { type: "analysis", analysisId: "a1" }, availability: "available", facets: expect.objectContaining({ cell: ["B7"] }) }));
    expect(await repositories.searchTerms.get("term-1")).toEqual(expect.objectContaining({ scope: { type: "analysis", analysisId: "a1" }, availability: "available", facets: expect.objectContaining({ cell: ["B7"] }) }));
    const rebuilt = await repositories.buildSearchIndex({ type: "analysis", analysisId: "a1" });
    await expect(rebuilt.search({ scope: { type: "analysis", analysisId: "a1" }, query: "10048", facets: { cell: ["B7"] }, limit: 10 })).resolves.toEqual([expect.objectContaining({ documentId: "doc-1", chunkId: "chunk-1", sanitizedHash: "hash-1" })]);
    const registry = createAnalysisToolRegistry({
      conversation: { id: "c1", type: "analysis", analysisId: "a1" },
      analysis: { id: "a1", result: { people: [], payrollRecords: [], registroEmployees: [] } as never },
      searchIndex: rebuilt,
      chunks: [storedChunk as never],
      documents: [{ id: "doc-1", scope: { type: "analysis", analysisId: "a1" }, availability: "available", sanitizedSourceLabel: "Registro autorizado", sourceType: "xlsx", content: "matrícula 10048 contenido autorizado", sanitizedHash: "hash-documento-autorizado" }],
    });
    await expect(registry.execute("searchDocumentChunks", { analysisId: "a1", query: "10048", limit: 10 })).resolves.toEqual({ matches: [{ sourceId: "doc-1", chunkId: "chunk-1", sanitizedSourceLabel: "Registro autorizado", sourceType: "xlsx", excerpt: "matrícula 10048 concepto SAL", sanitizedHash: "hash-1", facets: { employeeId: ["10048"], concept: ["SAL"], cell: ["B7"], sourceType: ["xlsx"] } }] });
    repositories.close();
  });

  it("runtime-validates typed snapshots and cleanup jobs", async () => {
    const repositories = await createIndexedDbRepositories({ factory: new IDBFactory(), dbName: "assistant-typed-records" });
    await expect(repositories.snapshots.put({ id: "snapshot-1" } as never)).rejects.toThrow();
    await expect(repositories.cleanupJobs.put({ id: "cleanup-1", attempts: -1 } as never)).rejects.toThrow();
    await expect(repositories.snapshots.put({ id: "snapshot-1", conversationId: "c1", analysisId: "a1", summary: "Resumen", summarizedMessageIds: ["m1"], decisions: [], figures: [], sourceIds: [], actionIds: [], personIds: [], analysisVersion: "v1", actualStrategy: "automatic", actualResponseMode: "strict", createdAt: "2026-07-13" })).resolves.toBeUndefined();
    repositories.close();
  });
});
