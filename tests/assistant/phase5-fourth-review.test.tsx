// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/AssistantProvider";
import { AssistantView } from "@/components/assistant/AssistantView";
import { AssistantAiSettings } from "@/components/settings/AssistantAiSettings";
import type { ChatMessage, Conversation, ModelProfile } from "@/lib/assistant/domain";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { AssistantRepositories } from "@/lib/assistant/storage/repositories";
import type { AnalysisResult, StoredAnalysis } from "@/lib/types";

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
  for (const item of conversations) await repositories.conversations.put(item);
  for (const item of messages) await repositories.messages.put(item);
  for (const item of profiles) await repositories.modelProfiles.put(item);
  repositories.close();
}

function StateProbe() {
  const assistant = useAssistant();
  const target = assistant.messages.find((item) => item.id === "assistant-a");
  return <>
    <output data-testid="probe-selected">{assistant.conversation?.id ?? "none"}</output>
    <output data-testid="probe-type">{assistant.conversation?.type ?? "none"}</output>
    <output data-testid="probe-conversation-count">{assistant.conversations.length}</output>
    <output data-testid="probe-streaming">{String(assistant.streaming)}</output>
    <output data-testid="probe-announcement">{assistant.announcement}</output>
    <output data-testid="probe-notice">{assistant.notice ?? ""}</output>
    <output data-testid="probe-error">{assistant.error ?? ""}</output>
    <output data-testid="probe-target-status">{target?.status ?? "none"}</output>
    <output data-testid="probe-target-content">{target?.content ?? ""}</output>
  </>;
}

function ConversionProbe() {
  const assistant = useAssistant();
  return <>
    <StateProbe />
    <button onClick={() => {
      void assistant.renameConversation("Renombrada antes de convertir");
      void assistant.updateConversationPreferences({ responseMode: "flexible", contextStrategy: "optimized" });
      void assistant.convertToActiveAnalysis();
    }}>Mutar y convertir</button>
  </>;
}

function installBrowser() {
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("min-width: 1280px"), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => true) });
}

describe("Phase 5 fourth-review regressions", () => {
  beforeEach(installBrowser);
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  test("the actual New conversation control invalidates a suspended A run and leaves B usable", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-create-during-stream";
    await seed(factory, dbName, [conversation("conversation-a")]);
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    let invocation = 0;
    const adapter = {
      streamGeneral: vi.fn(async function* (request: { messageId: string }) {
        invocation += 1;
        if (invocation === 1) {
          yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: request.messageId, delta: "Parcial A" })}\n`);
          await gateA;
        } else {
          yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: request.messageId, delta: "Respuesta B" })}\n`);
        }
        yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
      }),
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider factory={factory} dbName={dbName} adapter={adapter}><AssistantView /><StateProbe /></AssistantProvider>);
    await screen.findByRole("heading", { name: "conversation-a" });
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta" }), { target: { value: "¿Qué es Retributivo?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByText("Parcial A");

    fireEvent.click(screen.getByRole("button", { name: "Nueva conversación" }));
    await screen.findByRole("heading", { name: "Consulta general" });
    const selectedB = screen.getByTestId("probe-selected").textContent;
    expect(selectedB).not.toBe("conversation-a");
    releaseA();
    await waitFor(() => expect(screen.getByTestId("probe-streaming")).toHaveTextContent("false"));
    expect(screen.getByTestId("probe-selected")).toHaveTextContent(String(selectedB));

    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta" }), { target: { value: "¿Qué es Cuadre Reg.?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Respuesta B")).toBeVisible();
    expect(screen.getByTestId("probe-selected")).toHaveTextContent(String(selectedB));
  });

  test("the actual Settings clear discards a delayed conversation page and empties live state", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-clear-delayed-conversation-page";
    const base = await createIndexedDbRepositories({ factory, dbName });
    for (let index = 0; index < 12; index += 1) {
      const timestamp = `2026-07-13T10:${String(index).padStart(2, "0")}:00.000Z`;
      await base.conversations.put(conversation(`conversation-${index}`, { createdAt: timestamp, updatedAt: timestamp }));
    }
    let releasePage!: () => void;
    const pageGate = new Promise<void>((resolve) => { releasePage = resolve; });
    let pageStarted!: () => void;
    const pageStartedPromise = new Promise<void>((resolve) => { pageStarted = resolve; });
    const conversationRepository = base.conversations;
    const repositories: AssistantRepositories = {
      ...base,
      conversations: {
        get: (id) => conversationRepository.get(id), put: (value) => conversationRepository.put(value), delete: (id) => conversationRepository.delete(id),
        list: async (options) => {
          if (options.cursor) { pageStarted(); await pageGate; }
          return conversationRepository.list(options);
        },
      },
    };
    render(<AssistantProvider repositoriesFactory={async () => repositories}><AssistantView /><StateProbe /><AssistantAiSettings /></AssistantProvider>);
    await waitFor(() => expect(screen.getByTestId("probe-conversation-count")).toHaveTextContent("10"));
    fireEvent.click(screen.getByRole("button", { name: "Cargar más conversaciones" }));
    await pageStartedPromise;
    fireEvent.click(screen.getByRole("button", { name: "Borrar conversaciones y contexto" }));
    await waitFor(() => expect(screen.getByTestId("probe-conversation-count")).toHaveTextContent("0"));
    expect(screen.getByTestId("probe-selected")).toHaveTextContent("none");
    expect(screen.getByTestId("probe-announcement")).toBeEmptyDOMElement();
    expect(screen.getByTestId("probe-notice")).toBeEmptyDOMElement();
    expect(screen.getByTestId("probe-error")).toBeEmptyDOMElement();

    releasePage();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId("probe-conversation-count")).toHaveTextContent("0");
    expect(screen.getByTestId("probe-selected")).toHaveTextContent("none");
    expect(screen.getByTestId("probe-announcement")).toBeEmptyDOMElement();
  });

  test("a retry that emits a safe partial then fails persists a terminal failed target across reload", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-repeat-partial-failure";
    const selectedProfile = profile();
    await seed(factory, dbName, [conversation("conversation-a", { modelProfileId: selectedProfile.id })], [
      message("user-a", "conversation-a", "user", "Pregunta original", "completed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId }),
      message("assistant-a", "conversation-a", "assistant", "Respuesta anterior", "failed", { modelProfileId: selectedProfile.id, modelId: selectedProfile.modelId, createdAt: "2026-07-13T10:01:00.000Z" }),
    ], [selectedProfile]);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(`${JSON.stringify({ type: "text_delta", roundId: body.roundId, messageId: "remote", delta: "Parcial seguro nuevo" })}\n${JSON.stringify({ type: "error", roundId: body.roundId, code: "provider_failure", classification: "provider", message: "detalle privado", retryable: false })}\n`);
    }));
    const first = render(<AssistantProvider factory={factory} dbName={dbName}><AssistantView /><StateProbe /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar respuesta" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByTestId("probe-streaming")).toHaveTextContent("false"));
    expect(screen.getByTestId("probe-target-status")).toHaveTextContent("failed");
    expect(screen.getByTestId("probe-target-content")).toHaveTextContent("Parcial seguro nuevo");
    expect(screen.getByRole("alert")).not.toHaveTextContent("detalle privado");

    first.unmount();
    render(<AssistantProvider factory={factory} dbName={dbName}><AssistantView /><StateProbe /></AssistantProvider>);
    await waitFor(() => expect(screen.getByTestId("probe-target-content")).toHaveTextContent("Parcial seguro nuevo"));
    expect(screen.getByTestId("probe-target-status")).toHaveTextContent("failed");
    expect(screen.getByRole("button", { name: "Reintentar respuesta" })).toBeVisible();
  });

  test("conversion rereads the authoritative queued rename and preferences before persisting messages and event", async () => {
    const factory = new IDBFactory();
    const dbName = "phase5-authoritative-conversion";
    await seed(factory, dbName, [conversation("conversation-a")], [
      message("user-a", "conversation-a", "user", "Pregunta", "completed"),
      message("assistant-a", "conversation-a", "assistant", "Respuesta", "completed", { createdAt: "2026-07-13T10:01:00.000Z" }),
    ]);
    render(<AssistantProvider factory={factory} dbName={dbName} activeAnalysis={activeAnalysis}><ConversionProbe /></AssistantProvider>);
    await waitFor(() => expect(screen.getByTestId("probe-selected")).toHaveTextContent("conversation-a"));
    fireEvent.click(screen.getByRole("button", { name: "Mutar y convertir" }));
    await waitFor(() => expect(screen.getByTestId("probe-type")).toHaveTextContent("analysis"));

    const persisted = await createIndexedDbRepositories({ factory, dbName });
    expect(await persisted.conversations.get("conversation-a")).toMatchObject({
      type: "analysis", analysisId: "analysis-1", title: "Renombrada antes de convertir", responseMode: "flexible", contextStrategy: "optimized",
    });
    expect((await persisted.messages.listByConversation("conversation-a", { limit: 10 })).items).toEqual([
      expect.objectContaining({ id: "user-a", contextOrigin: "general" }),
      expect.objectContaining({ id: "assistant-a", contextOrigin: "general" }),
    ]);
    expect(await persisted.events.listByConversation("conversation-a")).toEqual([
      expect.objectContaining({ conversationId: "conversation-a", event: { type: "context_added", contextId: "analysis-1", label: "Análisis activo" } }),
    ]);
    persisted.close();
  });
});
