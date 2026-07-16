import { describe, expect, it, vi } from "vitest";
import { createProvidersPostHandler } from "@/lib/assistant/server/providersRoute";
import type { ProviderRuntimeService } from "@/lib/assistant/server/providerRuntime";

const config = { id: "provider-1", providerType: "openai", displayName: "OpenAI", baseUrl: "https://api.openai.com/v1", envVarName: "OPENAI_API_KEY", enabled: true, connectionStatus: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
const service = {
  register: vi.fn().mockResolvedValue({ providerId: "provider-1", keyStatus: "configured" }),
  status: vi.fn(), catalog: vi.fn(), checkCompatibility: vi.fn(), resolve: vi.fn(),
} as unknown as ProviderRuntimeService;

describe("POST /api/assistant/providers", () => {
  it("registers only public configuration", async () => {
    const response = await createProvidersPostHandler(service)(new Request("http://localhost/api/assistant/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "register", config }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providerId: "provider-1", keyStatus: "configured" });
  });

  it("rejects API keys and unknown fields before calling the service", async () => {
    const response = await createProvidersPostHandler(service)(new Request("http://localhost/api/assistant/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "register", config, apiKey: "secret" }) }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
