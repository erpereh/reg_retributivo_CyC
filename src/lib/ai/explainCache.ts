import { aiExplanationSchema, type AiExplanation, type ExplainPayload, type ExplainRequestType } from "@/lib/ai/explainTypes";

export const AI_EXPLANATION_CACHE_KEY = "retributivo.aiExplanationCache.v1";

interface CacheRecord {
  readonly storedAt: string;
  readonly explanation: AiExplanation;
}

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function readCache(): Record<string, CacheRecord> {
  if (!hasLocalStorage()) {
    return {};
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(AI_EXPLANATION_CACHE_KEY) || "{}") as Record<string, CacheRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CacheRecord>): void {
  if (!hasLocalStorage()) {
    return;
  }

  window.localStorage.setItem(AI_EXPLANATION_CACHE_KEY, JSON.stringify(cache));
}

export function createAiExplanationCacheKey(type: ExplainRequestType, payload: ExplainPayload, analysisId?: string): string {
  return [analysisId || "active", type, payload.rowId, hashString(stableStringify(payload))].join(":");
}

export function readCachedAiExplanation(type: ExplainRequestType, payload: ExplainPayload, analysisId?: string): AiExplanation | undefined {
  const record = readCache()[createAiExplanationCacheKey(type, payload, analysisId)];
  const parsed = aiExplanationSchema.safeParse(record?.explanation);
  return parsed.success ? parsed.data : undefined;
}

export function writeCachedAiExplanation(type: ExplainRequestType, payload: ExplainPayload, explanation: AiExplanation, analysisId?: string): void {
  const cache = readCache();
  cache[createAiExplanationCacheKey(type, payload, analysisId)] = {
    storedAt: new Date().toISOString(),
    explanation,
  };
  writeCache(cache);
}

export function clearAiExplanationCache(): void {
  if (!hasLocalStorage()) {
    return;
  }

  window.localStorage.removeItem(AI_EXPLANATION_CACHE_KEY);
}
