// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange, IDBObjectStore, IDBTransaction } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ASSISTANT_STORES, openAssistantDatabase } from "@/lib/assistant/storage/database";
import { AssistantStorageError, createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import { PrivacyBoundaryError } from "@/lib/assistant/privacy/assertions";
import type { ChatMessage, Conversation, SourceReference } from "@/lib/assistant/domain";

const conversation = (id: string, updatedAt = "2026-07-13T10:00:00.000Z"): Conversation => ({
  id, type: "general", title: id, associatedPersonIds: [], modelProfileId: "fake-model", responseMode: "strict",
  contextStrategy: "automatic", status: "active", createdAt: updatedAt, updatedAt,
});

const message = (id: string, conversationId: string, createdAt: string): ChatMessage => ({
  id, conversationId, role: "user", content: `Mensaje ${id}`, status: "completed", contextOrigin: "general",
  modelProfileId: "fake-model", responseMode: "strict", contextStrategy: "automatic", sourceRefIds: [], actionIds: [], createdAt,
});

const source = (id: string, conversationId: string): SourceReference => ({
  id, conversationId, sourceType: "person_profile", sanitizedSourceLabel: "Persona matrícula 10048", availability: "available",
  personId: "10048", conceptIds: [], excerpt: "Totales locales", sanitizedHash: `hash-${id}`,
});

describe("assistant IndexedDB repositories", () => {
  let factory: IDBFactory;

  beforeEach(() => {
    factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("IDBTransaction", IDBTransaction);
  });

  afterEach(() => vi.unstubAllGlobals());

  test("creates the complete idempotent version 4 schema", async () => {
    const db = await openAssistantDatabase(factory, "schema-test");
    expect(Array.from(db.objectStoreNames)).toEqual([...ASSISTANT_STORES].sort());
    db.close();
    const reloaded = await openAssistantDatabase(factory, "schema-test");
    expect(reloaded.version).toBe(4);
    expect(Array.from(reloaded.objectStoreNames)).toEqual([...ASSISTANT_STORES].sort());
    reloaded.close();
  });

  test("creates and reloads conversations and messages without localStorage fallback", async () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, "setItem");
    const first = await createIndexedDbRepositories({ factory, dbName: "reload-test" });
    await first.conversations.put(conversation("c1"));
    await first.messages.put(message("m1", "c1", "2026-07-13T10:01:00.000Z"));
    first.close();

    const second = await createIndexedDbRepositories({ factory, dbName: "reload-test" });
    expect(await second.conversations.get("c1")).toEqual(conversation("c1"));
    expect((await second.messages.listByConversation("c1", { limit: 10 })).items).toHaveLength(1);
    expect(localStorageSpy).not.toHaveBeenCalled();
    second.close();
  });

  test("paginates messages with an opaque cursor instead of loading an aggregate", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "pagination-test" });
    await repositories.messages.put(message("m1", "c1", "2026-07-13T10:01:00.000Z"));
    await repositories.messages.put(message("m2", "c1", "2026-07-13T10:02:00.000Z"));
    await repositories.messages.put(message("m3", "c1", "2026-07-13T10:03:00.000Z"));

    const first = await repositories.messages.listByConversation("c1", { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(["m2", "m3"]);
    expect(first.nextCursor).toBeTruthy();
    const second = await repositories.messages.listByConversation("c1", { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => item.id)).toEqual(["m1"]);
    expect(second.nextCursor).toBeUndefined();
    repositories.close();
  });

  test("does not skip messages that share the same timestamp", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "pagination-tie-test" });
    const sameTime = "2026-07-13T10:01:00.000Z";
    await repositories.messages.put(message("m1", "c1", sameTime));
    await repositories.messages.put(message("m2", "c1", sameTime));
    await repositories.messages.put(message("m3", "c1", sameTime));
    const first = await repositories.messages.listByConversation("c1", { limit: 1 });
    const second = await repositories.messages.listByConversation("c1", { limit: 1, cursor: first.nextCursor });
    const third = await repositories.messages.listByConversation("c1", { limit: 1, cursor: second.nextCursor });
    expect([...first.items, ...second.items, ...third.items].map((item) => item.id)).toEqual(["m3", "m2", "m1"]);
    repositories.close();
  });

  test("exposes repositories for every required store", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "surface-test" });
    expect(Object.keys(repositories).sort()).toEqual([
      "actions", "analysisVersions", "assistantSettings", "cache", "chunks", "cleanupJobs", "conversations", "documents", "events",
      "beginAnalysisIngestion", "buildSearchIndex", "cleanupAnalysis", "clearAssistantContent", "continueAnalysisPerson", "convertConversationToAnalysis", "copyDocumentCorpus", "deleteConversation", "deleteDocumentCorpus", "indexJobs", "messages", "modelProfiles", "replaceAnalysisCorpus", "resolveChatAction", "searchTerms", "snapshots", "sources", "syncAnalysisVersion", "transferDocumentCorpus", "updateActiveConversation", "writeConversationBlock", "writeIngestionBlock", "writeModelConfiguration", "close",
    ].sort());
    repositories.close();
  });

  test("writes conversation, messages and sources in one transaction", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "atomic-test" });
    await repositories.writeConversationBlock({ conversation: conversation("c1"), messages: [message("m1", "c1", "2026-07-13T10:01:00.000Z")], sources: [source("s1", "c1")] });
    expect(await repositories.conversations.get("c1")).toBeTruthy();
    expect((await repositories.messages.listByConversation("c1", { limit: 10 })).items).toHaveLength(1);
    expect(await repositories.sources.get("s1")).toBeTruthy();
    repositories.close();
  });

  test("keeps the existing sanitized glossary response persistable", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase1-compat-test" });
    const conversationId = `conversation-${crypto.randomUUID()}`;
    const user = { ...message(`message-${crypto.randomUUID()}`, conversationId, new Date().toISOString()), content: "¿Qué es Cuadre Reg.?" };
    const assistant = { ...message(`message-${crypto.randomUUID()}`, conversationId, new Date().toISOString()), role: "assistant" as const, content: "Retributivo compara el Registro Retributivo y los recibos. Cuadre Reg. muestra sus diferencias; conceptos y agrupaciones organizan el análisis." };
    await expect(repositories.writeConversationBlock({ conversation: conversation(conversationId, new Date().toISOString()), messages: [user, assistant], sources: [] })).resolves.toBeUndefined();
    repositories.close();
  });

  test("aborts the whole block and returns a sanitized quota error", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "quota-test" });
    const originalPut = IDBObjectStore.prototype.put;
    const putSpy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value: unknown) {
      if ((value as { id?: string }).id === "m1") throw new DOMException("raw private payload", "QuotaExceededError");
      return originalPut.call(this, value);
    });

    await expect(repositories.writeConversationBlock({ conversation: conversation("c1"), messages: [message("m1", "c1", "2026-07-13T10:01:00.000Z")], sources: [] }))
      .rejects.toEqual(new AssistantStorageError("quota_exceeded", "No hay espacio suficiente para guardar el bloque del Asistente."));
    expect(await repositories.conversations.get("c1")).toBeUndefined();
    expect(putSpy).toHaveBeenCalled();
    repositories.close();
  });

  test("audits every sensitive store recursively before put", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "privacy-put-test" });
    await expect(repositories.chunks.put({ id: "unsafe", content: "ana@example.com" })).rejects.toBeInstanceOf(PrivacyBoundaryError);
    await expect(repositories.documents.put({ id: "unsafe", originalFileName: "nomina.pdf" } as never)).rejects.toBeInstanceOf(PrivacyBoundaryError);
    expect(await repositories.chunks.get("unsafe")).toBeUndefined();
    expect(await repositories.documents.get("unsafe")).toBeUndefined();
    repositories.close();
  });

  test("persists sanitized ingestion records atomically after all audits", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "ingestion-atomic-test" });
    await repositories.writeIngestionBlock({
      document: { id: "d1", sanitizedSourceLabel: "Documento adicional 1", scope: { type: "conversation", conversationId: "c1" }, mediaType: "txt", status: "ready", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      chunks: [{ id: "ch1", documentId: "d1", sequence: 0, content: "texto sanitizado", snippet: "texto sanitizado", sanitizedHash: "abc", terms: ["texto"] }],
      searchTerms: [{ id: "term1", documentId: "d1", chunkId: "ch1", term: "texto", positions: [0] }],
      indexJob: { id: "job1", documentId: "d1", status: "ready", indexedChunkIds: ["ch1"] },
    });
    expect(await repositories.documents.get("d1")).toBeTruthy();
    expect(await repositories.chunks.get("ch1")).toBeTruthy();
    expect(await repositories.searchTerms.get("term1")).toBeTruthy();
    expect(await repositories.indexJobs.get("job1")).toBeTruthy();
    repositories.close();
  });

  async function seedCorpus(repositories: Awaited<ReturnType<typeof createIndexedDbRepositories>>, id: string, conversationId: string): Promise<void> {
    await repositories.writeIngestionBlock({
      document: { id, sanitizedSourceLabel: `Documento ${id}`, scope: { type: "conversation", conversationId }, mediaType: "txt", status: "ready", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      chunks: [{ id: `${id}-chunk`, documentId: id, sequence: 0, content: "texto sanitizado", snippet: "texto", sanitizedHash: "abc", terms: ["texto"] }],
      searchTerms: [{ id: `${id}-term`, documentId: id, chunkId: `${id}-chunk`, term: "texto", positions: [0] }],
      indexJob: { id: `${id}-job`, documentId: id, status: "ready", indexedChunkIds: [`${id}-chunk`] },
    });
  }

  const analysisBlock = (analysisId: string, documentId: string, chunkIds: readonly string[]) => ({
    document: { id: documentId, sanitizedSourceLabel: `Documento ${documentId}`, scope: { type: "analysis" as const, analysisId }, mediaType: "txt" as const, status: "ready" as const, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    chunks: chunkIds.map((id, sequence) => ({ id, documentId, sequence, content: `texto sanitizado ${sequence}`, snippet: "texto sanitizado", sanitizedHash: `hash-${sequence}`, terms: ["texto"] })),
    searchTerms: chunkIds.map((chunkId, sequence) => ({ id: `${chunkId}-term`, documentId, chunkId, term: "texto", positions: [sequence] })),
    indexJob: { id: `${documentId}-index`, documentId, status: "ready" as const, indexedChunkIds: chunkIds },
  });

  test("copies only the selected conversation corpus including index jobs in one transaction", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "copy-corpus-test" });
    await seedCorpus(repositories, "d1-copy-special", "c1");
    await seedCorpus(repositories, "d2", "c2");
    const mappings = await repositories.copyDocumentCorpus({ sourceConversationId: "c1", targetConversationId: "c3", documentIds: ["d1-copy-special"] });
    expect(mappings).toEqual([{ sourceDocumentId: "d1-copy-special", targetDocumentId: "d1-copy-special-copy-c3" }]);
    expect(await repositories.documents.get("d1-copy-special-copy-c3")).toEqual(expect.objectContaining({ scope: { type: "conversation", conversationId: "c3" } }));
    expect(await repositories.chunks.get("d1-copy-special-copy-c3-chunk-0")).toEqual(expect.objectContaining({ documentId: "d1-copy-special-copy-c3", scope: { type: "conversation", conversationId: "c3" } }));
    expect(await repositories.searchTerms.get("d1-copy-special-copy-c3-chunk-0-term-texto")).toEqual(expect.objectContaining({ documentId: "d1-copy-special-copy-c3", chunkId: "d1-copy-special-copy-c3-chunk-0", scope: { type: "conversation", conversationId: "c3" } }));
    expect(await repositories.indexJobs.get("d1-copy-special-copy-c3-index")).toEqual(expect.objectContaining({ documentId: "d1-copy-special-copy-c3", indexedChunkIds: ["d1-copy-special-copy-c3-chunk-0"] }));
    expect(await repositories.documents.get("d2-copy-c3")).toBeUndefined();
    repositories.close();
  });

  test("rejects a deterministic copy target collision without changing either complete corpus", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "copy-target-collision-test" });
    await seedCorpus(repositories, "d1", "c1");
    await seedCorpus(repositories, "d1-copy-c3", "c3");

    await expect(repositories.copyDocumentCorpus({ sourceConversationId: "c1", targetConversationId: "c3", documentIds: ["d1"] }))
      .rejects.toBeInstanceOf(AssistantStorageError);

    expect(await repositories.documents.get("d1")).toBeTruthy();
    expect(await repositories.chunks.get("d1-chunk")).toEqual(expect.objectContaining({ documentId: "d1" }));
    expect(await repositories.documents.get("d1-copy-c3")).toEqual(expect.objectContaining({ scope: { type: "conversation", conversationId: "c3" } }));
    expect(await repositories.chunks.get("d1-copy-c3-chunk")).toEqual(expect.objectContaining({ documentId: "d1-copy-c3" }));
    expect(await repositories.searchTerms.get("d1-copy-c3-term")).toEqual(expect.objectContaining({ chunkId: "d1-copy-c3-chunk" }));
    expect(await repositories.indexJobs.get("d1-copy-c3-job")).toEqual(expect.objectContaining({ indexedChunkIds: ["d1-copy-c3-chunk"] }));
    expect(await repositories.chunks.get("d1-copy-c3-chunk-0")).toBeUndefined();
    expect(await repositories.indexJobs.get("d1-copy-c3-index")).toBeUndefined();
    repositories.close();
  });

  test("atomically replaces an analysis corpus, removing retired documents and surplus chunks", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "replace-analysis-corpus-test" });
    await repositories.beginAnalysisIngestion({ analysisId: "a1", ingestionId: "v1" });
    await expect(repositories.replaceAnalysisCorpus({
      analysisId: "a1", ingestionId: "v1",
      blocks: [analysisBlock("a1", "a1-registro", ["old-r-1", "old-r-2"]), analysisBlock("a1", "a1-recibo-1", ["old-p-1"])],
    })).resolves.toBe(true);

    await repositories.beginAnalysisIngestion({ analysisId: "a1", ingestionId: "v2" });
    await expect(repositories.replaceAnalysisCorpus({
      analysisId: "a1", ingestionId: "v2", blocks: [analysisBlock("a1", "a1-registro", ["new-r-1"])],
    })).resolves.toBe(true);

    expect(await repositories.documents.get("a1-registro")).toBeTruthy();
    expect(await repositories.chunks.get("new-r-1")).toBeTruthy();
    expect(await repositories.chunks.get("old-r-1")).toBeUndefined();
    expect(await repositories.chunks.get("old-r-2")).toBeUndefined();
    expect(await repositories.searchTerms.get("old-r-2-term")).toBeUndefined();
    expect(await repositories.documents.get("a1-recibo-1")).toBeUndefined();
    expect(await repositories.chunks.get("old-p-1")).toBeUndefined();
    expect(await repositories.indexJobs.get("a1-recibo-1-index")).toBeUndefined();
    repositories.close();
  });

  test("keeps the newest complete analysis corpus when an older ingestion finishes last", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "analysis-ingestion-race-test" });
    await repositories.beginAnalysisIngestion({ analysisId: "a1", ingestionId: "old" });
    await repositories.beginAnalysisIngestion({ analysisId: "a1", ingestionId: "new" });

    await expect(repositories.replaceAnalysisCorpus({
      analysisId: "a1", ingestionId: "new", blocks: [analysisBlock("a1", "a1-registro", ["new-chunk"])],
    })).resolves.toBe(true);
    await expect(repositories.replaceAnalysisCorpus({
      analysisId: "a1", ingestionId: "old", blocks: [analysisBlock("a1", "a1-registro", ["old-chunk"])],
    })).resolves.toBe(false);

    expect(await repositories.chunks.get("new-chunk")).toBeTruthy();
    expect(await repositories.searchTerms.get("new-chunk-term")).toBeTruthy();
    expect(await repositories.chunks.get("old-chunk")).toBeUndefined();
    expect(await repositories.searchTerms.get("old-chunk-term")).toBeUndefined();
    expect(await repositories.indexJobs.get("a1-registro-index")).toEqual(expect.objectContaining({ indexedChunkIds: ["new-chunk"] }));
    repositories.close();
  });

  test("rolls back a failed analysis replacement and preserves the previous complete corpus", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "replace-analysis-rollback-test" });
    await repositories.beginAnalysisIngestion({ analysisId: "a1", ingestionId: "v1" });
    await repositories.replaceAnalysisCorpus({ analysisId: "a1", ingestionId: "v1", blocks: [analysisBlock("a1", "a1-registro", ["old-chunk"])] });
    await repositories.beginAnalysisIngestion({ analysisId: "a1", ingestionId: "v2" });
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value: unknown) {
      if ((value as { id?: string }).id === "new-chunk") throw new DOMException("private", "QuotaExceededError");
      return originalPut.call(this, value);
    });

    await expect(repositories.replaceAnalysisCorpus({
      analysisId: "a1", ingestionId: "v2", blocks: [analysisBlock("a1", "a1-registro", ["new-chunk"])],
    })).rejects.toEqual(new AssistantStorageError("quota_exceeded", "No hay espacio suficiente para guardar el bloque del Asistente."));

    expect(await repositories.chunks.get("old-chunk")).toBeTruthy();
    expect(await repositories.searchTerms.get("old-chunk-term")).toBeTruthy();
    expect(await repositories.chunks.get("new-chunk")).toBeUndefined();
    expect(await repositories.searchTerms.get("new-chunk-term")).toBeUndefined();
    expect(await repositories.indexJobs.get("a1-registro-index")).toEqual(expect.objectContaining({ indexedChunkIds: ["old-chunk"] }));
    repositories.close();
  });

  test("transfers atomically and leaves no source records or orphaned dependants", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "transfer-corpus-test" });
    await seedCorpus(repositories, "d1", "c1");
    await repositories.transferDocumentCorpus({ sourceConversationId: "c1", targetConversationId: "c3", documentIds: ["d1"] });
    expect(await repositories.documents.get("d1")).toBeUndefined();
    expect(await repositories.chunks.get("d1-chunk")).toBeUndefined();
    expect(await repositories.searchTerms.get("d1-term")).toBeUndefined();
    expect(await repositories.indexJobs.get("d1-job")).toBeUndefined();
    expect(await repositories.documents.get("d1-copy-c3")).toBeTruthy();
    expect(await repositories.chunks.get("d1-copy-c3-chunk-0")).toEqual(expect.objectContaining({ scope: { type: "conversation", conversationId: "c3" } }));
    expect(await repositories.searchTerms.get("d1-copy-c3-chunk-0-term-texto")).toEqual(expect.objectContaining({ scope: { type: "conversation", conversationId: "c3" } }));
    repositories.close();
  });

  test("deletes document, chunks, search terms and index jobs together", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "delete-corpus-test" });
    await seedCorpus(repositories, "d1", "c1");
    await repositories.deleteDocumentCorpus({ conversationId: "c1", documentIds: ["d1"] });
    expect(await repositories.documents.get("d1")).toBeUndefined();
    expect(await repositories.chunks.get("d1-chunk")).toBeUndefined();
    expect(await repositories.searchTerms.get("d1-term")).toBeUndefined();
    expect(await repositories.indexJobs.get("d1-job")).toBeUndefined();
    repositories.close();
  });

  test("aborts a failed corpus copy without partial targets or source loss", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "copy-atomic-failure-test" });
    await seedCorpus(repositories, "d1", "c1");
    const originalPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value: unknown) {
      if ((value as { id?: string }).id === "d1-copy-c3-chunk-0") throw new DOMException("private", "QuotaExceededError");
      return originalPut.call(this, value);
    });
    await expect(repositories.copyDocumentCorpus({ sourceConversationId: "c1", targetConversationId: "c3", documentIds: ["d1"] })).rejects.toBeInstanceOf(AssistantStorageError);
    expect(await repositories.documents.get("d1")).toBeTruthy();
    expect(await repositories.documents.get("d1-copy-c3")).toBeUndefined();
    expect(spy).toHaveBeenCalled();
    repositories.close();
  });
});
