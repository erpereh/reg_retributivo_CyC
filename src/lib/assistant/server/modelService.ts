import { GeminiAdapter } from "@/lib/assistant/providers/geminiAdapter";
import { OpenAICompatibleAdapter } from "@/lib/assistant/providers/openAiCompatibleAdapter";
import { createPinnedManualFetcher, validateManualEndpointUrl } from "@/lib/assistant/server/manualEndpoint";
import {
  PROVIDER_PRESETS,
  type AIProviderAdapter,
  type ProviderId,
  type ProviderModel,
} from "@/lib/assistant/providers/types";

type ServerEnv = Readonly<Record<string, string | undefined>>;
type ResolveAdapter = (provider: ProviderId, baseUrl: string) => AIProviderAdapter;

export class ModelServiceInputError extends Error {
  constructor(message = "Configuración de proveedor no válida.") { super(message); this.name = "ModelServiceInputError"; }
}

function defaultResolveAdapter(provider: ProviderId, baseUrl: string): AIProviderAdapter {
  if (provider === "gemini") return new GeminiAdapter();
  return new OpenAICompatibleAdapter({ provider, baseUrl, ...(provider === "manual" ? { fetcher: createPinnedManualFetcher() } : {}) });
}

function baseUrlFor(provider: ProviderId, requested?: string): string {
  const baseUrl = provider === "manual" ? requested : PROVIDER_PRESETS[provider].baseUrl;
  if (!baseUrl) throw new ModelServiceInputError();
  let parsed: URL;
  try { parsed = provider === "manual" ? validateManualEndpointUrl(baseUrl) : new URL(baseUrl); } catch { throw new ModelServiceInputError(); }
  if ((provider !== "manual" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.search || parsed.hash) throw new ModelServiceInputError("Solo se admiten endpoints seguros sin credenciales, consulta ni fragmento en la URL.");
  return baseUrl.replace(/\/+$/, "");
}

function keyFor(provider: ProviderId, requestKey: string | undefined, env: ServerEnv): string {
  const key = provider === "manual" ? requestKey : env[PROVIDER_PRESETS[provider].envName ?? ""];
  if (!key) throw new ModelServiceInputError(provider === "manual" ? "Introduce una clave API para el proveedor Manual." : `${PROVIDER_PRESETS[provider].envName} no está configurada.`);
  return key;
}

export interface ModelService {
  list(input: { provider: ProviderId; baseUrl?: string; apiKey?: string; signal?: AbortSignal }): Promise<{ models: readonly ProviderModel[] }>;
  get(input: { provider: ProviderId; modelId: string; baseUrl?: string; apiKey?: string; signal?: AbortSignal }): Promise<{ model: ProviderModel }>;
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
    async get(input) {
      const { adapter, apiKey } = dependencies(input.provider, input.baseUrl, input.apiKey);
      const modelId = input.modelId.replace(/^(?:models\/)+/u, "");
      if (!modelId) throw new ModelServiceInputError("Indica un identificador de modelo válido.");
      const model = await adapter.getModelMetadata({ apiKey, modelId, signal: input.signal });
      const supportsGeneration = (model.supportedMethods ?? []).some((method) => method.replace(/[^a-z0-9]/giu, "").toLocaleLowerCase("en") === "generatecontent");
      if (!supportsGeneration || model.category && model.category !== "chat") throw new ModelServiceInputError("El modelo indicado no admite chat de texto con generateContent.");
      return { model };
    },
  };
}
