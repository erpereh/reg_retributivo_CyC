import { z } from "zod";
import { assertSafeForProvider } from "@/lib/assistant/privacy/assertions";
import { analysisToolHandlers, type AnalysisToolData, type ScopedChunkRecord, type ScopedDocumentRecord } from "@/lib/assistant/tools/analysisTools";
import { DirectSearchIndex, type SearchIndex } from "@/lib/assistant/search/directIndex";
import type { SourceReference } from "@/lib/assistant/domain";
import { canonicalizePrivacyText } from "@/lib/assistant/privacy/patterns";
import { assertToolAllowedBySnapshot, normalizeScopedToolArguments, type ScopeSnapshot } from "@/lib/assistant/execution/scopeSnapshot";

export const ANALYSIS_TOOL_NAMES = ["getAnalysisSummary", "findPersonByEmployeeId", "searchPeople", "getPersonProfile", "getPersonPayrollPeriods", "getPersonConcepts", "getPersonConceptDifferences", "getPersonCuadreReg", "getPersonNormalizedData", "getPersonGroupings", "comparePeople", "getTopDifferences", "getDifferencesByCenter", "getDifferencesByPosition", "getDifferencesByConcept", "getPendingConcepts", "getDisabledConcepts", "searchDocumentChunks", "getSourceDetails"] as const;
export type AnalysisToolName = typeof ANALYSIS_TOOL_NAMES[number];
const analysisId = z.string().min(1).max(128); const personId = z.string().min(1).max(64);
const scoped = z.object({ analysisId }).strict(); const person = z.object({ analysisId, personId }).strict();
const query = z.object({ analysisId, query: z.string().min(1).max(256), limit: z.number().int().min(1).max(50).default(10) }).strict();
const people = z.object({ analysisId, personIds: z.array(personId).min(2).max(20) }).strict(); const limit = z.object({ analysisId, limit: z.number().int().min(1).max(50).default(10) }).strict();
const source = z.object({ analysisId, sourceId: z.string().min(1).max(128) }).strict();
const status = z.string().min(1).max(64);
const safePerson = z.object({ personId, workplace: z.string().max(256).optional(), position: z.string().max(256).optional(), category: z.string().max(256).optional(), totalDifference: z.number(), status }).strict();
const moneyTriple = z.object({ registro: z.number(), payroll: z.number(), difference: z.number() }).strict();
const summary = z.object({ generatedAt: z.string().optional(), pdfsAnalyzed: z.number().optional(), pdfsFailed: z.number().optional(), uniquePeople: z.number(), peopleWithDifferences: z.number(), totalSalaryDifference: z.number().optional(), totalSalaryComplementDifference: z.number().optional(), totalExtraSalaryDifference: z.number().optional(), totalGlobalDifference: z.number(), peopleWithGrossDifferences: z.number().optional(), peopleWithAdjustedDifferences: z.number().optional(), matchedGrossTotalDifference: z.number().optional(), matchedGrossSalaryDifference: z.number().optional(), matchedGrossSalaryComplementDifference: z.number().optional(), matchedGrossExtraSalaryDifference: z.number().optional(), matchedJustifiedTotalAmount: z.number().optional(), matchedJustifiedSalaryAmount: z.number().optional(), matchedJustifiedSalaryComplementAmount: z.number().optional(), matchedJustifiedExtraSalaryAmount: z.number().optional(), matchedAdjustedTotalDifference: z.number().optional(), matchedAdjustedSalaryDifference: z.number().optional(), matchedAdjustedSalaryComplementDifference: z.number().optional(), matchedAdjustedExtraSalaryDifference: z.number().optional(), peopleOkAdjusted: z.number().optional(), conceptsJustifiedActive: z.number().optional(), conceptsJustifiedApplied: z.number().optional(), matchedPeople: z.number().optional(), matchedTotalDifference: z.number().optional(), matchedSalaryDifference: z.number().optional(), matchedSalaryComplementDifference: z.number().optional(), matchedExtraSalaryDifference: z.number().optional(), peopleInRegistroWithoutPdf: z.number().optional(), peopleInPdfWithoutRegistro: z.number().optional(), totalPdfWithoutRegistro: z.number().optional(), conceptsUnmapped: z.number().optional(), conceptsNotIncluded: z.number().optional(), conceptsIgnored: z.number().optional(), conceptsPendingReview: z.number().optional(), conceptsRealUnmapped: z.number().optional(), pendingReviewAmount: z.number().optional(), pendingDecisionPdfTotal: z.number().optional(), internalExcelDifferences: z.number().optional(), groupingDifferences: z.number().optional(), tolerance: z.number().optional(), aiEnabled: z.boolean().optional(), aiModel: z.string().optional(), reviewThreshold: z.number().optional(), incidentThreshold: z.number().optional() }).strict();
const profile = z.object({ personId, workplace: z.string().optional(), position: z.string().optional(), category: z.string().optional(), totals: moneyTriple, blocks: z.object({ salary: moneyTriple, salaryComplement: moneyTriple, extraSalary: moneyTriple }).strict(), status, periods: z.array(z.string()) }).strict();
const breakdown = z.object({ personId, salaryPeriod: z.number(), salaryBreakdown: z.number(), salaryDifference: z.number(), salaryComplementPeriod: z.number(), salaryComplementBreakdown: z.number(), salaryComplementDifference: z.number(), extraSalaryPeriod: z.number(), extraSalaryBreakdown: z.number(), extraSalaryDifference: z.number(), status }).strict();
const normalizedCuadre = z.object({ personId, salaryPeriod: z.number(), salaryNormalizedPlusVariables: z.number(), salaryDifference: z.number(), salaryComplementPeriod: z.number(), salaryComplementNormalizedPlusVariables: z.number(), salaryComplementDifference: z.number(), extraSalaryPeriod: z.number(), extraSalaryNormalizedPlusVariables: z.number(), extraSalaryDifference: z.number(), totalPeriod: z.number(), totalNormalizedPlusVariables: z.number(), totalDifference: z.number(), status }).strict();
const conceptDifference = z.object({ block: z.string(), blockKey: z.string(), registroCode: z.string(), pdfConcept: z.string().optional(), registroAmount: z.number(), pdfAmount: z.number(), difference: z.number(), status }).strict();
const sourceResult = z.object({ sourceId: z.string(), chunkId: z.string().optional(), sanitizedSourceLabel: z.string(), sourceType: z.string(), excerpt: z.string(), sanitizedHash: z.string(), facets: z.record(z.array(z.string())).optional() }).strict();
const normalizedData = z.object({ personId, normalizedPlusVariables: z.number(), normalized: z.number(), periodComplete: z.number(), realPdf: z.number(), diffPdfVsPeriodComplete: z.number(), diffPdfVsNormalizedPlusVariables: z.number(), diffPdfVsNormalized: z.number(), status }).strict();
const personConcept = z.object({ origin: z.enum(["registro", "payroll"]), concept: z.string(), amount: z.number(), period: z.string().optional(), block: z.string().optional() }).strict();
const inputSchemas: Record<AnalysisToolName, z.ZodTypeAny> = { getAnalysisSummary: scoped, findPersonByEmployeeId: person, searchPeople: query, getPersonProfile: person, getPersonPayrollPeriods: person, getPersonConcepts: person, getPersonConceptDifferences: person, getPersonCuadreReg: person, getPersonNormalizedData: person, getPersonGroupings: person, comparePeople: people, getTopDifferences: limit, getDifferencesByCenter: scoped, getDifferencesByPosition: scoped, getDifferencesByConcept: scoped, getPendingConcepts: scoped, getDisabledConcepts: scoped, searchDocumentChunks: query, getSourceDetails: source };
const outputSchemas: Record<AnalysisToolName, z.ZodTypeAny> = {
  getAnalysisSummary: z.object({ summary }).strict(), findPersonByEmployeeId: z.object({ person: safePerson.optional() }).strict(), searchPeople: z.object({ people: z.array(safePerson) }).strict(), getPersonProfile: profile,
  getPersonPayrollPeriods: z.object({ personId, periods: z.array(z.object({ period: z.string(), totalDevengado: z.number().optional() }).strict()) }).strict(),
  getPersonConcepts: z.object({ personId, concepts: z.array(personConcept).max(500) }).strict(),
  getPersonConceptDifferences: z.object({ personId, concepts: z.array(conceptDifference) }).strict(), getPersonCuadreReg: z.object({ personId, breakdown: breakdown.optional(), normalizedVariables: normalizedCuadre.optional() }).strict(),
  getPersonNormalizedData: z.object({ personId, data: normalizedData.optional() }).strict(), getPersonGroupings: z.object({ personId, groupings: z.object({ position: z.string().optional(), valuation: z.string().optional(), category: z.string().optional(), family: z.string().optional(), personalCategoryGroup: z.string().optional() }).strict().optional() }).strict(),
  comparePeople: z.object({ people: z.array(safePerson) }).strict(), getTopDifferences: z.object({ people: z.array(safePerson) }).strict(),
  getDifferencesByCenter: z.object({ groups: z.array(z.object({ value: z.string(), count: z.number().int().nonnegative(), difference: z.number() }).strict()) }).strict(), getDifferencesByPosition: z.object({ groups: z.array(z.object({ value: z.string(), count: z.number().int().nonnegative(), difference: z.number() }).strict()) }).strict(),
  getDifferencesByConcept: z.object({ concepts: z.array(z.object({ registroCode: z.string(), pdfConcept: z.string().optional(), difference: z.number(), status }).strict()) }).strict(),
  getPendingConcepts: z.object({ concepts: z.array(z.object({ pdfConcept: z.string(), totalDetected: z.number(), peopleCount: z.number(), payrollCount: z.number(), action: z.string() }).strict()) }).strict(),
  getDisabledConcepts: z.object({ concepts: z.array(z.object({ conceptId: z.string(), block: z.string(), blockKey: z.string(), registroCode: z.string().optional(), status: z.string() }).strict()) }).strict(),
  searchDocumentChunks: z.object({ matches: z.array(sourceResult) }).strict(), getSourceDetails: sourceResult.optional(),
};
type ProviderJsonSchema = { readonly type: "object"; readonly properties: Readonly<Record<string, unknown>>; readonly required: readonly string[]; readonly additionalProperties: false };
const stringProperty = { type: "string", minLength: 1, maxLength: 128 } as const;
const providerInputs: Record<AnalysisToolName, ProviderJsonSchema> = Object.fromEntries(ANALYSIS_TOOL_NAMES.map((name) => {
  const properties: Record<string, unknown> = { analysisId: stringProperty };
  const required = ["analysisId"];
  if (["findPersonByEmployeeId", "getPersonProfile", "getPersonPayrollPeriods", "getPersonConcepts", "getPersonConceptDifferences", "getPersonCuadreReg", "getPersonNormalizedData", "getPersonGroupings"].includes(name)) { properties.personId = { type: "string", minLength: 1, maxLength: 64 }; required.push("personId"); }
  if (["searchPeople", "searchDocumentChunks"].includes(name)) { properties.query = { type: "string", minLength: 1, maxLength: 256 }; properties.limit = { type: "integer", minimum: 1, maximum: 50, default: 10 }; required.push("query"); }
  if (name === "comparePeople") { properties.personIds = { type: "array", items: { type: "string", minLength: 1, maxLength: 64 }, minItems: 2, maxItems: 20 }; required.push("personIds"); }
  if (name === "getTopDifferences") properties.limit = { type: "integer", minimum: 1, maximum: 50, default: 10 };
  if (name === "getSourceDetails") { properties.sourceId = stringProperty; required.push("sourceId"); }
  return [name, { type: "object", properties, required, additionalProperties: false }];
})) as unknown as Record<AnalysisToolName, ProviderJsonSchema>;
export const ANALYSIS_TOOL_SCHEMAS = Object.fromEntries(ANALYSIS_TOOL_NAMES.map((name) => [name, { input: inputSchemas[name], output: outputSchemas[name], provider: providerInputs[name] }])) as Record<AnalysisToolName, { input: z.ZodTypeAny; output: z.ZodTypeAny; provider: ProviderJsonSchema }>;
export interface AnalysisToolRegistryContext { readonly conversation: { readonly id: string; readonly type: "general" | "analysis"; readonly analysisId?: string }; readonly analysis: AnalysisToolData; readonly documents?: readonly ScopedDocumentRecord[]; readonly chunks: readonly ScopedChunkRecord[]; readonly searchIndex?: SearchIndex; readonly searchDocuments?: (input: { analysisId: string; query: string; limit: number }) => Promise<readonly { documentId: string; chunkId: string; sanitizedSourceLabel: string; excerpt: string; sanitizedHash: string }[]>; readonly scopeSnapshot?: ScopeSnapshot }
export interface ToolExecutionEnvelope { readonly data: unknown; readonly sources: readonly SourceReference[] }
export interface AnalysisToolRegistry { readonly names: typeof ANALYSIS_TOOL_NAMES; readonly privacyBlockedTerms?: readonly string[]; execute(name: AnalysisToolName, args: unknown): Promise<unknown>; executeEnvelope?(name: AnalysisToolName, args: unknown, requestId?: string): Promise<ToolExecutionEnvelope>; assertSafeOutput?(value: unknown): void }
function assertScope(context: AnalysisToolRegistryContext, requestedAnalysisId: string): void { if (context.conversation.type !== "analysis" || !context.conversation.analysisId) throw new Error("La conversación general no tiene acceso a herramientas de análisis."); if (context.conversation.analysisId !== requestedAnalysisId || context.analysis.id !== requestedAnalysisId) throw new Error("El análisis solicitado no pertenece a la conversación."); }

export function createAnalysisToolRegistry(context: AnalysisToolRegistryContext): AnalysisToolRegistry {
  const allCanonicalNames = canonicalKnownNames(context.analysis);
  const privacyBlockedTerms = canonicalKnownNames(context.analysis, context.scopeSnapshot);
  async function execute(name: AnalysisToolName, args: unknown): Promise<unknown> {
    if (!ANALYSIS_TOOL_NAMES.includes(name)) throw new Error("Herramienta no permitida.");
    const normalized = context.scopeSnapshot ? normalizeScopedToolArguments(context.scopeSnapshot, name, args) : args;
    const parsed = ANALYSIS_TOOL_SCHEMAS[name].input.parse(normalized) as Record<string, unknown> & { analysisId: string }; assertScope(context, parsed.analysisId);
    if (context.scopeSnapshot) assertToolAllowedBySnapshot(context.scopeSnapshot, name, parsed);
    assertNoKnownNames(parsed, allCanonicalNames);
    let value: unknown;
    if (name === "searchDocumentChunks") {
      if (context.searchDocuments) {
        const matches = await context.searchDocuments({ analysisId: parsed.analysisId, query: String(parsed.query), limit: Number(parsed.limit) });
        value = { matches: matches.map((match) => ({ sourceId: match.documentId, chunkId: match.chunkId, sanitizedSourceLabel: match.sanitizedSourceLabel, sourceType: "document", excerpt: match.excerpt, sanitizedHash: match.sanitizedHash })) };
      } else {
      const allowed = new Map((context.documents ?? []).filter((document) => document.scope.type === "analysis" && document.scope.analysisId === parsed.analysisId && document.availability === "available").map((document) => [document.id, document]));
      const authoritativeChunks = (context.chunks ?? []).filter((chunk) => chunk.scope.type === "analysis" && chunk.scope.analysisId === parsed.analysisId && chunk.availability === "available" && allowed.has(chunk.documentId));
      const indexRecords = authoritativeChunks.length ? authoritativeChunks.map((chunk) => { const document = allowed.get(chunk.documentId)!; return { ...chunk, facets: chunk.facets ?? {}, sanitizedSourceLabel: document.sanitizedSourceLabel, sourceType: document.sourceType, excerpt: chunk.content, chunkId: chunk.id }; }) : (context.searchIndex ? [] : [...allowed.values()].map((document) => ({ ...document, documentId: document.id, chunkId: document.id, facets: {} })));
      const searchIndex = context.searchIndex ?? new DirectSearchIndex(indexRecords);
      const matches = await searchIndex.search({ scope: { type: "analysis", analysisId: parsed.analysisId }, query: String(parsed.query), limit: Number(parsed.limit) });
      const chunkMap = new Map(authoritativeChunks.map((chunk) => [chunk.id, chunk]));
      value = { matches: matches.flatMap(({ documentId: sourceId, chunkId }) => { const document = allowed.get(sourceId); const chunk = chunkMap.get(chunkId); if (!document || !chunk || chunk.documentId !== sourceId) return []; return [{ sourceId, chunkId: chunk.id, sanitizedSourceLabel: document.sanitizedSourceLabel, sourceType: document.sourceType, excerpt: chunk.content, sanitizedHash: chunk.sanitizedHash, ...(chunk.facets ? { facets: chunk.facets } : {}) }]; }) };
      }
    } else if (name === "getSourceDetails") {
      const document = (context.documents ?? []).find((candidate) => candidate.id === parsed.sourceId && candidate.scope.type === "analysis" && candidate.scope.analysisId === parsed.analysisId && candidate.availability === "available"); value = document ? { sourceId: document.id, sanitizedSourceLabel: document.sanitizedSourceLabel, sourceType: document.sourceType, excerpt: document.content, sanitizedHash: document.sanitizedHash } : undefined;
    } else { const handler = analysisToolHandlers[name as keyof typeof analysisToolHandlers] as (analysis: AnalysisToolData, input: Record<string, unknown>) => unknown; value = handler(context.analysis, parsed); }
    if (context.scopeSnapshot?.strategy === "associated_people" && name === "searchPeople") {
      const allowed = new Set(context.scopeSnapshot.associatedPersonIds);
      value = { people: (value as { people: Array<{ personId: string }> }).people.filter((person) => allowed.has(person.personId)) };
    }
    const clean = stripUndefined(value);
    const result = ANALYSIS_TOOL_SCHEMAS[name].output.parse(clean); assertNoKnownNames(result, allCanonicalNames); assertSafeForProvider(result); return result;
  }
  return { names: ANALYSIS_TOOL_NAMES, privacyBlockedTerms, execute, assertSafeOutput(value) { assertNoKnownNames(value, allCanonicalNames); assertSafeForProvider(value); }, async executeEnvelope(name, args, requestId = "local") {
    const data = await execute(name, args);
    const parsed = ANALYSIS_TOOL_SCHEMAS[name].input.parse(args) as { analysisId: string };
    const documentMatches = name === "searchDocumentChunks" ? (data as { matches: { sourceId: string; sanitizedSourceLabel: string; sourceType: string; excerpt: string; sanitizedHash: string }[] }).matches : [];
    const sourceIds = documentMatches.map((item) => item.sourceId).concat(name === "getSourceDetails" && data ? [(data as { sourceId: string }).sourceId] : []);
    const documentMap = new Map((context.documents ?? []).map((document) => [document.id, document]));
    const matchMap = new Map(documentMatches.map((match) => [match.sourceId, match]));
    const sources: SourceReference[] = sourceIds.flatMap((sourceId) => { const document = documentMap.get(sourceId); const match = matchMap.get(sourceId); if (!document && !match) return []; return [{ id: `tool-source-${context.conversation.id}-${sourceId}`, conversationId: context.conversation.id, analysisId: parsed.analysisId, documentId: sourceId, sourceType: document?.sourceType ?? match!.sourceType, sanitizedSourceLabel: document?.sanitizedSourceLabel ?? match!.sanitizedSourceLabel, availability: document?.availability ?? "available", conceptIds: [], excerpt: (document?.content ?? match!.excerpt).slice(0, 2_000), sanitizedHash: document?.sanitizedHash ?? match!.sanitizedHash }]; });
    if (!sources.length) {
      const excerpt = canonicalJson(data);
      const factKey = `${name}:${requestId}`;
      const sanitizedHash = await sha256(canonicalJson({ tool: name, requestId, data, factKey }));
      sources.push({ id: `tool-source-${sanitizedHash}`, conversationId: context.conversation.id, analysisId: parsed.analysisId, sourceType: "analysis", sanitizedSourceLabel: `Análisis retributivo · ${name}`, availability: "available", conceptIds: [], excerpt: excerpt.slice(0, 2_000), sanitizedHash });
    }
    assertNoKnownNames(sources, allCanonicalNames); assertSafeForProvider(sources);
    return { data, sources };
  } };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertNoKnownNames(value: unknown, names: readonly string[]): void {
  const strings: string[] = [];
  const visit = (input: unknown): void => { if (typeof input === "string") strings.push(canonicalizePrivacyText(input)); else if (Array.isArray(input)) input.forEach(visit); else if (input && typeof input === "object") Object.values(input).forEach(visit); };
  visit(value);
  if (names.some((name) => strings.some((candidate) => candidate.includes(name)))) throw new Error("Los nombres conocidos no están permitidos en argumentos de herramientas por privacidad.");
}

function canonicalKnownNames(analysis: AnalysisToolData, scopeSnapshot?: ScopeSnapshot): string[] {
  const allowedPersonIds = scopeSnapshot?.strategy === "associated_people"
    ? new Set([...scopeSnapshot.associatedPersonIds, ...scopeSnapshot.explicitPersonIds])
    : undefined;
  const entries = [
    ...analysis.result.people.map((row) => ({ personId: row.employeeNumber, name: row.person })),
    ...analysis.result.payrollRecords.map((row) => ({ personId: row.employeeNumber, name: row.workerName })),
    ...analysis.result.registroEmployees.map((row) => ({ personId: row.employeeNumber, name: row.workerName })),
  ];
  const names = new Set<string>();
  for (const entry of entries) {
    if (allowedPersonIds && (!entry.personId || !allowedPersonIds.has(entry.personId))) continue;
    if (!entry.name?.trim()) continue;
    const canonical = canonicalizePrivacyText(entry.name);
    if (canonical.length > 1) names.add(canonical);
  }
  return [...names];
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, stripUndefined(item)]));
  return value;
}
