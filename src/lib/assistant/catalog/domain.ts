export type ProviderType = "gemini" | "openai" | "openrouter" | "cerebras" | "groq" | "openai-compatible";
export type ProviderConnectionStatus = "active" | "inactive" | "missing_key" | "error" | "connected";
export type CapabilityState = boolean | "unknown";

export interface ProviderConfig {
  readonly id: string;
  readonly providerType: ProviderType;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly envVarName: string;
  readonly enabled: boolean;
  readonly connectionStatus: ProviderConnectionStatus;
  readonly lastCheckedAt?: string;
  readonly lastCatalogRefreshAt?: string;
  readonly lastCatalogErrorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ModelCapabilities {
  readonly chat: CapabilityState;
  readonly streaming: CapabilityState;
  readonly tools: CapabilityState;
  readonly vision: CapabilityState;
  readonly documents: CapabilityState;
}

export interface ModelCatalogEntry {
  readonly id: string;
  readonly providerId: string;
  readonly canonicalModelId: string;
  readonly apiModelId: string;
  readonly generationModelId: string;
  readonly displayName: string;
  readonly description?: string;
  readonly contextWindow?: number;
  readonly contextWindowEstimated?: boolean;
  readonly maxOutputTokens?: number;
  readonly capabilities: ModelCapabilities;
  readonly availability: "available" | "retired";
  readonly incompatibleReason?: string;
  readonly metadataSource: "official" | "adapter" | "pattern" | "verified";
  readonly compatibilityCheckedAt?: string;
  readonly detectedAt: string;
  readonly favorite?: boolean;
  readonly lastUsedAt?: string;
}

export type CatalogCompletion = "complete" | "valid_empty" | "incomplete_pagination" | "partial_error" | "suspicious_empty";

export function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function catalogKey(providerId: string, canonicalModelId: string): string {
  return `${providerId}:${encodeURIComponent(canonicalModelId)}`;
}

function mergeEntry(previous: ModelCatalogEntry | undefined, fresh: ModelCatalogEntry): ModelCatalogEntry {
  if (!previous) return fresh;
  const verified = previous.metadataSource === "verified" && Boolean(previous.compatibilityCheckedAt);
  return {
    ...fresh,
    ...(verified ? {
      capabilities: previous.capabilities,
      metadataSource: previous.metadataSource,
      compatibilityCheckedAt: previous.compatibilityCheckedAt,
    } : {}),
    ...(previous.favorite === undefined ? {} : { favorite: previous.favorite }),
    ...(previous.lastUsedAt ? { lastUsedAt: previous.lastUsedAt } : {}),
  };
}

export function applyCompleteCatalogRefresh(
  previous: readonly ModelCatalogEntry[],
  detected: readonly ModelCatalogEntry[],
  result: Readonly<{ completion: CatalogCompletion }>,
): ModelCatalogEntry[] {
  if (result.completion !== "complete" && result.completion !== "valid_empty") throw new Error("catalog_refresh_incomplete");
  if (result.completion === "valid_empty" && detected.length) throw new Error("catalog_refresh_invalid_empty");
  const prior = new Map(previous.map((entry) => [entry.id, entry]));
  return detected.map((entry) => mergeEntry(prior.get(entry.id), entry));
}
