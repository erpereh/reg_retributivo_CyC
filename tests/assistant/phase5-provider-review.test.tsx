// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/AssistantProvider";
import { AssistantView } from "@/components/assistant/AssistantView";
import type { Conversation, ModelProfile } from "@/lib/assistant/domain";
import { FakeAssistantAdapter } from "@/lib/assistant/providers/fakeAdapter";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { AssistantRepositories } from "@/lib/assistant/storage/repositories";

const createdAt = "2026-07-13T10:00:00.000Z";

function conversation(id = "conversation-reviewed", overrides: Partial<Conversation> = {}): Conversation {
  return {
    id, type: "general", title: id, associatedPersonIds: [], modelProfileId: "fake-retributivo-v1",
    responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt, updatedAt: createdAt, ...overrides,
  };
}

function profile(id: string, overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id, name: id, provider: "openai", baseUrl: "https://api.openai.com/v1", modelId: `${id}-model`, enabled: true,
    generalChatCompatible: true, analysisCompatible: false, supportsStreaming: true, supportsTools: true,
    supportsStructuredOutput: true, capabilitiesSource: "detected", ...overrides,
  };
}

async function seed(factory: IDBFactory, dbName: string, selected = conversation(), profiles: ModelProfile[] = []) {
  const repositories = await createIndexedDbRepositories({ factory, dbName });
  await repositories.conversations.put(selected);
  for (const item of profiles) await repositories.modelProfiles.put(item);
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

describe("Phase 5 reviewed provider behavior", () => {
  beforeEach(browser);
  afterEach(() => vi.unstubAllGlobals());

  test("shows grouped incremental text before local NDJSON completion and stops with retained partial content", async () => {
    const factory = new IDBFactory();
    await seed(factory, "phase5-incremental");
    const encoder = new TextEncoder();
    let release: (() => void) | undefined;
    let iteratorReturned = false;
    const adapter = {
      streamGeneral: () => {
        let emitted = false;
        return {
          async next() {
            if (!emitted) {
              emitted = true;
              return { done: false as const, value: encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta: "Parcial visible" })}\n`) };
            }
            await new Promise<void>((resolve) => { release = resolve; });
            return { done: true as const, value: undefined };
          },
          async return() { iteratorReturned = true; release?.(); return { done: true as const, value: undefined }; },
          [Symbol.asyncIterator]() { return this; },
        };
      },
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider factory={factory} dbName="phase5-incremental" adapter={adapter}><AssistantView /></AssistantProvider>);
    await screen.findByRole("heading", { name: "conversation-reviewed" });
    const composer = screen.getByRole("textbox", { name: "Pregunta" });
    fireEvent.change(composer, { target: { value: "¿Qué es Retributivo?" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(await screen.findByText("Parcial visible")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Detener respuesta" }));
    expect(await screen.findByText("Detenida")).toBeVisible();
    expect(screen.getByText("Parcial visible")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(iteratorReturned).toBe(true));

    const persisted = await createIndexedDbRepositories({ factory, dbName: "phase5-incremental" });
    const page = await persisted.messages.listByConversation("conversation-reviewed", { limit: 10 });
    expect(page.items).toHaveLength(2);
    expect(page.items.find((item) => item.role === "assistant")).toMatchObject({
      role: "assistant", status: "stopped", content: "Parcial visible",
    });
    persisted.close();
  });

  test("retry resumes in place and regenerate replaces the assistant response without duplicating the user turn", async () => {
    const factory = new IDBFactory();
    await seed(factory, "phase5-repeat-semantics");
    const encoder = new TextEncoder();
    let call = 0;
    let releaseFirst: (() => void) | undefined;
    const adapter = {
      streamGeneral: () => {
        call += 1;
        const current = call;
        return (async function* () {
          const delta = current === 1 ? "Parcial" : current === 2 ? " continuada" : "Respuesta regenerada";
          yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: `local-${current}`, delta })}\n`);
          if (current === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
          else yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
        })();
      },
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider factory={factory} dbName="phase5-repeat-semantics" adapter={adapter}><AssistantView /></AssistantProvider>);
    await screen.findByRole("heading", { name: "conversation-reviewed" });
    const composer = screen.getByRole("textbox", { name: "Pregunta" });
    fireEvent.change(composer, { target: { value: "¿Qué es Cuadre Reg.?" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await screen.findByText("Parcial");
    fireEvent.click(screen.getByRole("button", { name: "Detener respuesta" }));
    releaseFirst?.();
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar respuesta" }));
    expect(await screen.findByText("Parcial continuada")).toBeVisible();
    expect(screen.getAllByLabelText("Tu pregunta")).toHaveLength(1);
    expect(screen.getAllByLabelText("Respuesta del Asistente")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Regenerar respuesta" }));
    expect(await screen.findByText("Respuesta regenerada")).toBeVisible();
    expect(screen.queryByText("Parcial continuada")).toBeNull();
    expect(screen.getAllByLabelText("Tu pregunta")).toHaveLength(1);
    expect(screen.getAllByLabelText("Respuesta del Asistente")).toHaveLength(1);
  });

  test("routes the selected compatible production profile and model through the repository-bound request", async () => {
    const factory = new IDBFactory();
    const selected = profile("profile-selected");
    const fallback = profile("profile-default");
    const incompatible = profile("analysis-only", { generalChatCompatible: false, analysisCompatible: true });
    await seed(factory, "phase5-model-routing", conversation("conversation-model", { modelProfileId: selected.id }), [selected, fallback, incompatible]);
    const settingsRepositories = await createIndexedDbRepositories({ factory, dbName: "phase5-model-routing" });
    await settingsRepositories.assistantSettings.put({
      id: "assistant-settings", defaultGeneralModelProfileId: fallback.id, responseMode: "strict", contextStrategy: "automatic",
      safetyMarginPercent: 10, warningThresholdPercent: 75, compactionThresholdPercent: 85,
    });
    settingsRepositories.close();
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return new Response(`${JSON.stringify({ type: "text_delta", roundId: body.roundId, messageId: "remote", delta: "Respuesta remota" })}\n${JSON.stringify({ type: "done", roundId: body.roundId, finishReason: "stop" })}\n`);
    }));
    render(<AssistantProvider factory={factory} dbName="phase5-model-routing"><AssistantView /></AssistantProvider>);
    await screen.findByRole("heading", { name: "conversation-model" });
    const options = within(screen.getByRole("combobox", { name: "Modelo de conversación" })).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(expect.arrayContaining([selected.name, fallback.name]));
    expect(options.map((option) => option.textContent)).not.toContain(incompatible.name);
    const composer = screen.getByRole("textbox", { name: "Pregunta" });
    fireEvent.change(composer, { target: { value: "¿Qué es Retributivo?" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(await screen.findByText("Respuesta remota")).toBeVisible();
    expect(bodies[0]).toMatchObject({ modelProfileId: selected.id, modelId: selected.modelId, profile: selected });
    expect(JSON.stringify(bodies)).not.toContain("apiKey");
    const persisted = await createIndexedDbRepositories({ factory, dbName: "phase5-model-routing" });
    const messages = await persisted.messages.listByConversation("conversation-model", { limit: 10 });
    expect(messages.items.at(-1)).toMatchObject({ modelProfileId: selected.id, modelId: selected.modelId });
    persisted.close();
  });

  test("ignores stale conversation loads and preserves concurrent person and preference mutations", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase5-races" });
    await repositories.conversations.put(conversation("conversation-a", { updatedAt: "2026-07-13T11:00:00.000Z" }));
    await repositories.conversations.put(conversation("conversation-b", { updatedAt: "2026-07-13T12:00:00.000Z", type: "analysis", analysisId: "analysis-1", analysisVersion: createdAt }));
    repositories.close();
    let releaseA: (() => void) | undefined;
    const repositoryFactory = async () => {
      const real = await createIndexedDbRepositories({ factory, dbName: "phase5-races" });
      const original = real.messages.listByConversation.bind(real.messages);
      return {
        ...real,
        messages: {
          ...real.messages,
          get: real.messages.get.bind(real.messages), put: real.messages.put.bind(real.messages), delete: real.messages.delete.bind(real.messages),
          async listByConversation(id: string, options: { limit: number; cursor?: string }) {
            if (id === "conversation-a") await new Promise<void>((resolve) => { releaseA = resolve; });
            return original(id, options);
          },
        },
      } as AssistantRepositories;
    };
    render(<AssistantProvider adapter={new FakeAssistantAdapter()} repositoriesFactory={repositoryFactory}><AssistantView /></AssistantProvider>);
    await screen.findByRole("heading", { name: "conversation-b" });
    fireEvent.click(screen.getByRole("button", { name: /conversation-a/i }));
    fireEvent.click(screen.getByRole("button", { name: /conversation-b/i }));
    releaseA?.();
    await waitFor(() => expect(screen.getByRole("heading", { name: "conversation-b" })).toBeVisible());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Pregunta" })).toBeEnabled());
  });

  test("serializes concurrent person and preference writes against the latest persisted conversation", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase5-concurrent-mutations" });
    await repositories.conversations.put(conversation("conversation-mutations", { type: "analysis", analysisId: "analysis-1", analysisVersion: createdAt, associatedPersonIds: ["10001"] }));
    repositories.close();
    function Probe() {
      const assistant = useAssistant();
      return <><output>{JSON.stringify(assistant.conversation)}</output><button type="button" onClick={() => { void assistant.addPerson("10002"); void assistant.updateConversationPreferences({ responseMode: "flexible" }); void assistant.updateConversationPreferences({ contextStrategy: "optimized" }); }}>Mutar</button></>;
    }
    render(<AssistantProvider factory={factory} dbName="phase5-concurrent-mutations"><Probe /></AssistantProvider>);
    await screen.findByText(/conversation-mutations/);
    fireEvent.click(screen.getByRole("button", { name: "Mutar" }));
    await waitFor(() => expect(screen.getByText(/conversation-mutations/).textContent).toContain('"contextStrategy":"optimized"'));
    const persisted = await createIndexedDbRepositories({ factory, dbName: "phase5-concurrent-mutations" });
    await waitFor(async () => expect(await persisted.conversations.get("conversation-mutations")).toMatchObject({ associatedPersonIds: ["10001", "10002"], primaryPersonId: "10002", responseMode: "flexible", contextStrategy: "optimized" }));
    persisted.close();
  });

  test("persists rename and archive and confirms complete deletion", async () => {
    const factory = new IDBFactory();
    await seed(factory, "phase5-conversation-controls", conversation("conversation-controls"));
    function Probe() {
      const assistant = useAssistant();
      return <><output>{assistant.conversation ? `${assistant.conversation.title}:${assistant.conversation.status}` : "sin conversación"}</output><button onClick={() => void assistant.renameConversation("Renombrada")}>Renombrar</button><button onClick={() => void assistant.archiveConversation()}>Archivar</button><button onClick={() => void assistant.deleteConversation()}>Eliminar</button></>;
    }
    render(<AssistantProvider factory={factory} dbName="phase5-conversation-controls"><Probe /></AssistantProvider>);
    await screen.findByText("conversation-controls:active");
    fireEvent.click(screen.getByRole("button", { name: "Renombrar" }));
    await screen.findByText("Renombrada:active");
    fireEvent.click(screen.getByRole("button", { name: "Archivar" }));
    await screen.findByText("Renombrada:archived");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await screen.findByText("sin conversación");
    expect(window.confirm).toHaveBeenCalled();
    const persisted = await createIndexedDbRepositories({ factory, dbName: "phase5-conversation-controls" });
    expect(await persisted.conversations.get("conversation-controls")).toBeUndefined();
    persisted.close();
  });
});
