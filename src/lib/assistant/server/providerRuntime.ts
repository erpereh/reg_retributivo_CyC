import { discoverCompleteCatalog } from "@/lib/assistant/catalog/discovery";
import { normalizeBaseUrl, providerRuntimeDescriptor, type ProviderConfig, type ProviderRuntimeDescriptor } from "@/lib/assistant/catalog/domain";
import { GeminiAdapter } from "@/lib/assistant/providers/geminiAdapter";
import { OpenAICompatibleAdapter } from "@/lib/assistant/providers/openAiCompatibleAdapter";
import type { AIProviderAdapter, BehavioralProbeResult } from "@/lib/assistant/providers/types";
import { createPinnedManualFetcher } from "@/lib/assistant/server/manualEndpoint";
import { resolveCompatibleEndpoint, validateCompatibleEnvName } from "@/lib/assistant/server/providerSecurity";

type KeyStatus = "configured" | "not_configured" | "provider_not_allowed";
type ServerEnv = Readonly<Record<string, string | undefined>>;

const BUILTINS = {
  gemini: { baseUrl: "https://generativelanguage.googleapis.com", envVarName: "GEMINI_API_KEY" },
  openai: { baseUrl: "https://api.openai.com/v1", envVarName: "OPENAI_API_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", envVarName: "OPENROUTER_API_KEY" },
  cerebras: { baseUrl: "https://api.cerebras.ai/v1", envVarName: "CEREBRAS_API_KEY" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", envVarName: "GROQ_API_KEY" },
} as const;

export interface ProviderRuntimeService {
  register(config: ProviderConfig): Promise<Readonly<{ providerId: string; keyStatus: KeyStatus }>>;
  status(provider: ProviderRuntimeDescriptor): Promise<Readonly<{ providerId: string; keyStatus: KeyStatus }>>;
  catalog(provider: ProviderRuntimeDescriptor, signal?: AbortSignal): ReturnType<typeof discoverCompleteCatalog>;
  checkCompatibility(provider: ProviderRuntimeDescriptor, modelId: string, signal?: AbortSignal): Promise<BehavioralProbeResult>;
  resolve(provider: ProviderRuntimeDescriptor): Promise<Readonly<{ provider: ProviderRuntimeDescriptor; adapter: AIProviderAdapter; apiKey: string }>>;
}

export function createProviderRuntimeService(options: Readonly<{
  env?: ServerEnv;
  production?: boolean;
  allowDevelopmentLocalhost?: boolean;
  resolveAdapter?: (config: ProviderRuntimeDescriptor) => AIProviderAdapter;
  clock?: () => number;
}> = {}): ProviderRuntimeService {
  const env = options.env ?? process.env;
  const production = options.production ?? process.env.NODE_ENV === "production";
  const clock = options.clock ?? Date.now;
  const compatibilityCache = new Map<string, { value: BehavioralProbeResult; expiresAt: number }>();
  const compatibilityInFlight = new Map<string, Promise<BehavioralProbeResult>>();
  const adapterFor = options.resolveAdapter ?? ((config: ProviderRuntimeDescriptor) => config.providerType === "gemini"
    ? new GeminiAdapter()
    : new OpenAICompatibleAdapter({
        provider: config.providerType === "openai-compatible" ? "manual" : config.providerType,
        baseUrl: config.baseUrl,
        ...(config.providerType === "openai-compatible" ? { fetcher: createPinnedManualFetcher() } : {}),
      }));

  async function validate(input: ProviderRuntimeDescriptor): Promise<ProviderRuntimeDescriptor> {
    const provider = { ...input, baseUrl: normalizeBaseUrl(input.baseUrl) };
    if (provider.providerType === "openai-compatible") {
      validateCompatibleEnvName(provider.envVarName);
      await resolveCompatibleEndpoint(provider.baseUrl, { production, allowDevelopmentLocalhost: options.allowDevelopmentLocalhost });
      return provider;
    }
    const preset = BUILTINS[provider.providerType];
    if (!preset || provider.baseUrl !== normalizeBaseUrl(preset.baseUrl) || provider.envVarName !== preset.envVarName) throw new Error("provider_not_allowed");
    return provider;
  }

  async function binding(input: ProviderRuntimeDescriptor): Promise<Readonly<{ provider: ProviderRuntimeDescriptor; adapter: AIProviderAdapter; apiKey: string }>> {
    const provider = await validate(input);
    const apiKey = env[provider.envVarName];
    if (!apiKey) throw new Error("provider_key_not_configured");
    return { provider, adapter: adapterFor(provider), apiKey };
  }

  return {
    async register(config) {
      try { await validate(providerRuntimeDescriptor(config)); }
      catch { return { providerId: config.id, keyStatus: "provider_not_allowed" }; }
      return { providerId: config.id, keyStatus: env[config.envVarName] ? "configured" : "not_configured" };
    },
    async status(provider) {
      try { await validate(provider); }
      catch { return { providerId: provider.providerId, keyStatus: "provider_not_allowed" }; }
      return { providerId: provider.providerId, keyStatus: env[provider.envVarName] ? "configured" : "not_configured" };
    },
    async catalog(provider, signal) {
      const { adapter, apiKey } = await binding(provider);
      return discoverCompleteCatalog({
        providerId: provider.providerId,
        signal,
        readPage: async (_cursor, pageSignal) => ({ models: await adapter.listModels({ apiKey, signal: pageSignal }), complete: true }),
      });
    },
    async checkCompatibility(provider, modelId, signal) {
      const resolved = await binding(provider);
      const key = `${provider.providerId}:${provider.providerType}:${normalizeBaseUrl(provider.baseUrl)}:${provider.envVarName}:${modelId}`;
      const cached = compatibilityCache.get(key);
      if (cached && cached.expiresAt > clock()) return cached.value;
      const existing = compatibilityInFlight.get(key);
      if (existing) return existing;
      const pending = (async () => {
        const { adapter, apiKey } = resolved;
        const value = await adapter.probeCapabilities({ apiKey, modelId, signal });
        compatibilityCache.set(key, { value, expiresAt: clock() + 24 * 60 * 60_000 });
        return value;
      })().finally(() => compatibilityInFlight.delete(key));
      compatibilityInFlight.set(key, pending);
      return pending;
    },
    resolve: binding,
  };
}

export const providerRuntime = createProviderRuntimeService();
