// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
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
    expect(screen.getByText(/Analizar con IA/i)).toBeTruthy();
    expect(screen.getByText(/Fase 2/i)).toBeTruthy();
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

  test("quick filters keep the table functional and show visible totals", () => {
    render(<TablesView mode="personas" />);

    fireEvent.click(screen.getByRole("button", { name: /Ver solo diferencias/i }));

    expect(appState.value.setFilters).toHaveBeenCalledWith(expect.objectContaining({ status: "Diferencia" }));
    expect(screen.getByText(/filas visibles/i)).toBeTruthy();
    expect(screen.getByText(/Suma diferencia visible/i)).toBeTruthy();
  });
});
