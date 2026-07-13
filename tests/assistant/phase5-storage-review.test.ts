import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ChatAction, ChatEvent, ChatMessage, Conversation, PersistedDocumentMetadata, SourceReference } from "@/lib/assistant/domain";
import { openAssistantDatabase } from "@/lib/assistant/storage/database";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";

const at = (minute: number) => `2026-07-13T10:${String(minute).padStart(2, "0")}:00.000Z`;

function conversation(id: string, updatedAt: string): Conversation {
  return {
    id, type: "general", title: id, associatedPersonIds: [], modelProfileId: "fake-retributivo-v1",
    responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: at(0), updatedAt,
  };
}

function message(id: string, conversationId: string, createdAt: string): ChatMessage {
  return {
    id, conversationId, role: "assistant", content: id, status: "completed", contextOrigin: "general",
    modelProfileId: "fake-retributivo-v1", modelId: "fake-retributivo-v1", responseMode: "strict",
    contextStrategy: "automatic", sourceRefIds: [], actionIds: [], createdAt,
  };
}

async function all(factory: IDBFactory, dbName: string, store: string): Promise<Record<string, unknown>[]> {
  const db = await openAssistantDatabase(factory, dbName);
  const values = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return values;
}

describe("Phase 5 reviewed repository contracts", () => {
  beforeEach(() => vi.stubGlobal("IDBKeyRange", IDBKeyRange));
  afterEach(() => vi.unstubAllGlobals());

  test("deletes a complete conversation corpus atomically and idempotently without touching analysis scope", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-delete-cascade";
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    await repositories.conversations.put(conversation("delete-me", at(1)));
    await repositories.conversations.put(conversation("keep-me", at(2)));
    for (let index = 0; index < 45; index += 1) await repositories.messages.put(message(`delete-message-${index}`, "delete-me", at(index)));
    await repositories.messages.put(message("keep-message", "keep-me", at(1)));

    const source: SourceReference = {
      id: "delete-source", conversationId: "delete-me", sourceType: "tool", sanitizedSourceLabel: "Fuente local",
      availability: "available", conceptIds: [], excerpt: "Dato anónimo", sanitizedHash: "delete-source-hash",
    };
    const event: ChatEvent = { id: "delete-event", conversationId: "delete-me", event: { type: "context_added", contextId: "ctx", label: "Contexto" }, createdAt: at(1) };
    const action: ChatAction = {
      id: "delete-action", conversationId: "delete-me", messageId: "delete-message-1", label: "Acción", description: "Descripción",
      action: { type: "show_sources", sourceIds: [source.id] }, status: "pending", createdAt: at(1),
    };
    await repositories.sources.put(source);
    await repositories.events.put(event);
    await repositories.actions.put(action);
    await repositories.snapshots.put({
      id: "delete-snapshot", conversationId: "delete-me", summary: "Resumen", summarizedMessageIds: [], decisions: [], figures: [],
      sourceIds: [], actionIds: [], personIds: [], analysisVersion: "v1", actualStrategy: "automatic", actualResponseMode: "strict", createdAt: at(1),
    });

    const conversationDocument: PersistedDocumentMetadata = {
      id: "delete-document", sanitizedSourceLabel: "Documento local", scope: { type: "conversation", conversationId: "delete-me" },
      mediaType: "txt", status: "ready", createdAt: at(1), updatedAt: at(1),
    };
    const analysisDocument: PersistedDocumentMetadata = {
      id: "analysis-document", sanitizedSourceLabel: "Documento análisis", scope: { type: "analysis", analysisId: "analysis-1" },
      mediaType: "txt", status: "ready", createdAt: at(1), updatedAt: at(1),
    };
    await repositories.writeIngestionBlock({
      document: conversationDocument,
      chunks: [{ id: "delete-chunk", documentId: conversationDocument.id, sequence: 0, content: "Contexto", snippet: "Contexto", sanitizedHash: "delete-chunk-hash", terms: ["contexto"] }],
      searchTerms: [{ id: "delete-term", documentId: conversationDocument.id, chunkId: "delete-chunk", term: "contexto", positions: [0] }],
      indexJob: { id: "delete-index", documentId: conversationDocument.id, status: "ready", indexedChunkIds: ["delete-chunk"] },
    });
    await repositories.writeIngestionBlock({
      document: analysisDocument,
      chunks: [{ id: "analysis-chunk", documentId: analysisDocument.id, sequence: 0, content: "Compartido", snippet: "Compartido", sanitizedHash: "analysis-chunk-hash", terms: ["compartido"] }],
      searchTerms: [{ id: "analysis-term", documentId: analysisDocument.id, chunkId: "analysis-chunk", term: "compartido", positions: [0] }],
      indexJob: { id: "analysis-index", documentId: analysisDocument.id, status: "ready", indexedChunkIds: ["analysis-chunk"] },
    });
    await repositories.cache.put({ id: "delete-cache", conversationId: "delete-me", documentId: conversationDocument.id });
    await repositories.cache.put({ id: "keep-cache", conversationId: "keep-me" });

    await repositories.deleteConversation("delete-me");
    await repositories.deleteConversation("delete-me");
    repositories.close();

    for (const store of ["conversations", "messages", "sources", "events", "actions", "snapshots", "documents", "chunks", "searchTerms", "indexJobs", "cache"]) {
      const records = await all(factory, dbName, store);
      expect(records.some((record) => record.id === "delete-me" || record.conversationId === "delete-me" || record.documentId === "delete-document" || record.id === "delete-document")).toBe(false);
    }
    expect((await all(factory, dbName, "documents")).map((record) => record.id)).toContain("analysis-document");
    expect((await all(factory, dbName, "chunks")).map((record) => record.id)).toContain("analysis-chunk");
    expect((await all(factory, dbName, "messages")).map((record) => record.id)).toContain("keep-message");
    expect((await all(factory, dbName, "cache")).map((record) => record.id)).toContain("keep-cache");
  });

  test("pages conversations newest-first with stable ties", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase5-conversation-order" });
    for (let index = 0; index < 12; index += 1) await repositories.conversations.put(conversation(`conversation-${String(index).padStart(2, "0")}`, index >= 10 ? at(10) : at(index)));
    const first = await repositories.conversations.list({ limit: 5 });
    const second = await repositories.conversations.list({ limit: 7, cursor: first.nextCursor });
    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(first.items.map((item) => item.updatedAt)).toEqual([...first.items.map((item) => item.updatedAt)].sort().reverse());
    expect(ids.slice(0, 2)).toEqual(["conversation-11", "conversation-10"]);
    repositories.close();
  });

  test("loads the newest message page chronologically and prepends older pages without duplicates", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase5-message-order" });
    await repositories.conversations.put(conversation("conversation-pages", at(1)));
    for (let index = 1; index <= 45; index += 1) await repositories.messages.put(message(`message-${String(index).padStart(2, "0")}`, "conversation-pages", at(index)));
    const newest = await repositories.messages.listByConversation("conversation-pages", { limit: 40 });
    const older = await repositories.messages.listByConversation("conversation-pages", { limit: 40, cursor: newest.nextCursor });
    expect(newest.items.at(0)?.id).toBe("message-06");
    expect(newest.items.at(-1)?.id).toBe("message-45");
    expect(older.items.map((item) => item.id)).toEqual(["message-01", "message-02", "message-03", "message-04", "message-05"]);
    expect(new Set([...older.items, ...newest.items].map((item) => item.id)).size).toBe(45);
    repositories.close();
  });

  test("uses bounded IndexedDB cursors instead of getAll for conversation and message pages", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase5-real-cursors" });
    await repositories.conversations.put(conversation("cursor-conversation", at(1)));
    for (let index = 0; index < 60; index += 1) {
      await repositories.messages.put(message(`cursor-message-${index}`, "cursor-conversation", at(index)));
    }
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
    await repositories.conversations.list({ limit: 10 });
    await repositories.messages.listByConversation("cursor-conversation", { limit: 10 });
    expect(getAll).not.toHaveBeenCalled();
    repositories.close();
  });

  test("does not delete an analysis-scoped record whose id equals the conversation id", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-delete-id-ownership";
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    await repositories.conversations.put(conversation("same-id", at(1)));
    await repositories.documents.put({
      id: "same-id", sanitizedSourceLabel: "Documento de análisis", scope: { type: "analysis", analysisId: "analysis-1" },
      mediaType: "txt", status: "ready", createdAt: at(1), updatedAt: at(1),
    });
    await repositories.deleteConversation("same-id");
    expect(await repositories.documents.get("same-id")).toMatchObject({ scope: { type: "analysis", analysisId: "analysis-1" } });
    repositories.close();
  });
});
