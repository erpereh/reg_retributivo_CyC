import { describe, expect, it, vi } from "vitest";
import { createChatPostHandler, createChatService } from "@/lib/assistant/server/chatService";
import { assistantStreamEventSchema } from "@/lib/assistant/schemas";

function request(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
}
const base = { conversationId: "c1", analysisId: "a1", roundId: "r1", roundNumber: 1, modelProfileId: "p1", modelId: "fake-model", responseMode: "strict", contextStrategy: "automatic" } as const;

describe("POST /api/assistant/chat", () => {
  it("skips tool planning for a general request with no available tools", async () => {
    const planTools = vi.fn();
    const streamResponse = vi.fn(async function* () {
      yield { type: "text_delta", delta: "Hola" } as const;
      yield { type: "done", finishReason: "STOP" } as const;
    });
    const adapter = { countTokens: vi.fn(async () => ({ tokens: 1, estimated: true })), planTools, streamResponse };
    const service = createChatService(async () => ({ adapter: adapter as never, apiKey: "server-only" }));
    const profile = { id: "p1", name: "Gemini", provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com", modelId: "gemini-2.5-flash", enabled: true, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: false, detectedContextWindow: 1_048_576, capabilitiesSource: "detected" as const };
    const events = [];
    for await (const event of service.execute({ ...base, phase: "plan", question: "hola", tools: [], profile }, new AbortController().signal)) events.push(event);
    expect(planTools).not.toHaveBeenCalled();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text_delta", delta: "Hola" }),
      expect.objectContaining({ type: "done", finishReason: "STOP" }),
    ]));
  });

  it("instructs an analysis request to use the available local tool before answering", async () => {
    const planTools = vi.fn(async () => ({ toolCalls: [] }));
    const adapter = { countTokens: vi.fn(async () => ({ tokens: 1, estimated: true })), planTools, streamResponse: vi.fn(async function* () { yield { type: "text_delta", delta: "Respuesta" } as const; yield { type: "done", finishReason: "STOP" } as const; }) };
    const service = createChatService(async () => ({ adapter: adapter as never, apiKey: "server-only" }));
    const profile = { id: "p1", name: "Gemini", provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com", modelId: "gemini-2.5-flash", enabled: true, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: false, detectedContextWindow: 1_048_576, capabilitiesSource: "detected" as const };

    for await (const _ of service.execute({ ...base, phase: "plan", question: "Matrícula 10048", tools: ["getPersonProfile"], profile }, new AbortController().signal)) { /* consume */ }
    expect(planTools).toHaveBeenCalledWith(expect.objectContaining({ tools: [expect.objectContaining({ name: "getPersonProfile", description: expect.stringContaining("ficha retributiva") })], messages: expect.arrayContaining([expect.objectContaining({ role: "system", content: expect.stringContaining("matrícula concreta") })]) }));
  });

  it.each(["plan", "respond", "continue"] as const)("accepts strict %s and emits only validated NDJSON", async (phase) => {
    const execute = vi.fn(async function* () {
      yield { type: "status", roundId: "r1", label: "Procesando" } as const;
      yield { type: "done", roundId: "r1", finishReason: "stop" } as const;
    });
    const body = phase === "plan" ? { ...base, phase, question: "Consulta matrícula 10048", tools: ["getPersonProfile"] }
      : phase === "respond" ? { ...base, phase, question: "Consulta matrícula 10048", toolResults: [{ requestId: "q1", tool: "getPersonProfile", result: { personId: "10048", workplace: "Centro", position: "Técnico", category: "A1", totals: { registro: 1, payroll: 2, difference: 1 }, blocks: { salary: { registro: 1, payroll: 2, difference: 1 }, salaryComplement: { registro: 0, payroll: 0, difference: 0 }, extraSalary: { registro: 0, payroll: 0, difference: 0 } }, status: "OK", periods: [] } }] }
      : { ...base, phase, interruptedMessageId: "m1", continuationContext: "Respuesta parcial sanitizada" };
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

  it("propagates cancellation/deadline and returns a sanitized error event", async () => {
    const execute = vi.fn(async function* (_input: unknown, signal: AbortSignal) {
      await new Promise<void>((resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
      yield { type: "done", roundId: "r1", finishReason: "stop" } as const;
    });
    const response = await createChatPostHandler({ execute }, { deadlineMs: 5 })(request({ ...base, phase: "plan", question: "Consulta", tools: [] }));
    const events = (await response.text()).trim().split("\n").map((line) => assistantStreamEventSchema.parse(JSON.parse(line)));
    expect(events.at(-1)).toEqual({ type: "error", roundId: "r1", code: "provider_cancelled", classification: "cancelled", message: "La comprobación fue cancelada.", retryable: false });
  });
});
