// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_DB_VERSION, openAssistantDatabase } from "@/lib/assistant/storage/database";
import { migrateLegacyAssistantModels } from "@/lib/assistant/storage/modelCatalogMigration";

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("failed"));
  });
}

describe("assistant model catalog migration", () => {
  let factory: IDBFactory;

  beforeEach(() => {
    factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  });

  it("keeps legacy stores and migrates duplicate profiles idempotently", async () => {
    const db = await openAssistantDatabase(factory, "assistant-v5-migration");
    expect(db.version).toBe(ASSISTANT_DB_VERSION);
    expect(db.objectStoreNames.contains("modelProfiles")).toBe(true);

    const seed = db.transaction(["modelProfiles", "conversations", "assistantSettings"], "readwrite");
    seed.objectStore("modelProfiles").put({
      id: "gemini-a", name: "Gemini A", provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com", modelId: "gemini-2.5-flash", enabled: true,
      generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true, capabilitiesSource: "detected",
    });
    seed.objectStore("modelProfiles").put({
      id: "gemini-b", name: "Gemini B", provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com/", modelId: "gemini-2.5-pro", enabled: true,
      generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true, capabilitiesSource: "detected",
    });
    seed.objectStore("conversations").put({ id: "c1", type: "general", title: "Uno", associatedPersonIds: [], modelProfileId: "gemini-b", responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    seed.objectStore("assistantSettings").put({ id: "assistant-settings", defaultGeneralModelProfileId: "gemini-a", responseMode: "strict", contextStrategy: "automatic", safetyMarginPercent: 10, warningThresholdPercent: 75, compactionThresholdPercent: 85 });
    await transactionDone(seed);

    await migrateLegacyAssistantModels(db);
    await migrateLegacyAssistantModels(db);

    const read = db.transaction(["providerConfigs", "modelCatalog", "conversations", "migrations"], "readonly");
    const providers = await new Promise<unknown[]>((resolve, reject) => { const request = read.objectStore("providerConfigs").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const models = await new Promise<unknown[]>((resolve, reject) => { const request = read.objectStore("modelCatalog").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const conversation = await new Promise<Record<string, unknown>>((resolve, reject) => { const request = read.objectStore("conversations").get("c1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const marker = await new Promise<Record<string, unknown>>((resolve, reject) => { const request = read.objectStore("migrations").get("assistant-model-catalog-v5"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await transactionDone(read);

    expect(providers).toHaveLength(1);
    expect(models).toHaveLength(2);
    expect(conversation).toEqual(expect.objectContaining({ providerId: expect.any(String), modelId: "gemini-2.5-pro", contextStrategy: "associated_people" }));
    expect(marker).toEqual(expect.objectContaining({ status: "completed", profileCount: 2, providerCount: 1, modelCount: 2, conversationCount: 1 }));
    db.close();
  });

  it("rolls back every new record when a legacy profile is invalid", async () => {
    const db = await openAssistantDatabase(factory, "assistant-v5-rollback");
    const seed = db.transaction("modelProfiles", "readwrite");
    seed.objectStore("modelProfiles").put({ id: "broken", provider: "gemini" });
    await transactionDone(seed);

    await expect(migrateLegacyAssistantModels(db)).rejects.toThrow("legacy_model_profile_invalid");
    const read = db.transaction(["providerConfigs", "modelCatalog", "migrations"], "readonly");
    const counts = await Promise.all(["providerConfigs", "modelCatalog", "migrations"].map((name) => new Promise<number>((resolve, reject) => { const request = read.objectStore(name).count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })));
    await transactionDone(read);
    expect(counts).toEqual([0, 0, 0]);
    const repair = db.transaction("modelProfiles", "readwrite");
    repair.objectStore("modelProfiles").delete("broken");
    await transactionDone(repair);
    await expect(migrateLegacyAssistantModels(db)).resolves.toBeUndefined();
    db.close();
  });

  it("migrates an empty database and records a completed, repeatable version marker", async () => {
    const db = await openAssistantDatabase(factory, "assistant-v5-empty");
    await migrateLegacyAssistantModels(db);
    await migrateLegacyAssistantModels(db);
    const read = db.transaction(["providerConfigs", "modelCatalog", "migrations"], "readonly");
    const counts = await Promise.all(["providerConfigs", "modelCatalog"].map((name) => new Promise<number>((resolve) => { const request = read.objectStore(name).count(); request.onsuccess = () => resolve(request.result); })));
    const marker = await new Promise<Record<string, unknown>>((resolve) => { const request = read.objectStore("migrations").get("assistant-model-catalog-v5"); request.onsuccess = () => resolve(request.result); });
    await transactionDone(read);
    expect(counts).toEqual([0, 0]);
    expect(marker).toMatchObject({ status: "completed", profileCount: 0, modelCount: 0 });
    db.close();
  });

  it("preserves missing and orphaned selections and marks retired models unavailable", async () => {
    const db = await openAssistantDatabase(factory, "assistant-v5-edge-relations");
    const seed = db.transaction(["modelProfiles", "conversations"], "readwrite");
    seed.objectStore("modelProfiles").put({ id: "retired", name: "Retirado", provider: "openai", baseUrl: "https://api.openai.com/v1", modelId: "retired-model", enabled: false, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true, capabilitiesSource: "detected" });
    const common = { type: "general", associatedPersonIds: [], responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    seed.objectStore("conversations").put({ id: "missing", title: "Sin modelo", ...common });
    seed.objectStore("conversations").put({ id: "orphan", title: "Huérfana", modelProfileId: "does-not-exist", ...common });
    seed.objectStore("conversations").put({ id: "retired-conversation", title: "Retirada", modelProfileId: "retired", ...common });
    await transactionDone(seed);
    await migrateLegacyAssistantModels(db);
    const read = db.transaction(["conversations", "modelCatalog", "migrations"], "readonly");
    const conversations = await new Promise<Record<string, unknown>[]>((resolve) => { const request = read.objectStore("conversations").getAll(); request.onsuccess = () => resolve(request.result); });
    const models = await new Promise<Record<string, unknown>[]>((resolve) => { const request = read.objectStore("modelCatalog").getAll(); request.onsuccess = () => resolve(request.result); });
    const marker = await new Promise<Record<string, unknown>>((resolve) => { const request = read.objectStore("migrations").get("assistant-model-catalog-v5"); request.onsuccess = () => resolve(request.result); });
    await transactionDone(read);
    expect(conversations.find((item) => item.id === "missing")).not.toHaveProperty("providerId");
    expect(conversations.find((item) => item.id === "orphan")).toMatchObject({ modelProfileId: "does-not-exist" });
    expect(conversations.find((item) => item.id === "orphan")).not.toHaveProperty("providerId");
    expect(conversations.find((item) => item.id === "retired-conversation")).toHaveProperty("providerId");
    expect(models).toEqual([expect.objectContaining({ availability: "retired" })]);
    expect(marker).toMatchObject({ missingConversationModelCount: 1, orphanModelReferenceCount: 1 });
    db.close();
  });
});
