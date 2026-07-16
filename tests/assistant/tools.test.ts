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
  it("exposes exactly the approved 19-tool allowlist", () => {
    expect(ANALYSIS_TOOL_NAMES).toEqual([
      "getAnalysisSummary", "findPersonByEmployeeId", "searchPeople", "getPersonProfile", "getPersonPayrollPeriods",
      "getPersonConcepts", "getPersonConceptDifferences", "getPersonCuadreReg", "getPersonNormalizedData", "getPersonGroupings", "comparePeople",
      "getTopDifferences", "getDifferencesByCenter", "getDifferencesByPosition", "getDifferencesByConcept", "getPendingConcepts",
      "getDisabledConcepts", "searchDocumentChunks", "getSourceDetails",
    ]);
  });

  it("deduplicates canonical privacy terms repeated across payroll records", () => {
    const scoped = createAnalysisToolRegistry({
      conversation: { id: "conversation-1", type: "analysis", analysisId: "analysis-1" },
      analysis: {
        id: "analysis-1",
        result: {
          people: [{ employeeNumber: "10048", person: " José  Pérez " }],
          payrollRecords: Array.from({ length: 201 }, () => ({ employeeNumber: "10048", workerName: "JOSÉ\u00a0PÉREZ" })),
          registroEmployees: [{ employeeNumber: "10048", workerName: "Jose\u0301 Pe\u0301rez" }],
        },
      },
      chunks: [],
      scopeSnapshot: {
        id: "scope-1", analysisId: "analysis-1", analysisVersion: "v1", strategy: "associated_people",
        associatedPersonIds: ["10048"], explicitPersonIds: [], documentIds: [], allowedTools: ANALYSIS_TOOL_NAMES,
      },
    } as never);

    expect(scoped.privacyBlockedTerms).toEqual(["josé pérez"]);
  });

  it("limits transported privacy terms to associated and explicitly mentioned people", () => {
    const scoped = createAnalysisToolRegistry({
      conversation: { id: "conversation-1", type: "analysis", analysisId: "analysis-1" },
      analysis: {
        id: "analysis-1",
        result: {
          people: [
            { employeeNumber: "100", person: "Ana Asociada" },
            { employeeNumber: "200", person: "Berta Explícita" },
            { employeeNumber: "300", person: "Carla Fuera" },
          ],
          payrollRecords: [{ employeeNumber: "300", workerName: "Carla Fuera" }],
          registroEmployees: [],
        },
      },
      chunks: [],
      scopeSnapshot: {
        id: "scope-1", analysisId: "analysis-1", analysisVersion: "v1", strategy: "associated_people",
        associatedPersonIds: ["100"], explicitPersonIds: ["200"], documentIds: [], allowedTools: ANALYSIS_TOOL_NAMES,
      },
    } as never);

    expect(scoped.privacyBlockedTerms).toEqual(["ana asociada", "berta explícita"]);
  });

  it("transports no privacy terms for associated-people context without authorized people", () => {
    const scoped = createAnalysisToolRegistry({
      conversation: { id: "conversation-1", type: "analysis", analysisId: "analysis-1" },
      analysis: { id: "analysis-1", result }, chunks: [],
      scopeSnapshot: {
        id: "scope-empty", analysisId: "analysis-1", analysisVersion: "v1", strategy: "associated_people",
        associatedPersonIds: [], explicitPersonIds: [], documentIds: [], allowedTools: ANALYSIS_TOOL_NAMES,
      },
    });

    expect(scoped.privacyBlockedTerms).toEqual([]);
  });

  it("keeps every unique canonical privacy term for full analysis", () => {
    const scoped = createAnalysisToolRegistry({
      conversation: { id: "conversation-1", type: "analysis", analysisId: "analysis-1" },
      analysis: {
        id: "analysis-1",
        result: {
          people: Array.from({ length: 201 }, (_, index) => ({ employeeNumber: String(index), person: `Persona ${index}` })),
          payrollRecords: [], registroEmployees: [],
        },
      },
      chunks: [],
      scopeSnapshot: {
        id: "scope-1", analysisId: "analysis-1", analysisVersion: "v1", strategy: "full_analysis",
        associatedPersonIds: [], explicitPersonIds: [], documentIds: [], allowedTools: ANALYSIS_TOOL_NAMES,
      },
    } as never);

    expect(scoped.privacyBlockedTerms).toHaveLength(201);
    expect(scoped.privacyBlockedTerms).toContain("persona 200");
  });

  it("returns a person's complete sanitized payroll and registro concepts", async () => {
    await expect(registry().execute("getPersonConcepts" as AnalysisToolName, { analysisId: "analysis-1", personId: "10048" })).resolves.toEqual({
      personId: "10048",
      concepts: expect.arrayContaining([
        expect.objectContaining({ origin: "registro", concept: "SAL", amount: 100 }),
        expect.objectContaining({ origin: "payroll", concept: "SALARIO", amount: 110, period: "2026-01" }),
      ]),
    });
  });

  it("returns the complete anonymized evidence for matricula 10050 and identifies explicit telework", async () => {
    const teleworkResult = {
      ...result,
      people: [{
        ...person,
        employeeNumber: "10050",
        person: "Persona Confidencial",
        position: "Delegado/a de Compras",
        category: "Oficial de Primera",
        workplace: "Bilbao",
        salaryRegistro: 25_325.28,
        salaryPdf: 25_325.28,
        salaryDifference: 0,
        salaryComplementRegistro: 14_694,
        salaryComplementPdf: 14_694,
        salaryComplementDifference: 0,
        extraSalaryRegistro: 4_740.88,
        extraSalaryPdf: 4_948.88,
        extraSalaryDifference: 208,
        registroTotal: 44_760.16,
        pdfTotal: 44_968.16,
        totalDifference: 208,
        periods: ["2025-01", "2025-02"],
      }],
      registroEmployees: [{
        ...result.registroEmployees[0],
        employeeNumber: "10050",
        workerName: "Persona Confidencial",
        position: "Delegado/a de Compras",
        category: "Oficial de Primera",
        workplace: "Bilbao",
        professionalGroup: "Grupo 3",
        valuation: "Nivel 4",
        family: "Compras",
        personalCategoryGroup: "Administracion",
        concepts: [
          { block: "Salario", blockKey: "salary", code: "SALARIO", amount: 25_325.28 },
          { block: "Extrasalarial", blockKey: "extraSalary", code: "CSP_I_COMP_TELETR_COVID", amount: 0 },
        ],
      }],
      payrollRecords: [
        { sourceFile: "recibo-enero-privado.pdf", periodLabel: "2025-01", workerName: "Persona Confidencial", employeeNumber: "10050", workplace: "Bilbao", professionalGroup: "Grupo 3", concepts: [{ name: "Abono teletrabajo", amount: 104, type: "devengo" }], totalDevengado: 3_700, totalDeducir: 500, netPay: 3_200, irpfBaseAccumulated: 3_700 },
        { sourceFile: "recibo-febrero-privado.pdf", periodLabel: "2025-02", workerName: "Persona Confidencial", employeeNumber: "10050", workplace: "Bilbao", professionalGroup: "Grupo 3", concepts: [{ name: "Abono teletrabajo", amount: 104, type: "devengo" }], totalDevengado: 3_750, totalDeducir: 510, netPay: 3_240, irpfBaseAccumulated: 7_450 },
      ],
      concepts: [{
        employeeNumber: "10050", person: "Persona Confidencial", block: "Extrasalarial", blockKey: "extraSalary",
        registroCode: "CSP_I_COMP_TELETR_COVID", pdfConcept: "Abono teletrabajo", registroAmount: 0, pdfAmount: 208,
        difference: 208, status: "Diferencia", detail: "Concepto presente en recibos y ausente en Registro",
      }],
      internalExcelChecks: [],
      internalExcelNormalizedVariablesChecks: [],
      normalizedVsReal: [],
    } as unknown as AnalysisResult;
    const custom = createAnalysisToolRegistry({ conversation: { id: "c-10050", type: "analysis", analysisId: "analysis-1" }, analysis: { id: "analysis-1", result: teleworkResult }, chunks: [] });

    const evidence = await custom.execute("getPersonProfile", { analysisId: "analysis-1", personId: "10050" }) as Record<string, any>;

    expect(evidence.laborContext).toMatchObject({ position: "Delegado/a de Compras", category: "Oficial de Primera", workplace: "Bilbao", professionalGroup: "Grupo 3", family: "Compras" });
    expect(evidence.registro.concepts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "CSP_I_COMP_TELETR_COVID", amount: 0 })]));
    expect(evidence.payroll.periods).toHaveLength(2);
    expect(evidence.payroll.periods.flatMap((period: any) => period.concepts)).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Abono teletrabajo", amount: 104 })]));
    expect(evidence.comparisons[0]).toMatchObject({ block: "Extrasalarial", registroAmount: 0, payrollAmount: 208, difference: 208, cause: { label: "Teletrabajo", confidence: "alta" } });
    expect(evidence.comparisons[0].cause.facts.join(" ")).toContain("Abono teletrabajo");
    expect(evidence.comparisons[0].cause.missingEvidence.join(" ")).toMatch(/confirmar|document/i);
    const serialized = JSON.stringify(evidence);
    for (const forbidden of ["Persona Confidencial", "recibo-enero-privado.pdf", "sourceFile", "workerName", "raw"]) expect(serialized).not.toContain(forbidden);
  });

  it("creates one deterministic structured person source instead of exposing JSON", async () => {
    const envelope = await registry().executeEnvelope!("getPersonProfile", { analysisId: "analysis-1", personId: "10048" });
    expect(envelope.sources).toHaveLength(1);
    expect(envelope.sources[0]).toMatchObject({
      personId: "10048",
      sourceType: "person_analysis",
      sanitizedSourceLabel: "Evidencia retributiva · matrícula 10048",
      presentation: { kind: "person_analysis", personId: "10048" },
    });
    expect(envelope.sources[0]!.excerpt).not.toMatch(/^\s*[\[{]/);
    expect(envelope.sources[0]!.excerpt).not.toContain("getPersonProfile");
  });

  it("uses medium confidence for an amount-only telework pattern", async () => {
    const amountOnly = { ...result, concepts: [{ ...result.concepts[0], pdfConcept: "Concepto variable", registroCode: "OTRO", registroAmount: 0, pdfAmount: 208, difference: 208, detail: "Diferencia calculada" }] } as AnalysisResult;
    const custom = createAnalysisToolRegistry({ conversation: { id: "c1", type: "analysis", analysisId: "analysis-1" }, analysis: { id: "analysis-1", result: amountOnly }, chunks: [] });
    const evidence = await custom.execute("getPersonProfile", { analysisId: "analysis-1", personId: "10048" }) as Record<string, any>;
    expect(evidence.comparisons[0].cause).toMatchObject({ label: "Teletrabajo", confidence: "media" });
    expect(evidence.comparisons[0].cause.description).toMatch(/no lo documenta expresamente/i);
  });

  it("only exposes anonymous cohort aggregates with at least three people", async () => {
    const cohortPeople = ["10048", "10049", "10050"].map((employeeNumber) => ({ ...person, employeeNumber, person: `Nombre ${employeeNumber}`, position: "Técnico", category: "A1", workplace: "Centro Norte" }));
    const cohortConcepts = cohortPeople.map(({ employeeNumber, person: privateName }) => ({ ...result.concepts[0], employeeNumber, person: privateName }));
    const cohortResult = { ...result, people: cohortPeople, concepts: cohortConcepts } as AnalysisResult;
    const custom = createAnalysisToolRegistry({ conversation: { id: "c1", type: "analysis", analysisId: "analysis-1" }, analysis: { id: "analysis-1", result: cohortResult }, chunks: [] });
    const evidence = await custom.execute("getPersonProfile", { analysisId: "analysis-1", personId: "10048" }) as Record<string, any>;
    expect(evidence.comparisons[0].cohorts).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "puesto", value: "Técnico", peopleCount: 3 }),
      expect.objectContaining({ dimension: "categoria", value: "A1", peopleCount: 3 }),
      expect.objectContaining({ dimension: "centro", value: "Centro Norte", peopleCount: 3 }),
    ]));
    const serialized = JSON.stringify(evidence.comparisons[0].cohorts);
    expect(serialized).not.toMatch(/10048|10049|10050|Nombre/);

    const tooSmall = { ...cohortResult, people: cohortPeople.slice(0, 2), concepts: cohortConcepts.slice(0, 2) } as AnalysisResult;
    const smallRegistry = createAnalysisToolRegistry({ conversation: { id: "c1", type: "analysis", analysisId: "analysis-1" }, analysis: { id: "analysis-1", result: tooSmall }, chunks: [] });
    const smallEvidence = await smallRegistry.execute("getPersonProfile", { analysisId: "analysis-1", personId: "10048" }) as Record<string, any>;
    expect(smallEvidence.comparisons[0].cohorts).toEqual([]);
  });

  it("fails recoverably instead of truncating an exceptionally large person package", async () => {
    const concepts = Array.from({ length: 300 }, (_, index) => ({ name: `Concepto estructurado ${String(index).padStart(3, "0")} ${"x".repeat(180)}`, amount: index, type: "devengo" as const }));
    const hugeResult = { ...result, payrollRecords: Array.from({ length: 12 }, (_, index) => ({ ...result.payrollRecords[0], periodLabel: `2026-${String(index + 1).padStart(2, "0")}`, concepts })) } as AnalysisResult;
    const custom = createAnalysisToolRegistry({ conversation: { id: "c1", type: "analysis", analysisId: "analysis-1" }, analysis: { id: "analysis-1", result: hugeResult }, chunks: [] });
    await expect(custom.execute("getPersonProfile", { analysisId: "analysis-1", personId: "10048" })).rejects.toMatchObject({ code: "person_evidence_too_large", classification: "context" });
  });

  it("rejects general scope, a different analysis and extra input fields", async () => {
    await expect(registry("general").execute("getAnalysisSummary", { analysisId: "analysis-1" })).rejects.toThrow(/conversación/i);
    await expect(registry().execute("getAnalysisSummary", { analysisId: "analysis-2" })).rejects.toThrow(/análisis/i);
    await expect(registry().execute("getPersonProfile", { analysisId: "analysis-1", personId: "10048", name: "Nombre Privado" })).rejects.toThrow();
  });

  it("enforces the immutable associated-people snapshot inside the registry", async () => {
    const scoped = createAnalysisToolRegistry({
      conversation: { id: "conversation-1", type: "analysis", analysisId: "analysis-1" },
      analysis: { id: "analysis-1", result },
      chunks: [],
      scopeSnapshot: {
        id: "scope-1", analysisId: "analysis-1", analysisVersion: "v1", strategy: "associated_people",
        associatedPersonIds: ["10048"], explicitPersonIds: [], documentIds: [], allowedTools: ["getAnalysisSummary", "getPersonProfile"],
      },
    });
    await expect(scoped.execute("getPersonProfile", { analysisId: "analysis-1", personId: "10049" })).rejects.toThrow("person_outside_authorized_scope");
    await expect(scoped.execute("searchPeople", { analysisId: "analysis-1", query: "Centro", limit: 10 })).rejects.toThrow("tool_not_allowed");
  });

  it("keeps Person and Cuadre Reg. parity with shared projections of AnalysisResult", async () => {
    const evidence = await registry().execute("getPersonProfile", { analysisId: "analysis-1", personId: "10048" }) as Record<string, unknown>;
    const { workplace: _workplace, position: _position, category: _category, ...profileFacts } = selectPersonProfile(result, "10048")!;
    expect(evidence).toMatchObject({ ...profileFacts, laborContext: { workplace: "Centro Norte", position: "Técnico", category: "A1" } });
    expect(await registry().execute("getPersonCuadreReg", { analysisId: "analysis-1", personId: "10048" })).toEqual(selectPersonCuadreReg(result, "10048"));
  });

  it("feeds the Persona and Cuadre surfaces and tools from the same literal-safe projections", async () => {
    const personSurface = selectPersonProfileFromRow(result.people[0]);
    expect(personSurface.totals).toEqual({ registro: 125, payroll: 134, difference: 9 });
    const { workplace: _workplace, position: _position, category: _category, ...surfaceFacts } = personSurface;
    await expect(registry().execute("getPersonProfile", { analysisId: "analysis-1", personId: "10048" })).resolves.toMatchObject({ ...surfaceFacts, laborContext: { workplace: "Centro Norte", position: "Técnico", category: "A1" } });
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
    expect(first.sources[0]).toEqual(expect.objectContaining({ availability: "available", excerpt: expect.stringContaining("diferencia 9.00 EUR"), sanitizedHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    const changedResult = { ...result, people: [{ ...result.people[0], totalDifference: 99 }] } as AnalysisResult;
    const changed = createAnalysisToolRegistry({ conversation: { id: "conversation-1", type: "analysis", analysisId: "analysis-1" }, analysis: { id: "analysis-1", result: changedResult }, chunks: [] });
    const changedEnvelope = await changed.executeEnvelope!("getPersonProfile", { analysisId: "analysis-1", personId: "10048" });
    expect(changedEnvelope.sources[0]?.id).not.toBe(first.sources[0]?.id);
    expect(changedEnvelope.sources[0]?.sanitizedHash).not.toBe(first.sources[0]?.sanitizedHash);
    expect(changedEnvelope.sources[0]?.excerpt).toContain("diferencia 99.00 EUR");
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
