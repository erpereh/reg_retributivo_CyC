// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceDetails } from "@/components/assistant/SourceDetails";
import type { SourceReference } from "@/lib/assistant/domain";

function structuredSource(): SourceReference {
  const evidence = {
    personId: "10050",
    laborContext: { workplace: "Bilbao", position: "Delegado/a de Compras", category: "Oficial de Primera" },
    totals: { registro: 44_760.16, payroll: 44_968.16, difference: 208 },
    blocks: {
      salary: { registro: 25_325.28, payroll: 25_325.28, difference: 0 },
      salaryComplement: { registro: 14_694, payroll: 14_694, difference: 0 },
      extraSalary: { registro: 4_740.88, payroll: 4_948.88, difference: 208 },
    },
    status: "Diferencia", periods: ["2025-01"],
    registro: { concepts: [{ block: "Extrasalarial", blockKey: "extraSalary", code: "CSP_I_COMP_TELETR_COVID", amount: 0 }] },
    payroll: { periods: [{ period: "2025-01", concepts: [{ name: "Abono teletrabajo", amount: 208, type: "devengo" }], totals: { totalDevengado: 3_700 }, bases: {} }] },
    comparisons: [{ block: "Extrasalarial", blockKey: "extraSalary", registroCode: "CSP_I_COMP_TELETR_COVID", pdfConcept: "Abono teletrabajo", registroAmount: 0, payrollAmount: 208, difference: 208, status: "Diferencia", detail: "Comparación", cause: { label: "Teletrabajo", description: "Abono identificado.", review: "Revisar inclusión.", confidence: "alta", facts: ["Registro 0; recibos 208."], missingEvidence: ["Confirmar documentalmente."] }, cohorts: [] }],
    cuadre: {}, normalizedData: undefined,
    completeness: { registroConcepts: 1, payrollPeriods: 1, payrollConcepts: 1, comparisons: 1, mismatches: 1 },
  } as const;
  return { id: "s1", conversationId: "c1", analysisId: "a1", personId: "10050", sourceType: "person_analysis", sanitizedSourceLabel: "Evidencia retributiva · matrícula 10050", availability: "available", conceptIds: ["CSP_I_COMP_TELETR_COVID"], excerpt: "Resumen legible", sanitizedHash: "hash", presentation: { kind: "person_analysis", personId: "10050", evidence } as SourceReference["presentation"] };
}

describe("SourceDetails", () => {
  it("renders person evidence as metrics and readable tables without technical JSON", () => {
    const { container } = render(<SourceDetails source={structuredSource()} />);
    expect(screen.getByRole("heading", { name: "Resumen" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Conceptos descuadrados" })).toBeVisible();
    expect(screen.getAllByText("Abono teletrabajo").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("208,00 EUR").length).toBeGreaterThan(1);
    expect(screen.getAllByText(/Confianza alta/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: "Causa probable y contexto laboral" })).toBeVisible();
    expect(screen.getByText("Registro 0; recibos 208.")).toBeVisible();
    expect(screen.getByText("Revisar inclusión.")).toBeVisible();
    expect(screen.getByText("Recibos por periodo")).toBeVisible();
    expect(container.textContent).not.toContain('"comparisons"');
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renders parseable legacy JSON as translated key/value content and hides the technical extract", () => {
    render(<SourceDetails source={{ id: "legacy", conversationId: "c1", sourceType: "analysis", sanitizedSourceLabel: "Análisis retributivo · getPersonProfile", availability: "available", conceptIds: [], excerpt: '{"personId":"10048","totalDifference":208}', sanitizedHash: "legacy-hash" }} />);
    expect(screen.getByText("Matrícula")).toBeVisible();
    expect(screen.getByText("10048")).toBeVisible();
    expect(screen.getByText("Diferencia total")).toBeVisible();
    expect(screen.queryByText(/\{"personId"/)).toBeNull();
    expect(screen.getByText("Extracto técnico heredado")).toBeVisible();
  });
});
