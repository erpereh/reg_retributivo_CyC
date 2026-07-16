// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AssistantView } from "@/components/assistant/AssistantView";
import { AssistantAiSettings } from "@/components/settings/AssistantAiSettings";
import { catalogKey, type ModelCatalogEntry, type ProviderConfig } from "@/lib/assistant/catalog/domain";
import type { Conversation, ModelPreferences } from "@/lib/assistant/domain";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import { openAssistantDatabase } from "@/lib/assistant/storage/database";
import { migrateLegacyAssistantModels } from "@/lib/assistant/storage/modelCatalogMigration";

const createdAt = "2026-07-16T10:00:00.000Z";

function provider(id = "provider-gemini", enabled = true): ProviderConfig {
  return {
    id,
    providerType: "gemini",
    displayName: id === "provider-gemini" ? "Gemini" : "Gemini desactivado",
    baseUrl: "https://generativelanguage.googleapis.com",
    envVarName: "GEMINI_API_KEY",
    enabled,
    connectionStatus: enabled ? "connected" : "inactive",
    createdAt,
    updatedAt: createdAt,
  };
}

function model(modelId: string, tools: true | false | "unknown" = true, providerId = "provider-gemini"): ModelCatalogEntry {
  return {
    id: catalogKey(providerId, modelId),
    providerId,
    canonicalModelId: modelId,
    apiModelId: `models/${modelId}`,
    generationModelId: modelId,
    displayName: modelId,
    contextWindow: 32_768,
    capabilities: { chat: true, tools, streaming: true, vision: false, documents: false },
    availability: "available",
    metadataSource: "official",
    detectedAt: createdAt,
  };
}

function conversation(type: "general" | "analysis" = "general"): Conversation {
  return {
    id: "conversation-selector",
    type,
    ...(type === "analysis" ? { analysisId: "analysis-1", analysisVersion: "v1", associatedPersonIds: ["10001"], primaryPersonId: "10001" } : { associatedPersonIds: [] }),
    title: type === "analysis" ? "Análisis" : "Consulta general",
    responseMode: "strict",
    contextStrategy: "associated_people",
    status: "active",
    createdAt,
    updatedAt: createdAt,
  };
}

async function seed(
  factory: IDBFactory,
  dbName: string,
  entries: readonly ModelCatalogEntry[],
  selectedConversation = conversation(),
  providers: readonly ProviderConfig[] = [provider()],
  preferences?: ModelPreferences,
) {
  const repositories = await createIndexedDbRepositories({ factory, dbName });
  for (const item of providers) await repositories.providerConfigs.put(item);
  for (const item of entries) await repositories.modelCatalog.put(item);
  await repositories.conversations.put(selectedConversation);
  if (preferences) await repositories.saveModelPreferences(preferences);
  repositories.close();
}

describe("assistant model selector regressions", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  test("opens 39 persisted Gemini models without a prior selection or preferences", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const entries = Array.from({ length: 39 }, (_, index) => model(`gemini-chat-${index + 1}`, index === 0 ? false : true));
    await seed(factory, "selector-39-models", entries);

    render(<AssistantProvider factory={factory} dbName="selector-39-models"><AssistantView /></AssistantProvider>);

    const selector = await screen.findByRole("button", { name: "Modelo de conversación: sin seleccionar" });
    expect(selector).toBeEnabled();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    fireEvent.click(selector);
    const catalog = screen.getByRole("dialog", { name: "Catálogo de modelos" });
    expect(within(catalog).getByRole("heading", { name: "Gemini" })).toBeVisible();
    const firstModelButton = within(catalog).getAllByRole("button").find((button) => button.querySelector("span")?.textContent === "gemini-chat-1");
    expect(firstModelButton).toBeEnabled();
    expect(within(catalog).getAllByText(/^gemini-chat-/)).toHaveLength(39);
  });

  test("uses separate general and analysis compatibility rules", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    await seed(factory, "selector-general-rules", [model("without-tools", false), model("unknown-tools", "unknown")]);
    render(<AssistantProvider factory={factory} dbName="selector-general-rules"><AssistantView /></AssistantProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Modelo de conversación: sin seleccionar" }));
    expect(screen.getByRole("button", { name: /without-tools/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /unknown-tools/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /without-tools/i }));
    await screen.findByRole("button", { name: "Modelo de conversación: without-tools" });
    cleanup();

    await seed(factory, "selector-analysis-rules", [model("with-tools", true), model("without-tools", false), model("unknown-tools", "unknown")], conversation("analysis"));
    render(<AssistantProvider factory={factory} dbName="selector-analysis-rules"><AssistantView /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Modelo de conversación: sin seleccionar" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ver todos" }));
    expect(screen.getByRole("button", { name: /with-tools/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /without-tools/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /unknown-tools/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Comprobar compatibilidad" })).toBeVisible();
  });

  test("shows unknown chat compatibility only in Ver todos without emptying general chat", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const unknownChat = { ...model("unknown-chat"), capabilities: { ...model("unknown-chat").capabilities, chat: "unknown" as const } };
    await seed(factory, "selector-unknown-chat", [model("confirmed-chat", false), unknownChat]);
    render(<AssistantProvider factory={factory} dbName="selector-unknown-chat"><AssistantView /></AssistantProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Modelo de conversación: sin seleccionar" }));
    expect(screen.getByText("confirmed-chat")).toBeVisible();
    expect(screen.queryByText("unknown-chat")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ver todos" }));
    expect(screen.getByRole("button", { name: /unknown-chat/i })).toBeDisabled();
    expect(screen.getByText("La compatibilidad con chat no está confirmada.")).toBeVisible();
  });

  test("recomputes the selector after asynchronous repository hydration", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    await seed(factory, "selector-delayed-hydration", [model("delayed-model")]);
    const repositories = await createIndexedDbRepositories({ factory, dbName: "selector-delayed-hydration" });
    let release!: () => void;
    const hydration = new Promise<void>((resolve) => { release = resolve; });
    render(<AssistantProvider repositoriesFactory={async () => { await hydration; return repositories; }}><AssistantView /></AssistantProvider>);

    expect(screen.getByText("Cargando Asistente…")).toBeVisible();
    release();
    const selector = await screen.findByRole("button", { name: "Modelo de conversación: sin seleccionar" });
    expect(selector).toBeEnabled();
    fireEvent.click(selector);
    expect(screen.getByText("delayed-model")).toBeVisible();
  });

  test("ignores disabled providers even when their models are favorites", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const disabled = model("disabled-favorite", true, "provider-disabled");
    await seed(factory, "selector-disabled-provider", [model("active-model"), disabled], conversation(), [provider(), provider("provider-disabled", false)], {
      id: "model-preferences",
      favoriteCatalogEntryIds: [disabled.id],
      recentCatalogEntryIds: [],
      updatedAt: createdAt,
    });

    render(<AssistantProvider factory={factory} dbName="selector-disabled-provider"><AssistantView /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Modelo de conversación: sin seleccionar" }));
    expect(screen.getByText("active-model")).toBeVisible();
    expect(screen.queryByText("disabled-favorite")).toBeNull();
  });

  test("keeps providers and catalog when preferences fail to hydrate", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    await seed(factory, "selector-preferences-failure", [model("hydrated-model")]);
    const repositories = await createIndexedDbRepositories({ factory, dbName: "selector-preferences-failure" });
    const failingPreferences = new Proxy(repositories.modelPreferences, {
      get(target, property, receiver) {
        if (property === "get") return async () => { throw new Error("private-preferences-failure"); };
        return Reflect.get(target, property, receiver);
      },
    });

    render(<AssistantProvider repositoriesFactory={async () => ({ ...repositories, modelPreferences: failingPreferences })}><AssistantView /></AssistantProvider>);

    const selector = await screen.findByRole("button", { name: "Modelo de conversación: sin seleccionar" });
    expect(selector).toBeEnabled();
    fireEvent.click(selector);
    expect(screen.getByText("hydrated-model")).toBeVisible();
    expect(screen.queryByText("private-preferences-failure")).toBeNull();
  });

  test("propagates a catalog refresh from Settings to the open Assistant", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    await seed(factory, "selector-settings-refresh", [], conversation());
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.operation === "catalog") return Response.json({ completion: "complete", models: [model("refreshed-model")] });
      return Response.json({ providerId: body.providerId ?? body.config?.id, keyStatus: "configured" });
    }));

    render(<AssistantProvider factory={factory} dbName="selector-settings-refresh"><AssistantAiSettings /><AssistantView /></AssistantProvider>);
    const card = (await screen.findByRole("heading", { level: 3, name: "Gemini" })).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Actualizar modelos" }));
    await screen.findByText("Catálogo actualizado sin probes de inferencia.");
    const selector = screen.getByRole("button", { name: "Modelo de conversación: sin seleccionar" });
    fireEvent.click(selector);
    expect(await screen.findByText("refreshed-model")).toBeVisible();
  });

  test("does not expose persisted analysis state in a legacy general conversation", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const db = await openAssistantDatabase(factory, "selector-legacy-general");
    await migrateLegacyAssistantModels(db);
    const transaction = db.transaction(["providerConfigs", "modelCatalog", "conversations", "events"], "readwrite");
    transaction.objectStore("providerConfigs").put(provider());
    transaction.objectStore("modelCatalog").put(model("general-model", false));
    transaction.objectStore("conversations").put({ ...conversation(), analysisId: "analysis-1", analysisVersion: "v1", associatedPersonIds: ["10001"], primaryPersonId: "10001" });
    transaction.objectStore("events").put({ id: "legacy-analysis-event", conversationId: "conversation-selector", event: { type: "context_added", contextId: "analysis-1", label: "Análisis activo" }, createdAt });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
    db.close();

    render(<AssistantProvider factory={factory} dbName="selector-legacy-general"><AssistantView /></AssistantProvider>);

    expect(await screen.findByText("Chat general · sin datos retributivos")).toBeVisible();
    expect(screen.queryByText("Contexto añadido: Análisis activo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Gestionar personas asociadas" })).toBeNull();
    const selector = screen.getByRole("button", { name: "Modelo de conversación: sin seleccionar" });
    expect(selector).toBeEnabled();
  });
});
