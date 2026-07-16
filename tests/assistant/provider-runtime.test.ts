import { describe, expect, it, vi } from "vitest";
import { createProviderRuntimeService } from "@/lib/assistant/server/providerRuntime";
import type { AIProviderAdapter } from "@/lib/assistant/providers/types";
import { providerRuntimeDescriptor, type ProviderConfig } from "@/lib/assistant/catalog/domain";

const config: ProviderConfig = {
  id: "provider-openai", providerType: "openai", displayName: "OpenAI", baseUrl: "https://api.openai.com/v1", envVarName: "OPENAI_API_KEY",
  enabled: true, connectionStatus: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01",
};

function adapter(): AIProviderAdapter {
  return {
    listModels: vi.fn().mockResolvedValue([{ id: "chat-a", displayName: "Chat A", supportedParameters: ["tools"] }]),
    getModelMetadata: vi.fn(), countTokens: vi.fn(), planTools: vi.fn(), streamResponse: vi.fn(),
    probeCapabilities: vi.fn().mockResolvedValue({ connection: true, streaming: true, tools: true, structuredArguments: true, structuredOutput: true, cancellation: true, sanitizedErrors: true }),
  } as unknown as AIProviderAdapter;
}

describe("provider runtime service", () => {
  it("returns generic key states and never returns the key", async () => {
    const service = createProviderRuntimeService({ env: { OPENAI_API_KEY: "super-secret" }, resolveAdapter: () => adapter(), production: true });
    expect(await service.register(config)).toEqual({ providerId: "provider-openai", keyStatus: "configured" });
    expect(JSON.stringify(await service.status(providerRuntimeDescriptor(config)))).not.toContain("super-secret");
  });

  it("refreshes the catalog without invoking inference probes", async () => {
    const current = adapter();
    const service = createProviderRuntimeService({ env: { OPENAI_API_KEY: "x" }, resolveAdapter: () => current, production: true });
    await service.register(config);
    const catalog = await service.catalog(providerRuntimeDescriptor(config));
    expect(catalog.completion).toBe("complete");
    expect(catalog.models[0]).toEqual(expect.objectContaining({ providerId: "provider-openai", canonicalModelId: "chat-a" }));
    expect(current.probeCapabilities).not.toHaveBeenCalled();
  });

  it("runs and caches a minimal compatibility probe only after an explicit request", async () => {
    const current = adapter();
    const service = createProviderRuntimeService({ env: { OPENAI_API_KEY: "x" }, resolveAdapter: () => current, production: true });
    await service.register(config);
    await service.checkCompatibility(providerRuntimeDescriptor(config), "chat-a");
    await service.checkCompatibility(providerRuntimeDescriptor(config), "chat-a");
    expect(current.probeCapabilities).toHaveBeenCalledTimes(1);
  });

  it("resolves a validated provider descriptor without prior in-memory registration", async () => {
    const current = adapter();
    const service = createProviderRuntimeService({ env: { OPENAI_API_KEY: "server-only" }, resolveAdapter: () => current, production: true });

    const binding = await service.resolve(providerRuntimeDescriptor(config));

    expect(binding.provider.providerId).toBe("provider-openai");
    expect(binding.apiKey).toBe("server-only");
  });

  it("rejects manipulated built-in descriptors without reading arbitrary environment variables", async () => {
    const service = createProviderRuntimeService({
      env: { OPENAI_API_KEY: "server-only", DATABASE_URL: "must-not-be-readable" },
      resolveAdapter: () => adapter(),
      production: true,
    });
    const descriptor = providerRuntimeDescriptor(config);

    await expect(service.resolve({ ...descriptor, envVarName: "DATABASE_URL" })).rejects.toThrow("provider_not_allowed");
    await expect(service.resolve({ ...descriptor, baseUrl: "https://example.com/v1" })).rejects.toThrow("provider_not_allowed");
  });
});
