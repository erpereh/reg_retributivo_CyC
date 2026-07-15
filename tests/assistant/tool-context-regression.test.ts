import { describe, expect, test, vi } from "vitest";
import { GeminiAdapter } from "@/lib/assistant/providers/geminiAdapter";
import { createChatPostHandler, createChatService } from "@/lib/assistant/server/chatService";
import { AssistantOrchestrator } from "@/lib/assistant/orchestration/assistantOrchestrator";
import type { AnalysisToolRegistry } from "@/lib/assistant/tools/registry";
import { canonicalizeToolArguments } from "@/lib/assistant/toolRounds";

const profile = { id: "p1", name: "Gemini", provider: "gemini" as const, baseUrl: "", modelId: "gemini-test", enabled: true, generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true, detectedContextWindow: 1_048_576, capabilitiesSource: "detected", detectedModels: [{ id: "gemini-test", generationModelId: "gemini-test", providerModelName: "models/gemini-test", displayName: "Gemini test", contextWindow: 1_048_576, maxOutputTokens: 65_536 }] };
const source = { id: "source-10048", conversationId: "c1", analysisId: "a1", sourceType: "analysis", sanitizedSourceLabel: "Análisis retributivo · getPersonProfile", availability: "available" as const, conceptIds: [], excerpt: "totales retributivos sanitizados", sanitizedHash: "source-hash" };

function routeTransport(handler: (request: Request) => Promise<Response>) {
  return (body: Record<string, unknown>, signal?: AbortSignal) => handler(new Request("http://local/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }));
}

describe("Gemini analysis tool continuity regression", () => {
  test("preserves the native function call before its response and persists one grounded answer", async () => {
    const nativePart = { thoughtSignature: "safe-native-state", functionCall: { name: "getPersonProfile", args: { analysisId: "a1", personId: "10048" } } };
    const generateContent = vi.fn()
      .mockResolvedValueOnce({ candidates: [{ content: { role: "model", parts: [nativePart] }, finishReason: "STOP" }] })
      .mockResolvedValueOnce({ text: "La matrícula 10048 presenta 63.862,04 € en el Registro Retributivo y 64.070,09 € en los recibos, con una diferencia de 208,05 €.", candidates: [{ finishReason: "STOP" }] });
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models: { list: vi.fn(), get: vi.fn(), countTokens: vi.fn(async () => ({ totalTokens: 1 })), generateContent, generateContentStream: vi.fn() } }) as never });
    const registry = {
      names: ["getPersonProfile"],
      execute: vi.fn(),
      executeEnvelope: vi.fn(async () => ({
        data: { personId: "10048", workplace: "Centro", position: "Técnico", category: "A1", totals: { registro: 63862.04, payroll: 64070.09, difference: 208.05 }, blocks: { salary: { registro: 0, payroll: 0, difference: 0 }, salaryComplement: { registro: 0, payroll: 0, difference: 0 }, extraSalary: { registro: 0, payroll: 0, difference: 0 } }, status: "OK", periods: [] },
        sources: [source],
      })),
    } as unknown as AnalysisToolRegistry;
    const persisted: unknown[] = [];
    const handler = createChatPostHandler(createChatService(async () => ({ adapter, apiKey: "server-key" })));
    const orchestrator = new AssistantOrchestrator({ transport: routeTransport(handler), registry, validateRequestScope: vi.fn(async () => undefined), persistMessage: async (message: unknown) => { persisted.push(message); }, idFactory: () => "11111111-1111-4111-8111-111111111111" });

    const result = await orchestrator.send({ conversationId: "c1", analysisId: "a1", analysisContext: { associatedPersonIds: ["10048"], primaryPersonId: "10048" }, question: "¿Qué puedes decirme de la matrícula 10048?", modelProfileId: "p1", modelId: "gemini-test", profile, responseMode: "strict", contextStrategy: "automatic" });

    const secondRequest = generateContent.mock.calls[1]?.[0] as { contents: unknown[]; config: { systemInstruction?: { parts?: { text?: string }[] } } };
    expect(secondRequest.contents).toEqual(expect.arrayContaining([
      { role: "model", parts: [nativePart] },
      { role: "user", parts: [{ functionResponse: { name: "getPersonProfile", response: { result: expect.objectContaining({ personId: "10048" }) } } }] },
    ]));
    expect(secondRequest.config.systemInstruction?.parts?.[0]?.text).toContain("auditoría retributiva");
    expect(result.text).toContain("10048");
    expect(result.text).toMatch(/63[.\s]?862[,\.]04/);
    expect(result.text).toMatch(/64[.\s]?070[,\.]09/);
    expect(result.text).toMatch(/208[,\.]05/);
    expect(result.text).not.toMatch(/vehículo|país|universidad|aeronave|patente|no dispongo de información/iu);
    expect(result.events).toContainEqual({ type: "source", roundId: expect.any(String), source });
    expect(persisted).toEqual([expect.objectContaining({ status: "completed", content: result.text })]);
  });

  test("uses the frozen principal only for an implicit person request and creates a stable local id", async () => {
    const planTools = vi.fn(async () => ({ toolCalls: [{ name: "getPersonProfile", args: { analysisId: "a1" } }] }));
    const adapter = { countTokens: vi.fn(async () => ({ tokens: 1, estimated: true })), planTools, streamResponse: vi.fn(), listModels: vi.fn(), getModelMetadata: vi.fn(), probeCapabilities: vi.fn() } as never;
    const service = createChatService(async () => ({ adapter, apiKey: "key" }));
    const input = { phase: "plan" as const, executionId: "11111111-1111-4111-8111-111111111111", conversationId: "c1", analysisId: "a1", analysisContext: { associatedPersonIds: ["10048"], primaryPersonId: "10048" }, roundId: "round-1", roundNumber: 1, modelProfileId: "p1", modelId: "gemini-test", profile, responseMode: "strict" as const, contextStrategy: "automatic" as const, question: "¿Qué puedes decirme de esta persona?", tools: ["getPersonProfile"] };
    const events = [];
    for await (const event of service.execute(input, new AbortController().signal)) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_request", requestId: "11111111-1111-4111-8111-111111111111:round-1:tool:1", args: { analysisId: "a1", personId: "10048" } }));

    planTools.mockResolvedValueOnce({ toolCalls: [{ id: "call-explicit", name: "getPersonProfile", args: { analysisId: "a1", personId: "10050" } }] });
    const explicitEvents = [];
    for await (const event of service.execute({ ...input, roundId: "round-2", question: "Consulta la matrícula 10050" }, new AbortController().signal)) explicitEvents.push(event);
    expect(explicitEvents).toContainEqual(expect.objectContaining({ type: "tool_request", requestId: "call-explicit", args: { analysisId: "a1", personId: "10050" } }));
  });

  test("holds a partial tool-call claim until grounding and replaces it after one failed synthesis", async () => {
    const planTools = vi.fn()
      .mockResolvedValueOnce({ text: "La matrícula 10048 tiene una diferencia de 999,99 €.", toolCalls: [{ id: "call-1", name: "getPersonProfile", args: { analysisId: "a1", personId: "10048" } }] })
      .mockResolvedValueOnce({ text: "La matrícula 10048 tiene una diferencia de 208,05 €.", toolCalls: [] });
    const adapter = {
      countTokens: vi.fn(async () => ({ tokens: 1, estimated: true })), planTools,
      async *streamResponse() {
        yield { type: "text_delta" as const, delta: "La matrícula 10048 tiene una diferencia de 208,05 €." };
        yield { type: "done" as const, finishReason: "STOP" };
      },
      listModels: vi.fn(), getModelMetadata: vi.fn(), probeCapabilities: vi.fn(),
    } as never;
    const service = createChatService(async () => ({ adapter, apiKey: "key" }));
    const base = { executionId: "11111111-1111-4111-8111-111111111111", conversationId: "c1", analysisId: "a1", analysisContext: { associatedPersonIds: ["10048"], primaryPersonId: "10048" }, modelProfileId: "p1", modelId: "gemini-test", profile, responseMode: "strict" as const, contextStrategy: "automatic" as const, question: "¿Qué puedes decirme de la matrícula 10048?" };
    const planned = [];
    for await (const event of service.execute({ ...base, phase: "plan", roundId: "round-1", roundNumber: 1, tools: ["getPersonProfile"] }, new AbortController().signal)) planned.push(event);
    expect(planned).toContainEqual(expect.objectContaining({ type: "tool_request", assistantText: "La matrícula 10048 tiene una diferencia de 999,99 €." }));
    expect(planned).not.toContainEqual(expect.objectContaining({ type: "text_delta" }));
    const canonical = await canonicalizeToolArguments("getPersonProfile", { analysisId: "a1", personId: "10048" });
    const toolRound = {
      executionId: base.executionId, roundId: "round-1", text: "La matrícula 10048 tiene una diferencia de 999,99 €.",
      calls: [{ executionId: base.executionId, roundId: "round-1", requestId: "call-1", name: "getPersonProfile" as const, args: canonical.args, argsHash: canonical.hash }],
      results: [{ executionId: base.executionId, roundId: "round-1", requestId: "call-1", name: "getPersonProfile" as const, args: canonical.args, argsHash: canonical.hash, outcome: { ok: true as const, data: { personId: "10048", totals: { registro: 63862.04, payroll: 64070.09, difference: 208.05 }, blocks: { salary: { registro: 0, payroll: 0, difference: 0 }, salaryComplement: { registro: 0, payroll: 0, difference: 0 }, extraSalary: { registro: 0, payroll: 0, difference: 0 } }, status: "OK", periods: [] } }, sources: [source] }],
    };
    const responded = [];
    for await (const event of service.execute({ ...base, phase: "respond", roundId: "round-2", roundNumber: 2, toolRounds: [toolRound] }, new AbortController().signal)) responded.push(event);
    expect(responded).toContainEqual(expect.objectContaining({ type: "status", code: "tool_grounding_retried" }));
    expect(responded.filter((event) => event.type === "text_delta").map((event) => event.delta).join("")).toBe("La matrícula 10048 tiene una diferencia de 208,05 €.");
    expect(responded).toContainEqual(expect.objectContaining({ type: "source", source }));
  });
});
