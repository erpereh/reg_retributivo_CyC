import { describe, expect, test } from "vitest";
import { describePersonCause, describeConceptCause } from "@/lib/ui/probableCause";
import type { ConceptComparisonRow, PersonComparisonRow } from "@/lib/types";

function person(overrides: Partial<PersonComparisonRow>): PersonComparisonRow {
  return {
    employeeNumber: "10048",
    person: "Persona Test",
    workplace: "Bilbao",
    position: "Puesto",
    category: "Categoria",
    salaryRegistro: 0,
    salaryPdf: 0,
    salaryDifference: 0,
    salaryComplementRegistro: 0,
    salaryComplementPdf: 0,
    salaryComplementDifference: 0,
    extraSalaryRegistro: 0,
    extraSalaryPdf: 0,
    extraSalaryDifference: 0,
    registroTotal: 0,
    pdfTotal: 0,
    totalDifference: 0,
    pdfControlTotalDevengado: 0,
    payrollCount: 1,
    unmappedConceptsCount: 0,
    status: "OK",
    detail: "",
    periods: [],
    files: [],
    ...overrides,
  };
}

function concept(overrides: Partial<ConceptComparisonRow>): ConceptComparisonRow {
  return {
    employeeNumber: "10048",
    person: "Persona Test",
    block: "Extrasalarial",
    blockKey: "extraSalary",
    registroCode: "CYC_TEST",
    pdfConcept: "Concepto Test",
    registroAmount: 0,
    pdfAmount: 0,
    difference: 0,
    status: "OK",
    detail: "",
    ...overrides,
  };
}

describe("probable deterministic cause", () => {
  test("labels telework-like extra salary differences without changing the row", () => {
    const row = person({ extraSalaryDifference: 208.05, totalDifference: 208.05, detail: "Teletrabajo pendiente" });

    expect(describePersonCause(row, 1).label).toBe("Teletrabajo");
    expect(row.status).toBe("OK");
  });

  test("labels vacation bonus and compensated block reclassification", () => {
    expect(describePersonCause(person({ salaryComplementDifference: 841.92 }), 1).label).toBe("Bolsa vacaciones");
    expect(
      describePersonCause(person({ salaryDifference: 120, salaryComplementDifference: -119.7, totalDifference: 0.3 }), 1).label,
    ).toBe("Reclasificacion");
  });

  test("labels no-registro, pending concept, tolerance and fallback cases", () => {
    expect(describePersonCause(person({ status: "Sin Registro" }), 1).label).toBe("PDF sin Registro");
    expect(describePersonCause(person({ unmappedConceptsCount: 2, totalDifference: 50 }), 1).label).toBe("Concepto pendiente");
    expect(describePersonCause(person({ totalDifference: 0.5 }), 1).label).toBe("Redondeo");
    expect(describePersonCause(person({ totalDifference: 50 }), 1).label).toBe("Sin causa clara");
  });

  test("describes concept rows using existing deterministic data only", () => {
    expect(describeConceptCause(concept({ pdfConcept: "Teletrabajo", difference: 208.01 }), 1).label).toBe("Teletrabajo");
    expect(describeConceptCause(concept({ status: "Sin mapear", difference: 20 }), 1).label).toBe("Concepto pendiente");
  });
});
