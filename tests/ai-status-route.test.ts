import { afterEach, describe, expect, test } from "vitest";

const originalEnv = { ...process.env };

describe("GET /api/ai/status", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("reports API as not configured without GEMINI_API_KEY", async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.ENABLE_AI_REVIEW = "true";
    const { GET } = await import("@/app/api/ai/status/route");

    const response = GET();
    const payload = await response.json();

    expect(payload).toMatchObject({
      configured: false,
      enabled: false,
      model: "gemini-3.1-flash-lite",
    });
  });

  test("reports configured but disabled when env disables review", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.ENABLE_AI_REVIEW = "false";
    const { GET } = await import("@/app/api/ai/status/route");

    const response = GET();
    const payload = await response.json();

    expect(payload).toMatchObject({
      configured: true,
      enabled: false,
      model: "gemini-3.1-flash-lite",
    });
  });
});
