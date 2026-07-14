// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { AssistantProvider, useAssistant } from "@/components/assistant/AssistantProvider";
import { AssistantView } from "@/components/assistant/AssistantView";
import type { ChatAction, ChatMessage, Conversation } from "@/lib/assistant/domain";
import { createAnalysisVersionSnapshot } from "@/lib/assistant/integrations/analysisVersion";
import { createAnalysisCleanupJob, runAnalysisCleanupJob } from "@/lib/assistant/integrations/analysisCleanup";
import type { AppNavigationIntent } from "@/lib/assistant/integrations/actions";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { StoredAnalysis } from "@/lib/types";

const at = "2026-07-13T10:00:00.000Z";
const person = (difference = 5, name = "Privada") => ({
  employeeNumber: "001", person: name, workplace: "Centro", position: "Puesto", category: "Grupo",
  salaryRegistro: 10, salaryPdf: 8, salaryDifference: 2, salaryComplementRegistro: 2, salaryComplementPdf: 1,
  salaryComplementDifference: 1, extraSalaryRegistro: 2, extraSalaryPdf: 0, extraSalaryDifference: 2,
  registroTotal: 14, pdfTotal: 9, totalDifference: difference, pdfControlTotalDevengado: 9, payrollCount: 1,
  unmappedConceptsCount: 0, status: "Diferencia", detail: "detalle", periods: ["2026-01"], files: ["secreto.pdf"],
});
const analysis = (difference = 5, name = "Privada") => ({
  id: "analysis-1", createdAt: at, registroFileName: "registro.xlsx", pdfCount: 1,
  result: { people: [person(difference, name)], groupings: [], concepts: [], internalExcelChecks: [] }, config: { tolerance: 1 },
}) as unknown as StoredAnalysis;
const conversation = (status: Conversation["status"] = "active", version = "old"): Conversation => ({
  id: "conversation-1", type: "analysis", analysisId: "analysis-1", title: "Análisis", associatedPersonIds: ["001"], primaryPersonId: "001",
  modelProfileId: "fake-retributivo-v1", responseMode: "strict", contextStrategy: "automatic", analysisVersion: version,
  status, createdAt: at, updatedAt: at,
});
const message: ChatMessage = {
  id: "message-1", conversationId: "conversation-1", role: "assistant", content: "Resultado", status: "completed",
  contextOrigin: "analysis", modelProfileId: "fake-retributivo-v1", responseMode: "strict", contextStrategy: "automatic",
  analysisVersion: "old", sourceRefIds: [], actionIds: ["action-1"], createdAt: at,
};
const action: ChatAction = {
  id: "action-1", conversationId: "conversation-1", messageId: "message-1", label: "Comparar", description: "Comparar personas",
  action: { type: "show_comparison_table", analysisId: "analysis-1", personIds: ["001"] }, status: "pending", createdAt: at,
};
const navigationAction: ChatAction = {
  ...action, id: "action-2", label: "Abrir persona", description: "Abrir persona",
  action: { type: "open_person", analysisId: "analysis-1", personId: "001" },
};
const sourceAction: ChatAction = {
  ...action, id: "action-3", label: "Ver fuentes", description: "Mostrar fuentes",
  action: { type: "show_sources", sourceIds: ["source-1"] },
};

beforeEach(() => { vi.stubGlobal("IDBKeyRange", IDBKeyRange); });
afterEach(() => vi.unstubAllGlobals());

describe("Phase 6 reviewed integration", () => {
  test("accepts a proposed action in the provider, renders its local result and supports rejection", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-action-ui" });
    await repositories.conversations.put(conversation()); await repositories.messages.put({ ...message, actionIds: ["action-1", "action-2", "action-3"], sourceRefIds: ["source-1"] }); await repositories.actions.put(action); await repositories.actions.put(navigationAction); await repositories.actions.put(sourceAction);
    await repositories.sources.put({ id: "source-1", conversationId: "conversation-1", messageId: "message-1", analysisId: "analysis-1", sourceType: "analysis", sanitizedSourceLabel: "Fuente local", availability: "available", conceptIds: [], excerpt: "Evidencia local visible", sanitizedHash: "hash" });
    repositories.close();
    const navigate = vi.fn<(intent: AppNavigationIntent) => void>();
    render(<AssistantProvider activeAnalysis={analysis()} factory={factory} dbName="phase6-action-ui" onNavigate={navigate}><AssistantView /></AssistantProvider>);
    await screen.findByText("Resultado");
    fireEvent.click(screen.getByRole("button", { name: "Aceptar Comparar" }));
    expect(await screen.findByRole("table", { name: "Resultado de Comparar" })).toHaveTextContent("001");
    fireEvent.click(screen.getByRole("button", { name: "Aceptar Abrir persona" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ type: "open_person", analysisId: "analysis-1", personId: "001" }));
    fireEvent.click(screen.getByRole("button", { name: "Aceptar Ver fuentes" }));
    expect(await screen.findByText("Evidencia local visible")).toBeVisible();
    const persisted = await createIndexedDbRepositories({ factory, dbName: "phase6-action-ui" });
    await waitFor(async () => expect(await persisted.actions.get("action-1")).toMatchObject({ status: "accepted" }));
    persisted.close();
  });

  test("ignores rapid duplicate accept and reject invocations without surfacing a false error", async () => {
    const factory = new IDBFactory();
    const accept = { ...action, id: "rapid-accept", label: "Aceptar rápido", action: { type: "add_person" as const, analysisId: "analysis-1", personId: "001" } };
    const reject = { ...action, id: "rapid-reject", label: "Rechazar rápido", action: { type: "add_person" as const, analysisId: "analysis-1", personId: "001" } };
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-action-rapid-ui" });
    await repositories.conversations.put(conversation());
    await repositories.messages.put({ ...message, actionIds: [accept.id, reject.id] });
    await repositories.actions.put(accept); await repositories.actions.put(reject); repositories.close();
    function RapidProbe() {
      const assistant = useAssistant();
      return <><button onClick={() => { void assistant.acceptAction(accept.id); void assistant.acceptAction(accept.id); }}>Aceptar dos veces</button><button onClick={() => { void assistant.rejectAction(reject.id); void assistant.rejectAction(reject.id); }}>Rechazar dos veces</button></>;
    }
    render(<AssistantProvider activeAnalysis={analysis()} factory={factory} dbName="phase6-action-rapid-ui"><AssistantView /><RapidProbe /></AssistantProvider>);
    await screen.findByText("Resultado");
    fireEvent.click(screen.getByRole("button", { name: "Aceptar dos veces" }));
    fireEvent.click(screen.getByRole("button", { name: "Rechazar dos veces" }));
    const persisted = await createIndexedDbRepositories({ factory, dbName: "phase6-action-rapid-ui" });
    await waitFor(async () => {
      expect(await persisted.actions.get(accept.id)).toMatchObject({ status: "accepted" });
      expect(await persisted.actions.get(reject.id)).toMatchObject({ status: "rejected" });
    });
    expect((await persisted.events.listByConversation("conversation-1")).filter((event) => event.event.type === "action_accepted")).toHaveLength(1);
    expect((await persisted.events.listByConversation("conversation-1")).filter((event) => event.event.type === "action_rejected")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
    persisted.close();
  });

  test("uses the canonical SHA for the first person continuation", async () => {
    const factory = new IDBFactory();
    function Probe() { const assistant = useAssistant(); return <button disabled={!assistant.ready} onClick={() => void assistant.continuePersonInAssistant("001")}>Continuar</button>; }
    render(<AssistantProvider activeAnalysis={analysis()} factory={factory} dbName="phase6-first-version"><Probe /></AssistantProvider>);
    const button = await screen.findByRole("button", { name: "Continuar" });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    const expected = await createAnalysisVersionSnapshot("analysis-1", analysis(), at);
    const persisted = await createIndexedDbRepositories({ factory, dbName: "phase6-first-version" });
    await waitFor(async () => expect((await persisted.conversations.list({ limit: 10 })).items[0]?.analysisVersion).toBe(expected.analysisVersion));
    persisted.close();
  });

  test("honors an authoritative cleanup tombstone even when the deleted analysis remains active in AppState", async () => {
    const factory = new IDBFactory();
    const seeded = await createIndexedDbRepositories({ factory, dbName: "phase6-provider-tombstone" });
    await seeded.cleanupAnalysis("analysis-1", "delete_all"); seeded.close();
    function Probe() {
      const assistant = useAssistant();
      const [failure, setFailure] = useState("");
      return <><output>{assistant.ready ? "preparado" : "cargando"}</output><button disabled={!assistant.ready} onClick={() => void assistant.continuePersonInAssistant("001").catch((error: Error) => setFailure(error.message))}>Continuar borrado</button><span>{failure}</span></>;
    }
    render(<AssistantProvider activeAnalysis={analysis()} factory={factory} dbName="phase6-provider-tombstone"><Probe /></AssistantProvider>);
    await screen.findByText("preparado"); fireEvent.click(screen.getByRole("button", { name: "Continuar borrado" }));
    expect(await screen.findByText(/análisis.*no están disponibles|no está disponible/i)).toBeVisible();
    const snapshot = await createAnalysisVersionSnapshot("analysis-1", analysis(), at);
    const persisted = await createIndexedDbRepositories({ factory, dbName: "phase6-provider-tombstone" });
    expect(await persisted.analysisVersions.get(snapshot.id)).toBeUndefined();
    expect((await persisted.conversations.list({ limit: 20 })).items.filter((item) => item.analysisId === "analysis-1" && item.status === "active")).toEqual([]);
    persisted.close();
  });

  test.each([
    ["preserve_conversations", "general"], ["delete_all", "general"],
    ["preserve_conversations", "different_analysis"], ["delete_all", "different_analysis"],
  ] as const)("reconciles every cached analysis conversation after %s while %s is selected", async (policy, selectedKind) => {
    const factory = new IDBFactory(); const dbName = `phase6-cache-reconcile-${policy}-${selectedKind}`;
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    const unaffected: Conversation = selectedKind === "general"
      ? { id: "z-general", type: "general", title: "General seleccionada", associatedPersonIds: [], modelProfileId: "fake-retributivo-v1", responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: at, updatedAt: at }
      : { id: "z-other-analysis", type: "analysis", analysisId: "analysis-2", analysisVersion: "other-version", title: "Otro análisis seleccionado", associatedPersonIds: [], modelProfileId: "fake-retributivo-v1", responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: at, updatedAt: at };
    const first = { ...conversation(), id: "analysis-c1", title: "Análisis uno" };
    const second = { ...conversation(), id: "analysis-c2", title: "Análisis dos" };
    const historicalMessage = { ...message, id: "cached-message", conversationId: first.id, content: "Contenido afectado", actionIds: ["cached-action"] };
    const historicalAction = { ...action, id: "cached-action", conversationId: first.id, messageId: historicalMessage.id, label: "Acción afectada" };
    await repositories.conversations.put(first); await repositories.conversations.put(second); await repositories.conversations.put(unaffected);
    await repositories.messages.put(historicalMessage); await repositories.actions.put(historicalAction); repositories.close();
    function CacheProbe() {
      const assistant = useAssistant();
      return <><output data-testid="cache-current">{`${assistant.conversation?.id ?? "none"}:${assistant.conversation?.status ?? "none"}`}</output><output data-testid="cache-list">{assistant.conversations.map((item) => `${item.id}:${item.status}`).join("|")}</output><button onClick={() => void assistant.selectConversation(first.id)}>Seleccionar afectada</button></>;
    }
    render(<AssistantProvider activeAnalysis={analysis()} factory={factory} dbName={dbName}><AssistantView /><CacheProbe /></AssistantProvider>);
    await waitFor(() => expect(screen.getByTestId("cache-current")).toHaveTextContent(`${unaffected.id}:active`));
    const cleanupRepositories = await createIndexedDbRepositories({ factory, dbName });
    const cleanupJob = createAnalysisCleanupJob("analysis-1", policy, at); await cleanupRepositories.cleanupJobs.put(cleanupJob);
    await act(async () => { await runAnalysisCleanupJob(cleanupRepositories, cleanupJob.id, async () => undefined, at); });
    if (policy === "preserve_conversations") {
      await waitFor(() => {
        expect(screen.getByTestId("cache-list")).toHaveTextContent("analysis-c1:archived_analysis_deleted");
        expect(screen.getByTestId("cache-list")).toHaveTextContent("analysis-c2:archived_analysis_deleted");
      });
      fireEvent.click(screen.getByRole("button", { name: "Seleccionar afectada" }));
      await waitFor(() => expect(screen.getByTestId("cache-current")).toHaveTextContent("analysis-c1:archived_analysis_deleted"));
      expect(screen.getByRole("textbox", { name: "Pregunta" })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Modo de respuesta:/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Aceptar Acción afectada" })).toBeDisabled();
    } else {
      await waitFor(() => {
        expect(screen.getByTestId("cache-list")).not.toHaveTextContent("analysis-c1");
        expect(screen.getByTestId("cache-list")).not.toHaveTextContent("analysis-c2");
      });
      fireEvent.click(screen.getByRole("button", { name: "Seleccionar afectada" }));
      await waitFor(() => expect(screen.getByTestId("cache-current")).toHaveTextContent(`${unaffected.id}:active`));
      expect(screen.queryByText("Contenido afectado")).toBeNull();
      expect(screen.queryByRole("button", { name: "Aceptar Acción afectada" })).toBeNull();
    }
    cleanupRepositories.close();
  });

  test("warns only for a real canonical analysis change", async () => {
    const factory = new IDBFactory();
    const initialVersion = await createAnalysisVersionSnapshot("analysis-1", analysis(), at);
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-version-provider" });
    await repositories.conversations.put(conversation("active", initialVersion.analysisVersion)); repositories.close();
    function Probe() { const assistant = useAssistant(); return <output>{assistant.notice ?? "sin aviso"}</output>; }
    const view = render(<AssistantProvider activeAnalysis={analysis()} factory={factory} dbName="phase6-version-provider"><Probe /></AssistantProvider>);
    await screen.findByText("sin aviso");
    view.rerender(<AssistantProvider activeAnalysis={analysis(5, "Otra privada")} factory={factory} dbName="phase6-version-provider"><Probe /></AssistantProvider>);
    await new Promise((resolve) => setTimeout(resolve, 20)); expect(screen.getByText("sin aviso")).toBeVisible();
    view.rerender(<AssistantProvider activeAnalysis={analysis(7)} factory={factory} dbName="phase6-version-provider"><Probe /></AssistantProvider>);
    expect(await screen.findByText(/análisis ha cambiado/i)).toBeVisible();
  });

  test("keeps archived evidence strictly read-only while allowing deletion", async () => {
    const factory = new IDBFactory();
    const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-readonly" });
    await repositories.conversations.put(conversation("archived_analysis_deleted")); await repositories.messages.put(message); await repositories.actions.put(action);
    repositories.close();
    function Mutator() {
      const assistant = useAssistant();
      return <button onClick={() => { void assistant.renameConversation("Mutada"); void assistant.addPerson("002"); void assistant.updateConversationPreferences({ responseMode: "flexible" }); void assistant.acceptAction("action-1"); }}>Intentar mutar</button>;
    }
    render(<AssistantProvider activeAnalysis={analysis()} factory={factory} dbName="phase6-readonly"><AssistantView /><Mutator /></AssistantProvider>);
    await screen.findByText("Resultado");
    expect(screen.getByRole("textbox", { name: "Pregunta" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Modo de respuesta:/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aceptar Comparar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Intentar mutar" }));
    const check = await createIndexedDbRepositories({ factory, dbName: "phase6-readonly" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await check.conversations.get("conversation-1")).toMatchObject({ title: "Análisis", associatedPersonIds: ["001"], responseMode: "strict" });
    expect(await check.actions.get("action-1")).toMatchObject({ status: "pending" });
    check.close();
  });

  test("throws a sanitized error when person continuation is unavailable", async () => {
    const factory = new IDBFactory();
    function Probe() {
      const assistant = useAssistant();
      const [failure, setFailure] = useState("");
      return <><button disabled={!assistant.ready} onClick={() => void assistant.continuePersonInAssistant("001").catch((error: Error) => setFailure(error.message))}>Continuar</button><output>{failure}</output></>;
    }
    render(<AssistantProvider factory={factory} dbName="phase6-person-unavailable"><Probe /></AssistantProvider>);
    const button = await screen.findByRole("button", { name: "Continuar" }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    expect(await screen.findByText(/análisis o la matrícula ya no están disponibles/i)).toBeVisible();
  });

  test("does not expose retry or regenerate for historical conversations", async () => {
    const factory = new IDBFactory(); const repositories = await createIndexedDbRepositories({ factory, dbName: "phase6-historical-repeat" });
    await repositories.conversations.put(conversation("archived_analysis_deleted"));
    await repositories.messages.put({ ...message, id: "user-repeat", role: "user", content: "Consulta la matrícula 001", actionIds: [] });
    await repositories.messages.put({ ...message, id: "assistant-repeat", createdAt: "2026-07-13T10:01:00.000Z", actionIds: [] }); repositories.close();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    function RetryProbe() { const assistant = useAssistant(); return <button onClick={() => void assistant.retryResponse("assistant-repeat")}>Forzar retry</button>; }
    render(<AssistantProvider activeAnalysis={analysis()} factory={factory} dbName="phase6-historical-repeat"><AssistantView /><RetryProbe /></AssistantProvider>);
    await screen.findByText("Resultado");
    expect(screen.queryByRole("button", { name: /Regenerar|Reintentar/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Forzar retry" }));
    await new Promise((resolve) => setTimeout(resolve, 20)); expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("keeps an active run intact when the selected conversation is selected again", async () => {
    const factory = new IDBFactory(); const dbName = "phase6-selected-stream-noop";
    const repositories = await createIndexedDbRepositories({ factory, dbName }); await repositories.conversations.put(conversation()); repositories.close();
    const encoder = new TextEncoder(); let release: (() => void) | undefined; let streamCalls = 0;
    const adapter = {
      streamGeneral: async function* () { yield new Uint8Array(); },
      streamPersonProfile: async function* () {
        streamCalls += 1;
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta: "Parcial preservado" })}\n`);
        await new Promise<void>((resolve) => { release = resolve; });
        yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
      },
    };
    function StreamingProbe() {
      const assistant = useAssistant();
      return <><output data-testid="same-selection-streaming">{String(assistant.streaming)}</output><button onClick={() => void assistant.send("Consulta la matrícula 001")}>Enviar inicial</button><button onClick={() => void assistant.selectConversation(assistant.conversation!.id)}>Seleccionar actual</button><button onClick={() => void assistant.send("Consulta la matrícula 001")}>Enviar paralelo</button></>;
    }
    render(<AssistantProvider activeAnalysis={analysis()} factory={factory} dbName={dbName} adapter={adapter}><AssistantView /><StreamingProbe /></AssistantProvider>);
    await screen.findByRole("heading", { name: "Análisis" });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Pregunta" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Enviar inicial" }));
    await screen.findByText("Parcial preservado");
    expect(screen.getByTestId("same-selection-streaming")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar actual" }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(screen.getByTestId("same-selection-streaming")).toHaveTextContent("true");
    expect(screen.getByText("Parcial preservado")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Enviar paralelo" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(streamCalls).toBe(1);
    release?.();
    await waitFor(() => expect(screen.getByTestId("same-selection-streaming")).toHaveTextContent("false"));
    const persisted = await createIndexedDbRepositories({ factory, dbName });
    await waitFor(async () => expect((await persisted.messages.listByConversation("conversation-1", { limit: 10 })).items.find((item) => item.role === "assistant")).toMatchObject({ content: "Parcial preservado", status: "completed" }));
    persisted.close();
  });

  test.each(["switch", "delete"] as const)("does not leak a fallback partial into another conversation after %s", async (operation) => {
    if (operation === "delete") vi.spyOn(window, "confirm").mockReturnValue(true);
    const factory = new IDBFactory(); const dbName = `phase7-fallback-cas-${operation}`;
    const repositories = await createIndexedDbRepositories({ factory, dbName });
    await repositories.conversations.put({ ...conversation(), updatedAt: "2026-07-13T10:02:00.000Z" });
    await repositories.conversations.put({ id: "conversation-b", type: "general", title: "General B", associatedPersonIds: [], modelProfileId: "fake-retributivo-v1", responseMode: "strict", contextStrategy: "automatic", status: "active", createdAt: at, updatedAt: "2026-07-13T10:01:00.000Z" });
    repositories.close();
    const encoder = new TextEncoder(); let release: (() => void) | undefined; let attempt = 0;
    const adapter = {
      streamGeneral: async function* () { yield new Uint8Array(); },
      streamPersonProfile: async function* () {
        attempt += 1;
        if (attempt === 1) {
          yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta: "Parcial fallback A" })}\n`);
          yield encoder.encode(`${JSON.stringify({ type: "error", code: "transient", classification: "transient", message: "Fallo transitorio sanitizado", retryable: true })}\n`);
          return;
        }
        await new Promise<void>((resolve) => { release = resolve; });
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta: "Continuación tardía" })}\n`);
        yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
      },
    };
    function Probe() {
      const assistant = useAssistant();
      return <><button onClick={() => void assistant.send("Consulta la matrícula 001")}>Enviar fallback</button><button onClick={() => void assistant.selectConversation("conversation-b")}>Cambiar a B</button><button onClick={() => void assistant.deleteConversation()}>Eliminar A</button></>;
    }
    render(<AssistantProvider activeAnalysis={analysis()} factory={factory} dbName={dbName} adapter={adapter}><AssistantView /><Probe /></AssistantProvider>);
    await screen.findByRole("heading", { name: "Análisis" });
    fireEvent.click(screen.getByRole("button", { name: "Enviar fallback" }));
    await screen.findByText("Parcial fallback A");
    fireEvent.click(screen.getByRole("button", { name: operation === "switch" ? "Cambiar a B" : "Eliminar A" }));
    release?.();
    await screen.findByRole("heading", { name: "General B" });
    const persisted = await createIndexedDbRepositories({ factory, dbName });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await persisted.messages.listByConversation("conversation-b", { limit: 10 })).items).toEqual([]);
    expect((await persisted.messages.listByConversation("conversation-1", { limit: 10 })).items).toEqual([]);
    if (operation === "delete") expect(await persisted.conversations.get("conversation-1")).toBeUndefined();
    persisted.close();
  });

  test("aborts an active analysis run before cleanup and cannot persist after completion", async () => {
    const factory = new IDBFactory(); const dbName = "phase6-cleanup-active-run";
    const repositories = await createIndexedDbRepositories({ factory, dbName }); await repositories.conversations.put(conversation()); repositories.close();
    const encoder = new TextEncoder(); let release: (() => void) | undefined; let attempt = 0;
    const adapter = {
      streamGeneral: async function* () { yield new Uint8Array(); },
      streamPersonProfile: async function* () {
        attempt += 1;
        if (attempt === 1) {
          yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta: "Parcial antes de limpiar" })}\n`);
          yield encoder.encode(`${JSON.stringify({ type: "error", code: "transient", classification: "transient", message: "Fallo transitorio sanitizado", retryable: true })}\n`);
          return;
        }
        await new Promise<void>((resolve) => { release = resolve; });
        yield encoder.encode(`${JSON.stringify({ type: "text_delta", messageId: "local", delta: "Continuación tardía" })}\n`);
        yield encoder.encode(`${JSON.stringify({ type: "done", finishReason: "stop" })}\n`);
      },
    };
    render(<AssistantProvider activeAnalysis={analysis()} factory={factory} dbName={dbName} adapter={adapter}><AssistantView /></AssistantProvider>);
    await screen.findByRole("heading", { name: "Análisis" });
    const composer = screen.getByRole("textbox", { name: "Pregunta" }); fireEvent.change(composer, { target: { value: "Consulta la matrícula 001" } }); fireEvent.keyDown(composer, { key: "Enter" });
    await screen.findByText("Parcial antes de limpiar");
    const cleanupRepositories = await createIndexedDbRepositories({ factory, dbName }); const job = createAnalysisCleanupJob("analysis-1", "preserve_conversations", at); await cleanupRepositories.cleanupJobs.put(job);
    await runAnalysisCleanupJob(cleanupRepositories, job.id, vi.fn(), at); release?.();
    await waitFor(async () => expect((await cleanupRepositories.conversations.get("conversation-1"))?.status).toBe("archived_analysis_deleted"));
    await new Promise((resolve) => setTimeout(resolve, 30)); expect((await cleanupRepositories.messages.listByConversation("conversation-1", { limit: 10 })).items).toEqual([]);
    cleanupRepositories.close();
  });
});
