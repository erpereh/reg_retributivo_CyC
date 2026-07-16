import type { AnalysisResult, PersonComparisonRow } from "@/lib/types";
import { selectConceptDifferenceGroups, selectPerson, selectPersonCuadreReg, selectPersonDifferenceGroups, selectPersonProfile } from "@/lib/assistant/tools/sharedSelectors";
import type { SearchFacets } from "@/lib/assistant/search/directIndex";
import { buildPersonAnalysisEvidence } from "@/lib/assistant/tools/personEvidence";

export interface ScopedDocumentRecord {
  readonly id: string;
  readonly scope: { readonly type: "analysis"; readonly analysisId: string } | { readonly type: "conversation"; readonly conversationId: string };
  readonly availability: "available" | "historical_unavailable" | "deleted";
  readonly sanitizedSourceLabel: string;
  readonly sourceType: string;
  readonly content: string;
  readonly sanitizedHash: string;
}
export interface ScopedChunkRecord {
  readonly id: string;
  readonly documentId: string;
  readonly scope: ScopedDocumentRecord["scope"];
  readonly availability: ScopedDocumentRecord["availability"];
  readonly content: string;
  readonly sanitizedHash: string;
  readonly facets?: SearchFacets;
}
export interface AnalysisToolData { readonly id: string; readonly result: AnalysisResult }

function requirePerson(result: AnalysisResult, personId: string) {
  const person = selectPerson(result, personId);
  if (!person) throw new Error("No existe una persona con esa matrícula en el análisis.");
  return person;
}
function safePersonRow(row: PersonComparisonRow) {
  return { personId: row.employeeNumber, workplace: row.workplace, position: row.position, category: row.category, totalDifference: row.totalDifference, status: row.status };
}

export const analysisToolHandlers = {
  getAnalysisSummary: (analysis: AnalysisToolData) => ({ summary: analysis.result.summary }),
  findPersonByEmployeeId: (analysis: AnalysisToolData, input: { personId: string }) => ({ person: selectPerson(analysis.result, input.personId) ? safePersonRow(requirePerson(analysis.result, input.personId)) : undefined }),
  searchPeople: (analysis: AnalysisToolData, input: { query: string; limit: number }) => ({ people: analysis.result.people.filter((row) => [row.employeeNumber, row.workplace, row.position, row.category].some((value) => value?.toLocaleLowerCase("es").includes(input.query.toLocaleLowerCase("es")))).slice(0, input.limit).map(safePersonRow) }),
  getPersonProfile: (analysis: AnalysisToolData, input: { personId: string }) => { requirePerson(analysis.result, input.personId); return buildPersonAnalysisEvidence(analysis.result, input.personId); },
  getPersonPayrollPeriods: (analysis: AnalysisToolData, input: { personId: string }) => ({ personId: input.personId, periods: analysis.result.payrollRecords.filter((row) => row.employeeNumber === input.personId).map((row) => ({ period: row.periodLabel, ...(row.totalDevengado === undefined ? {} : { totalDevengado: row.totalDevengado }) })) }),
  getPersonConcepts: (analysis: AnalysisToolData, input: { personId: string }) => {
    requirePerson(analysis.result, input.personId);
    const registro = analysis.result.registroEmployees.filter((row) => row.employeeNumber === input.personId).flatMap((row) => row.concepts.map((concept) => ({ origin: "registro" as const, concept: concept.code, amount: concept.amount, block: concept.block })));
    const payroll = analysis.result.payrollRecords.filter((row) => row.employeeNumber === input.personId).flatMap((row) => row.concepts.map((concept) => ({ origin: "payroll" as const, concept: concept.name, amount: concept.amount, period: row.periodLabel })));
    return { personId: input.personId, concepts: [...registro, ...payroll] };
  },
  getPersonConceptDifferences: (analysis: AnalysisToolData, input: { personId: string }) => ({ personId: input.personId, concepts: analysis.result.concepts.filter((row) => row.employeeNumber === input.personId).map(({ block, blockKey, registroCode, pdfConcept, registroAmount, pdfAmount, difference, status }) => ({ block, blockKey, registroCode, pdfConcept, registroAmount, pdfAmount, difference, status })) }),
  getPersonCuadreReg: (analysis: AnalysisToolData, input: { personId: string }) => selectPersonCuadreReg(analysis.result, input.personId),
  getPersonNormalizedData: (analysis: AnalysisToolData, input: { personId: string }) => { const row = analysis.result.normalizedVsReal.find((candidate) => candidate.employeeNumber === input.personId); return { personId: input.personId, data: row ? { personId: row.employeeNumber, normalizedPlusVariables: row.normalizedPlusVariables, normalized: row.normalized, periodComplete: row.periodComplete, realPdf: row.realPdf, diffPdfVsPeriodComplete: row.diffPdfVsPeriodComplete, diffPdfVsNormalizedPlusVariables: row.diffPdfVsNormalizedPlusVariables, diffPdfVsNormalized: row.diffPdfVsNormalized, status: row.status } : undefined }; },
  getPersonGroupings: (analysis: AnalysisToolData, input: { personId: string }) => { const employee = analysis.result.registroEmployees.find((row) => row.employeeNumber === input.personId); return { personId: input.personId, groupings: employee ? { position: employee.position, valuation: employee.valuation, category: employee.category, family: employee.family, personalCategoryGroup: employee.personalCategoryGroup } : undefined }; },
  comparePeople: (analysis: AnalysisToolData, input: { personIds: string[] }) => ({ people: input.personIds.map((id) => safePersonRow(requirePerson(analysis.result, id))) }),
  getTopDifferences: (analysis: AnalysisToolData, input: { limit: number }) => ({ people: [...analysis.result.people].sort((a, b) => Math.abs(b.totalDifference) - Math.abs(a.totalDifference)).slice(0, input.limit).map(safePersonRow) }),
  getDifferencesByCenter: (analysis: AnalysisToolData) => ({ groups: selectPersonDifferenceGroups(analysis.result, "workplace") }),
  getDifferencesByPosition: (analysis: AnalysisToolData) => ({ groups: selectPersonDifferenceGroups(analysis.result, "position") }),
  getDifferencesByConcept: (analysis: AnalysisToolData) => ({ concepts: selectConceptDifferenceGroups(analysis.result) }),
  getPendingConcepts: (analysis: AnalysisToolData) => ({ concepts: analysis.result.unmappedConcepts.filter((row) => row.action === "Pendiente revisión" || row.decisionType === "Pendiente revision").map(({ pdfConcept, totalDetected, peopleCount, payrollCount, action }) => ({ pdfConcept, totalDetected, peopleCount, payrollCount, action })) }),
  getDisabledConcepts: (analysis: AnalysisToolData) => ({ concepts: analysis.result.conceptMap.filter((row) => row.active === false).map(({ normalizedPdfConcept, block, blockKey, registroCode, status }) => ({ conceptId: normalizedPdfConcept, block, blockKey, registroCode, status })) }),
};
