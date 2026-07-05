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
      internalExcelDifferences: 0,
      groupingDifferences: 0,
      tolerance: 1,
    };

    render(<SummaryCards summary={summary} />);

    expect(screen.getByText("Recibos procesados").textContent).toBe("Recibos procesados");
    expect(screen.queryByText("PDFs analizados")).toBeNull();
  });
});
