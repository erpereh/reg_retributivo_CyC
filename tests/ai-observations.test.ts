import { describe, expect, test, vi } from "vitest";
import type { IssueObservationInput } from "@/lib/ai/observations";

const geminiMocks = vi.hoisted(() => ({
  createGeminiClient: vi.fn(),
}));

vi.mock("@/lib/ai/geminiClient", () => ({
  createGeminiClient: geminiMocks.createGeminiClient,
  getGeminiModel: () => "gemini-3.1-flash-lite",
  isGeminiEnabled: () => true,
}));

describe("AI observations", () => {
  test("uses deterministic observations and skips Gemini when request disables AI", async () => {
    const { generateIssueObservation } = await import("@/lib/ai/observations");
    const input: IssueObservationInput = {
      field: "GT / Grupo de cotizacion",
      shouldBe: "7",
      actual: "5",
      context: "Enero 2025",
      salaryDifference: 30,
      severity: "Alta",
      issueType: "GT / Grupo de cotizacion",
    };

    const result = await generateIssueObservation(input, { enableAI: false });

    expect(geminiMocks.createGeminiClient).not.toHaveBeenCalled();
    expect(result.severity).toBe("Alta");
    expect(result.observations).toContain("no coincide");
  });
});
