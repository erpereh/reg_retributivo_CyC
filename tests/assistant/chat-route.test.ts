import { describe, expect, it, vi } from "vitest";
import { createChatPostHandler } from "@/lib/assistant/server/chatService";
import { assistantStreamEventSchema } from "@/lib/assistant/schemas";
import { canonicalizeToolArguments } from "@/lib/assistant/toolRounds";

function request(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
}
const base = { executionId: "11111111-1111-4111-8111-111111111111", conversationId: "c1", analysisId: "a1", roundId: "r1", roundNumber: 1, modelProfileId: "p1", modelId: "fake-model", responseMode: "strict", contextStrategy: "automatic" } as const;

describe("POST /api/assistant/chat", () => {
  it.each(["plan", "respond", "continue"] as const)("accepts strict %s and emits only validated NDJSON", async (phase) => {
    const execute = vi.fn(async function* () {
      yield { type: "status", roundId: "r1", label: "Procesando" } as const;
      yield { type: "done", roundId: "r1", finishReason: "stop" } as const;
    });
    const canonical = await canonicalizeToolArguments("getPersonProfile", { analysisId: "a1", personId: "10048" });
    const toolRounds = [{ executionId: base.executionId, roundId: "previous-round", calls: [{ executionId: base.executionId, roundId: "previous-round", requestId: "q1", name: "getPersonProfile", args: canonical.args, argsHash: canonical.hash }], results: [{ executionId: base.executionId, roundId: "previous-round", requestId: "q1", name: "getPersonProfile", args: canonical.args, argsHash: canonical.hash, outcome: { ok: true, data: { personId: "10048", workplace: "Centro", position: "Técnico", category: "A1", totals: { registro: 1, payroll: 2, difference: 1 }, blocks: { salary: { registro: 1, payroll: 2, difference: 1 }, salaryComplement: { registro: 0, payroll: 0, difference: 0 }, extraSalary: { registro: 0, payroll: 0, difference: 0 } }, status: "OK", periods: [] } }, sources: [] }] }];
    const body = phase === "plan" ? { ...base, phase, question: "Consulta matrícula 10048", tools: ["getPersonProfile"] }
      : phase === "respond" ? { ...base, phase, question: "Consulta matrícula 10048", toolRounds }
      : { ...base, phase, question: "Consulta matrícula 10048", toolRounds, interruptedMessageId: "m1", continuationContext: "Respuesta parcial sanitizada" };
    const response = await createChatPostHandler({ execute })(request(body));
    expect(response.status).toBe(200);
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.every((line) => assistantStreamEventSchema.safeParse(line).success)).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects unknown fields, unknown phases, wrong rounds and PII before the service", async () => {
    const execute = vi.fn(async function* () { yield { type: "done", roundId: "r1", finishReason: "stop" } as const; });
    const handler = createChatPostHandler({ execute });
    for (const body of [
      { ...base, phase: "plan", question: "Consulta", tools: [], unexpected: true },
      { ...base, phase: "other", question: "Consulta" },
      { ...base, phase: "plan", question: "Consulta", tools: [], roundNumber: 4 },
      { ...base, phase: "plan", question: "persona@example.com", tools: [] },
    ]) expect((await handler(request(body))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects duplicated, missing, or stale execution tool results", async () => {
    const execute = vi.fn(async function* () { yield { type: "done", roundId: "r1", finishReason: "stop" } as const; });
    const canonical = await canonicalizeToolArguments("getAnalysisSummary", { analysisId: "a1" });
    const call = { executionId: base.executionId, roundId: "previous-round", requestId: "q1", name: "getAnalysisSummary" as const, args: canonical.args, argsHash: canonical.hash };
    const result = { ...call, outcome: { ok: true as const, data: null, empty: true as const, message: "Sin datos." }, sources: [] };
    const valid = { ...base, phase: "respond" as const, question: "Resumen", toolRounds: [{ executionId: base.executionId, roundId: "previous-round", calls: [call], results: [result] }] };
    const malformed = [
      { ...valid, toolRounds: [{ ...valid.toolRounds[0]!, results: [result, result] }] },
      { ...valid, toolRounds: [{ ...valid.toolRounds[0]!, results: [] }] },
      { ...valid, toolRounds: [{ ...valid.toolRounds[0]!, executionId: "other-execution", calls: [{ ...call, executionId: "other-execution" }], results: [{ ...result, executionId: "other-execution" }] }] },
    ];
    const handler = createChatPostHandler({ execute });
    for (const body of malformed) expect((await handler(request(body))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("propagates cancellation/deadline and returns a sanitized error event", async () => {
    const execute = vi.fn(async function* (_input: unknown, signal: AbortSignal) {
      await new Promise<void>((_resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
      yield { type: "done", roundId: "r1", finishReason: "stop" } as const;
    });
    const response = await createChatPostHandler({ execute }, { deadlineMs: 5 })(request({ ...base, phase: "plan", question: "Consulta", tools: [] }));
    const events = (await response.text()).trim().split("\n").map((line) => assistantStreamEventSchema.parse(JSON.parse(line)));
    expect(events.at(-1)).toEqual({ type: "error", roundId: "r1", code: "provider_cancelled", classification: "cancelled", message: "La comprobación fue cancelada.", retryable: false });
  });
});
