import { describe, expect, it } from "vitest";
import { validateCompatibleEnvName, resolveCompatibleEndpoint } from "@/lib/assistant/server/providerSecurity";

describe("OpenAI-compatible provider security", () => {
  it("only permits the reserved API-key namespace", () => {
    expect(validateCompatibleEnvName("OPENAI_COMPATIBLE_INTERNAL_API_KEY")).toBe("OPENAI_COMPATIBLE_INTERNAL_API_KEY");
    for (const value of ["DATABASE_URL", "SESSION_SECRET", "OPENAI_API_KEY", "OPENAI_COMPATIBLE__API_KEY", "OPENAI_COMPATIBLE_X_TOKEN"]) {
      expect(() => validateCompatibleEnvName(value)).toThrow("provider_env_not_allowed");
    }
  });

  it("blocks private destinations in production and allows localhost only by explicit server option", async () => {
    await expect(resolveCompatibleEndpoint("http://127.0.0.1:11434/v1", { production: true })).rejects.toThrow("provider_endpoint_not_allowed");
    await expect(resolveCompatibleEndpoint("http://localhost:11434/v1", { production: false, allowDevelopmentLocalhost: false })).rejects.toThrow("provider_endpoint_not_allowed");
    await expect(resolveCompatibleEndpoint("http://localhost:11434/v1", { production: false, allowDevelopmentLocalhost: true })).resolves.toEqual(expect.objectContaining({ url: expect.objectContaining({ hostname: "localhost" }) }));
  });

  it("rejects embedded credentials, non-http protocols and cloud metadata endpoints", async () => {
    await expect(resolveCompatibleEndpoint("https://user:pass@example.test/v1", { production: true })).rejects.toThrow("provider_endpoint_not_allowed");
    await expect(resolveCompatibleEndpoint("file:///etc/passwd", { production: true })).rejects.toThrow("provider_endpoint_not_allowed");
    await expect(resolveCompatibleEndpoint("http://169.254.169.254/latest/meta-data", { production: true })).rejects.toThrow("provider_endpoint_not_allowed");
  });
});
