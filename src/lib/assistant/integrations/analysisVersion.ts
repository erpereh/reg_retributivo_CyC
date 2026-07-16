import type { AnalysisVersionSnapshot } from "@/lib/assistant/domain";
import { analysisVersionSnapshotSchema } from "@/lib/assistant/schemas";
import type { AssistantRepositories } from "@/lib/assistant/storage/repositories";

const PRIVATE_KEYS = /(?:name|person|file|path|author|metadata|raw|text|source|filename|workername|localdisplay)/i;
const CALCULATION_KEYS = /(?:result|config|tolerance|threshold|exclud|concept|status|amount|total|difference|salary|payroll|registro|employee(?:number|id)|people|period|block|code|included|normalized|summary|checks|group)/i;

function normalize(value: unknown, key = "root", inConfig = false): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("El análisis contiene un número no finito.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => normalize(item, key, inConfig));
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([childKey]) => !PRIVATE_KEYS.test(childKey) && (inConfig || CALCULATION_KEYS.test(childKey)))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([childKey, childValue]) => {
      const normalized = normalize(childValue, childKey, inConfig || /config/i.test(childKey));
      return normalized === undefined ? [] : [[childKey, normalized] as const];
    });
  return Object.fromEntries(entries);
}

export function canonicalizeAnalysis(analysis: unknown): string {
  return JSON.stringify(normalize(analysis));
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAnalysisVersionSnapshot(analysisId: string, analysis: unknown, createdAt: string): Promise<AnalysisVersionSnapshot> {
  const canonical = canonicalizeAnalysis(analysis);
  const analysisVersion = await sha256(canonical);
  return analysisVersionSnapshotSchema.parse({ id: `analysis-version-${analysisId}-${analysisVersion}`, analysisId, analysisVersion, createdAt });
}

export async function syncAnalysisVersion(repositories: AssistantRepositories, analysisId: string, analysis: unknown, createdAt: string) {
  const snapshot = await createAnalysisVersionSnapshot(analysisId, analysis, createdAt);
  const { changed } = await repositories.syncAnalysisVersion({ snapshot, analysisId, updatedAt: createdAt });
  return { snapshot, changed };
}
