import { discoverCompleteCatalog } from "@/lib/assistant/catalog/discovery";
import { normalizeBaseUrl, type ProviderConfig } from "@/lib/assistant/catalog/domain";
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
  status(providerId: string): Promise<Readonly<{ providerId: string; keyStatus: KeyStatus }>>;
  catalog(providerId: string, signal?: AbortSignal): ReturnType<typeof discoverCompleteCatalog>;
  checkCompatibility(providerId: string, modelId: string, signal?: AbortSignal): Promise<BehavioralProbeResult>;
  resolve(providerId: string): Promise<Readonly<{ config: ProviderConfig; adapter: AIProviderAdapter; apiKey: string }>>;
}

export function createProviderRuntimeService(options: Readonly<{
  env?: ServerEnv;
  production?: boolean;
  allowDevelopmentLocalhost?: boolean;
  resolveAdapter?: (config: ProviderConfig) => AIProviderAdapter;
  clock?: () => number;
}> = {}): ProviderRuntimeService {
  const env = options.env ?? process.env;
  const production = options.production ?? process.env.NODE_ENV === "production";
  const clock = options.clock ?? Date.now;
  const configs = new Map<string, ProviderConfig>();
  const compatibilityCache = new Map<string, { value: BehavioralProbeResult; expiresAt: number }>();
  const compatibilityInFlight = new Map<string, Promise<BehavioralProbeResult>>();
  const adapterFor = options.resolveAdapter ?? ((config: ProviderConfig) => config.providerType === "gemini"
    ? new GeminiAdapter()
    : new OpenAICompatibleAdapter({
        provider: config.providerType === "openai-compatible" ? "manual" : config.providerType,
        baseUrl: config.baseUrl,
        ...(config.providerType === "openai-compatible" ? { fetcher: createPinnedManualFetcher() } : {}),
      }));

  async function validate(config: ProviderConfig): Promise<void> {
    if (config.providerType === "openai-compatible") {
      validateCompatibleEnvName(config.envVarName);
      await resolveCompatibleEndpoint(config.baseUrl, { production, allowDevelopmentLocalhost: options.allowDevelopmentLocalhost });
      return;
    }
    const preset = BUILTINS[config.providerType];
    if (!preset || normalizeBaseUrl(config.baseUrl) !== normalizeBaseUrl(preset.baseUrl) || config.envVarName !== preset.envVarName) throw new Error("provider_not_allowed");
  }

  async function binding(providerId: string): Promise<Readonly<{ config: ProviderConfig; adapter: AIProviderAdapter; apiKey: string }>> {
    const config = configs.get(providerId);
    if (!config || !config.enabled) throw new Error("provider_not_allowed");
    const apiKey = env[config.envVarName];
    if (!apiKey) throw new Error("provider_key_not_configured");
    return { config, adapter: adapterFor(config), apiKey };
  }

  return {
    async register(config) {
      try { await validate(config); }
      catch { return { providerId: config.id, keyStatus: "provider_not_allowed" }; }
      configs.set(config.id, { ...config, baseUrl: normalizeBaseUrl(config.baseUrl) });
      return { providerId: config.id, keyStatus: env[config.envVarName] ? "configured" : "not_configured" };
    },
    async status(providerId) {
      const config = configs.get(providerId);
      if (!config) return { providerId, keyStatus: "provider_not_allowed" };
      return { providerId, keyStatus: env[config.envVarName] ? "configured" : "not_configured" };
    },
    async catalog(providerId, signal) {
      const { adapter, apiKey } = await binding(providerId);
      return discoverCompleteCatalog({
        providerId,
        signal,
        readPage: async (_cursor, pageSignal) => ({ models: await adapter.listModels({ apiKey, signal: pageSignal }), complete: true }),
      });
    },
    async checkCompatibility(providerId, modelId, signal) {
      const key = `${providerId}:${modelId}`;
      const cached = compatibilityCache.get(key);
      if (cached && cached.expiresAt > clock()) return cached.value;
      const existing = compatibilityInFlight.get(key);
      if (existing) return existing;
      const pending = (async () => {
        const { adapter, apiKey } = await binding(providerId);
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
