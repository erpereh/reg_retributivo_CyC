import { describe, expect, test } from "vitest";
import { describePersonCause } from "@/lib/ui/probableCause";
import type { ConceptComparisonRow, PersonComparisonRow } from "@/lib/types";

describe("AI explain payload builders", () => {
  test("builds a person payload without sending the person name", async () => {
    const { buildPersonExplainPayload } = await import("@/lib/ai/explainPayload");
    const row: PersonComparisonRow = {
      employeeNumber: "10048",
      person: "Persona Privada",
      workplace: "Bilbao",
      position: "Administracion",
      category: "Categoria A",
      salaryRegistro: 1000,
      salaryPdf: 1100,
      salaryDifference: 100,
      salaryComplementRegistro: 500,
      salaryComplementPdf: 400,
      salaryComplementDifference: -100,
      extraSalaryRegistro: 50,
      extraSalaryPdf: 258.01,
      extraSalaryDifference: 208.01,
      registroTotal: 1550,
      pdfTotal: 1758.01,
      totalDifference: 208.01,
      pdfControlTotalDevengado: 1758.01,
      payrollCount: 1,
      unmappedConceptsCount: 1,
      status: "Diferencia",
      detail: "Teletrabajo pendiente",
      periods: ["Febrero 2025"],
      files: ["PDF_FEBRERO.pdf"],
    };

    const concepts: ConceptComparisonRow[] = [
      {
        employeeNumber: "10048",
        person: "Persona Privada",
        block: "Salario",
        blockKey: "salary",
        registroCode: "SSP_SAL_BASE",
        pdfConcept: "Salario Base",
        registroAmount: 1000,
        pdfAmount: 1100,
        difference: 100,
        status: "Diferencia",
        detail: "Diferencia concepto",
      },
      {
        employeeNumber: "10048",
        person: "Persona Privada",
        block: "Extrasalarial",
        blockKey: "extraSalary",
        registroCode: "CYC_TEST",
        pdfConcept: "Plus Transporte",
        registroAmount: 0,
        pdfAmount: 208.01,
        difference: 208.01,
        status: "Diferencia",
        detail: "Pendiente",
      },
    ];

    const payload = buildPersonExplainPayload(row, describePersonCause(row, 1), concepts);
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain("Persona Privada");
    expect(payload.employeeNumber).toBe("10048");
    expect(payload.workplace).toBe("Bilbao");
    expect(payload.position).toBe("Administracion");
    expect(payload.category).toBe("Categoria A");
    expect(payload.amounts.map((item) => item.label)).toEqual(["Salario", "C. Salarial", "Extrasalarial", "Total"]);
    expect(payload.topConceptDifferences?.map((item) => item.registroCode)).toEqual(["CYC_TEST", "SSP_SAL_BASE"]);
    expect(payload.deterministicCause.description).toBeTruthy();
  });
});
