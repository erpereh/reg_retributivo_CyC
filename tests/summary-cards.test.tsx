// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import type { AnalysisSummary } from "@/lib/types";

describe("dashboard summary cards", () => {
  test("labels processed payroll pages as receipts instead of PDF files", () => {
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

    render(<SummaryCards summary={summary} />);

    expect(screen.getByText("Recibos procesados").textContent).toBe("Recibos procesados");
    expect(screen.queryByText("PDFs analizados")).toBeNull();
    expect(screen.queryByText("Conceptos sin mapear")).toBeNull();
    expect(screen.getByText("Pendientes revision")).toBeTruthy();
    expect(screen.getByText("Importe PDF pendiente de decision, no incluido en el calculo principal")).toBeTruthy();
  });
});
