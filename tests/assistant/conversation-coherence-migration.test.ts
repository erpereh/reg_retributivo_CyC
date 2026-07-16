// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { openAssistantDatabase } from "@/lib/assistant/storage/database";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import { migrateLegacyAssistantModels } from "@/lib/assistant/storage/modelCatalogMigration";

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("failed"));
  });
}

describe("assistant conversation coherence migration", () => {
  let factory: IDBFactory;

  beforeEach(() => {
    factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  });

  test("repairs inconsistent conversations once without deleting history or sources", async () => {
    const db = await openAssistantDatabase(factory, "conversation-coherence");
    await migrateLegacyAssistantModels(db);
    const seed = db.transaction(["conversations", "messages", "events", "sources"], "readwrite");
    seed.objectStore("conversations").put({
      id: "general-inconsistent", type: "general", analysisId: "analysis-1", analysisVersion: "v1", title: "Consulta general",
      associatedPersonIds: ["10001"], primaryPersonId: "10001", responseMode: "strict", contextStrategy: "full_analysis",
      status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01",
    });
    seed.objectStore("conversations").put({
      id: "analysis-without-id", type: "analysis", title: "Registro analítico incompleto", associatedPersonIds: ["10002"], primaryPersonId: "10002",
      responseMode: "strict", contextStrategy: "associated_people", status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01",
    });
    seed.objectStore("conversations").put({
      id: "analysis-valid", type: "analysis", analysisId: "analysis-2", analysisVersion: "v2", title: "Registro analítico válido", associatedPersonIds: ["10003"], primaryPersonId: "10003",
      responseMode: "strict", contextStrategy: "full_analysis", status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01",
    });
    seed.objectStore("messages").put({ id: "message-1", conversationId: "general-inconsistent", role: "assistant", content: "Histórico", status: "completed", contextOrigin: "analysis", modelProfileId: "legacy", responseMode: "strict", contextStrategy: "full_analysis", sourceRefIds: ["source-1"], actionIds: [], createdAt: "2026-01-01" });
    seed.objectStore("events").put({ id: "event-1", conversationId: "general-inconsistent", event: { type: "context_added", contextId: "analysis-1", label: "Análisis activo" }, createdAt: "2026-01-01" });
    seed.objectStore("sources").put({ id: "source-1", conversationId: "general-inconsistent", messageId: "message-1", analysisId: "analysis-1", sourceType: "analysis", sanitizedSourceLabel: "Fuente histórica", availability: "available", conceptIds: [], excerpt: "Dato histórico", sanitizedHash: "hash-1" });
    await transactionDone(seed);
    db.close();

    const repositories = await createIndexedDbRepositories({ factory, dbName: "conversation-coherence" });
    expect(await repositories.conversations.get("general-inconsistent")).toEqual(expect.objectContaining({ type: "general", associatedPersonIds: [] }));
    expect(await repositories.conversations.get("general-inconsistent")).not.toHaveProperty("analysisId");
    expect(await repositories.conversations.get("general-inconsistent")).not.toHaveProperty("analysisVersion");
    expect(await repositories.conversations.get("general-inconsistent")).not.toHaveProperty("primaryPersonId");
    expect(await repositories.conversations.get("analysis-without-id")).toEqual(expect.objectContaining({ type: "general", associatedPersonIds: [] }));
    expect(await repositories.conversations.get("analysis-valid")).toEqual(expect.objectContaining({ type: "analysis", analysisId: "analysis-2", associatedPersonIds: ["10003"], primaryPersonId: "10003" }));
    expect(await repositories.messages.get("message-1")).toBeDefined();
    expect(await repositories.events.get("event-1")).toBeDefined();
    expect(await repositories.sources.get("source-1")).toBeDefined();
    repositories.close();

    const markerDb = await openAssistantDatabase(factory, "conversation-coherence");
    const markerTransaction = markerDb.transaction("migrations", "readonly");
    const marker = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = markerTransaction.objectStore("migrations").get("assistant-conversation-coherence-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await transactionDone(markerTransaction);
    markerDb.close();
    expect(marker).toEqual(expect.objectContaining({ status: "completed", repairedGeneralCount: 1, downgradedAnalysisCount: 1 }));

    const reopened = await createIndexedDbRepositories({ factory, dbName: "conversation-coherence" });
    expect(await reopened.conversations.get("general-inconsistent")).toEqual(expect.objectContaining({ type: "general", associatedPersonIds: [] }));
    expect(await reopened.messages.get("message-1")).toBeDefined();
    expect(await reopened.events.get("event-1")).toBeDefined();
    expect(await reopened.sources.get("source-1")).toBeDefined();
    reopened.close();
  });
});
