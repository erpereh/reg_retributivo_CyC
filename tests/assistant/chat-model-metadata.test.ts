import { describe, expect, test, vi } from "vitest";
import type { AIProviderAdapter } from "@/lib/assistant/providers/types";
import { ProviderAdapterError, providerErrorFromStatus } from "@/lib/assistant/providers/types";
import { createChatPostHandler, createChatService } from "@/lib/assistant/server/chatService";

const profile = {
  id: "p1",
  name: "Gemini",
  provider: "gemini",
  baseUrl: "https://generativelanguage.googleapis.com",
  modelId: "gemini-flash",
  enabled: true,
  generalChatCompatible: true,
  analysisCompatible: true,
  supportsStreaming: true,
  supportsTools: true,
  supportsStructuredOutput: true,
  capabilitiesSource: "detected",
  maxOutputTokens: 2_048,
  detectedModels: [{
    id: "gemini-flash",
    providerModelName: "models/gemini-flash",
    generationModelId: "gemini-flash-generation",
    displayName: "Gemini Flash",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportedMethods: ["generateContent"],
  }],
} as const;

const body = {
  phase: "plan",
  executionId: "11111111-1111-4111-8111-111111111111",
  conversationId: "c1",
  analysisId: "a1",
  roundId: "r1",
  roundNumber: 1,
  modelProfileId: "p1",
  modelId: "gemini-flash",
  profile,
  responseMode: "strict",
  contextStrategy: "automatic",
  question: "hola",
  tools: [],
} as const;

async function events(response: Response) {
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("chat model metadata", () => {
  test("uses one requested output limit for analysis planning and generation", async () => {
    const adapter = {
      listModels: vi.fn(),
      getModelMetadata: vi.fn(),
      countTokens: vi.fn(async () => ({ tokens: 1, estimated: false })),
      probeCapabilities: vi.fn(),
      planTools: vi.fn(async () => ({ toolCalls: [] })),
      streamResponse: vi.fn(async function* () {
        yield { type: "text_delta", delta: "Hola" } as const;
        yield { type: "done", finishReason: "STOP" } as const;
      }),
    } as unknown as AIProviderAdapter;

    const result = await events(await createChatPostHandler(createChatService(async () => ({ adapter, apiKey: "key" })))(new Request("http://local/chat", { method: "POST", body: JSON.stringify(body) })));

    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text_delta", delta: "Hola" }), expect.objectContaining({ type: "done", finishReason: "STOP" })]));
    expect(result).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "error" })]));
    expect(vi.mocked(adapter.planTools)).toHaveBeenCalledWith(expect.objectContaining({ modelId: "gemini-flash-generation", maxOutputTokens: 2_048 }));
    expect(vi.mocked(adapter.streamResponse)).toHaveBeenCalledWith(expect.objectContaining({ modelId: "gemini-flash-generation", maxOutputTokens: 2_048 }));
    expect(vi.mocked(adapter.countTokens).mock.calls.every(([request]) => request.modelId === "gemini-flash-generation")).toBe(true);
  });

  test("publishes specific context messages without leaking provider details", async () => {
    const unknownWindow = { ...profile, detectedModels: [], detectedContextWindow: undefined, manualContextWindow: undefined };
    const adapter = { countTokens: vi.fn(async () => ({ tokens: 1, estimated: false })) } as unknown as AIProviderAdapter;
    const result = await events(await createChatPostHandler(createChatService(async () => ({ adapter, apiKey: "key" })))(new Request("http://local/chat", { method: "POST", body: JSON.stringify({ ...body, profile: unknownWindow }) })));

    expect(result.at(-1)).toMatchObject({ type: "error", code: "context_window_unknown", message: "No se conoce la ventana de contexto del modelo seleccionado." });
    expect(providerErrorFromStatus(413).publicMessage).toBe("La solicitud supera el tamaño admitido por el proveedor.");
  });

  test.each([
    ["context_budget_invalid", "No se pudo calcular el presupuesto de contexto."],
    ["context_overflow", "El contenido seleccionado supera la ventana del modelo."],
    ["context_compaction_insufficient", "El contexto sigue siendo demasiado grande después de compactarlo."],
  ])("publishes the specific %s message", (code, message) => {
    expect(new ProviderAdapterError("context", code).publicMessage).toBe(message);
  });
});
