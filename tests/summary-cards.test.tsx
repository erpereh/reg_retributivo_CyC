// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import type { AnalysisSummary } from "@/lib/types";

describe("dashboard summary cards", () => {
  test("labels processed payroll pages as receipts and shows internal Excel status", () => {
    const summary: AnalysisSummary = {
      generatedAt: "2026-07-03T00:00:00.000Z",
      pdfsAnalyzed: 953,
      pdfsFailed: 0,
      uniquePeople: 1,
      peopleWithDifferences: 0,
      totalSalaryDifference: 0,
      totalSalaryComplementDifference: 0,
      totalExtraSalaryDifference: 0,
      totalGlobalDifference: 0,
      peopleWithGrossDifferences: 2,
      peopleWithAdjustedDifferences: 1,
      matchedGrossTotalDifference: 416.1,
      matchedJustifiedTotalAmount: 416,
      matchedAdjustedTotalDifference: 0.1,
      peopleOkAdjusted: 1,
      conceptsJustifiedActive: 1,
      conceptsJustifiedApplied: 2,
      conceptsUnmapped: 0,
      conceptsNotIncluded: 37,
      conceptsIgnored: 35,
      conceptsPendingReview: 2,
      conceptsRealUnmapped: 0,
      pendingDecisionPdfTotal: 16358.04,
      internalExcelDifferences: 0,
      groupingDifferences: 0,
      tolerance: 1,
    };

    render(
      <SummaryCards
        summary={summary}
        internalExcelChecks={Array.from({ length: 70 }, (_, index) => ({
          employeeNumber: String(10000 + index),
          salaryPeriod: 100,
          salaryBreakdown: 100,
          salaryDifference: 0,
          salaryComplementPeriod: 50,
          salaryComplementBreakdown: 50,
          salaryComplementDifference: 0,
          extraSalaryPeriod: 10,
          extraSalaryBreakdown: 10,
          extraSalaryDifference: 0,
          status: "OK" as const,
          detail: "Cuadre correcto",
        }))}
      />,
    );

    expect(screen.getByText("Recibos procesados").textContent).toBe("Recibos procesados");
    expect(screen.queryByText("PDFs analizados")).toBeNull();
    expect(screen.queryByText("Conceptos sin mapear")).toBeNull();
    expect(screen.getByText("Conceptos pendientes de revisión")).toBeTruthy();
    expect(screen.getByText("Personas analizadas")).toBeTruthy();
    expect(screen.getByText("Personas con diferencia")).toBeTruthy();
    expect(screen.getByText("Diferencia total matched")).toBeTruthy();
    expect(screen.getByText("Conceptos desactivados")).toBeTruthy();
    expect(screen.getByText("Reg. Retrib. sin Recibo")).toBeTruthy();
    expect(screen.queryByText(/justificad/i)).toBeNull();
    expect(screen.queryByText(/ajustad/i)).toBeNull();
    expect(screen.queryByText("Conceptos no incluidos")).toBeNull();
    expect(screen.getByText("Conceptos sin mapear reales")).toBeTruthy();
    expect(screen.getByText("Importe pendiente de decisión")).toBeTruthy();
    expect(screen.getByText("Importe Recibo pendiente de decisión, no incluido en el cálculo principal")).toBeTruthy();
    expect(screen.getByText(/requieren decisión/i)).toBeTruthy();
    expect(screen.getByText(/Reglas configuradas fuera del análisis/i)).toBeTruthy();
    expect(screen.getByText(/problema real de mapeo/i)).toBeTruthy();
    expect(screen.getByText("Cuadre interno Excel")).toBeTruthy();
    expect(screen.getByText("70 / 70 OK")).toBeTruthy();
    expect(screen.getByText(/No compara contra recibos/i)).toBeTruthy();
  });
});
