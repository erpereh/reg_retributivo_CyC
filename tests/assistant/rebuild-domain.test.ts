import { describe, expect, it } from "vitest";
import {
  applyCompleteCatalogRefresh,
  catalogKey,
  normalizeBaseUrl,
  type ModelCatalogEntry,
  type ProviderConfig,
} from "@/lib/assistant/catalog/domain";

const provider: ProviderConfig = {
  id: "provider-local-1",
  providerType: "openai-compatible",
  displayName: "Servidor interno",
  baseUrl: "https://models.example.test/v1/",
  envVarName: "OPENAI_COMPATIBLE_INTERNAL_API_KEY",
  enabled: true,
  connectionStatus: "connected",
  createdAt: "2026-07-16T08:00:00.000Z",
  updatedAt: "2026-07-16T08:00:00.000Z",
};

function model(overrides: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry {
  return {
    id: catalogKey(provider.id, "chat/model-a"),
    providerId: provider.id,
    canonicalModelId: "chat/model-a",
    apiModelId: "chat/model-a",
    generationModelId: "chat/model-a",
    displayName: "Model A",
    capabilities: { chat: true, streaming: "unknown", tools: "unknown", vision: false, documents: false },
    availability: "available",
    metadataSource: "official",
    detectedAt: "2026-07-16T08:00:00.000Z",
    ...overrides,
  };
}

describe("assistant provider and catalog domain", () => {
  it("uses stable provider/model identifiers independently from display names", () => {
    expect(normalizeBaseUrl(provider.baseUrl)).toBe("https://models.example.test/v1");
    expect(catalogKey(provider.id, "chat/model-a")).toBe("provider-local-1:chat%2Fmodel-a");
    expect(catalogKey(provider.id, "chat/model-a")).toBe(catalogKey({ ...provider, displayName: "Renamed" }.id, "chat/model-a"));
  });

  it("publishes only complete refreshes and preserves verified capabilities and local preferences", () => {
    const previous = model({
      capabilities: { chat: true, streaming: true, tools: true, vision: false, documents: false },
      metadataSource: "verified",
      compatibilityCheckedAt: "2026-07-16T08:30:00.000Z",
      favorite: true,
      lastUsedAt: "2026-07-16T08:35:00.000Z",
    });
    const refreshed = model({ displayName: "Model A renamed", detectedAt: "2026-07-17T08:00:00.000Z" });

    expect(applyCompleteCatalogRefresh([previous], [refreshed], { completion: "complete" })).toEqual([
      expect.objectContaining({
        displayName: "Model A renamed",
        metadataSource: "verified",
        compatibilityCheckedAt: "2026-07-16T08:30:00.000Z",
        favorite: true,
        lastUsedAt: "2026-07-16T08:35:00.000Z",
        capabilities: expect.objectContaining({ tools: true }),
      }),
    ]);

    expect(() => applyCompleteCatalogRefresh([previous], [refreshed], { completion: "partial_error" })).toThrow("catalog_refresh_incomplete");
    expect(() => applyCompleteCatalogRefresh([previous], [], { completion: "suspicious_empty" })).toThrow("catalog_refresh_incomplete");
  });
});
