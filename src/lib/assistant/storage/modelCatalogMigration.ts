import { modelProfileSchema } from "@/lib/assistant/schemas";
import { catalogKey, normalizeBaseUrl, type ModelCatalogEntry, type ProviderConfig, type ProviderType } from "@/lib/assistant/catalog/domain";
import type { ModelProfile } from "@/lib/assistant/domain";

const MIGRATION_ID = "assistant-model-catalog-v5";
const BUILTIN_ENV: Readonly<Record<Exclude<ProviderType, "openai-compatible">, string>> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  groq: "GROQ_API_KEY",
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("migration_read_failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("migration_aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("migration_failed"));
  });
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function providerType(profile: ModelProfile): ProviderType {
  return profile.provider === "manual" ? "openai-compatible" : profile.provider;
}

function providerIdentity(profile: ModelProfile): Readonly<{ key: string; id: string; type: ProviderType; baseUrl: string; envVarName: string }> {
  const type = providerType(profile);
  const baseUrl = normalizeBaseUrl(profile.baseUrl);
  const envVarName = type === "openai-compatible" ? "OPENAI_COMPATIBLE_LEGACY_API_KEY" : BUILTIN_ENV[type];
  const key = `${type}|${baseUrl}|${envVarName}`;
  return { key, id: `provider-${type}-${stableHash(key)}`, type, baseUrl, envVarName };
}

function asProvider(profile: ModelProfile, now: string): ProviderConfig {
  const identity = providerIdentity(profile);
  return {
    id: identity.id,
    providerType: identity.type,
    displayName: identity.type === "openai-compatible" ? profile.name : identity.type,
    baseUrl: identity.baseUrl,
    envVarName: identity.envVarName,
    enabled: profile.enabled,
    connectionStatus: profile.enabled ? "active" : "inactive",
    ...(profile.verifiedAt ? { lastCheckedAt: profile.verifiedAt } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

function asCatalogEntry(profile: ModelProfile, providerId: string, now: string): ModelCatalogEntry {
  const canonicalModelId = profile.modelId.replace(/^models\//, "");
  return {
    id: catalogKey(providerId, canonicalModelId),
    providerId,
    canonicalModelId,
    apiModelId: profile.providerModelName ?? profile.modelId,
    generationModelId: canonicalModelId,
    displayName: profile.name,
    ...(profile.detectedContextWindow ?? profile.manualContextWindow ? { contextWindow: profile.detectedContextWindow ?? profile.manualContextWindow } : {}),
    ...(profile.maxOutputTokens ? { maxOutputTokens: profile.maxOutputTokens } : {}),
    capabilities: {
      chat: profile.generalChatCompatible,
      streaming: profile.supportsStreaming,
      tools: profile.supportsTools,
      vision: "unknown",
      documents: "unknown",
    },
    availability: profile.enabled ? "available" : "retired",
    metadataSource: profile.capabilitiesSource === "detected" ? "official" : "adapter",
    ...(profile.verifiedAt ? { compatibilityCheckedAt: profile.verifiedAt } : {}),
    detectedAt: profile.verifiedAt ?? now,
  };
}

export async function migrateLegacyAssistantModels(db: IDBDatabase): Promise<void> {
  const storeNames = ["modelProfiles", "providerConfigs", "modelCatalog", "modelPreferences", "assistantSettings", "conversations", "messages", "migrations"];
  const transaction = db.transaction(storeNames, "readwrite");
  const done = transactionDone(transaction);
  try {
    const marker = await requestResult(transaction.objectStore("migrations").get(MIGRATION_ID));
    if (marker) { await done; return; }

    const [rawProfiles, conversations, messages, settings] = await Promise.all([
      requestResult(transaction.objectStore("modelProfiles").getAll()),
      requestResult(transaction.objectStore("conversations").getAll()),
      requestResult(transaction.objectStore("messages").getAll()),
      requestResult(transaction.objectStore("assistantSettings").get("assistant-settings")),
    ]);
    const profiles = (rawProfiles as unknown[]).map((raw) => {
      const parsed = modelProfileSchema.safeParse(raw);
      if (!parsed.success) throw new Error("legacy_model_profile_invalid");
      return parsed.data;
    });
    const now = new Date().toISOString();
    const providerByIdentity = new Map<string, ProviderConfig>();
    const profileMapping = new Map<string, Readonly<{ providerId: string; modelId: string }>>();
    const catalog = new Map<string, ModelCatalogEntry>();
    for (const profile of profiles) {
      const identity = providerIdentity(profile);
      if (!providerByIdentity.has(identity.key)) providerByIdentity.set(identity.key, asProvider(profile, now));
      const entry = asCatalogEntry(profile, identity.id, now);
      catalog.set(entry.id, entry);
      profileMapping.set(profile.id, { providerId: identity.id, modelId: entry.canonicalModelId });
    }
    const defaults = settings as { defaultGeneralModelProfileId?: string; defaultAnalysisModelProfileId?: string } | undefined;
    const fallback = profileMapping.get(defaults?.defaultGeneralModelProfileId ?? "") ?? profileMapping.get(defaults?.defaultAnalysisModelProfileId ?? "") ?? profileMapping.values().next().value;
    for (const value of providerByIdentity.values()) transaction.objectStore("providerConfigs").put(value);
    for (const value of catalog.values()) transaction.objectStore("modelCatalog").put(value);
    if (fallback) transaction.objectStore("modelPreferences").put({ id: "model-preferences", favoriteCatalogEntryIds: [], recentCatalogEntryIds: [catalogKey(fallback.providerId, fallback.modelId)], lastCatalogEntryId: catalogKey(fallback.providerId, fallback.modelId), updatedAt: now });
    let missingConversationModelCount = 0;
    let orphanModelReferenceCount = 0;
    for (const raw of conversations as Array<Record<string, unknown>>) {
      const legacyModelId = typeof raw.modelProfileId === "string" ? raw.modelProfileId : undefined;
      const mapped = legacyModelId ? profileMapping.get(legacyModelId) : undefined;
      if (!legacyModelId) missingConversationModelCount += 1;
      else if (!mapped) orphanModelReferenceCount += 1;
      transaction.objectStore("conversations").put({
        ...raw,
        ...(mapped ? { providerId: mapped.providerId, modelId: mapped.modelId } : {}),
        contextStrategy: raw.contextStrategy === "full" ? "full_analysis" : "associated_people",
      });
    }
    for (const raw of messages as Array<Record<string, unknown>>) {
      const mapped = profileMapping.get(String(raw.modelProfileId ?? ""));
      transaction.objectStore("messages").put({ ...raw, ...(mapped ? { providerId: mapped.providerId, modelId: raw.modelId ?? mapped.modelId } : {}) });
    }
    transaction.objectStore("migrations").put({
      id: MIGRATION_ID,
      status: "completed",
      fromVersion: 4,
      toVersion: 5,
      profileCount: profiles.length,
      providerCount: providerByIdentity.size,
      modelCount: catalog.size,
      conversationCount: (conversations as unknown[]).length,
      messageCount: (messages as unknown[]).length,
      missingConversationModelCount,
      orphanModelReferenceCount,
      completedAt: now,
    });
    await done;
  } catch (error) {
    try { transaction.abort(); } catch { /* already inactive */ }
    await done.catch(() => undefined);
    throw error;
  }
}
