// @vitest-environment jsdom

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AssistantView } from "@/components/assistant/AssistantView";
import { FakeAssistantAdapter } from "@/lib/assistant/providers/fakeAdapter";
import type { ChatMessage } from "@/lib/assistant/domain";
import { openAssistantDatabase } from "@/lib/assistant/storage/database";
import { getPersonProfile } from "@/lib/assistant/tools/personTools";
import { executeAssistantToolRequest } from "@/lib/assistant/tools/personTools";
import type { AnalysisResult, PersonComparisonRow, StoredAnalysis } from "@/lib/types";

const person: PersonComparisonRow = {
  employeeNumber: "10048", person: "Persona Test", workplace: "Bilbao", position: "Puesto", category: "Categoría",
  salaryRegistro: 1000, salaryPdf: 1100, salaryDifference: 100,
  salaryComplementRegistro: 500, salaryComplementPdf: 400, salaryComplementDifference: -100,
  extraSalaryRegistro: 50, extraSalaryPdf: 258.01, extraSalaryDifference: 208.01,
  registroTotal: 1550, pdfTotal: 1758.01, totalDifference: 208.01, pdfControlTotalDevengado: 1758.01,
  payrollCount: 1, unmappedConceptsCount: 0, status: "Diferencia", detail: "Diferencia local", periods: ["enero 2025"], files: ["privado.pdf"],
};

const result = { people: [person], payrollRecords: [{ workerName: "Persona Test", sourceFile: "privado.pdf" }], registroEmployees: [{ workerName: "Persona Test" }] } as unknown as AnalysisResult;
const activeAnalysis = { id: "analysis-1", result, createdAt: "2026-07-13T10:00:00.000Z" } as StoredAnalysis;

function Assistant({ factory }: { factory: IDBFactory }) {
  return (
    <AssistantProvider activeAnalysis={activeAnalysis} factory={factory} dbName="vertical-slice-test" adapter={new FakeAssistantAdapter()}>
      <AssistantView />
    </AssistantProvider>
  );
}

describe("assistant vertical slice", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("persists a general fake stream, reloads, converts and associates a person without a provider call", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const first = render(<Assistant factory={factory} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Crear conversación general/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Crear conversación general/i }));
    await screen.findAllByText("Consulta general");

    const composer = screen.getByRole("textbox", { name: /Pregunta/i });
    fireEvent.change(composer, { target: { value: "¿Qué es Cuadre Reg.?" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar/i }));
    await screen.findAllByText(/Retributivo compara el Registro Retributivo y los recibos/i);
    expect((composer as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText(/1.758,01/)).toBeNull();

    first.unmount();
    render(<Assistant factory={factory} />);
    await screen.findByText("¿Qué es Cuadre Reg.?");
    expect(screen.getByText(/Retributivo compara el Registro Retributivo y los recibos/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Convertir al análisis activo/i }));
    await screen.findByText(/Análisis activo asociado/i);
    const eventDb = await openAssistantDatabase(factory, "vertical-slice-test");
    const persistedEvents = await new Promise<unknown[]>((resolve, reject) => {
      const request = eventDb.transaction("events", "readonly").objectStore("events").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    eventDb.close();
    expect(persistedEvents).toEqual(expect.arrayContaining([expect.objectContaining({ event: { type: "context_added", contextId: "analysis-1", label: "Análisis activo" } })]));
    fireEvent.click(screen.getByRole("button", { name: "Gestionar personas asociadas" }));
    const picker = screen.getByRole("group", { name: "Personas asociadas" });
    fireEvent.click(within(picker).getByRole("checkbox", { name: "Matrícula 10048" }));
  await waitFor(() =>
    expect(within(picker).getByRole("checkbox", { name: "Matrícula 10048" })).toHaveProperty("checked", true),
  );
    expect(screen.queryByText("privado.pdf", { exact: false })).toBeNull();
  });

  test("getPersonProfile returns exactly the totals shown by the Persona row", () => {
    const profile = getPersonProfile({ analysisId: "analysis-1", personId: "10048" }, { id: "analysis-1", result });
    expect(profile.totals).toEqual({ registro: person.registroTotal, payroll: person.pdfTotal, difference: person.totalDifference });
    expect(profile.source.sanitizedSourceLabel).toBe("Persona matrícula 10048");
    expect(JSON.stringify(profile)).not.toContain(person.person);
    expect(JSON.stringify(profile)).not.toContain(person.files[0]);
  });

  test("a general conversation never reads active analysis people", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    let peopleReads = 0;
    const guardedResult = Object.defineProperty({}, "people", { get() { peopleReads += 1; return [person]; } }) as AnalysisResult;
    const guardedAnalysis = { ...activeAnalysis, result: guardedResult };
    render(<AssistantProvider activeAnalysis={guardedAnalysis} factory={factory} dbName="general-isolation-test" adapter={new FakeAssistantAdapter()}><AssistantView /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Crear conversación general/i }));
    await screen.findAllByText("Consulta general");
    fireEvent.change(screen.getByRole("textbox", { name: /Pregunta/i }), { target: { value: "¿Qué es Cuadre Reg.?" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar/i }));
    await screen.findAllByText(/Retributivo compara/i);
    expect(peopleReads).toBe(0);
  });

  test("fails closed instead of persisting an unknown name or direct identifiers", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    render(<Assistant factory={factory} />);
    fireEvent.click(await screen.findByRole("button", { name: /Crear conversación general/i }));
    await screen.findAllByText("Consulta general");
    const composer = screen.getByRole("textbox", { name: /Pregunta/i });
    fireEvent.change(composer, { target: { value: "La persona Ana García, DNI 12345678Z, ana@example.com, 612 345 678" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar/i }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Ana García", { exact: false })).toBeNull();
    const db = await openAssistantDatabase(factory, "vertical-slice-test");
    const stored = await new Promise<ChatMessage[]>((resolve) => {
      const request = db.transaction("messages", "readonly").objectStore("messages").getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    expect(JSON.stringify(stored)).not.toContain("12345678Z");
    expect(JSON.stringify(stored)).not.toContain("ana@example.com");
    expect(JSON.stringify(stored)).not.toContain("612 345 678");
  });

  test("tool requests allow only getPersonProfile", () => {
    expect(() => executeAssistantToolRequest({ tool: "searchPeople", args: {} }, { id: "analysis-1", result })).toThrow(/no permitida/i);
    expect(executeAssistantToolRequest({ tool: "getPersonProfile", args: { analysisId: "analysis-1", personId: "10048" } }, { id: "analysis-1", result }).totals.registro).toBe(1550);
  });

  test("clears streaming state when the adapter fails", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const failingAdapter = { streamGeneral: async function* () { throw new Error("private provider body"); }, streamPersonProfile: async function* () { throw new Error("private provider body"); } };
    render(<AssistantProvider activeAnalysis={activeAnalysis} factory={factory} dbName="stream-failure-test" adapter={failingAdapter}><AssistantView /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Crear conversación general/i }));
    await screen.findAllByText("Consulta general");
    const composer = screen.getByRole("textbox", { name: /Pregunta/i });
    fireEvent.change(composer, { target: { value: "¿Qué es Cuadre Reg.?" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar/i }));
    await screen.findByRole("alert");
    expect((composer as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).not.toContain("private provider body");
  });

  test("fails before the adapter when repository scope disappears", async () => {
    const factory = new IDBFactory(); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const adapter = new FakeAssistantAdapter();
    const streamGeneral = vi.spyOn(adapter, "streamGeneral");
    render(<AssistantProvider activeAnalysis={activeAnalysis} factory={factory} dbName="scope-bridge-test" adapter={adapter}><AssistantView /></AssistantProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Crear conversación general/i })); await screen.findAllByText("Consulta general");
    const db = await openAssistantDatabase(factory, "scope-bridge-test"); await new Promise<void>((resolve, reject) => { const transaction = db.transaction("conversations", "readwrite"); transaction.objectStore("conversations").clear(); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
    fireEvent.change(screen.getByRole("textbox", { name: /Pregunta/i }), { target: { value: "¿Qué es Cuadre Reg.?" } }); fireEvent.click(screen.getByRole("button", { name: /Enviar/i }));
    await screen.findByRole("alert"); expect(streamGeneral).not.toHaveBeenCalled();
  });
});
