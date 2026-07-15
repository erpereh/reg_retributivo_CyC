// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/AssistantProvider";
import { AssistantView } from "@/components/assistant/AssistantView";
import { AssistantAiSettings } from "@/components/settings/AssistantAiSettings";
import type { ChatMessage, Conversation, ModelProfile, SourceReference } from "@/lib/assistant/domain";
import { ASSISTANT_STORES, openAssistantDatabase } from "@/lib/assistant/storage/database";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { AssistantRepositories } from "@/lib/assistant/storage/repositories";
import { localIterableResponse } from "@/lib/assistant/providers/localNdjsonTransport";
import type { AnalysisResult, StoredAnalysis } from "@/lib/types";

const createdAt = "2026-07-13T10:00:00.000Z";
const encoder = new TextEncoder();
const contentStores = ASSISTANT_STORES.filter((name) => name !== "assistantSettings" && name !== "modelProfiles");

function conversation(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id, type: "general", title: id, associatedPersonIds: [], modelProfileId: "fake-retributivo-v1",
    responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt, updatedAt: createdAt, ...overrides,
  };
}

function message(id: string, conversationId: string, role: "user" | "assistant", content: string, status: ChatMessage["status"], overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id, conversationId, role, content, status, contextOrigin: "general", modelProfileId: "fake-retributivo-v1",
    modelId: "fake-retributivo-v1", responseMode: "strict", contextStrategy: "automatic", sourceRefIds: [], actionIds: [], createdAt,
    ...overrides,
  };
}

function profile(id = "profile-production"): ModelProfile {
  return {
    id, name: id, provider: "manual", baseUrl: `https://${id}.example/v1`, modelId: `${id}-model`, enabled: true,
    generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true,
    supportsStructuredOutput: true, capabilitiesSource: "detected",
  };
}

function source(id: string, conversationId: string): SourceReference {
  return {
    id, conversationId, sourceType: "document", sanitizedSourceLabel: id, availability: "available", conceptIds: [], excerpt: "Fuente segura", sanitizedHash: `hash-${id}`,
  };
}

const activeAnalysis = {
  id: "analysis-1", createdAt, result: { people: [], payrollRecords: [], registroEmployees: [] } as unknown as AnalysisResult,
} as StoredAnalysis;

async function seed(factory: IDBFactory, dbName: string, conversations: Conversation[], messages: ChatMessage[] = [], profiles: ModelProfile[] = [], sources: SourceReference[] = []) {
  const repositories = await createIndexedDbRepositories({ factory, dbName });
  for (const item of conversations) await repositories.conversations.put(item);
  for (const item of messages) await repositories.messages.put(item);
  for (const item of profiles) await repositories.modelProfiles.put(item);
  for (const item of sources) await repositories.sources.put(item);
  repositories.close();
}

async function contentStoreCounts(factory: IDBFactory, dbName: string): Promise<Record<string, number>> {
  const db = await openAssistantDatabase(factory, dbName);
  const transaction = db.transaction(contentStores, "readonly");
  const entries = await Promise.all(contentStores.map((storeName) => new Promise<readonly [string, number]>((resolve, reject) => {
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve([storeName, request.result.length]);
    request.onerror = () => reject(request.error);
  })));
  db.close();
  return Object.fromEntries(entries);
}

function installBrowser() {
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("min-width: 1280px"), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => true) });
}

function ClearSettingsProbe() {
  const assistant = useAssistant();
  return <>
    <output data-testid="clear-selected">{assistant.conversation?.id ?? "none"}</output>
    <output data-testid="clear-streaming">{String(assistant.streaming)}</output>
    <output data-testid="clear-announcement">{assistant.announcement}</output>
    <button onClick={() => void assistant.send("¿Qué es Retributivo?")}>Enviar suspendido</button>
    <AssistantAiSettings />
  </>;
}

function PageProbe() {
  const assistant = useAssistant();
  return <>
    <output data-testid="page-selected">{assistant.conversation?.id ?? "none"}</output>
    <output data-testid="page-message-conversations">{assistant.messages.map((item) => item.conversationId).join(",")}</output>
    <output data-testid="page-sources">{assistant.sources.map((item) => item.id).join(",")}</output>
    <output data-testid="page-error">{assistant.error ?? "ok"}</output>
    <button onClick={() => void assistant.loadMoreMessages()}>Cargar página A</button>
    <button onClick={() => void assistant.selectConversation("conversation-b")}>Seleccionar B</button>
  </>;
}

function MutationProbe() {
  const assistant = useAssistant();
  return <>
    <output data-testid="mutation-conversation">{JSON.stringify(assistant.conversation)}</output>
    <output data-testid="mutation-streaming">{String(assistant.streaming)}</output>
    <button onClick={() => void assistant.send("¿Qué es Retributivo?")}>Enviar carrera</button>
    <button onClick={() => void assistant.convertToActiveAnalysis()}>Forzar conversión</button>
    <button onClick={() => { void assistant.renameConversation("Renombrada"); void assistant.archiveConversation(); void assistant.updateConversationPreferences({ responseMode: "flexible", contextStrategy: "optimized" }); }}>Mutar conversación</button>
  </>;
}

function TimerProbe() {
  const assistant = useAssistant();
  return <>
    <output data-testid="timer-selected">{assistant.conversation?.id ?? "none"}</output>
    <output data-testid="timer-announcement">{assistant.announcement}</output>
    <button onClick={() => void assistant.send("¿Qué es Retributivo?")}>Enviar A temporizado</button>
    <button onClick={() => void assistant.selectConversation("conversation-b")}>Seleccionar B temporizado</button>
  </>;
}

describe("Phase 5 third-review regressions", () => {
  beforeEach(installBrowser);
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  test("the actual Settings clear callback invalidates a suspended run and leaves every assistant-content store empty", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-clear-all-suspended";
    await seed(factory, dbName, [conversation("conversation-a")], [message("existing", "conversation-a", "user", "Anterior", "completed")]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = {
      streamGeneral: async function* () {
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta: "Delta tardío" })}\n`);
        await gate;
        yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
      },
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider factory={factory} dbName={dbName} adapter={adapter}><ClearSettingsProbe /></AssistantProvider>);
    await waitFor(() => expect(screen.getByTestId("clear-selected")).toHaveTextContent("conversation-a"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar suspendido" }));
    await waitFor(() => expect(screen.getByTestId("clear-streaming")).toHaveTextContent("true"));
    fireEvent.click(await screen.findByRole("button", { name: "Borrar conversaciones y contexto" }));
    await waitFor(() => expect(screen.getByTestId("clear-selected")).toHaveTextContent("none"));
    expect(screen.getByTestId("clear-streaming")).toHaveTextContent("false");
    release();
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(screen.getByTestId("clear-announcement")).not.toHaveTextContent("Delta tardío");
    expect(Object.values(await contentStoreCounts(factory, dbName))).toEqual(contentStores.map(() => 0));
  });

  test("discards A's delayed older page and sources after B is selected", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-load-more-isolation";
    const aMessages = Array.from({ length: 42 }, (_, index) => message(
      `a-${String(index).padStart(2, "0")}`, "conversation-a", index % 2 ? "assistant" : "user", `A ${index}`, "completed",
      { createdAt: `2026-07-13T10:${String(index).padStart(2, "0")}:00.000Z`, sourceRefIds: index === 0 ? ["source-a"] : [] },
    ));
    await seed(factory, dbName, [
      conversation("conversation-a", { updatedAt: "2026-07-13T12:00:00.000Z" }),
      conversation("conversation-b", { updatedAt: "2026-07-13T11:00:00.000Z" }),
    ], [...aMessages, message("b-00", "conversation-b", "user", "B", "completed")], [], [source("source-a", "conversation-a")]);
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    const listMessages = repositories.messages.listByConversation.bind(repositories.messages);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    repositories.messages.listByConversation = async (conversationId, options) => {
      if (conversationId === "conversation-a" && options.cursor) await gate;
      return listMessages(conversationId, options);
    };
    render(<AssistantProvider repositoriesFactory={async () => repositories}><PageProbe /></AssistantProvider>);
    await waitFor(() => expect(screen.getByTestId("page-selected")).toHaveTextContent("conversation-a"));
    fireEvent.click(screen.getByRole("button", { name: "Cargar página A" }));
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar B" }));
    await waitFor(() => expect(screen.getByTestId("page-selected")).toHaveTextContent("conversation-b"));
    release();
    await waitFor(() => expect(screen.getByTestId("page-message-conversations")).toHaveTextContent(/^conversation-b$/));
    expect(screen.getByTestId("page-sources")).not.toHaveTextContent("source-a");
    expect(screen.getByTestId("page-error")).toHaveTextContent("ok");
  });

  test("send completion preserves a concurrent analysis conversion and disables the visible conversion control while streaming", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-authoritative-conversion";
    await seed(factory, dbName, [conversation("conversation-a")]);
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = {
      streamGeneral: async function* () { started(); await gate; yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`); },
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider activeAnalysis={activeAnalysis} factory={factory} dbName={dbName} adapter={adapter}><MutationProbe /><AssistantView /></AssistantProvider>);
    await waitFor(() => expect(screen.getByTestId("mutation-conversation")).toHaveTextContent("conversation-a"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar carrera" }));
    await startedPromise;
    expect(screen.getByRole("button", { name: "Convertir al análisis activo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Forzar conversión" }));
    await waitFor(() => expect(screen.getByTestId("mutation-conversation")).toHaveTextContent('"type":"analysis"'));
    release();
    await waitFor(() => expect(screen.getByTestId("mutation-streaming")).toHaveTextContent("false"));
    const persisted = await createIndexedDbRepositories({ factory, dbName });
    expect(await persisted.conversations.get("conversation-a")).toMatchObject({ type: "analysis", analysisId: "analysis-1" });
    expect(await persisted.events.listByConversation("conversation-a")).toHaveLength(1);
    persisted.close();
  });

  test("send completion preserves rename and archive while rejecting preferences queued after archival", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-authoritative-mutation";
    await seed(factory, dbName, [conversation("conversation-a")]);
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = {
      streamGeneral: async function* () { started(); await gate; yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`); },
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider factory={factory} dbName={dbName} adapter={adapter}><MutationProbe /></AssistantProvider>);
    await screen.findByText(/conversation-a/);
    fireEvent.click(screen.getByRole("button", { name: "Enviar carrera" }));
    await startedPromise;
    fireEvent.click(screen.getByRole("button", { name: "Mutar conversación" }));
    await waitFor(() => expect(screen.getByTestId("mutation-conversation")).toHaveTextContent('"status":"archived"'));
    release();
    await waitFor(() => expect(screen.getByTestId("mutation-streaming")).toHaveTextContent("false"));
    const persisted = await createIndexedDbRepositories({ factory, dbName });
    expect(await persisted.conversations.get("conversation-a")).toMatchObject({ title: "Renombrada", status: "archived", responseMode: "strict", contextStrategy: "automatic" });
    persisted.close();
  });

  test("aborts reader.read promptly even when iterator return never settles", async () => {
    const controller = new AbortController();
    const never = new Promise<never>(() => undefined);
    const iterable: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return { next: () => never, return: () => never };
      },
    };
    const reader = localIterableResponse(iterable, "round-abort", controller.signal).body!.getReader();
    const readResult = reader.read().then(() => "resolved", () => "rejected");
    controller.abort(new DOMException("Stopped", "AbortError"));
    const outcome = await Promise.race([readResult, new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 40))]);
    expect(outcome).toBe("rejected");
  });

  test("retries an empty failed general response without invoking analysis planning", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-empty-failed-retry";
    const selectedProfile = profile();
    await seed(factory, dbName, [conversation("conversation-a", { modelProfileId: selectedProfile.id })], [
      message("user-a", "conversation-a", "user", "¿Qué es Retributivo?", "completed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId }),
      message("assistant-a", "conversation-a", "assistant", "", "failed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId, createdAt: "2026-07-13T10:01:00.000Z" }),
    ], [selectedProfile]);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return new Response(`${JSON.stringify({ type: "text_delta", roundId: body.roundId, messageId: "remote", delta: "Respuesta reiniciada" })}\n${JSON.stringify({ type: "done", roundId: body.roundId, finishReason: "stop" })}\n`);
    }));
    render(<AssistantProvider factory={factory} dbName={dbName}><AssistantView /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar respuesta" }));
    await screen.findByText("Respuesta reiniciada");
    expect(bodies[0]).toMatchObject({ phase: "general" });
    expect(bodies[0]).not.toHaveProperty("continuationContext");
    expect(bodies[0]).not.toHaveProperty("interruptedMessageId");
  });

  test("retries a non-empty stopped general response with its partial text in recent history", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-partial-stopped-retry";
    const selectedProfile = profile();
    await seed(factory, dbName, [conversation("conversation-a", { modelProfileId: selectedProfile.id })], [
      message("user-a", "conversation-a", "user", "¿Qué es Retributivo?", "completed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId }),
      message("assistant-a", "conversation-a", "assistant", "Parcial", "stopped", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId, createdAt: "2026-07-13T10:01:00.000Z" }),
    ], [selectedProfile]);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return new Response(`${JSON.stringify({ type: "text_delta", roundId: body.roundId, messageId: "remote", delta: " completada" })}\n${JSON.stringify({ type: "done", roundId: body.roundId, finishReason: "stop" })}\n`);
    }));
    render(<AssistantProvider factory={factory} dbName={dbName}><AssistantView /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar respuesta" }));
    await screen.findByText("Parcial completada");
    expect(bodies[0]).toMatchObject({
      phase: "general",
      generalHistory: [{ role: "assistant", content: "Parcial" }],
    });
    expect(bodies[0]).not.toHaveProperty("continuationContext");
    expect(bodies[0]).not.toHaveProperty("interruptedMessageId");
  });

  test("hides repeat controls for a restored fake analysis response without its exact in-memory descriptor", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-restored-fake-analysis";
    await seed(factory, dbName, [conversation("conversation-a", { type: "analysis", analysisId: "analysis-1", analysisVersion: createdAt })], [
      message("user-a", "conversation-a", "user", "Consulta la matrícula 10001", "completed", { contextOrigin: "analysis", analysisVersion: createdAt }),
      message("assistant-a", "conversation-a", "assistant", "Parcial", "stopped", { contextOrigin: "analysis", analysisVersion: createdAt, createdAt: "2026-07-13T10:01:00.000Z" }),
    ]);
    render(<AssistantProvider factory={factory} dbName={dbName}><AssistantView /></AssistantProvider>);
    await screen.findByText("Parcial");
    expect(screen.queryByRole("button", { name: "Reintentar respuesta" })).toBeNull();
  });

  test("does not scan past an unrelated loaded assistant when deciding whether a target is repeatable", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-repeat-unrelated-message";
    const selectedProfile = profile();
    await seed(factory, dbName, [conversation("conversation-a", { modelProfileId: selectedProfile.id })], [
      message("user-a", "conversation-a", "user", "¿Qué es Retributivo?", "completed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId }),
      message("assistant-first", "conversation-a", "assistant", "Primera", "completed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId, createdAt: "2026-07-13T10:01:00.000Z" }),
      message("assistant-orphan", "conversation-a", "assistant", "Huérfana", "stopped", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId, createdAt: "2026-07-13T10:02:00.000Z" }),
    ], [selectedProfile]);
    render(<AssistantProvider factory={factory} dbName={dbName}><AssistantView /></AssistantProvider>);
    await screen.findByText("Huérfana");
    expect(screen.queryByRole("button", { name: "Reintentar respuesta" })).toBeNull();
  });

  test("does not expose repeat across an unloaded page boundary", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-repeat-page-boundary";
    const selectedProfile = profile();
    const boundaryMessages = [
      message("older-user", "conversation-a", "user", "¿Qué es Retributivo?", "completed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId, createdAt: "2026-07-13T09:00:00.000Z" }),
      message("boundary-target", "conversation-a", "assistant", "Parcial límite", "stopped", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId, createdAt: "2026-07-13T09:01:00.000Z" }),
      ...Array.from({ length: 39 }, (_, index) => message(`later-${index}`, "conversation-a", "assistant", `Después ${index}`, "completed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId, createdAt: `2026-07-13T10:${String(index).padStart(2, "0")}:00.000Z` })),
    ];
    await seed(factory, dbName, [conversation("conversation-a", { modelProfileId: selectedProfile.id })], boundaryMessages, [selectedProfile]);
    render(<AssistantProvider factory={factory} dbName={dbName}><AssistantView /></AssistantProvider>);
    await screen.findByText("Parcial límite");
    expect(screen.queryByRole("button", { name: "Reintentar respuesta" })).toBeNull();
  });

  test("a stale A batching timer cannot announce A after B is selected", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-stale-batching-timer";
    await seed(factory, dbName, [
      conversation("conversation-a", { updatedAt: "2026-07-13T12:00:00.000Z" }),
      conversation("conversation-b", { updatedAt: "2026-07-13T11:00:00.000Z" }),
    ]);
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = {
      streamGeneral: async function* () {
        started();
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta: "Anuncio de A" })}\n`);
        await gate;
        yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
      },
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider factory={factory} dbName={dbName} adapter={adapter}><TimerProbe /></AssistantProvider>);
    await screen.findByText("conversation-a");
    fireEvent.click(screen.getByRole("button", { name: "Enviar A temporizado" }));
    await startedPromise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar B temporizado" }));
    await screen.findByText("conversation-b");
    release();
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(screen.getByTestId("timer-selected")).toHaveTextContent("conversation-b");
    expect(screen.getByTestId("timer-announcement")).not.toHaveTextContent("Anuncio de A");
  });
});
