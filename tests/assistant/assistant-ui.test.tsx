// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AssistantView } from "@/components/assistant/AssistantView";
import { ActionProposal } from "@/components/assistant/ActionProposal";
import { MarkdownRenderer } from "@/components/assistant/MarkdownRenderer";
import { SafeMarkdown } from "@/components/assistant/SafeMarkdown";
import type { ChatAction, ChatEvent, ChatMessage, Conversation, SourceReference } from "@/lib/assistant/domain";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import { FakeAssistantAdapter } from "@/lib/assistant/providers/fakeAdapter";
import type { AnalysisResult, StoredAnalysis } from "@/lib/types";

const createdAt = "2026-07-13T10:00:00.000Z";

function installBrowser() {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("min-width: 1280px"), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

function baseConversation(type: "general" | "analysis" = "general"): Conversation {
  return {
    id: "conversation-ui",
    type,
    ...(type === "analysis" ? { analysisId: "analysis-1", analysisVersion: createdAt } : {}),
    title: "Revisión retributiva",
    associatedPersonIds: type === "analysis" ? ["10001", "10002", "10003", "10004", "10005"] : [],
    ...(type === "analysis" ? { primaryPersonId: "10001" } : {}),
    modelProfileId: "fake-retributivo-v1",
    responseMode: "strict",
    contextStrategy: "automatic",
    status: "active",
    createdAt,
    updatedAt: createdAt,
  };
}

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-assistant",
    conversationId: "conversation-ui",
    role: "assistant",
    content: "## Resumen\n[Enlace seguro](https://example.com/informe) [Enlace inseguro](javascript:alert(1))\n<script>alert('raw')</script>\nACTION: abrir persona",
    status: "completed",
    contextOrigin: "general",
    modelProfileId: "fake-retributivo-v1",
    modelId: "fake-retributivo-v1",
    responseMode: "strict",
    contextStrategy: "automatic",
    sourceRefIds: ["source-available", "source-history", "source-deleted"],
    actionIds: ["action-open-person"],
    usage: { inputTokens: 120, outputTokens: 45, totalTokens: 165, estimated: false },
    createdAt,
    ...overrides,
  };
}

function source(id: string, availability: SourceReference["availability"], label: string): SourceReference {
  return {
    id, conversationId: "conversation-ui", messageId: "message-assistant", sourceType: "tool",
    sanitizedSourceLabel: label, availability, conceptIds: [], excerpt: "Dato retributivo anonimizado", sanitizedHash: `${id}-hash`,
  };
}

async function seedUi(factory: IDBFactory, dbName: string, type: "general" | "analysis" = "general") {
  const repositories = await createIndexedDbRepositories({ factory, dbName });
  await repositories.conversations.put(baseConversation(type));
  await repositories.messages.put(message({ contextOrigin: type }));
  for (const item of [
    source("source-available", "available", "Fuente disponible"),
    source("source-history", "historical_unavailable", "Fuente histórica"),
    source("source-deleted", "deleted", "Fuente eliminada"),
  ]) await repositories.sources.put(item);
  const action: ChatAction = {
    id: "action-open-person", conversationId: "conversation-ui", messageId: "message-assistant",
    label: "Abrir matrícula 10001", description: "Navega a la persona anonimizada",
    action: { type: "open_person", analysisId: "analysis-1", personId: "10001" }, status: "pending", createdAt,
  };
  const event: ChatEvent = {
    id: "event-context", conversationId: "conversation-ui",
    event: { type: "context_added", contextId: "analysis-1", label: "Análisis activo" }, createdAt,
  };
  await repositories.actions.put(action);
  await repositories.events.put(event);
  await repositories.snapshots.put({
    id: "snapshot-1", conversationId: "conversation-ui", analysisId: "analysis-1", summary: "Resumen de contexto",
    summarizedMessageIds: ["message-assistant"], decisions: ["Mantener alcance"], figures: [208.01], sourceIds: ["source-available"],
    actionIds: ["action-open-person"], personIds: ["10001"], analysisVersion: createdAt,
    actualStrategy: "automatic", actualResponseMode: "strict", createdAt,
  });
  await repositories.writeIngestionBlock({
    document: { id: "document-ui", sanitizedSourceLabel: "Documento contextual", scope: { type: "conversation", conversationId: "conversation-ui" }, mediaType: "txt", status: "ready", createdAt, updatedAt: createdAt },
    chunks: [{ id: "document-ui-chunk", documentId: "document-ui", sequence: 0, content: "Dato", snippet: "Dato", sanitizedHash: "document-ui-hash", terms: ["dato"] }],
    searchTerms: [{ id: "document-ui-term", documentId: "document-ui", chunkId: "document-ui-chunk", term: "dato", positions: [0] }],
    indexJob: { id: "document-ui-index", documentId: "document-ui", status: "ready", indexedChunkIds: ["document-ui-chunk"] },
  });
  repositories.close();
}

const activeAnalysis = {
  id: "analysis-1",
  createdAt,
  result: { people: Array.from({ length: 7 }, (_, index) => ({
    employeeNumber: String(10001 + index), workplace: "Centro", position: "Puesto", category: "Categoría",
    registroTotal: 1550, pdfTotal: 1758.01, totalDifference: 208.01,
    salaryRegistro: 1000, salaryPdf: 1100, salaryDifference: 100,
    salaryComplementRegistro: 500, salaryComplementPdf: 400, salaryComplementDifference: -100,
    extraSalaryRegistro: 50, extraSalaryPdf: 258.01, extraSalaryDifference: 208.01,
    status: "Diferencia", periods: ["enero 2026"],
  })) } as unknown as AnalysisResult,
} as StoredAnalysis;

describe("assistant conversation UI", () => {
  beforeEach(() => {
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    installBrowser();
  });
  afterEach(() => vi.unstubAllGlobals());

  test("offers Añadir contexto for an active general conversation", async () => {
    const factory = new IDBFactory();
    await seedUi(factory, "add-context-label", "general");
    render(<AssistantProvider activeAnalysis={activeAnalysis} factory={factory} dbName="add-context-label"><AssistantView /></AssistantProvider>);

    expect(await screen.findByRole("button", { name: "Añadir contexto" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Convertir al análisis activo" })).toBeNull();
  });

  test("loads safe Markdown dynamically, rejects raw HTML and unsafe links, and renders only typed actions", async () => {
    const factory = new IDBFactory();
    await seedUi(factory, "safe-markdown", "analysis");
    render(<AssistantProvider activeAnalysis={activeAnalysis} factory={factory} dbName="safe-markdown"><AssistantView /></AssistantProvider>);

    expect(await screen.findByText("Preparando formato seguro…")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Resumen" })).toBeTruthy();
    const safe = screen.getByRole("link", { name: "Enlace seguro" });
    expect(safe).toHaveAttribute("href", "https://example.com/informe");
    expect(safe).toHaveAttribute("target", "_blank");
    expect(safe).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("link", { name: "Enlace inseguro" })).toBeNull();
    expect(screen.queryByText(/alert\('raw'\)/)).toBeNull();
    expect(screen.queryByRole("button", { name: /ACTION: abrir persona/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir matrícula 10001" })).toBeNull();
    expect(screen.getByText(/Abrir matrícula 10001.*Estado: pendiente/i)).toBeVisible();
  });

  test("suppresses Markdown images and fails closed when the dynamic renderer rejects", async () => {
    const first = render(<MarkdownRenderer content={'![remote](https://example.com/a.png) ![data](data:image/png;base64,AAAA) [mail](mailto:test@example.com) [file](file:///tmp/a) [blob](blob:https://example.com/id) [relative](//example.com/a) [broken](not a url)'} />);
    expect(first.container.querySelector("img")).toBeNull();
    for (const name of ["mail", "file", "blob", "relative", "broken"]) expect(screen.queryByRole("link", { name })).toBeNull();
    first.unmount();
    render(<SafeMarkdown content="Texto local seguro" loader={() => Promise.reject(new Error("chunk unavailable"))} />);
    expect(await screen.findByText(/no se pudo cargar el formato/i)).not.toHaveAttribute("role");
    expect(screen.getByText("Texto local seguro")).toBeVisible();
  });

  test("renders resolved statuses as content and pending actions as explicit controls", () => {
    const statuses: ChatAction["status"][] = ["pending", "accepted", "rejected", "failed"];
    render(<>{statuses.map((status) => <ActionProposal key={status} action={{
      id: `action-${status}`, conversationId: "conversation-ui", messageId: "message-assistant", label: `Acción ${status}`,
      description: "Estado persistido", action: { type: "show_sources", sourceIds: [] }, status, createdAt,
    }} />)}</>);
    expect(screen.getByText(/Acción pending.*Estado: pendiente/i)).toBeVisible();
    expect(screen.getByText(/Acción accepted.*Estado: aceptada/i)).toBeVisible();
    expect(screen.getByText(/Acción rejected.*Estado: rechazada/i)).toBeVisible();
    expect(screen.getByText(/Acción failed.*Estado: fallida/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Aceptar Acción pending" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Rechazar Acción pending" })).toBeVisible();
  });

  test("distinguishes source lifecycle states and expands context and token details", async () => {
    const factory = new IDBFactory();
    await seedUi(factory, "source-states", "analysis");
    render(<AssistantProvider activeAnalysis={activeAnalysis} factory={factory} dbName="source-states"><AssistantView /></AssistantProvider>);
    await screen.findByText("Fuente disponible");
    expect(screen.getByText("Disponible")).toBeTruthy();
    expect(screen.getByText("Histórica no disponible")).toBeTruthy();
    expect(screen.getByText("Eliminada")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abrir fuente Fuente disponible" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Fuente histórica no disponible" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fuente eliminada" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Ver uso de contexto" }));
    expect(screen.getByText("120 tokens de entrada")).toBeTruthy();
    expect(screen.getByText("45 tokens de salida")).toBeTruthy();
    expect(screen.getByText("Resumen de contexto")).toBeTruthy();
    expect(screen.getByText("Documento contextual")).toBeTruthy();
    expect(screen.getByText("Indexación: ready")).toBeTruthy();
    expect(screen.getByText(/Contexto añadido: Análisis activo/)).toBeTruthy();
  });

  test("does not announce clipboard success when the browser write rejects", async () => {
    const factory = new IDBFactory();
    await seedUi(factory, "clipboard-rejected");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<AssistantProvider factory={factory} dbName="clipboard-rejected"><AssistantView /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Copiar respuesta" }));
    expect(await screen.findByText("No se pudo copiar la respuesta")).toBeInTheDocument();
    expect(screen.queryByText("Respuesta copiada")).toBeNull();
  });

  test("does not announce clipboard success when the API is unavailable", async () => {
    const factory = new IDBFactory();
    await seedUi(factory, "clipboard-unavailable");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    render(<AssistantProvider factory={factory} dbName="clipboard-unavailable"><AssistantView /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Copiar respuesta" }));
    expect(await screen.findByText("No se pudo copiar la respuesta")).toBeInTheDocument();
    expect(screen.queryByText("Respuesta copiada")).toBeNull();
  });

  test("hides repeat controls when a restored assistant message has no preceding user turn", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "unsafe-restored-repeat" });
    await repositories.conversations.put(baseConversation());
    await repositories.messages.put(message({ status: "stopped", content: "Parcial sin pregunta" }));
    repositories.close();
    render(<AssistantProvider factory={factory} dbName="unsafe-restored-repeat"><AssistantView /></AssistantProvider>);
    await screen.findByText("Parcial sin pregunta");
    expect(screen.queryByRole("button", { name: "Reintentar respuesta" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Regenerar respuesta" })).toBeNull();
  });

  test("owns one atomic live region with grouped response content and final status", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "aggregated-live-region" });
    await repositories.conversations.put(baseConversation());
    repositories.close();
    const encoder = new TextEncoder();
    const adapter = {
      streamGeneral: async function* () {
        for (const delta of ["Uno", " dos", " tres"]) yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta })}\n`);
        yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
      },
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider factory={factory} dbName="aggregated-live-region" adapter={adapter}><AssistantView /></AssistantProvider>);
    const composer = await screen.findByRole("textbox", { name: "Pregunta" });
    fireEvent.change(composer, { target: { value: "¿Qué es Retributivo?" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await screen.findByText("Uno dos tres");
    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute("aria-atomic", "true");
    expect(regions[0]).toHaveTextContent("Respuesta completada: Uno dos tres");
  });

  test("supports composer keys, conversation controls and summarized people without duplicates", async () => {
    const factory = new IDBFactory();
    await seedUi(factory, "conversation-controls", "analysis");
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
    render(<AssistantProvider activeAnalysis={activeAnalysis} factory={factory} dbName="conversation-controls" adapter={new FakeAssistantAdapter()}><AssistantView /></AssistantProvider>);
    await screen.findByRole("heading", { name: "Revisión retributiva" });

    expect(screen.getByRole("button", { name: /Modelo de conversación:/ })).toBeTruthy();
    expect(screen.queryByText("Añadir contexto")).toBeNull();
    expect(screen.getByTestId("assistant-composer-controls")).not.toHaveClass("overflow-x-auto");
    expect(screen.getByRole("button", { name: "Enviar" })).toHaveClass("shrink-0");
    expect(screen.getByRole("button", { name: "Abrir detalle del contexto" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Configuración" })).toBeNull();

    expect(screen.getByText("+ 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Gestionar personas asociadas" }));
    const picker = screen.getByRole("group", { name: "Personas asociadas" });
    const alreadyAssociated = within(picker).getByRole("checkbox", { name: "Matrícula 10001" });
    expect(alreadyAssociated).toBeChecked();
    fireEvent.click(within(picker).getByRole("checkbox", { name: "Matrícula 10006" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Modo de respuesta" }), { target: { value: "flexible" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Estrategia de contexto" }), { target: { value: "associated_people" } });
    const composer = screen.getByRole("textbox", { name: "Pregunta" }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "Consulta la matrícula 10006" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(composer.value).toContain("Consulta la matrícula 10006");
    fireEvent.keyDown(composer, { key: "Enter" });
    await screen.findAllByText(/Registro:/);

    fireEvent.click(screen.getAllByRole("button", { name: "Copiar respuesta" }).at(-1)!);
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Regenerar respuesta" })).toBeTruthy();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  test("offers stop while streaming and retry after an interrupted response", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "stop-retry" });
    await repositories.conversations.put(baseConversation());
    repositories.close();
    const encoder = new TextEncoder();
    const adapter = {
      streamGeneral: async function* (request: { messageId: string }) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: request.messageId, delta: "Respuesta parcial" })}\n`);
      },
      streamPersonProfile: async function* () { yield new Uint8Array(); },
    };
    render(<AssistantProvider factory={factory} dbName="stop-retry" adapter={adapter}><AssistantView /></AssistantProvider>);
    await screen.findByRole("heading", { name: "Revisión retributiva" });
    const composer = screen.getByRole("textbox", { name: "Pregunta" });
    fireEvent.change(composer, { target: { value: "¿Qué es Retributivo?" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Detener respuesta" }));
    expect(await screen.findByRole("button", { name: "Reintentar respuesta" })).toBeTruthy();
  });
});
