import { GeminiAdapter } from "@/lib/assistant/providers/geminiAdapter";
import { OpenAICompatibleAdapter } from "@/lib/assistant/providers/openAiCompatibleAdapter";
import { createPinnedManualFetcher, validateManualEndpointUrl } from "@/lib/assistant/server/manualEndpoint";
import { buildCapabilityMeasurementText } from "@/lib/assistant/server/capabilityPayload";
import {
  PROVIDER_PRESETS,
  ProviderAdapterError,
  type AIProviderAdapter,
  type BehavioralProbeResult,
  type ModelProfileInput,
  type ProviderId,
  type ProviderModel,
} from "@/lib/assistant/providers/types";

export const MODEL_CATALOG_VERSION = "2026-07-13";
const MODEL_CATALOG: Readonly<Record<string, { contextWindow: number; maxOutputTokens?: number }>> = {
  "gemini:gemini-2.5-flash": { contextWindow: 1_048_576, maxOutputTokens: 65_536 },
  "gemini:gemini-2.5-pro": { contextWindow: 1_048_576, maxOutputTokens: 65_536 },
  "openai:gpt-4.1": { contextWindow: 1_047_576, maxOutputTokens: 32_768 },
  "openai:gpt-4.1-mini": { contextWindow: 1_047_576, maxOutputTokens: 32_768 },
};
const OUTPUT_RESERVE = 2_048;
const DEFAULT_MARGIN_PERCENT = 10;

type ServerEnv = Readonly<Record<string, string | undefined>>;
type ResolveAdapter = (provider: ProviderId, baseUrl: string) => AIProviderAdapter;

export interface ModelProbe extends BehavioralProbeResult {
  readonly sufficientContext: boolean;
  readonly requiredContextTokens: number;
  readonly contextWindow?: number;
  readonly contextWindowSource: "provider" | "catalog" | "manual" | "unknown";
  readonly analysisCompatible: boolean;
}

export class ModelServiceInputError extends Error {
  constructor(message = "Configuración de proveedor no válida.") { super(message); this.name = "ModelServiceInputError"; }
}

function defaultResolveAdapter(provider: ProviderId, baseUrl: string): AIProviderAdapter {
  if (provider === "gemini") return new GeminiAdapter();
  return new OpenAICompatibleAdapter({ provider, baseUrl, ...(provider === "manual" ? { fetcher: createPinnedManualFetcher() } : {}) });
}

function baseUrlFor(provider: ProviderId, requested?: string): string {
  const baseUrl = provider === "manual" ? requested : PROVIDER_PRESETS[provider].baseUrl;
  if (provider === "gemini") return "";
  if (!baseUrl) throw new ModelServiceInputError();
  let parsed: URL;
  try { parsed = provider === "manual" ? validateManualEndpointUrl(baseUrl) : new URL(baseUrl); } catch { throw new ModelServiceInputError(); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new ModelServiceInputError("Solo se admiten endpoints HTTPS sin credenciales, consulta ni fragmento en la URL.");
  return baseUrl.replace(/\/+$/, "");
}

function keyFor(provider: ProviderId, requestKey: string | undefined, env: ServerEnv): string {
  const key = provider === "manual" ? requestKey : env[PROVIDER_PRESETS[provider].envName ?? ""];
  if (!key) throw new ModelServiceInputError("El proveedor no tiene una clave disponible.");
  return key;
}

function windowResolution(profile: ModelProfileInput, metadata: ProviderModel, allowManual = true): { window?: number; maxOutputTokens?: number; source: ModelProbe["contextWindowSource"] } {
  if (metadata.contextWindow) return { window: metadata.contextWindow, maxOutputTokens: metadata.maxOutputTokens, source: "provider" };
  const catalog = MODEL_CATALOG[`${profile.provider}:${profile.modelId}`];
  if (catalog) return { window: catalog.contextWindow, maxOutputTokens: catalog.maxOutputTokens, source: "catalog" };
  if (allowManual && profile.manualContextWindow) return { window: profile.manualContextWindow, maxOutputTokens: profile.maxOutputTokens, source: "manual" };
  return { maxOutputTokens: profile.maxOutputTokens, source: "unknown" };
}

export interface ModelService {
  list(input: { provider: ProviderId; baseUrl?: string; apiKey?: string; signal?: AbortSignal }): Promise<{ models: readonly ProviderModel[] }>;
  probe(input: { profile: ModelProfileInput; apiKey?: string; restore?: boolean; signal?: AbortSignal }): Promise<{ profile: ModelProfileInput; probe: ModelProbe }>;
}

export function createModelService(options: { resolveAdapter?: ResolveAdapter; env?: ServerEnv } = {}): ModelService {
  const resolveAdapter = options.resolveAdapter ?? defaultResolveAdapter;
  const env = options.env ?? process.env;

  function dependencies(provider: ProviderId, requestedBaseUrl: string | undefined, requestKey: string | undefined) {
    const baseUrl = baseUrlFor(provider, requestedBaseUrl);
    const apiKey = keyFor(provider, requestKey, env);
    return { adapter: resolveAdapter(provider, baseUrl), apiKey, baseUrl };
  }

  return {
    async list(input) {
      const { adapter, apiKey } = dependencies(input.provider, input.baseUrl, input.apiKey);
      return { models: await adapter.listModels({ apiKey, signal: input.signal }) };
    },
    async probe(input) {
      const { profile } = input;
      const { adapter, apiKey, baseUrl } = dependencies(profile.provider, profile.baseUrl, input.apiKey);
      const behavior = await adapter.probeCapabilities({ apiKey, modelId: profile.modelId, signal: input.signal });
      let metadata: ProviderModel = { id: profile.modelId, displayName: profile.modelId };
      try { metadata = await adapter.getModelMetadata({ apiKey, modelId: profile.modelId, signal: input.signal }); } catch (error) {
        if (error instanceof ProviderAdapterError && error.classification === "auth") throw error;
      }
      const measured = await adapter.countTokens({
        apiKey, modelId: profile.modelId,
        text: buildCapabilityMeasurementText(),
        signal: input.signal,
      });
      const requiredContextTokens = Math.ceil((measured.tokens + OUTPUT_RESERVE) / (1 - DEFAULT_MARGIN_PERCENT / 100));
      const resolved = windowResolution(profile, metadata, !input.restore);
      const sufficientContext = Boolean(resolved.window && resolved.window >= requiredContextTokens && (resolved.maxOutputTokens === undefined || resolved.maxOutputTokens >= OUTPUT_RESERVE));
      const analysisCompatible = behavior.connection && behavior.streaming && behavior.tools && behavior.structuredArguments && behavior.structuredOutput && behavior.cancellation && behavior.sanitizedErrors && sufficientContext;
      const now = new Date().toISOString();
      const updated: ModelProfileInput = {
        ...profile,
        baseUrl,
        generalChatCompatible: behavior.connection && behavior.streaming,
        analysisCompatible,
        supportsStreaming: behavior.streaming,
        supportsTools: behavior.tools && behavior.structuredArguments,
        supportsStructuredOutput: behavior.structuredOutput,
        detectedContextWindow: resolved.source === "provider" || resolved.source === "catalog" ? resolved.window : undefined,
        manualContextWindow: input.restore ? undefined : profile.manualContextWindow,
        maxOutputTokens: resolved.maxOutputTokens,
        capabilitiesSource: "detected",
        verifiedAt: now,
        lastVerificationError: analysisCompatible ? undefined : "El modelo no supera todas las comprobaciones requeridas.",
      };
      return {
        profile: updated,
        probe: { ...behavior, sufficientContext, requiredContextTokens, contextWindow: resolved.window, contextWindowSource: resolved.source, analysisCompatible },
      };
    },
  };
}
