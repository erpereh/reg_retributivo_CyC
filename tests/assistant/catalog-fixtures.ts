import { catalogKey, type ProviderType } from "@/lib/assistant/catalog/domain";
import type { ModelProfile } from "@/lib/assistant/domain";
import type { AssistantRepositories } from "@/lib/assistant/storage/repositories";

const ENV_NAMES: Record<ProviderType, string> = {
  gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY",
  cerebras: "CEREBRAS_API_KEY", groq: "GROQ_API_KEY", "openai-compatible": "OPENAI_COMPATIBLE_FIXTURE_API_KEY",
};

export async function seedCatalogFixtures(repositories: AssistantRepositories, profiles: readonly ModelProfile[], createdAt: string) {
  const mappings = new Map<string, { providerId: string; entryId: string; modelId: string }>();
  for (const profile of profiles) {
    await repositories.modelProfiles.put(profile);
    const providerType: ProviderType = profile.provider === "manual" ? "openai-compatible" : profile.provider;
    const providerId = `provider-fixture-${profile.id}`;
    const modelId = profile.modelId.replace(/^models\//, "");
    const entryId = catalogKey(providerId, modelId);
    await repositories.providerConfigs.put({ id: providerId, providerType, displayName: profile.name, baseUrl: profile.baseUrl, envVarName: ENV_NAMES[providerType], enabled: profile.enabled, connectionStatus: "active", createdAt, updatedAt: createdAt });
    await repositories.modelCatalog.put({ id: entryId, providerId, canonicalModelId: modelId, apiModelId: profile.providerModelName ?? profile.modelId, generationModelId: modelId, displayName: profile.name, contextWindow: profile.detectedContextWindow ?? profile.manualContextWindow ?? 8_192, capabilities: { chat: profile.generalChatCompatible, tools: profile.supportsTools, streaming: profile.supportsStreaming, vision: "unknown", documents: "unknown" }, availability: profile.enabled ? "available" : "retired", metadataSource: "official", detectedAt: createdAt });
    mappings.set(profile.id, { providerId, entryId, modelId });
  }
  return mappings;
}
