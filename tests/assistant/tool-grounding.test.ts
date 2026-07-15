import { describe, expect, test } from "vitest";
import { normalizeMoney, verifyToolGrounding } from "@/lib/assistant/toolGrounding";

const source = { id: "source-10048", conversationId: "c1", analysisId: "a1", sourceType: "analysis", sanitizedSourceLabel: "Análisis retributivo · getPersonProfile", availability: "available" as const, conceptIds: [], excerpt: "datos sanitizados", sanitizedHash: "hash-10048" };
const round = {
  executionId: "exec", roundId: "round", calls: [{ executionId: "exec", roundId: "round", requestId: "call-1", name: "getPersonProfile" as const, args: { analysisId: "a1", personId: "10048" }, argsHash: "hash" }],
  results: [{ executionId: "exec", roundId: "round", requestId: "call-1", name: "getPersonProfile" as const, args: { analysisId: "a1", personId: "10048" }, argsHash: "hash", outcome: { ok: true as const, data: { personId: "10048", totals: { registro: 63862.04, payroll: 64070.09, difference: 208.05 } } }, sources: [source] }],
};

describe("tool fact grounding", () => {
  test("normalizes Spanish and international money formats", () => {
    expect(normalizeMoney("63.862,04 €")).toBe(63862.04);
    expect(normalizeMoney("63862.04 EUR")).toBe(63862.04);
    expect(normalizeMoney("63862,04")).toBe(63862.04);
  });

  test("accepts facts backed by the relevant tool result and selects its source", () => {
    const grounded = verifyToolGrounding("La matrícula 10048 presenta 63.862,04 € en Registro, 64.070,09 € en recibos y una diferencia de 208,05 €.", [round]);
    expect(grounded).toMatchObject({ valid: true, usedSources: [source] });
  });

  test("rejects invented figures and external interpretations without requiring secondary fields", () => {
    expect(verifyToolGrounding("La matrícula 10048 tiene una diferencia de 999,99 €.", [round]).valid).toBe(false);
    expect(verifyToolGrounding("La matrícula 10048 podría ser un vehículo.", [round]).valid).toBe(false);
    expect(verifyToolGrounding("La matrícula 10048 tiene una diferencia de 999,99 €.\nLa diferencia real es 208,05 €.", [round]).valid).toBe(false);
  });

  test("does not attach an auxiliary person source just because it shares the matrícula", () => {
    const auxiliary = { ...round, roundId: "round-2", calls: [{ ...round.calls[0]!, roundId: "round-2", requestId: "call-2", name: "getPersonConceptDifferences" as const }], results: [{ ...round.results[0]!, roundId: "round-2", requestId: "call-2", name: "getPersonConceptDifferences" as const, outcome: { ok: true as const, data: { personId: "10048", concepts: [] } }, sources: [{ ...source, id: "source-concepts" }] }] };
    const grounded = verifyToolGrounding("La matrícula 10048 presenta una diferencia de 208,05 €.", [round, auxiliary]);
    expect(grounded.usedSources).toEqual([source]);
  });
});
