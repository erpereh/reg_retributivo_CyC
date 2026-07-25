// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/AssistantProvider";
import { AssistantView } from "@/components/assistant/AssistantView";
import { AssistantAiSettings } from "@/components/settings/AssistantAiSettings";
import type { ChatMessage, Conversation, ModelProfile } from "@/lib/assistant/domain";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { AssistantRepositories } from "@/lib/assistant/storage/repositories";
import { createAnalysisVersionSnapshot } from "@/lib/assistant/integrations/analysisVersion";
import type { AnalysisResult, StoredAnalysis } from "@/lib/types";
import { seedCatalogFixtures } from "./catalog-fixtures";

const createdAt = "2026-07-13T10:00:00.000Z";
const encoder = new TextEncoder();

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

function profile(): ModelProfile {
  return {
    id: "profile-production", name: "Producción", provider: "manual", baseUrl: "https://provider.example/v1", modelId: "model-production",
    enabled: true, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true,
    supportsStructuredOutput: true, capabilitiesSource: "detected",
  };
}

const activeAnalysis = {
  id: "analysis-1", createdAt, result: { people: [], payrollRecords: [], registroEmployees: [] } as unknown as AnalysisResult,
} as StoredAnalysis;

async function seed(factory: IDBFactory, dbName: string, conversations: Conversation[], messages: ChatMessage[] = [], profiles: ModelProfile[] = []) {
  const repositories = await createIndexedDbRepositories({ factory, dbName });
  const mappings = await seedCatalogFixtures(repositories, profiles, createdAt);
  for (const item of conversations) { const mapping = item.modelProfileId ? mappings.get(item.modelProfileId) : undefined; await repositories.conversations.put(mapping ? { ...item, providerId: mapping.providerId, modelProfileId: mapping.entryId, modelId: mapping.modelId } : item); }
  for (const item of messages) { const mapping = item.modelProfileId ? mappings.get(item.modelProfileId) : undefined; await repositories.messages.put(mapping ? { ...item, providerId: mapping.providerId, modelProfileId: mapping.entryId, modelId: mapping.modelId } : item); }
  repositories.close();
}

function installBrowser() {
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("min-width: 1280px"), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => true) });
}

function StateProbe() {
  const assistant = useAssistant();
  const target = assistant.messages.find((item) => item.id === "assistant-a");
  const latestAssistant = [...assistant.messages].reverse().find((item) => item.role === "assistant");
  return <>
    <output data-testid="selected">{assistant.conversation?.id ?? "none"}</output>
    <output data-testid="type">{assistant.conversation?.type ?? "none"}</output>
    <output data-testid="conversation-count">{assistant.conversations.length}</output>
    <output data-testid="streaming">{String(assistant.streaming)}</output>
    <output data-testid="selection-loading">{String(assistant.selectionLoading)}</output>
    <output data-testid="message-count">{assistant.messages.length}</output>
    <output data-testid="has-more-messages">{String(assistant.hasMoreMessages)}</output>
    <output data-testid="target-status">{target?.status ?? "none"}</output>
    <output data-testid="target-content">{target?.content ?? ""}</output>
    <output data-testid="latest-assistant-status">{latestAssistant?.status ?? "none"}</output>
    <output data-testid="announcement">{assistant.announcement}</output>
    <output data-testid="notice">{assistant.notice ?? ""}</output>
    <output data-testid="error">{assistant.error ?? ""}</output>
  </>;
}

function OwnershipProbe() {
  const assistant = useAssistant();
  const [firstDone, setFirstDone] = useState(false);
  return <>
    <StateProbe />
    <output data-testid="first-done">{String(firstDone)}</output>
    <button onClick={() => { void assistant.send("¿Qué es Retributivo?").finally(() => setFirstDone(true)); }}>Enviar A1</button>
    <button onClick={() => void assistant.selectConversation("conversation-b")}>Seleccionar B</button>
    <button onClick={() => void assistant.selectConversation("conversation-a")}>Volver a A</button>
    <button onClick={() => void assistant.send("¿Qué es Cuadre Reg.?")}>Enviar A2</button>
    <button onClick={() => void assistant.deleteConversation()}>Eliminar A2</button>
  </>;
}

function ConversionProbe() {
  const assistant = useAssistant();
  return <>
    <StateProbe />
    <button onClick={() => void assistant.convertToActiveAnalysis()}>Convertir paginada</button>
    <button onClick={() => void assistant.loadMoreMessages()}>Cargar antiguas</button>
  </>;
}

function CreateTransitionProbe() {
  const assistant = useAssistant();
  const [doubleDone, setDoubleDone] = useState(false);
  const [createDone, setCreateDone] = useState(false);
  const [selectDone, setSelectDone] = useState(false);
  const [conflictsDone, setConflictsDone] = useState(false);
  return <>
    <StateProbe />
    <output data-testid="double-done">{String(doubleDone)}</output>
    <output data-testid="create-done">{String(createDone)}</output>
    <output data-testid="select-done">{String(selectDone)}</output>
    <output data-testid="conflicts-done">{String(conflictsDone)}</output>
    <button onClick={() => { void Promise.all([assistant.createGeneralConversation(), assistant.createGeneralConversation()]).finally(() => setDoubleDone(true)); }}>Doble create directo</button>
    <button onClick={() => { void assistant.createGeneralConversation().finally(() => setCreateDone(true)); }}>Create retrasada directa</button>
    <button onClick={() => { void assistant.selectConversation("conversation-b").finally(() => setSelectDone(true)); }}>Seleccionar B directo</button>
    <button onClick={() => { void Promise.all([
      assistant.selectConversation("conversation-b"), assistant.renameConversation("Renombrada durante create"),
      assistant.archiveConversation(), assistant.deleteConversation(), assistant.convertToActiveAnalysis(),
    ]).finally(() => setConflictsDone(true)); }}>Conflictos directos durante create</button>
  </>;
}

describe("Phase 5 fifth-review regressions", () => {
  beforeEach(installBrowser);
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  test("actual clear wins over a create whose repository write finishes late", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-fifth-create-clear";
    await seed(factory, dbName, [conversation("conversation-a")]);
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    const originalPut = repositories.conversations.put.bind(repositories.conversations);
    const originalClear = repositories.clearAssistantContent.bind(repositories);
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    let createStarted!: () => void;
    const createStartedPromise = new Promise<void>((resolve) => { createStarted = resolve; });
    let clearDone!: () => void;
    const clearDonePromise = new Promise<void>((resolve) => { clearDone = resolve; });
    repositories.conversations.put = async (value) => {
      if (value.id !== "conversation-a") { createStarted(); await createGate; }
      await originalPut(value);
    };
    repositories.clearAssistantContent = async () => { await originalClear(); clearDone(); };
    render(<AssistantProvider repositoriesFactory={async () => repositories}><AssistantView /><AssistantAiSettings /><StateProbe /></AssistantProvider>);
    await screen.findByRole("heading", { name: "conversation-a" });
    fireEvent.click(screen.getByRole("button", { name: "Nueva conversación" }));
    await createStartedPromise;
    fireEvent.click(screen.getByRole("button", { name: "Borrar conversaciones y contexto" }));
    releaseCreate();
    await clearDonePromise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("conversation-count")).toHaveTextContent("0");
    expect(screen.getByTestId("selected")).toHaveTextContent("none");
    expect(screen.getByTestId("announcement")).toBeEmptyDOMElement();
    expect(screen.getByTestId("notice")).toBeEmptyDOMElement();
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
  });

  test("two rapid direct Create calls enqueue only one transition and disable actual New/select controls", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-final-double-create";
    await seed(factory, dbName, [conversation("conversation-a")]);
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    const originalPut = repositories.conversations.put.bind(repositories.conversations);
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    let createStarted!: () => void;
    const createStartedPromise = new Promise<void>((resolve) => { createStarted = resolve; });
    let createdWrites = 0;
    repositories.conversations.put = async (value) => {
      if (value.id !== "conversation-a") { createdWrites += 1; if (createdWrites === 1) createStarted(); await createGate; }
      await originalPut(value);
    };
    render(<AssistantProvider repositoriesFactory={async () => repositories}><AssistantView /><CreateTransitionProbe /></AssistantProvider>);
    await screen.findByRole("heading", { name: "conversation-a" });
    fireEvent.click(screen.getByRole("button", { name: "Doble create directo" }));
    await createStartedPromise;
    expect(screen.getByRole("button", { name: "Nueva conversación" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /conversation-a/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Más acciones de conversación" })).toBeDisabled();
    releaseCreate();
    await waitFor(() => expect(screen.getByTestId("double-done")).toHaveTextContent("true"));
    expect(createdWrites).toBe(1);
    expect(screen.getByTestId("conversation-count")).toHaveTextContent("2");
    expect(screen.getByTestId("selected").textContent).not.toBe("conversation-a");
    expect(screen.getByTestId("selection-loading")).toHaveTextContent("false");
  });

  test("direct select rename archive and delete cannot compete with a pending Create", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-final-select-during-create";
    await seed(factory, dbName, [
      conversation("conversation-a", { updatedAt: "2026-07-13T12:00:00.000Z" }),
      conversation("conversation-b", { updatedAt: "2026-07-13T11:00:00.000Z" }),
    ]);
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    const originalPut = repositories.conversations.put.bind(repositories.conversations);
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    let createStarted!: () => void;
    const createStartedPromise = new Promise<void>((resolve) => { createStarted = resolve; });
    repositories.conversations.put = async (value) => {
      if (value.id !== "conversation-a" && value.id !== "conversation-b") { createStarted(); await createGate; }
      await originalPut(value);
    };
    render(<AssistantProvider activeAnalysis={activeAnalysis} repositoriesFactory={async () => repositories}><AssistantView /><CreateTransitionProbe /></AssistantProvider>);
    await screen.findByRole("heading", { name: "conversation-a" });
    fireEvent.click(screen.getByRole("button", { name: "Create retrasada directa" }));
    await createStartedPromise;
    expect(screen.getByRole("button", { name: "Nueva conversación" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /conversation-b/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Conflictos directos durante create" }));
    releaseCreate();
    await waitFor(() => expect(screen.getByTestId("create-done")).toHaveTextContent("true"));
    await waitFor(() => expect(screen.getByTestId("conflicts-done")).toHaveTextContent("true"));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("selected").textContent).not.toBe("conversation-a");
    expect(screen.getByTestId("selected").textContent).not.toBe("conversation-b");
    expect(screen.getByTestId("conversation-count")).toHaveTextContent("3");
    expect(screen.getByTestId("streaming")).toHaveTextContent("false");
    expect(screen.getByTestId("selection-loading")).toHaveTextContent("false");
    const persisted = await createIndexedDbRepositories({ factory, dbName });
    expect(await persisted.conversations.get("conversation-a")).toMatchObject({ title: "conversation-a", status: "active", type: "general" });
    expect(await persisted.conversations.get("conversation-b")).toMatchObject({ title: "conversation-b", status: "active" });
    persisted.close();
  });

  test("actual clear wins over delayed delete metadata and selection continuations", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-fifth-delete-clear";
    await seed(factory, dbName, [
      conversation("conversation-a", { updatedAt: "2026-07-13T12:00:00.000Z" }),
      conversation("conversation-b", { updatedAt: "2026-07-13T11:00:00.000Z" }),
    ]);
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    const originalDelete = repositories.deleteConversation.bind(repositories);
    const originalClear = repositories.clearAssistantContent.bind(repositories);
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
    let deleteStarted!: () => void;
    const deleteStartedPromise = new Promise<void>((resolve) => { deleteStarted = resolve; });
    let releaseClear!: () => void;
    const clearGate = new Promise<void>((resolve) => { releaseClear = resolve; });
    let clearStarted!: () => void;
    const clearStartedPromise = new Promise<void>((resolve) => { clearStarted = resolve; });
    let clearDone!: () => void;
    const clearDonePromise = new Promise<void>((resolve) => { clearDone = resolve; });
    repositories.deleteConversation = async (id) => { deleteStarted(); await deleteGate; await originalDelete(id); };
    repositories.clearAssistantContent = async () => { clearStarted(); await clearGate; await originalClear(); clearDone(); };
    render(<AssistantProvider repositoriesFactory={async () => repositories}><AssistantView /><AssistantAiSettings /><StateProbe /></AssistantProvider>);
    await screen.findByRole("heading", { name: "conversation-a" });
    fireEvent.click(screen.getByRole("button", { name: "Más acciones de conversación" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar conversación" }));
    await deleteStartedPromise;
    fireEvent.click(screen.getByRole("button", { name: "Borrar conversaciones y contexto" }));
    releaseDelete();
    await clearStartedPromise;
    await new Promise((resolve) => setTimeout(resolve, 30));
    releaseClear();
    await clearDonePromise;
    expect(screen.getByTestId("conversation-count")).toHaveTextContent("0");
    expect(screen.getByTestId("selected")).toHaveTextContent("none");
    expect(screen.getByTestId("announcement")).toBeEmptyDOMElement();
  });

  test("create keeps the composer locked until B is selected and then leaves B usable", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-fifth-atomic-create";
    await seed(factory, dbName, [conversation("conversation-a")]);
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    const originalPut = repositories.conversations.put.bind(repositories.conversations);
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    let createStarted!: () => void;
    const createStartedPromise = new Promise<void>((resolve) => { createStarted = resolve; });
    repositories.conversations.put = async (value) => {
      if (value.id !== "conversation-a") { createStarted(); await createGate; }
      await originalPut(value);
    };
    const adapter = {
      streamGeneral: vi.fn(async function* (request: { messageId: string }) {
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: request.messageId, delta: "Respuesta B" })}\n`);
        yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
      }),
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider repositoriesFactory={async () => repositories} adapter={adapter}><AssistantView /><StateProbe /></AssistantProvider>);
    await screen.findByRole("heading", { name: "conversation-a" });
    fireEvent.click(screen.getByRole("button", { name: "Nueva conversación" }));
    await createStartedPromise;
    expect(screen.getByTestId("selection-loading")).toHaveTextContent("true");
    expect(screen.getByRole("textbox", { name: "Pregunta" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta" }), { target: { value: "¿Qué es Retributivo?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(adapter.streamGeneral).not.toHaveBeenCalled();
    releaseCreate();
    await screen.findByRole("heading", { name: "Consulta general" });
    const selectedB = screen.getByTestId("selected").textContent;
    expect(selectedB).not.toBe("conversation-a");
    expect(screen.getByTestId("selection-loading")).toHaveTextContent("false");
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta" }), { target: { value: "¿Qué es Cuadre Reg.?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Respuesta B")).toBeVisible();
    expect(screen.getByTestId("selected")).toHaveTextContent(String(selectedB));
  });

  test("a failed create restores A without a streaming target and exposes only a sanitized error", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-fifth-create-failure";
    await seed(factory, dbName, [conversation("conversation-a")]);
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    const originalPut = repositories.conversations.put.bind(repositories.conversations);
    repositories.conversations.put = async (value) => {
      if (value.id !== "conversation-a") throw new Error("private create detail");
      await originalPut(value);
    };
    let sendStarted!: () => void;
    const sendStartedPromise = new Promise<void>((resolve) => { sendStarted = resolve; });
    const never = new Promise<IteratorResult<Uint8Array>>(() => undefined);
    const adapter = {
      streamGeneral: () => ({ [Symbol.asyncIterator]() { return { next: () => { sendStarted(); return never; }, return: async () => ({ done: true as const, value: undefined }) }; } }),
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider repositoriesFactory={async () => repositories} adapter={adapter}><AssistantView /><StateProbe /></AssistantProvider>);
    await screen.findByRole("heading", { name: "conversation-a" });
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta" }), { target: { value: "¿Qué es Retributivo?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await sendStartedPromise;
    fireEvent.click(screen.getByRole("button", { name: "Nueva conversación" }));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("No se pudo crear la conversación. Puedes volver a intentarlo."));
    expect(screen.getByTestId("error")).not.toHaveTextContent("private create detail");
    expect(screen.getByTestId("streaming")).toHaveTextContent("false");
    expect(screen.getByTestId("selection-loading")).toHaveTextContent("false");
    expect(screen.getByTestId("latest-assistant-status")).toHaveTextContent("interrupted");
    expect(screen.getByRole("textbox", { name: "Pregunta" })).toBeEnabled();
  });

  test("late A1 finalization cannot steal A2 ownership before A2 is deleted", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-fifth-exact-run-owner";
    await seed(factory, dbName, [
      conversation("conversation-a", { updatedAt: "2026-07-13T12:00:00.000Z" }),
      conversation("conversation-b", { updatedAt: "2026-07-13T11:00:00.000Z" }),
    ]);
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    const originalWrite = repositories.writeConversationBlock.bind(repositories);
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    let writeStarted!: () => void;
    const writeStartedPromise = new Promise<void>((resolve) => { writeStarted = resolve; });
    let firstWrite = true;
    repositories.writeConversationBlock = async (block) => {
      if (firstWrite) { firstWrite = false; writeStarted(); await writeGate; }
      await originalWrite(block);
    };
    let invocation = 0;
    let a2Started!: () => void;
    const a2StartedPromise = new Promise<void>((resolve) => { a2Started = resolve; });
    const a2Return = vi.fn(async () => ({ done: true as const, value: undefined }));
    const never = new Promise<IteratorResult<Uint8Array>>(() => undefined);
    const adapter = {
      streamGeneral: vi.fn((): AsyncIterable<Uint8Array> => {
        invocation += 1;
        if (invocation === 1) return (async function* () {
          yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "a1", delta: "Respuesta A1" })}\n`);
          yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
        })();
        return { [Symbol.asyncIterator]() { return { next: () => { a2Started(); return never; }, return: a2Return }; } };
      }),
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider repositoriesFactory={async () => repositories} adapter={adapter}><OwnershipProbe /></AssistantProvider>);
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conversation-a"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar A1" }));
    await writeStartedPromise;
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar B" }));
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conversation-b"));
    fireEvent.click(screen.getByRole("button", { name: "Volver a A" }));
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conversation-a"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar A2" }));
    await a2StartedPromise;
    releaseWrite();
    await waitFor(() => expect(screen.getByTestId("first-done")).toHaveTextContent("true"));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar A2" }));
    await waitFor(() => expect(a2Return).toHaveBeenCalledTimes(1));
  });

  test("zero-delta regenerate failure preserves a completed target", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-fifth-regenerate-zero-delta";
    const selectedProfile = profile();
    await seed(factory, dbName, [conversation("conversation-a", { modelProfileId: selectedProfile.id })], [
      message("user-a", "conversation-a", "user", "Pregunta original", "completed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId }),
      message("assistant-a", "conversation-a", "assistant", "Respuesta completada previa", "completed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId, createdAt: "2026-07-13T10:01:00.000Z" }),
    ], [selectedProfile]);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(`${JSON.stringify({ type: "error", roundId: body.roundId, code: "provider_failure", classification: "provider", message: "detalle privado", retryable: false })}\n`);
    }));
    render(<AssistantProvider factory={factory} dbName={dbName}><AssistantView /><StateProbe /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Regenerar respuesta" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByTestId("streaming")).toHaveTextContent("false"));
    expect(screen.getByTestId("target-status")).toHaveTextContent("completed");
    expect(screen.getByTestId("target-content")).toHaveTextContent("Respuesta completada previa");
    const persisted = await createIndexedDbRepositories({ factory, dbName });
    expect(await persisted.messages.get("assistant-a")).toMatchObject({ status: "completed", content: "Respuesta completada previa" });
    persisted.close();
  });

  test("zero-delta retry failure preserves a failed target", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-fifth-retry-zero-delta";
    const selectedProfile = profile();
    await seed(factory, dbName, [conversation("conversation-a", { modelProfileId: selectedProfile.id })], [
      message("user-a", "conversation-a", "user", "Pregunta original", "completed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId }),
      message("assistant-a", "conversation-a", "assistant", "Respuesta fallida previa", "failed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId, createdAt: "2026-07-13T10:01:00.000Z" }),
    ], [selectedProfile]);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(`${JSON.stringify({ type: "error", roundId: body.roundId, code: "provider_failure", classification: "provider", message: "detalle privado", retryable: false })}\n`);
    }));
    render(<AssistantProvider factory={factory} dbName={dbName}><AssistantView /><StateProbe /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar respuesta" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByTestId("streaming")).toHaveTextContent("false"));
    expect(screen.getByTestId("target-status")).toHaveTextContent("failed");
    expect(screen.getByTestId("target-content")).toHaveTextContent("Respuesta fallida previa");
    const persisted = await createIndexedDbRepositories({ factory, dbName });
    expect(await persisted.messages.get("assistant-a")).toMatchObject({ status: "failed", content: "Respuesta fallida previa" });
    persisted.close();
  });

  test("conversion keeps the loaded page bounded and atomically converts the full stored history", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-fifth-paginated-conversion";
    const history = Array.from({ length: 45 }, (_, index) => message(
      `message-${String(index).padStart(2, "0")}`, "conversation-a", index % 2 ? "assistant" : "user", `Mensaje ${index}`, "completed",
      { createdAt: `2026-07-13T10:${String(index).padStart(2, "0")}:00.000Z`, ...(index % 7 === 0 ? { analysisVersion: "legacy-v1" } : {}) },
    ));
    await seed(factory, dbName, [conversation("conversation-a")], history);
    render(<AssistantProvider factory={factory} dbName={dbName} activeAnalysis={activeAnalysis}><ConversionProbe /></AssistantProvider>);
    await waitFor(() => expect(screen.getByTestId("message-count")).toHaveTextContent("40"));
    expect(screen.getByTestId("has-more-messages")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: "Convertir paginada" }));
    await waitFor(() => expect(screen.getByTestId("type")).toHaveTextContent("analysis"));
    expect(screen.getByTestId("message-count")).toHaveTextContent("40");
    expect(screen.getByTestId("has-more-messages")).toHaveTextContent("true");

    fireEvent.click(screen.getByRole("button", { name: "Cargar antiguas" }));
    await waitFor(() => expect(screen.getByTestId("message-count")).toHaveTextContent("45"));
    expect(screen.getByTestId("has-more-messages")).toHaveTextContent("false");

    const persisted = await createIndexedDbRepositories({ factory, dbName });
    const stored: ChatMessage[] = [];
    let cursor: string | undefined;
    do {
      const page = await persisted.messages.listByConversation("conversation-a", { limit: 10, ...(cursor ? { cursor } : {}) });
      stored.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(stored).toHaveLength(45);
    expect(stored.every((item) => item.contextOrigin === "general")).toBe(true);
    expect(stored.filter((item) => item.analysisVersion === "legacy-v1")).toHaveLength(history.filter((item) => item.analysisVersion === "legacy-v1").length);
    const expectedVersion = await createAnalysisVersionSnapshot(activeAnalysis.id, activeAnalysis, createdAt);
    expect(await persisted.conversations.get("conversation-a")).toMatchObject({ type: "analysis", analysisId: "analysis-1", analysisVersion: expectedVersion.analysisVersion });
    expect(await persisted.events.listByConversation("conversation-a")).toEqual([
      expect.objectContaining({ conversationId: "conversation-a", event: { type: "context_added", contextId: "analysis-1", label: "Análisis activo" } }),
    ]);
    persisted.close();
  });
});
