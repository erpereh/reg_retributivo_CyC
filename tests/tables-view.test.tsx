// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TablesView } from "@/components/tables/TablesView";

const appState = {
  value: {
    result: {
      people: [
        {
          employeeNumber: "10048",
          person: "Persona Test",
          workplace: "Bilbao",
          position: "Puesto",
          category: "Categoria",
          salaryRegistro: 1000,
          salaryPdf: 1100,
          salaryDifference: 100,
          salaryComplementRegistro: 500,
          salaryComplementPdf: 400,
          salaryComplementDifference: -100,
          extraSalaryRegistro: 50,
          extraSalaryPdf: 50,
          extraSalaryDifference: 0,
          registroTotal: 1550,
          pdfTotal: 1550,
          totalDifference: 0,
          pdfControlTotalDevengado: 1550,
          payrollCount: 1,
          unmappedConceptsCount: 0,
          status: "OK",
          detail: "Detalle",
          periods: ["Enero 2025"],
          files: ["PDF_ENERO.pdf"],
        },
        {
          employeeNumber: "10050",
          person: "Persona Diferencia",
          workplace: "Madrid",
          position: "Puesto",
          category: "Categoria",
          salaryRegistro: 1000,
          salaryPdf: 1200,
          salaryDifference: 200,
          salaryComplementRegistro: 0,
          salaryComplementPdf: 0,
          salaryComplementDifference: 0,
          extraSalaryRegistro: 0,
          extraSalaryPdf: 208.01,
          extraSalaryDifference: 208.01,
          registroTotal: 1000,
          pdfTotal: 1408.01,
          totalDifference: 408.01,
          pdfControlTotalDevengado: 1408.01,
          payrollCount: 1,
          unmappedConceptsCount: 1,
          status: "Diferencia",
          detail: "Teletrabajo pendiente",
          periods: ["Febrero 2025"],
          files: ["PDF_FEBRERO.pdf"],
        },
      ],
      concepts: [
        {
          employeeNumber: "10048",
          person: "Persona Test",
          block: "Extrasalarial",
          blockKey: "extraSalary",
          registroCode: "CYC_SEG_SALUD",
          pdfConcept: "Seguro Medico",
          registroAmount: 100,
          pdfAmount: 120,
          difference: 20,
          status: "Diferencia",
          detail: "Diferencia de concepto",
        },
        {
          employeeNumber: "10048",
          person: "Persona Test",
          block: "Salario",
          blockKey: "salary",
          registroCode: "SSP_SAL_BASE",
          pdfConcept: "Salario Base",
          registroAmount: 1000,
          pdfAmount: 1100,
          difference: 100,
          status: "Diferencia",
          detail: "Diferencia de concepto",
        },
      ],
      unmappedConcepts: [
        {
          decisionType: "Pendiente revision",
          includedInComparison: false,
          pdfConcept: "Paga 40 anos",
          totalDetected: 841.92,
          peopleCount: 1,
          payrollCount: 1,
          exampleEmployeeNumbers: ["10072"],
          suggestedBlock: "C. Salarial",
          action: "Pendiente revisiÃ³n",
          recommendedAction: "Revisar codigo Registro",
          reason: "No existe codigo exacto",
        },
      ],
      groupings: [],
    },
    filters: { query: "", center: "", group: "", status: "" },
    setFilters: vi.fn(),
    activeAnalysis: { id: "analysis-1" },
    settings: {
      autoExplainOnOpen: false,
    },
    aiStatus: { configured: false, enabled: false, model: "gemini-3.1-flash-lite" },
    pushToast: vi.fn(),
  },
};

vi.mock("@/components/app/AppState", async () => {
  const actual = await vi.importActual<typeof import("@/components/app/AppState")>("@/components/app/AppState");
  return {
    ...actual,
    useAppState: () => appState.value,
  };
});

describe("TablesView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    appState.value.aiStatus = { configured: false, enabled: false, model: "gemini-3.1-flash-lite" };
    appState.value.settings = { autoExplainOnOpen: false };
  });

  test("does not key mapped table headers by their visible label", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "components", "tables", "TablesView.tsx"), "utf8");

    expect(source).not.toContain("key={header}");
  });

  test("renders repeated visible headers with unique React keys", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<TablesView mode="personas" />);

    expect(consoleError.mock.calls.flat().some((entry) => String(entry).includes("Encountered two children with the same key"))).toBe(false);
    consoleError.mockRestore();
  });

  test("opens a deterministic person detail modal from the whole clickable row", () => {
    render(<TablesView mode="personas" />);

    expect(screen.queryByRole("dialog", { name: /Detalle persona/i })).toBeNull();

    fireEvent.click(screen.getByText("10048"));

    expect(screen.getByRole("dialog", { name: /Detalle persona/i })).toBeTruthy();
    expect(screen.getByText(/Causa probable/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Analizar con IA/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("IA no configurada. Añade GEMINI_API_KEY en .env")).toBeTruthy();
  });

  test("requests an AI explanation on demand without sending the person name", async () => {
    appState.value.aiStatus = { configured: true, enabled: true, model: "gemini-3.1-flash-lite" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          explanation: {
            summary: "Diferencia explicada.",
            probableCauses: ["Concepto pendiente."],
            registroReview: ["Revisar Registro."],
            pdfReview: ["Revisar datos extraidos de los PDFs."],
            recommendedActions: ["Documentar criterio."],
            confidence: "Media",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(<TablesView mode="personas" />);
    fireEvent.click(screen.getByText("10048"));
    fireEvent.click(screen.getByRole("button", { name: /Analizar con IA/i }));

    await screen.findByText("Diferencia explicada.");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/explain", expect.any(Object)));
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));

    expect(JSON.stringify(body)).not.toContain("Persona Test");
    expect(JSON.stringify(body)).toContain("10048");
    expect(body.payload.topConceptDifferences.map((item: { registroCode: string }) => item.registroCode)).toContain("SSP_SAL_BASE");
    expect(screen.getByText("Causas probables")).toBeTruthy();
    expect(screen.getByText(/revisar en Registro/i)).toBeTruthy();
    expect(screen.getByText(/revisar en PDF/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Regenerar/i })).toBeTruthy();
  });

  test("removes detail buttons and opens the concept modal from the row", () => {
    render(<TablesView mode="conceptos" />);

    expect(screen.queryByRole("button", { name: /^Detalle$/i })).toBeNull();

    fireEvent.click(screen.getByText("CYC_SEG_SALUD"));

    expect(screen.getByRole("dialog", { name: /Detalle concepto/i })).toBeTruthy();
    expect(screen.getAllByText("CYC_SEG_SALUD").length).toBeGreaterThan(1);
  });

  test("does not render a Detalle table column", () => {
    render(<TablesView mode="personas" />);

    expect(screen.queryByRole("columnheader", { name: /^Detalle$/i })).toBeNull();
  });

  test("keeps only Matricula sticky and uses opaque row backgrounds", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "components", "tables", "TablesView.tsx"), "utf8");

    expect(source).not.toContain("left-[120px]");
    expect(source).not.toContain("bg-emerald-50/45");
    expect(source).not.toContain("bg-orange-50/45");
    expect(source).not.toContain("bg-red-50/35");
    expect(source).not.toContain("hover:bg-red-50/75");
    expect(source).toContain("shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]");
  });

  test("quick filters keep the table functional and show visible totals", () => {
    render(<TablesView mode="personas" />);

    fireEvent.click(screen.getByRole("button", { name: /Ver solo diferencias/i }));

    expect(appState.value.setFilters).toHaveBeenCalledWith(expect.objectContaining({ status: "Diferencia" }));
    expect(screen.getByText(/filas visibles/i)).toBeTruthy();
    expect(screen.getByText(/Suma diferencia visible/i)).toBeTruthy();
  });
});
