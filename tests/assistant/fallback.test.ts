import { describe, expect, it, vi } from "vitest";
import { ProviderAdapterError } from "@/lib/assistant/providers/types";
import { runWithBoundedFallback } from "@/lib/assistant/orchestration/assistantOrchestrator";

const current = { id: "current", modelId: "model-current" };
const fallback = { id: "default", modelId: "model-default" };

describe("bounded assistant fallback and partial output", () => {
  it("allows at most one transient retry then one compatible default switch", async () => {
    const run = vi.fn().mockRejectedValueOnce(new ProviderAdapterError("transient")).mockRejectedValueOnce(new ProviderAdapterError("transient")).mockResolvedValueOnce("ok");
    const result = await runWithBoundedFallback({ current, compatibleDefault: fallback, run });
    expect(result.text).toBe("ok");
    expect(run.mock.calls.map((call) => call[0].id)).toEqual(["current", "current", "default"]);
  });

  it.each(["auth", "privacy", "incompatible", "context", "cancelled"] as const)("does not fallback for %s", async (classification) => {
    const run = vi.fn().mockRejectedValue(new ProviderAdapterError(classification));
    await expect(runWithBoundedFallback({ current, compatibleDefault: fallback, run })).rejects.toMatchObject({ classification });
    expect(run).toHaveBeenCalledOnce();
  });

  it("persists partial text as interrupted and continuation as a new producer-identified message", async () => {
    const persisted: unknown[] = [];
    const run = vi.fn()
      .mockImplementationOnce(async (_profile, emit: (delta: string) => void) => { emit("Parcial"); throw new ProviderAdapterError("transient"); })
      .mockImplementationOnce(async (_profile, emit: (delta: string) => void) => { emit(" continuado"); return " continuado"; });
    const result = await runWithBoundedFallback({ current, compatibleDefault: fallback, run, persistMessage: async (message) => { persisted.push(message); } });
    expect(persisted).toEqual([
      expect.objectContaining({ status: "interrupted", content: "Parcial", modelProfileId: "current", modelId: "model-current" }),
      expect.objectContaining({ status: "completed", content: " continuado", modelProfileId: "current", modelId: "model-current" }),
    ]);
    expect((persisted[0] as { id: string }).id).not.toBe((persisted[1] as { id: string }).id);
    expect(result.text).toBe(" continuado");
  });
});
