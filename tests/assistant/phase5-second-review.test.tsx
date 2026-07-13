// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/AssistantProvider";
import { AssistantView } from "@/components/assistant/AssistantView";
import type { ChatMessage, Conversation, ModelProfile } from "@/lib/assistant/domain";
import { FakeAssistantAdapter } from "@/lib/assistant/providers/fakeAdapter";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";

const createdAt = "2026-07-13T10:00:00.000Z";
const encoder = new TextEncoder();

function conversation(id: string, updatedAt = createdAt, modelProfileId = "fake-retributivo-v1"): Conversation {
  return { id, type: "general", title: id, associatedPersonIds: [], modelProfileId, responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt, updatedAt };
}

function chatMessage(id: string, conversationId: string, role: "user" | "assistant", content: string, status: ChatMessage["status"], messageCreatedAt = createdAt): ChatMessage {
  return { id, conversationId, role, content, status, contextOrigin: "general", modelProfileId: "fake-retributivo-v1", modelId: "fake-retributivo-v1", responseMode: "strict", contextStrategy: "automatic", sourceRefIds: [], actionIds: [], createdAt: messageCreatedAt };
}

function profile(id: string, baseUrl: string): ModelProfile {
  return { id, name: id, provider: "manual", baseUrl, modelId: `${id}-model`, enabled: true, generalChatCompatible: true, analysisCompatible: false, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true, capabilitiesSource: "detected" };
}

async function seed(factory: IDBFactory, dbName: string, conversations: Conversation[]) {
  const repositories = await createIndexedDbRepositories({ factory, dbName });
  for (const item of conversations) await repositories.conversations.put(item);
  repositories.close();
}

function browser() {
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("min-width: 1280px"), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => true) });
}

function LifecycleProbe() {
  const assistant = useAssistant();
  return <>
    <output data-testid="selected">{assistant.conversation?.id ?? "none"}</output>
    <output data-testid="latest-content">{assistant.messages.at(-1)?.content ?? ""}</output>
    <output data-testid="lifecycle-state">{`${assistant.streaming}:${assistant.error ?? "ok"}`}</output>
    <button onClick={() => void assistant.send("¿Qué es Retributivo?")}>Enviar A</button>
    <button onClick={() => void assistant.deleteConversation()}>Eliminar actual</button>
    <button onClick={() => void assistant.selectConversation("conversation-b")}>Seleccionar B</button>
  </>;
}

function ReliabilityProbe() {
  const assistant = useAssistant();
  return <>
    <output data-testid="selected">{assistant.conversation?.id ?? "none"}</output>
    <output data-testid="selection-state">{`${assistant.selectionLoading}:${assistant.error ?? "ok"}`}</output>
    <output data-testid="conversation-order">{assistant.conversations.map((item) => item.id).join(",")}</output>
    <button onClick={() => void assistant.selectConversation("conversation-b")}>Seleccionar B</button>
    <button onClick={() => void assistant.selectConversation("conversation-a")}>Seleccionar A</button>
    <button onClick={() => void assistant.renameConversation("Renombrada")}>Renombrar</button>
    <button onClick={() => void assistant.deleteConversation()}>Eliminar actual</button>
  </>;
}

function DefaultFakeProbe() {
  const assistant = useAssistant();
  const lastAssistant = [...assistant.messages].reverse().find((message) => message.role === "assistant");
  return <>
    <output data-testid="fake-selected">{assistant.conversation?.id ?? "none"}</output>
    <output data-testid="fake-content">{lastAssistant?.content ?? ""}</output>
    <output data-testid="fake-status">{lastAssistant?.status ?? "none"}</output>
    <button onClick={() => void assistant.send("¿Qué es Retributivo?")}>Enviar fake</button>
    <button onClick={() => assistant.stop()}>Detener fake</button>
    <button onClick={() => lastAssistant && void assistant.retryResponse(lastAssistant.id)}>Reintentar fake</button>
  </>;
}

describe("Phase 5 second-review regressions", () => {
  beforeEach(browser);
  afterEach(() => vi.unstubAllGlobals());

  test("deleting a conversation invalidates its suspended run so late completion cannot recreate data", async () => {
    const factory = new IDBFactory();
    await seed(factory, "phase5-delete-run-race", [conversation("conversation-a")]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = {
      streamGeneral: async function* () {
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta: "Parcial" })}\n`);
        await gate;
        yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
      },
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider factory={factory} dbName="phase5-delete-run-race" adapter={adapter}><LifecycleProbe /></AssistantProvider>);
    await screen.findByText("conversation-a");
    fireEvent.click(screen.getByRole("button", { name: "Enviar A" }));
    await screen.findByText("Parcial");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar actual" }));
    await screen.findByText("none");
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("selected")).toHaveTextContent("none");
    const persisted = await createIndexedDbRepositories({ factory, dbName: "phase5-delete-run-race" });
    expect(await persisted.conversations.get("conversation-a")).toBeUndefined();
    expect((await persisted.messages.listByConversation("conversation-a", { limit: 10 })).items).toEqual([]);
    persisted.close();
  });

  test("selecting B invalidates a suspended run from A so late completion cannot reselect A", async () => {
    const factory = new IDBFactory();
    await seed(factory, "phase5-select-run-race", [
      conversation("conversation-a", "2026-07-13T12:00:00.000Z"),
      conversation("conversation-b", "2026-07-13T11:00:00.000Z"),
    ]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = {
      streamGeneral: async function* () {
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta: "Parcial A" })}\n`);
        await gate;
        yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
      },
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider factory={factory} dbName="phase5-select-run-race" adapter={adapter}><LifecycleProbe /></AssistantProvider>);
    await screen.findByText("conversation-a");
    fireEvent.click(screen.getByRole("button", { name: "Enviar A" }));
    await screen.findByText("Parcial A");
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar B" }));
    await screen.findByText("conversation-b");
    release();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(screen.getByTestId("selected")).toHaveTextContent("conversation-b");
  });

  test("hides retry for a restored fake target without its exact live descriptor", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase5-restored-repeat" });
    await repositories.conversations.put(conversation("conversation-restored"));
    await repositories.messages.put(chatMessage("user-restored", "conversation-restored", "user", "¿Qué es Cuadre Reg.?", "completed", "2026-07-13T10:00:00.000Z"));
    await repositories.messages.put(chatMessage("assistant-restored", "conversation-restored", "assistant", "Parcial viejo", "stopped", "2026-07-13T10:01:00.000Z"));
    repositories.close();
    const adapter = {
      streamGeneral: vi.fn(async function* () {
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta: "Respuesta restaurada" })}\n`);
        yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
      }),
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider factory={factory} dbName="phase5-restored-repeat" adapter={adapter}><AssistantView /></AssistantProvider>);
    await screen.findByText("Parcial viejo");
    expect(screen.queryByRole("button", { name: "Reintentar respuesta" })).toBeNull();
    expect(adapter.streamGeneral).not.toHaveBeenCalled();
  });

  test("scopes transient fallback keys to each producer profile", async () => {
    const factory = new IDBFactory();
    const selected = profile("profile-a", "https://a.example/v1");
    const fallback = profile("profile-b", "https://b.example/v1");
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase5-fallback-key-scope" });
    await repositories.conversations.put(conversation("conversation-key", createdAt, selected.id));
    await repositories.modelProfiles.put(selected);
    await repositories.modelProfiles.put(fallback);
    await repositories.assistantSettings.put({ id: "assistant-settings", defaultGeneralModelProfileId: fallback.id, responseMode: "strict", contextStrategy: "automatic", safetyMarginPercent: 10, warningThresholdPercent: 75, compactionThresholdPercent: 85 });
    repositories.close();
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return bodies.length < 3
        ? new Response(`${JSON.stringify({ type: "error", roundId: body.roundId, code: "temporary", message: "Temporal", retryable: true, classification: "transient" })}\n`)
        : new Response(`${JSON.stringify({ type: "text_delta", roundId: body.roundId, messageId: "remote", delta: "Fallback correcto" })}\n${JSON.stringify({ type: "done", roundId: body.roundId, finishReason: "stop" })}\n`);
    }));
    function KeyProbe() {
      const assistant = useAssistant();
      return <><output>{assistant.conversation?.id}</output><button onClick={() => assistant.setKey({ profileId: selected.id, endpoint: selected.baseUrl }, "secret-a")}>Preparar clave</button><button onClick={() => void assistant.send("¿Qué es Retributivo?")}>Enviar</button><output>{assistant.messages.at(-1)?.content}</output><output>{assistant.error}</output></>;
    }
    render(<AssistantProvider factory={factory} dbName="phase5-fallback-key-scope"><KeyProbe /></AssistantProvider>);
    await screen.findByText("conversation-key");
    fireEvent.click(screen.getByRole("button", { name: "Preparar clave" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByText("Fallback correcto");
    expect(bodies.map((body) => body.apiKey)).toEqual(["secret-a", "secret-a", undefined]);
    expect(bodies.at(-1)).toMatchObject({ modelProfileId: fallback.id, profile: fallback });
  });

  test("clearing the vault before regenerate prevents reuse of the prior request key", async () => {
    const factory = new IDBFactory();
    const selected = profile("profile-clear", "https://clear.example/v1");
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase5-clear-before-repeat" });
    await repositories.conversations.put(conversation("conversation-clear", createdAt, selected.id));
    await repositories.modelProfiles.put(selected);
    repositories.close();
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return new Response(`${JSON.stringify({ type: "text_delta", roundId: body.roundId, messageId: "remote", delta: `Respuesta ${bodies.length}` })}\n${JSON.stringify({ type: "done", roundId: body.roundId, finishReason: "stop" })}\n`);
    }));
    function ClearProbe() {
      const assistant = useAssistant();
      return <><button onClick={() => assistant.setKey({ profileId: selected.id, endpoint: selected.baseUrl }, "secret-clear")}>Preparar clave</button><button onClick={() => assistant.clearKey()}>Borrar clave</button><AssistantView /></>;
    }
    render(<AssistantProvider factory={factory} dbName="phase5-clear-before-repeat"><ClearProbe /></AssistantProvider>);
    const composer = await screen.findByRole("textbox", { name: "Pregunta" });
    fireEvent.click(screen.getByRole("button", { name: "Preparar clave" }));
    fireEvent.change(composer, { target: { value: "¿Qué es Retributivo?" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await screen.findByText("Respuesta 1");
    fireEvent.click(screen.getByRole("button", { name: "Borrar clave" }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerar respuesta" }));
    await screen.findByText("Respuesta 2");
    expect(bodies.map((body) => body.apiKey)).toEqual(["secret-clear", undefined]);
  });

  test("clears selection loading and exposes a sanitized error when a conversation load fails", async () => {
    const factory = new IDBFactory();
    await seed(factory, "phase5-load-failure", [
      conversation("conversation-a", "2026-07-13T12:00:00.000Z"),
      conversation("conversation-b", "2026-07-13T11:00:00.000Z"),
    ]);
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase5-load-failure" });
    const listMessages = repositories.messages.listByConversation.bind(repositories.messages);
    repositories.messages.listByConversation = async (conversationId, options) => {
      if (conversationId === "conversation-b") throw new Error("secret database internals");
      return listMessages(conversationId, options);
    };
    render(<AssistantProvider repositoriesFactory={async () => repositories}><ReliabilityProbe /></AssistantProvider>);
    await screen.findByText("conversation-a");
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar B" }));
    await waitFor(() => expect(screen.getByTestId("selection-state")).toHaveTextContent(/^false:No se pudo cargar/));
    expect(screen.getByTestId("selection-state")).not.toHaveTextContent("secret database internals");
    expect(screen.getByTestId("selected")).toHaveTextContent("conversation-a");
  });

  test("a queued conversation mutation becomes a no-op after deletion is requested", async () => {
    const factory = new IDBFactory();
    await seed(factory, "phase5-delete-queued-mutation", [conversation("conversation-a")]);
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase5-delete-queued-mutation" });
    const getConversation = repositories.conversations.get.bind(repositories.conversations);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let delayNextGet = true;
    repositories.conversations.get = async (id) => {
      if (delayNextGet) { delayNextGet = false; await gate; }
      return getConversation(id);
    };
    render(<AssistantProvider repositoriesFactory={async () => repositories}><ReliabilityProbe /></AssistantProvider>);
    await screen.findByText("conversation-a");
    fireEvent.click(screen.getByRole("button", { name: "Renombrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar actual" }));
    release();
    await screen.findByText("none");
    await waitFor(async () => expect(await getConversation("conversation-a")).toBeUndefined());
  });

  test("keeps the conversation list sorted newest-first after a mutation", async () => {
    const factory = new IDBFactory();
    await seed(factory, "phase5-conversation-order", [
      conversation("conversation-a", "2026-07-13T10:00:00.000Z"),
      conversation("conversation-b", "2026-07-13T11:00:00.000Z"),
    ]);
    render(<AssistantProvider factory={factory} dbName="phase5-conversation-order"><ReliabilityProbe /></AssistantProvider>);
    await screen.findByText("conversation-b");
    expect(screen.getByTestId("conversation-order")).toHaveTextContent("conversation-b,conversation-a");
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar A" }));
    await screen.findByText("conversation-a");
    fireEvent.click(screen.getByRole("button", { name: "Renombrar" }));
    await waitFor(() => expect(screen.getByTestId("conversation-order")).toHaveTextContent("conversation-a,conversation-b"));
  });

  test("stopping and retrying through the default fake transport replaces the partial response", async () => {
    const factory = new IDBFactory();
    await seed(factory, "phase5-default-fake-repeat", [conversation("conversation-a")]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let invocation = 0;
    vi.spyOn(FakeAssistantAdapter.prototype, "streamGeneral").mockImplementation(async function* (request) {
      invocation += 1;
      if (invocation === 1) {
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: request.messageId, delta: "Respuesta parcial" })}\n`);
        await gate;
      } else {
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: request.messageId, delta: "Respuesta completa" })}\n`);
      }
      yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
    });
    render(<AssistantProvider factory={factory} dbName="phase5-default-fake-repeat"><DefaultFakeProbe /></AssistantProvider>);
    await screen.findByText("conversation-a");
    fireEvent.click(screen.getByRole("button", { name: "Enviar fake" }));
    await waitFor(() => expect(screen.getByTestId("fake-content")).toHaveTextContent("Respuesta parcial"));
    fireEvent.click(screen.getByRole("button", { name: "Detener fake" }));
    release();
    await waitFor(() => expect(screen.getByTestId("fake-status")).toHaveTextContent("stopped"));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar fake" }));
    await waitFor(() => expect(screen.getByTestId("fake-content")).toHaveTextContent(/^Respuesta completa$/));
    expect(screen.getByTestId("fake-content")).not.toHaveTextContent("Respuesta parcialRespuesta completa");
  });
});
