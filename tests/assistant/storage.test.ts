// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange, IDBObjectStore, IDBTransaction } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ASSISTANT_STORES, openAssistantDatabase } from "@/lib/assistant/storage/database";
import { AssistantStorageError, createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
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

  test("creates the complete idempotent version 1 schema", async () => {
    const db = await openAssistantDatabase(factory, "schema-test");
    expect(Array.from(db.objectStoreNames)).toEqual([...ASSISTANT_STORES].sort());
    db.close();
    const reloaded = await openAssistantDatabase(factory, "schema-test");
    expect(reloaded.version).toBe(1);
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
    expect(first.items.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(first.nextCursor).toBeTruthy();
    const second = await repositories.messages.listByConversation("c1", { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => item.id)).toEqual(["m3"]);
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
    expect([...first.items, ...second.items, ...third.items].map((item) => item.id)).toEqual(["m1", "m2", "m3"]);
    repositories.close();
  });

  test("exposes repositories for every required store", async () => {
    const repositories = await createIndexedDbRepositories({ factory, dbName: "surface-test" });
    expect(Object.keys(repositories).sort()).toEqual([
      "actions", "analysisVersions", "assistantSettings", "cache", "chunks", "cleanupJobs", "conversations", "documents", "events",
      "indexJobs", "messages", "modelProfiles", "searchTerms", "snapshots", "sources", "writeConversationBlock", "close",
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
});
