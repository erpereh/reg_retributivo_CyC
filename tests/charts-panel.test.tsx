// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";
import { ChartsPanel } from "@/components/dashboard/ChartsPanel";
import type { AnalysisResult } from "@/lib/types";

const result = {
  summary: {
    generatedAt: "2026-07-05T00:00:00.000Z",
    pdfsAnalyzed: 10,
    pdfsFailed: 0,
    uniquePeople: 3,
    peopleWithDifferences: 1,
    totalSalaryDifference: 100,
    totalSalaryComplementDifference: -50,
    totalExtraSalaryDifference: 25,
    totalGlobalDifference: 75,
    matchedTotalDifference: 75,
    matchedSalaryDifference: 100,
    matchedSalaryComplementDifference: -50,
    matchedExtraSalaryDifference: 25,
    pendingDecisionPdfTotal: 200,
    totalPdfWithoutRegistro: 300,
    conceptsUnmapped: 0,
    internalExcelDifferences: 0,
    groupingDifferences: 0,
    tolerance: 1,
  },
  people: [
    {
      employeeNumber: "10048",
      person: "Persona Uno",
      salaryRegistro: 100,
      salaryPdf: 150,
      salaryDifference: 50,
      salaryComplementRegistro: 0,
      salaryComplementPdf: 0,
      salaryComplementDifference: 0,
      extraSalaryRegistro: 0,
      extraSalaryPdf: 0,
      extraSalaryDifference: 0,
      registroTotal: 100,
      pdfTotal: 150,
      totalDifference: 50,
      pdfControlTotalDevengado: 150,
      payrollCount: 1,
      unmappedConceptsCount: 0,
      status: "Diferencia",
      detail: "",
      periods: [],
      files: [],
    },
    {
      employeeNumber: "10050",
      person: "Persona Dos",
      salaryRegistro: 100,
      salaryPdf: 100,
      salaryDifference: 0,
      salaryComplementRegistro: 0,
      salaryComplementPdf: 0,
      salaryComplementDifference: 0,
      extraSalaryRegistro: 0,
      extraSalaryPdf: 0,
      extraSalaryDifference: 0,
      registroTotal: 100,
      pdfTotal: 100,
      totalDifference: 0,
      pdfControlTotalDevengado: 100,
      payrollCount: 1,
      unmappedConceptsCount: 0,
      status: "OK",
      detail: "",
      periods: [],
      files: [],
    },
  ],
  payrollRecords: [],
  registroEmployees: [],
  normalizedVsReal: [],
  concepts: [],
  unmappedConcepts: [],
  ignoredConcepts: [],
  pdfWithoutRegistro: [],
  registroWithoutPdf: [],
  groupings: [],
  internalExcelChecks: [],
  conceptMap: [],
  errors: [],
  criteria: [],
} satisfies AnalysisResult;

describe("ChartsPanel", () => {
  beforeAll(() => {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    window.ResizeObserver = ResizeObserverStub;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 320 });
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 320,
        right: 800,
        width: 800,
        height: 320,
        toJSON: () => undefined,
      }) as DOMRect;
  });

  test("renders at most four professional chart modules", () => {
    render(<ChartsPanel result={result} />);

    expect(screen.getAllByTestId("professional-chart-card")).toHaveLength(4);
    expect(screen.queryByText(/Conceptos no incluidos por tipo/i)).toBeNull();
    expect(screen.queryByText(/Recibo sin Reg\. Retrib\. por importe/i)).toBeNull();
  });

  test("keeps matched, pending and receipt without Reg. Retrib. visually separated", () => {
    render(<ChartsPanel result={result} />);

    expect(screen.getByText("Diferencia total matched")).toBeTruthy();
    expect(screen.getByText("Pendiente decisión")).toBeTruthy();
    expect(screen.getByText("Recibo sin Reg. Retrib.")).toBeTruthy();
    expect(screen.queryByText(/justificad/i)).toBeNull();
    expect(screen.queryByText(/ajustad/i)).toBeNull();
    expect(screen.getAllByText(/No se suman/i).length).toBeGreaterThan(0);
  });
});
