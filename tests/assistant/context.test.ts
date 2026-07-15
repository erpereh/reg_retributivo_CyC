import { describe, expect, it } from "vitest";
import { ContextPlanner, responseModeInstructions, type ContextCandidate } from "@/lib/assistant/context/contextPlanner";
import { calculateTokenBudget } from "@/lib/assistant/context/tokenBudget";
import { compactContextPayload } from "@/lib/assistant/context/compaction";

const candidates = ([
  { id: "tool-1", kind: "tool", content: "hecho estructurado", tokens: 40, relevance: 1, sourceId: "s1", sanitizedHash: "h1", factKey: "person:10048:total" },
  { id: "metadata-1", kind: "metadata", content: "matrícula 10048", tokens: 20, relevance: 1, sourceId: "s2", sanitizedHash: "h2", factKey: "person:10048" },
  { id: "lexical-1", kind: "lexical", content: "concepto SAL", tokens: 30, relevance: 0.9, sourceId: "s3", sanitizedHash: "h3", factKey: "concept:SAL" },
  { id: "chunk-equivalent", kind: "chunk", content: "mismo total", tokens: 80, relevance: 1, sourceId: "s4", sanitizedHash: "h4", factKey: "person:10048:total" },
  { id: "chunk-1", kind: "chunk", content: "fragmento relevante", tokens: 50, relevance: 0.8, sourceId: "s5", sanitizedHash: "h5", factKey: "doc:1" },
  { id: "message-low", kind: "message", content: "historial remoto", tokens: 60, relevance: 0.1, sourceId: "s6", sanitizedHash: "h6", factKey: "history:old" },
  { id: "duplicate", kind: "chunk", content: "duplicado", tokens: 20, relevance: 1, sourceId: "s5", sanitizedHash: "h5", factKey: "doc:1" },
] as const).map((candidate) => ({ ...candidate, scope: { type: "analysis" as const, analysisId: "a1" } })) satisfies ContextCandidate[];

describe("context planning, token budget and compaction", () => {
  it("reserves prompt, tool schemas, 2048 output and 10 percent without exceeding the window", () => {
    const budget = calculateTokenBudget({ contextWindow: 10_000, promptTokens: 500, toolSchemaTokens: 500, contextTokens: 5_000 });
    expect(budget.reservedOutputTokens).toBe(2_048);
    expect(budget.safetyMarginTokens).toBe(1_000);
    expect(budget.totalTokens).toBe(9_048);
    expect(budget.exceedsWindow).toBe(false);
    expect(() => calculateTokenBudget({ contextWindow: 3_000, promptTokens: 500, toolSchemaTokens: 500, contextTokens: 1 })).toThrow(/ventana/i);
  });

  it("uses the requested output reservation throughout context planning diagnostics", () => {
    const plan = new ContextPlanner().plan({
      strategy: "automatic",
      candidates: [],
      scope: { type: "analysis", analysisId: "a1" },
      contextWindow: 100_000,
      promptTokens: 200,
      toolSchemaTokens: 300,
      outputTokens: 2_048,
    });

    expect(plan.budget).toMatchObject({
      contextWindow: 100_000,
      promptTokens: 200,
      toolSchemaTokens: 300,
      contextTokens: 0,
      reservedOutputTokens: 2_048,
      safetyMarginTokens: 10_000,
    });
  });

  it("warns at 75 percent and compacts at 85 percent", () => {
    expect(calculateTokenBudget({ contextWindow: 10_000, promptTokens: 500, toolSchemaTokens: 500, contextTokens: 3_500 }).warning).toBe(false);
    expect(calculateTokenBudget({ contextWindow: 10_000, promptTokens: 500, toolSchemaTokens: 500, contextTokens: 4_600 }).warning).toBe(true);
    expect(calculateTokenBudget({ contextWindow: 10_000, promptTokens: 500, toolSchemaTokens: 500, contextTokens: 5_600 }).requiresCompaction).toBe(true);
  });

  it("applies the exact 74/75 warning and 84/85 compaction boundaries", () => {
    const at = (contextTokens: number) => calculateTokenBudget({ contextWindow: 3_387, promptTokens: 0, toolSchemaTokens: 0, contextTokens });
    expect(at(740)).toMatchObject({ warning: false, requiresCompaction: false });
    expect(at(750)).toMatchObject({ warning: true, requiresCompaction: false });
    expect(at(840)).toMatchObject({ warning: true, requiresCompaction: false });
    expect(at(850)).toMatchObject({ warning: true, requiresCompaction: true });
  });

  it.each(["automatic", "full", "optimized"] as const)("plans %s with priority, scope relevance and deterministic dedupe", (strategy) => {
    const plan = new ContextPlanner().plan({ strategy, candidates, scope: { type: "analysis", analysisId: "a1" }, contextWindow: 8_000, promptTokens: 300, toolSchemaTokens: 400 });
    expect(plan.items.slice(0, 3).map((item) => item.kind)).toEqual(["tool", "metadata", "lexical"]);
    expect(plan.items.map((item) => item.id)).not.toContain("chunk-equivalent");
    expect(plan.items.filter((item) => item.sourceId === "s5" && item.sanitizedHash === "h5" && item.factKey === "doc:1")).toHaveLength(1);
    if (strategy === "optimized") expect(plan.items.map((item) => item.id)).not.toContain("message-low");
    expect(plan.budget.exceedsWindow).toBe(false);
  });

  it("full includes every relevant deduplicated item that fits, never unrelated content", () => {
    const plan = new ContextPlanner().plan({ strategy: "full", candidates: [...candidates, { id: "unrelated", kind: "chunk", content: "otro análisis", tokens: 20, relevance: 1, sourceId: "other", sanitizedHash: "other", factKey: "other", scope: { type: "analysis", analysisId: "a2" } }], scope: { type: "analysis", analysisId: "a1" }, contextWindow: 8_000, promptTokens: 300, toolSchemaTokens: 400 });
    expect(plan.items.map((item) => item.id)).not.toContain("unrelated");
    expect(plan.items.map((item) => item.id)).toContain("message-low");
  });

  it("compacts only the outbound payload and preserves full lineage", () => {
    const messages = Object.freeze([{ id: "m1", content: "Confirmado 125", tokens: 100 }, { id: "m2", content: "Decisión mantener", tokens: 100 }]);
    const result = compactContextPayload({ messages, summary: "Resumen sanitizado", decisions: ["mantener"], figures: [125], sourceIds: ["s1"], actionIds: ["a1"], personIds: ["10048"], analysisVersion: "v3", keepRecent: 1 });
    expect(result.payloadMessages).toEqual([{ id: expect.stringMatching(/^snapshot-message-/), content: "Resumen sanitizado", tokens: expect.any(Number) }, messages[1]]);
    expect(result.snapshot).toEqual(expect.objectContaining({ summarizedMessageIds: ["m1"], decisions: ["mantener"], figures: [125], sourceIds: ["s1"], actionIds: ["a1"], personIds: ["10048"], analysisVersion: "v3" }));
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Confirmado 125");
  });

  it("creates collision-resistant snapshot/message ids and rejects invalid keepRecent", () => {
    const input = { messages: [{ id: "m1", content: "Seguro", tokens: 2 }], summary: "Resumen seguro", decisions: [], figures: [], sourceIds: [], actionIds: [], personIds: [], analysisVersion: "v1", keepRecent: 0 } as const;
    const first = compactContextPayload(input); const second = compactContextPayload(input);
    expect(first.snapshot.id).not.toBe(second.snapshot.id);
    expect(first.payloadMessages[0]?.id).not.toBe(second.payloadMessages[0]?.id);
    expect(() => compactContextPayload({ ...input, keepRecent: -1 })).toThrow(/keepRecent/i);
    expect(() => compactContextPayload({ ...input, keepRecent: 2 })).toThrow(/keepRecent/i);
  });

  it("defines strict and flexible semantics and records the actual mode and strategy", () => {
    expect(responseModeInstructions("strict")).toMatch(/solo.*fuentes|falta información/i);
    expect(responseModeInstructions("flexible")).toContain("Confirmado por los datos");
    expect(responseModeInstructions("flexible")).toContain("Posible explicación");
    expect(responseModeInstructions("flexible")).toContain("Información necesaria para verificarlo");
    const plan = new ContextPlanner().plan({ strategy: "automatic", responseMode: "strict", candidates, scope: { type: "analysis", analysisId: "a1" }, contextWindow: 8_000, promptTokens: 300, toolSchemaTokens: 400 });
    expect(plan.actualStrategy).toBe("automatic");
    expect(plan.actualResponseMode).toBe("strict");
  });
});
