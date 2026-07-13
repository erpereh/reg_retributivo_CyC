import { describe, expect, it } from "vitest";
import { ANALYSIS_TOOL_NAMES, ANALYSIS_TOOL_SCHEMAS, createAnalysisToolRegistry, type AnalysisToolName } from "@/lib/assistant/tools/registry";
import { selectBreakdownProjection, selectNormalizedProjection, selectPersonCuadreReg, selectPersonProfile, selectPersonProfileFromRow } from "@/lib/assistant/tools/sharedSelectors";
import type { AnalysisResult } from "@/lib/types";
import type { SearchIndex } from "@/lib/assistant/search/directIndex";

const person = {
  employeeNumber: "10048",
  person: "Nombre Privado",
  workplace: "Centro Norte",
  position: "Técnico",
  category: "A1",
  salaryRegistro: 100,
  salaryPdf: 110,
  salaryDifference: 10,
  salaryComplementRegistro: 20,
  salaryComplementPdf: 18,
  salaryComplementDifference: -2,
  extraSalaryRegistro: 5,
  extraSalaryPdf: 6,
  extraSalaryDifference: 1,
  registroTotal: 125,
  pdfTotal: 134,
  totalDifference: 9,
  pdfControlTotalDevengado: 134,
  payrollCount: 1,
  unmappedConceptsCount: 0,
  status: "Diferencia",
  detail: "Diferencia calculada",
  periods: ["2026-01"],
  files: ["nomina-secreta.pdf"],
} as const;

const result = {
  summary: { uniquePeople: 1, peopleWithDifferences: 1, totalGlobalDifference: 9 },
  people: [person],
  payrollRecords: [{ employeeNumber: "10048", workerName: "Nombre Privado", sourceFile: "nomina-secreta.pdf", periodLabel: "2026-01", concepts: [{ name: "SALARIO", amount: 110, type: "devengo" }] }],
  registroEmployees: [{ employeeNumber: "10048", workerName: "Nombre Privado", sourceRow: 7, position: "Técnico", category: "A1", workplace: "Centro Norte", professionalGroup: "G1", valuation: "V1", family: "Operaciones", personalCategoryGroup: "Grupo A", normalizedPlusVariables: { salary: 100, salaryComplement: 20, extraSalary: 5, total: 125 }, normalized: { salary: 95, salaryComplement: 18, extraSalary: 5, total: 118 }, periodComplete: { salary: 100, salaryComplement: 20, extraSalary: 5, total: 125 }, lastSituation: { salary: 100, salaryComplement: 20, extraSalary: 5, total: 125 }, nonNormalized: { salaryComplementVariable: 0, extraSalaryVariable: 0, salaryPpe: 0, salaryComplementPpe: 0, salaryIt: 0, salaryComplementIt: 0 }, excelBreakdownDiffs: { salary: 0, salaryComplement: 0, extraSalary: 0 }, concepts: [{ block: "Salario", blockKey: "salary", code: "SAL", amount: 100 }], raw: {} }],
  concepts: [{ employeeNumber: "10048", person: "Nombre Privado", block: "Salario", blockKey: "salary", registroCode: "SAL", pdfConcept: "SALARIO", registroAmount: 100, pdfAmount: 110, difference: 10, status: "Diferencia", detail: "Calculado" }],
  internalExcelChecks: [{ employeeNumber: "10048", workplace: "Centro Norte", position: "Técnico", category: "A1", salaryPeriod: 100, salaryBreakdown: 100, salaryDifference: 0, salaryComplementPeriod: 20, salaryComplementBreakdown: 20, salaryComplementDifference: 0, extraSalaryPeriod: 5, extraSalaryBreakdown: 5, extraSalaryDifference: 0, status: "OK", detail: "Cuadra" }],
  internalExcelNormalizedVariablesChecks: [{ employeeNumber: "10048", person: "Nombre Privado", workplace: "Centro Norte", position: "Técnico", category: "A1", salaryPeriod: 100, salaryNormalizedPlusVariables: 100, salaryDifference: 0, salaryComplementPeriod: 20, salaryComplementNormalizedPlusVariables: 20, salaryComplementDifference: 0, extraSalaryPeriod: 5, extraSalaryNormalizedPlusVariables: 5, extraSalaryDifference: 0, totalPeriod: 125, totalNormalizedPlusVariables: 125, totalDifference: 0, status: "OK", detail: "Cuadra" }],
  normalizedVsReal: [{ employeeNumber: "10048", normalizedPlusVariables: 125, normalized: 118, periodComplete: 125, realPdf: 134, diffPdfVsPeriodComplete: 9, diffPdfVsNormalizedPlusVariables: 9, diffPdfVsNormalized: 16, possibleJustification: "", status: "Diferencia", detail: "Calculado" }],
  groupings: [], unmappedConcepts: [], ignoredConcepts: [], conceptMap: [], excludedEmployeeIdsApplied: [], errors: [], criteria: [],
} as unknown as AnalysisResult;

function registry(type: "analysis" | "general" = "analysis", searchIndex?: SearchIndex) {
  return createAnalysisToolRegistry({
    conversation: type === "analysis" ? { id: "conversation-1", type, analysisId: "analysis-1" } : { id: "conversation-1", type },
    analysis: { id: "analysis-1", result },
    searchIndex,
    chunks: [{ id: "ok-chunk", documentId: "doc-ok", scope: { type: "analysis", analysisId: "analysis-1" }, availability: "available", content: "matrícula 10048 concepto SAL periodo 2026-01", sanitizedHash: "hash-ok" }],
    documents: [
      { id: "doc-ok", scope: { type: "analysis", analysisId: "analysis-1" }, availability: "available", sanitizedSourceLabel: "Registro Retributivo · hoja Datos", sourceType: "xlsx", content: "matrícula 10048 concepto SAL periodo 2026-01", sanitizedHash: "hash-ok" },
      { id: "doc-old", scope: { type: "analysis", analysisId: "analysis-1" }, availability: "historical_unavailable", sanitizedSourceLabel: "Documento histórico", sourceType: "xlsx", content: "matrícula 10048", sanitizedHash: "hash-old" },
      { id: "doc-other", scope: { type: "analysis", analysisId: "analysis-2" }, availability: "available", sanitizedSourceLabel: "Otro análisis", sourceType: "xlsx", content: "matrícula 10048", sanitizedHash: "hash-other" },
    ],
  });
}

describe("assistant analysis tool registry", () => {
  it("exposes exactly the approved 18-tool allowlist", () => {
    expect(ANALYSIS_TOOL_NAMES).toEqual([
      "getAnalysisSummary", "findPersonByEmployeeId", "searchPeople", "getPersonProfile", "getPersonPayrollPeriods",
      "getPersonConceptDifferences", "getPersonCuadreReg", "getPersonNormalizedData", "getPersonGroupings", "comparePeople",
      "getTopDifferences", "getDifferencesByCenter", "getDifferencesByPosition", "getDifferencesByConcept", "getPendingConcepts",
      "getDisabledConcepts", "searchDocumentChunks", "getSourceDetails",
    ]);
  });

  it("rejects general scope, a different analysis and extra input fields", async () => {
    await expect(registry("general").execute("getAnalysisSummary", { analysisId: "analysis-1" })).rejects.toThrow(/conversación/i);
    await expect(registry().execute("getAnalysisSummary", { analysisId: "analysis-2" })).rejects.toThrow(/análisis/i);
    await expect(registry().execute("getPersonProfile", { analysisId: "analysis-1", personId: "10048", name: "Nombre Privado" })).rejects.toThrow();
  });

  it("keeps Person and Cuadre Reg. parity with shared projections of AnalysisResult", async () => {
    expect(await registry().execute("getPersonProfile", { analysisId: "analysis-1", personId: "10048" })).toEqual(selectPersonProfile(result, "10048"));
    expect(await registry().execute("getPersonCuadreReg", { analysisId: "analysis-1", personId: "10048" })).toEqual(selectPersonCuadreReg(result, "10048"));
  });

  it("feeds the Persona and Cuadre surfaces and tools from the same literal-safe projections", async () => {
    const personSurface = selectPersonProfileFromRow(result.people[0]);
    expect(personSurface.totals).toEqual({ registro: 125, payroll: 134, difference: 9 });
    await expect(registry().execute("getPersonProfile", { analysisId: "analysis-1", personId: "10048" })).resolves.toEqual(personSurface);
    const breakdownSurface = selectBreakdownProjection(result.internalExcelChecks[0]);
    const normalizedSurface = selectNormalizedProjection(result.internalExcelNormalizedVariablesChecks![0]);
    expect(breakdownSurface).toMatchObject({ personId: "10048", salaryDifference: 0, salaryComplementDifference: 0, extraSalaryDifference: 0 });
    expect(normalizedSurface).toMatchObject({ personId: "10048", totalDifference: 0 });
    await expect(registry().execute("getPersonCuadreReg", { analysisId: "analysis-1", personId: "10048" })).resolves.toEqual({ personId: "10048", breakdown: breakdownSurface, normalizedVariables: normalizedSurface });
  });

  it("aggregates repeated concept rows once with an independently asserted total", async () => {
    const duplicated = { ...result, concepts: [...result.concepts, { ...result.concepts[0], difference: 5 }] } as AnalysisResult;
    const custom = createAnalysisToolRegistry({ conversation: { id: "c1", type: "analysis", analysisId: "analysis-1" }, analysis: { id: "analysis-1", result: duplicated }, chunks: [] });
    await expect(custom.execute("getDifferencesByConcept", { analysisId: "analysis-1" })).resolves.toEqual({ concepts: [{ registroCode: "SAL", pdfConcept: "SALARIO", difference: 15, status: "Diferencia" }] });
  });

  it("never returns names or original filenames", async () => {
    const output = await registry().execute("getPersonProfile", { analysisId: "analysis-1", personId: "10048" });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain("Nombre Privado");
    expect(serialized).not.toContain("nomina-secreta.pdf");
    expect(serialized).toContain("10048");
  });

  it("binds analytical source identity and hash deterministically to the exact fact payload", async () => {
    const stable = registry();
    const first = await stable.executeEnvelope!("getPersonProfile", { analysisId: "analysis-1", personId: "10048" });
    const repeated = await stable.executeEnvelope!("getPersonProfile", { analysisId: "analysis-1", personId: "10048" });
    expect(repeated.sources).toEqual(first.sources);
    expect(first.sources[0]).toEqual(expect.objectContaining({ availability: "available", excerpt: expect.stringContaining('"difference":9'), sanitizedHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    const changedResult = { ...result, people: [{ ...result.people[0], totalDifference: 99 }] } as AnalysisResult;
    const changed = createAnalysisToolRegistry({ conversation: { id: "conversation-1", type: "analysis", analysisId: "analysis-1" }, analysis: { id: "analysis-1", result: changedResult }, chunks: [] });
    const changedEnvelope = await changed.executeEnvelope!("getPersonProfile", { analysisId: "analysis-1", personId: "10048" });
    expect(changedEnvelope.sources[0]?.id).not.toBe(first.sources[0]?.id);
    expect(changedEnvelope.sources[0]?.sanitizedHash).not.toBe(first.sources[0]?.sanitizedHash);
    expect(changedEnvelope.sources[0]?.excerpt).toContain('"difference":99');
  });

  it("rejects known names in tool arguments before local execution", async () => {
    await expect(registry().execute("searchPeople", { analysisId: "analysis-1", query: "Nombre Privado", limit: 10 })).rejects.toThrow(/nombre|privacidad/i);
    await expect(registry().execute("searchDocumentChunks", { analysisId: "analysis-1", query: "Nombre Privado", limit: 10 })).rejects.toThrow(/nombre|privacidad/i);
  });

  it("searches only available sanitized documents in the scoped analysis", async () => {
    const output = await registry().execute("searchDocumentChunks", { analysisId: "analysis-1", query: "10048", limit: 10 });
    expect(output).toEqual({ matches: [{ sourceId: "doc-ok", chunkId: "ok-chunk", sanitizedSourceLabel: "Registro Retributivo · hoja Datos", sourceType: "xlsx", excerpt: "matrícula 10048 concepto SAL periodo 2026-01", sanitizedHash: "hash-ok" }] });
  });

  it("revalidates a replaceable index against authoritative scope and availability", async () => {
    const searchIndex: SearchIndex = { search: async () => [
      { documentId: "doc-other", chunkId: "other-chunk", sanitizedSourceLabel: "Otro", excerpt: "10048", sanitizedHash: "other", score: 1 },
      { documentId: "doc-old", chunkId: "old-chunk", sanitizedSourceLabel: "Viejo", excerpt: "10048", sanitizedHash: "old", score: 1 },
      { documentId: "doc-ok", chunkId: "ok-chunk", sanitizedSourceLabel: "Etiqueta falsa", excerpt: "extracto falso", sanitizedHash: "hash-falso", score: 1 },
    ] };
    await expect(registry("analysis", searchIndex).execute("searchDocumentChunks", { analysisId: "analysis-1", query: "10048", limit: 10 })).resolves.toEqual({ matches: [{ sourceId: "doc-ok", chunkId: "ok-chunk", sanitizedSourceLabel: "Registro Retributivo · hoja Datos", sourceType: "xlsx", excerpt: "matrícula 10048 concepto SAL periodo 2026-01", sanitizedHash: "hash-ok" }] });
  });

  const matrix: ReadonlyArray<readonly [AnalysisToolName, Record<string, unknown>]> = [
    ["getAnalysisSummary", { analysisId: "analysis-1" }],
    ["findPersonByEmployeeId", { analysisId: "analysis-1", personId: "10048" }],
    ["searchPeople", { analysisId: "analysis-1", query: "10048", limit: 10 }],
    ["getPersonProfile", { analysisId: "analysis-1", personId: "10048" }],
    ["getPersonPayrollPeriods", { analysisId: "analysis-1", personId: "10048" }],
    ["getPersonConceptDifferences", { analysisId: "analysis-1", personId: "10048" }],
    ["getPersonCuadreReg", { analysisId: "analysis-1", personId: "10048" }],
    ["getPersonNormalizedData", { analysisId: "analysis-1", personId: "10048" }],
    ["getPersonGroupings", { analysisId: "analysis-1", personId: "10048" }],
    ["comparePeople", { analysisId: "analysis-1", personIds: ["10048", "10048"] }],
    ["getTopDifferences", { analysisId: "analysis-1", limit: 10 }],
    ["getDifferencesByCenter", { analysisId: "analysis-1" }],
    ["getDifferencesByPosition", { analysisId: "analysis-1" }],
    ["getDifferencesByConcept", { analysisId: "analysis-1" }],
    ["getPendingConcepts", { analysisId: "analysis-1" }],
    ["getDisabledConcepts", { analysisId: "analysis-1" }],
    ["searchDocumentChunks", { analysisId: "analysis-1", query: "10048", limit: 10 }],
    ["getSourceDetails", { analysisId: "analysis-1", sourceId: "doc-ok" }],
  ];

  it.each(matrix)("executes %s with strict validated and recursively safe output", async (name, args) => {
    const value = await registry().execute(name, args);
    expect(ANALYSIS_TOOL_SCHEMAS[name].output.safeParse(value).success).toBe(true);
    expect(JSON.stringify(value)).not.toMatch(/Nombre Privado|nomina-secreta|12345678Z|persona@example\.com/i);
  });

  it.each(matrix)("rejects wrong scope and unknown fields for %s", async (name, args) => {
    await expect(registry().execute(name, { ...args, analysisId: "analysis-2" })).rejects.toThrow(/análisis/i);
    await expect(registry().execute(name, { ...args, unexpected: true })).rejects.toThrow();
  });
});
