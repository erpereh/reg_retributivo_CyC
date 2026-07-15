// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/AssistantProvider";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import { openAssistantDatabase, ASSISTANT_DB_VERSION } from "@/lib/assistant/storage/database";

function ProfileProbe() {
  const assistant = useAssistant();
  return <><output data-testid="profiles">{JSON.stringify(assistant.modelProfiles)}</output><output data-testid="selected-conversation">{assistant.conversation?.id ?? "none"}</output><output data-testid="can-send">{String(assistant.canSend)}</output></>;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("repairs selected model metadata on load without changing the IndexedDB schema version", async () => {
  const factory = new IDBFactory();
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const dbName = "model-profile-repair";
  const repositories = await createIndexedDbRepositories({ factory, dbName });
  await repositories.modelProfiles.put({
    id: "p1",
    name: "Gemini",
    provider: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    modelId: "gemini-flash",
    enabled: true,
    generalChatCompatible: true,
    analysisCompatible: true,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    capabilitiesSource: "detected",
    manualContextWindow: 12_345,
    maxOutputTokens: 2_048,
    detectedModels: [{ id: "gemini-flash", providerModelName: "models/gemini-flash", generationModelId: "gemini-flash", displayName: "Gemini Flash", contextWindow: 1_048_576, maxOutputTokens: 65_536, supportedMethods: ["generateContent"] }],
  });
  repositories.close();

  render(<AssistantProvider factory={factory} dbName={dbName}><ProfileProbe /></AssistantProvider>);

  await waitFor(() => expect(screen.getByTestId("profiles")).toHaveTextContent("detectedContextWindow"));
  const db = await openAssistantDatabase(factory, dbName);
  expect(db.version).toBe(ASSISTANT_DB_VERSION);
  const request = db.transaction("modelProfiles", "readonly").objectStore("modelProfiles").get("p1");
  const repaired = await new Promise<Record<string, unknown>>((resolve) => { request.onsuccess = () => resolve(request.result); });
  db.close();

  expect(repaired).toMatchObject({ id: "p1", modelId: "gemini-flash", detectedContextWindow: 1_048_576, manualContextWindow: 12_345, maxOutputTokens: 2_048 });
});

test("disables sending when the refreshed catalog no longer resolves the selected model", async () => {
  const factory = new IDBFactory();
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const dbName = "model-profile-unavailable";
  const repositories = await createIndexedDbRepositories({ factory, dbName });
  await repositories.modelProfiles.put({
    id: "p1", name: "Gemini", provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com", modelId: "missing-model", enabled: true,
    generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true,
    capabilitiesSource: "detected", detectedContextWindow: 1_048_576, manualContextWindow: 12_345, maxOutputTokens: 2_048,
    detectedModels: [{ id: "gemini-flash", displayName: "Gemini Flash", contextWindow: 1_048_576, maxOutputTokens: 65_536, supportedMethods: ["generateContent"] }],
  });
  await repositories.conversations.put({ id: "c1", type: "general", title: "Consulta general", associatedPersonIds: [], modelProfileId: "p1", responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:00:00.000Z" });
  repositories.close();

  render(<AssistantProvider factory={factory} dbName={dbName}><ProfileProbe /></AssistantProvider>);

  await waitFor(() => expect(screen.getByTestId("selected-conversation")).toHaveTextContent("c1"));
  await waitFor(() => expect(screen.getByTestId("profiles")).not.toHaveTextContent("detectedContextWindow"));
  expect(screen.getByTestId("can-send")).toHaveTextContent("false");
});
