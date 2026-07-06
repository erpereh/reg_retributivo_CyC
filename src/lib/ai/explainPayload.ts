import type { ProbableCause } from "@/lib/ui/probableCause";
import type { ConceptComparisonRow, InternalExcelCheckRow, PersonComparisonRow, UnmappedConceptRow } from "@/lib/types";
import type { ExplainPayload } from "@/lib/ai/explainTypes";

function clean(value?: string): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function causeFrom(value: ProbableCause): ExplainPayload["deterministicCause"] {
  return {
    label: value.label,
    description: value.description,
    review: value.review,
  };
}

function buildTopConceptDifferences(row: PersonComparisonRow, concepts: readonly ConceptComparisonRow[] = []): ExplainPayload["topConceptDifferences"] {
  const top = concepts
    .filter((concept) => concept.employeeNumber === row.employeeNumber)
    .filter((concept) => Math.abs(concept.difference) > 0)
    .sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference))
    .slice(0, 10)
    .map((concept) => ({
      block: concept.block,
      registroCode: clean(concept.registroCode),
      pdfConcept: clean(concept.pdfConcept),
      registroAmount: concept.registroAmount,
      pdfAmount: concept.pdfAmount,
      difference: concept.difference,
      status: concept.status,
      detail: clean(concept.detail),
    }));

  return top.length ? top : undefined;
}

export function buildPersonExplainPayload(row: PersonComparisonRow, cause: ProbableCause, concepts: readonly ConceptComparisonRow[] = []): ExplainPayload {
  return {
    rowId: `person:${row.employeeNumber}`,
    employeeNumber: row.employeeNumber,
    workplace: clean(row.workplace),
    position: clean(row.position),
    category: clean(row.category),
    status: row.status,
    payrollCount: row.payrollCount,
    periods: [...row.periods].slice(0, 12),
    detail: clean(row.detail),
    amounts: [
      { label: "Salario", registro: row.salaryRegistro, pdf: row.salaryPdf, difference: row.salaryDifference },
      { label: "C. Salarial", registro: row.salaryComplementRegistro, pdf: row.salaryComplementPdf, difference: row.salaryComplementDifference },
      { label: "Extrasalarial", registro: row.extraSalaryRegistro, pdf: row.extraSalaryPdf, difference: row.extraSalaryDifference },
      { label: "Total", registro: row.registroTotal, pdf: row.pdfTotal, difference: row.totalDifference },
    ],
    topConceptDifferences: buildTopConceptDifferences(row, concepts),
    deterministicCause: causeFrom(cause),
  };
}

export function buildConceptExplainPayload(row: ConceptComparisonRow, cause: ProbableCause): ExplainPayload {
  return {
    rowId: `concept:${row.employeeNumber}:${row.registroCode}:${row.pdfConcept ?? "sin-pdf"}`,
    employeeNumber: row.employeeNumber,
    block: row.block,
    concept: clean(row.pdfConcept),
    registroCode: row.registroCode,
    status: row.status,
    detail: clean(row.detail),
    amounts: [{ label: "Concepto", registro: row.registroAmount, pdf: row.pdfAmount, difference: row.difference }],
    deterministicCause: causeFrom(cause),
  };
}

export function buildNotIncludedConceptExplainPayload(row: UnmappedConceptRow, cause: ProbableCause): ExplainPayload {
  return {
    rowId: `not-included:${row.pdfConcept}`,
    concept: row.pdfConcept,
    block: clean(row.suggestedBlock),
    registroCode: clean(row.suggestedRegistroCode),
    decisionType: row.decisionType,
    includedInComparison: row.includedInComparison,
    payrollCount: row.payrollCount,
    peopleCount: row.peopleCount,
    exampleEmployeeNumbers: [...row.exampleEmployeeNumbers].slice(0, 12),
    suggestedBlock: clean(row.suggestedBlock),
    suggestedRegistroCode: clean(row.suggestedRegistroCode),
    detail: clean(row.reason ?? row.recommendedAction ?? row.action),
    amounts: [{ label: "Detectado en PDF", detected: row.totalDetected }],
    deterministicCause: causeFrom(cause),
  };
}

export function buildInternalExcelExplainPayload(row: InternalExcelCheckRow): ExplainPayload {
  return {
    rowId: `internal-excel:${row.employeeNumber}`,
    employeeNumber: row.employeeNumber,
    workplace: clean(row.workplace),
    position: clean(row.position),
    category: clean(row.category),
    status: row.status,
    detail: clean(row.detail),
    amounts: [
      { label: "Salario", period: row.salaryPeriod, breakdown: row.salaryBreakdown, difference: row.salaryDifference },
      {
        label: "C. Salarial",
        period: row.salaryComplementPeriod,
        breakdown: row.salaryComplementBreakdown,
        difference: row.salaryComplementDifference,
      },
      { label: "Extrasalarial", period: row.extraSalaryPeriod, breakdown: row.extraSalaryBreakdown, difference: row.extraSalaryDifference },
    ],
    deterministicCause: {
      label: row.status === "OK" ? "Cuadre correcto" : "Diferencia interna Excel",
      description: row.detail || "Cuadre interno entre periodo completo y desglose de conceptos.",
      review: "Revisar el Registro y su desglose interno. Este cuadre no compara contra PDFs.",
    },
  };
}
