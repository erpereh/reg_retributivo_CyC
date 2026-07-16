import { catalogKey, type CatalogCompletion, type ModelCapabilities, type ModelCatalogEntry } from "@/lib/assistant/catalog/domain";

export interface DiscoveredProviderModel {
  readonly id: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly supportedParameters?: readonly string[];
  readonly supportedMethods?: readonly string[];
}

export interface CatalogPage {
  readonly models: readonly DiscoveredProviderModel[];
  readonly nextCursor?: string;
  readonly complete?: boolean;
}

export class CatalogDiscoveryError extends Error {
  constructor(readonly code: "catalog_partial_error" | "catalog_pagination_invalid" | "catalog_empty_suspicious") {
    super(code);
    this.name = "CatalogDiscoveryError";
  }
}

export function inferConservativeCapabilities(model: Pick<DiscoveredProviderModel, "id" | "supportedParameters" | "supportedMethods">): ModelCapabilities {
  const id = model.id.toLowerCase();
  const parameters = new Set((model.supportedParameters ?? []).map((value) => value.toLowerCase()));
  const methods = new Set((model.supportedMethods ?? []).map((value) => value.toLowerCase()));
  const nonChat = /(?:^|[-_.\/])(embed|embedding|whisper|audio|tts|speech|image|dall-e|moderation|rerank)(?:[-_.\/]|$)/.test(id);
  const chat = nonChat ? false : methods.size ? [...methods].some((method) => /generate|chat|completion/.test(method)) : true;
  return {
    chat,
    streaming: !chat ? false : parameters.has("stream") || methods.has("streamgeneratecontent") ? true : "unknown",
    tools: !chat ? false : parameters.has("tools") || parameters.has("tool_choice") || methods.has("functioncalling") ? true : "unknown",
    vision: !chat ? false : parameters.has("images") || parameters.has("vision") ? true : "unknown",
    documents: !chat ? false : parameters.has("files") || parameters.has("documents") ? true : "unknown",
  };
}

function canonicalModelId(id: string): string { return id.replace(/^models\//, ""); }

export async function discoverCompleteCatalog(input: Readonly<{
  providerId: string;
  readPage(cursor: string | undefined, signal: AbortSignal): Promise<CatalogPage>;
  probe?: unknown;
  signal?: AbortSignal;
}>): Promise<Readonly<{ models: readonly ModelCatalogEntry[]; completion: CatalogCompletion }>> {
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) abort(); else input.signal?.addEventListener("abort", abort, { once: true });
  const detected: DiscoveredProviderModel[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let complete = false;
  try {
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      let page: CatalogPage;
      try { page = await input.readPage(cursor, controller.signal); }
      catch (error) {
        if (detected.length) throw new CatalogDiscoveryError("catalog_partial_error");
        throw error;
      }
      detected.push(...page.models);
      if (page.complete || !page.nextCursor) { complete = true; break; }
      if (cursors.has(page.nextCursor)) throw new CatalogDiscoveryError("catalog_pagination_invalid");
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    if (!complete) throw new CatalogDiscoveryError("catalog_pagination_invalid");
    const now = new Date().toISOString();
    const models = detected.map((model): ModelCatalogEntry => {
      const canonical = canonicalModelId(model.id);
      const capabilities = inferConservativeCapabilities(model);
      const officialCapabilities = Boolean(model.supportedParameters?.length || model.supportedMethods?.length);
      return {
        id: catalogKey(input.providerId, canonical),
        providerId: input.providerId,
        canonicalModelId: canonical,
        apiModelId: model.id,
        generationModelId: canonical,
        displayName: model.displayName ?? canonical,
        ...(model.description ? { description: model.description } : {}),
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
        capabilities,
        availability: "available",
        ...(!capabilities.chat ? { incompatibleReason: "Este modelo no es compatible con conversación." } : {}),
        metadataSource: officialCapabilities ? "official" : "pattern",
        detectedAt: now,
      };
    });
    return { models, completion: models.length ? "complete" : "valid_empty" };
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}
