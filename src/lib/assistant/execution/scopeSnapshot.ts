export type AnalysisContextStrategy = "associated_people" | "full_analysis";

export interface ScopeSnapshot {
  readonly id: string;
  readonly analysisId: string;
  readonly analysisVersion: string;
  readonly strategy: AnalysisContextStrategy;
  readonly associatedPersonIds: readonly string[];
  readonly primaryPersonId?: string;
  readonly explicitPersonIds: readonly string[];
  readonly documentIds: readonly string[];
  readonly allowedTools: readonly string[];
}

export interface ScopeSnapshotInput extends Omit<ScopeSnapshot, "id" | "explicitPersonIds"> {
  readonly explicitPersonIds?: readonly string[];
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createScopeSnapshot(input: ScopeSnapshotInput): Promise<ScopeSnapshot> {
  const associatedPersonIds = Object.freeze([...new Set(input.associatedPersonIds)]);
  const explicitPersonIds = Object.freeze([...new Set(input.explicitPersonIds ?? [])]);
  const documentIds = Object.freeze([...new Set(input.documentIds)]);
  const allowedTools = Object.freeze([...new Set(input.allowedTools)]);
  if (input.primaryPersonId && !associatedPersonIds.includes(input.primaryPersonId)) throw new Error("primary_person_outside_scope");
  const body = {
    analysisId: input.analysisId,
    analysisVersion: input.analysisVersion,
    strategy: input.strategy,
    associatedPersonIds,
    ...(input.primaryPersonId ? { primaryPersonId: input.primaryPersonId } : {}),
    explicitPersonIds,
    documentIds,
    allowedTools,
  };
  return Object.freeze({ id: `scope-${await sha256(canonical(body))}`, ...body });
}

const PERSON_TOOLS = new Set([
  "findPersonByEmployeeId", "getPersonProfile", "getPersonPayrollPeriods", "getPersonConcepts", "getPersonConceptDifferences",
  "getPersonCuadreReg", "getPersonNormalizedData", "getPersonGroupings",
]);

export function normalizeScopedToolArguments(snapshot: ScopeSnapshot, toolName: string, input: unknown): Record<string, unknown> {
  const args = input && typeof input === "object" && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  if (!PERSON_TOOLS.has(toolName)) return args;
  if (snapshot.explicitPersonIds.length === 1) args.personId = snapshot.explicitPersonIds[0];
  else if (!args.personId && snapshot.primaryPersonId) args.personId = snapshot.primaryPersonId;
  else if (!args.personId && snapshot.associatedPersonIds.length > 1) throw new Error("person_clarification_required");
  return args;
}

export function assertToolAllowedBySnapshot(snapshot: ScopeSnapshot, toolName: string, input: unknown): void {
  if (!snapshot.allowedTools.includes(toolName)) throw new Error("tool_not_allowed");
  const args = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  if (args.analysisId !== snapshot.analysisId) throw new Error("analysis_scope_mismatch");
  if (snapshot.strategy === "associated_people" && !snapshot.associatedPersonIds.length && toolName !== "getAnalysisSummary") throw new Error("associated_people_required");
  const ids = PERSON_TOOLS.has(toolName) && typeof args.personId === "string"
    ? [args.personId]
    : toolName === "comparePeople" && Array.isArray(args.personIds) ? args.personIds.filter((id): id is string => typeof id === "string") : [];
  if (snapshot.strategy === "associated_people" && ids.some((id) => !snapshot.associatedPersonIds.includes(id))) throw new Error("person_outside_authorized_scope");
  if ((toolName === "searchPeople" || toolName === "searchDocumentChunks") && (typeof args.query !== "string" || args.query.trim().length < 2)) throw new Error("tool_query_too_broad");
  if (typeof args.limit === "number" && args.limit > 20) throw new Error("tool_result_limit_exceeded");
}
