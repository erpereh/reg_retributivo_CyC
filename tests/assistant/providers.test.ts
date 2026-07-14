import { describe, expect, test, vi } from "vitest";
import { GeminiAdapter } from "@/lib/assistant/providers/geminiAdapter";
import { OpenAICompatibleAdapter } from "@/lib/assistant/providers/openAiCompatibleAdapter";
import { PROVIDER_PRESETS, ProviderAdapterError } from "@/lib/assistant/providers/types";

const encoder = new TextEncoder();

function sseResponse(lines: readonly string[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("provider adapters", () => {
  test("defines the exact presets without closing the model list", () => {
    expect(PROVIDER_PRESETS).toMatchObject({
      openai: { baseUrl: "https://api.openai.com/v1", envName: "OPENAI_API_KEY" },
      openrouter: { baseUrl: "https://openrouter.ai/api/v1", envName: "OPENROUTER_API_KEY" },
      cerebras: { baseUrl: "https://api.cerebras.ai/v1", envName: "CEREBRAS_API_KEY" },
      groq: { baseUrl: "https://api.groq.com/openai/v1", envName: "GROQ_API_KEY" },
      gemini: { baseUrl: "https://generativelanguage.googleapis.com", envName: "GEMINI_API_KEY" },
      manual: { envName: undefined },
    });
    expect(Object.values(PROVIDER_PRESETS).every((preset) => !("models" in preset))).toBe(true);
  });

  test("lists arbitrary OpenAI-compatible models and preserves provider metadata", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [
      { id: "future-model-2030", name: "Future", context_length: 128_000, max_completion_tokens: 8_192, supported_parameters: ["tools", "response_format"] },
    ] }));
    const adapter = new OpenAICompatibleAdapter({ provider: "openrouter", baseUrl: PROVIDER_PRESETS.openrouter.baseUrl!, fetcher });

    await expect(adapter.listModels({ apiKey: "secret" })).resolves.toEqual([
      expect.objectContaining({ id: "future-model-2030", displayName: "Future", contextWindow: 128_000, maxOutputTokens: 8_192 }),
    ]);
    expect(fetcher).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret" }) }));
  });

  test("estimates preflight tokens but forwards exact usage returned after generation", async () => {
    const fetcher = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}}\n\n',
      "data: [DONE]\n\n",
    ]));
    const adapter = new OpenAICompatibleAdapter({ provider: "openai", baseUrl: PROVIDER_PRESETS.openai.baseUrl!, fetcher });

    await expect(adapter.countTokens({ apiKey: "secret", modelId: "any", text: "abcdefgh" })).resolves.toEqual({ tokens: 2, estimated: true });
    const events = [];
    for await (const event of adapter.streamResponse({ apiKey: "secret", modelId: "any", messages: [{ role: "user", content: "hola" }] })) events.push(event);
    expect(events).toEqual([
      { type: "text_delta", delta: "Hola" },
      { type: "usage", usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15, estimated: false } },
      { type: "done", finishReason: "stop" },
    ]);
  });

  test("consumes a final SSE frame without a trailing blank line", async () => {
    const fetcher = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Final"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}',
    ]));
    const adapter = new OpenAICompatibleAdapter({ provider: "openai", baseUrl: PROVIDER_PRESETS.openai.baseUrl!, fetcher });
    const events = [];
    for await (const event of adapter.streamResponse({ apiKey: "secret", modelId: "any", messages: [{ role: "user", content: "hola" }] })) events.push(event);
    expect(events).toContainEqual({ type: "text_delta", delta: "Final" });
    expect(events).toContainEqual({ type: "usage", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3, estimated: false } });
  });

  test("rejects negative or fractional usage", async () => {
    const fetcher = vi.fn(async () => sseResponse([
      'data: {"choices":[],"usage":{"prompt_tokens":-1,"completion_tokens":0.5,"total_tokens":0}}\n\n',
    ]));
    const adapter = new OpenAICompatibleAdapter({ provider: "openai", baseUrl: PROVIDER_PRESETS.openai.baseUrl!, fetcher });
    const consume = async () => { for await (const _ of adapter.streamResponse({ apiKey: "secret", modelId: "any", messages: [{ role: "user", content: "hola" }] })) { /* consume */ } };
    await expect(consume()).rejects.toMatchObject({ classification: "provider" });
  });

  test("never copies an upstream body or secret into a public provider error", async () => {
    const privateBody = "invalid sk-private ana@example.com";
    const adapter = new OpenAICompatibleAdapter({
      provider: "manual",
      baseUrl: "https://models.example.test/v1",
      fetcher: vi.fn(async () => new Response(privateBody, { status: 401 })),
    });

    const error = await adapter.listModels({ apiKey: "sk-private" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ProviderAdapterError);
    expect(error).toMatchObject({ classification: "auth", publicMessage: "No se pudo autenticar con el proveedor." });
    expect(JSON.stringify(error)).not.toContain(privateBody);
    expect(JSON.stringify(error)).not.toContain("sk-private");
  });

  test("uses Gemini provider metadata and exact token counting through @google/genai", async () => {
    const models = {
      list: vi.fn(async () => ({ async *[Symbol.asyncIterator]() { yield { name: "models/gemini-future", displayName: "Gemini Future", inputTokenLimit: 1_000_000, outputTokenLimit: 8_192, supportedActions: ["generateContent", "countTokens"] }; } })),
      get: vi.fn(async () => ({ name: "models/gemini-future", displayName: "Gemini Future", inputTokenLimit: 1_000_000, outputTokenLimit: 8_192 })),
      countTokens: vi.fn(async () => ({ totalTokens: 37 })),
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
    };
    const fetcher = vi.fn(async () => Response.json({ models: [{ name: "models/gemini-future", displayName: "Gemini Future", inputTokenLimit: 1_000_000, outputTokenLimit: 8_192, supportedGenerationMethods: ["generateContent", "countTokens"] }] }));
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never, fetcher });
    const controller = new AbortController();

    await expect(adapter.listModels({ apiKey: "secret", signal: controller.signal })).resolves.toEqual([
      expect.objectContaining({ id: "gemini-future", displayName: "Gemini Future", contextWindow: 1_000_000, maxOutputTokens: 8_192 }),
    ]);
    await expect(adapter.getModelMetadata({ apiKey: "secret", modelId: "gemini-future", signal: controller.signal })).resolves.toEqual(expect.objectContaining({ contextWindow: 1_000_000 }));
    await expect(adapter.countTokens({ apiKey: "secret", modelId: "gemini-future", text: "contenido", signal: controller.signal })).resolves.toEqual({ tokens: 37, estimated: false });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/v1beta/models?pageSize=1000"), expect.objectContaining({ signal: controller.signal }));
    expect(models.get).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ abortSignal: controller.signal }) }));
    expect(models.countTokens).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ abortSignal: controller.signal }) }));
  });

  test("lists every paginated Gemini generateContent variant without collapsing a shared base model", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("pageToken=page-2")) return Response.json({ models: [
        { name: "models/gemini-2.5-flash-preview", baseModelId: "gemini-2.5-flash", displayName: "Gemini Flash", inputTokenLimit: 1_000_000, outputTokenLimit: 8_192, supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
      ] });
      return Response.json({ models: [
        { name: "models/gemini-2.5-flash", baseModelId: "gemini-2.5-flash", displayName: "Gemini Flash", inputTokenLimit: 1_000_000, outputTokenLimit: 8_192, supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash", baseModelId: "gemini-2.5-flash", displayName: "Duplicate", supportedGenerationMethods: ["generateContent"] },
      ], nextPageToken: "page-2" });
    });
    const models = { list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent: vi.fn(), generateContentStream: vi.fn() };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never, fetcher } as never);

    await expect(adapter.listModels({ apiKey: "secret" })).resolves.toEqual([
      expect.objectContaining({ id: "gemini-2.5-flash", providerModelName: "models/gemini-2.5-flash", baseModelId: "gemini-2.5-flash", supportedMethods: ["generateContent"] }),
      expect.objectContaining({ id: "gemini-2.5-flash-preview", providerModelName: "models/gemini-2.5-flash-preview", baseModelId: "gemini-2.5-flash" }),
    ]);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/v1beta/models?pageSize=1000"), expect.objectContaining({ headers: expect.objectContaining({ "x-goog-api-key": "secret" }) }));
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("pageToken=page-2"), expect.anything());
  });

  test("uses Gemini AUTO tool selection and returns local tool results as function responses", async () => {
    const generateContent = vi.fn(async () => ({ functionCalls: [] }));
    const models = { list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent, generateContentStream: vi.fn() };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });

    await adapter.planTools({
      apiKey: "secret", modelId: "gemini-test", messages: [
        { role: "user", content: "Consulta" },
        { role: "tool", content: JSON.stringify([{ requestId: "tool-1", tool: "getAnalysisSummary", data: { total: 1 } }]) },
      ], tools: [{ name: "getAnalysisSummary", description: "Resumen", parameters: { type: "object" } }],
    });

    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ toolConfig: { functionCallingConfig: { mode: "AUTO" } } }),
      contents: expect.arrayContaining([expect.objectContaining({ parts: [expect.objectContaining({ functionResponse: expect.objectContaining({ name: "getAnalysisSummary" }) })] })]),
    }));
  });

  test("turns a Gemini prompt block into a typed error instead of a completed empty stream", async () => {
    const models = {
      list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent: vi.fn(),
      generateContentStream: vi.fn(async function* () { yield { promptFeedback: { blockReason: "SAFETY" } }; }),
    };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });
    const consume = async () => { for await (const _ of adapter.streamResponse({ apiKey: "secret", modelId: "gemini-test", messages: [{ role: "user", content: "Consulta" }] })) { /* consume */ } };

    await expect(consume()).rejects.toMatchObject({ code: "gemini_response_blocked", classification: "provider" });
  });

  test("accepts normal Gemini EOF without a provider done marker after flushing its final text", async () => {
    const models = {
      list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent: vi.fn(),
      generateContentStream: vi.fn(async function* () { yield { text: "Texto final", candidates: [{ finishReason: "STOP" }] }; }),
    };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });
    const events = [];
    for await (const event of adapter.streamResponse({ apiKey: "secret", modelId: "gemini-test", messages: [{ role: "user", content: "Consulta" }] })) events.push(event);
    expect(events).toEqual([{ type: "text_delta", delta: "Texto final" }, { type: "done", finishReason: "STOP" }]);
  });

  test("classifies an unparseable Gemini stream frame", async () => {
    const models = {
      list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent: vi.fn(),
      generateContentStream: vi.fn(async function* () { throw new SyntaxError("invalid SSE payload"); }),
    };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });
    const consume = async () => { for await (const _ of adapter.streamResponse({ apiKey: "secret", modelId: "gemini-test", messages: [{ role: "user", content: "Consulta" }] })) { /* consume */ } };
    await expect(consume()).rejects.toMatchObject({ code: "gemini_stream_parse", classification: "provider" });
  });

  test("exposes distinct safe messages for empty output, tool limits and truncated streams", () => {
    expect(new ProviderAdapterError("provider", "empty_response").publicMessage).toBe("El modelo no devolvió contenido.");
    expect(new ProviderAdapterError("provider", "tool_round_limit").publicMessage).toBe("El asistente necesitó demasiadas rondas de herramientas.");
    expect(new ProviderAdapterError("provider", "stream_truncated").publicMessage).toBe("La respuesta se interrumpió antes de completarse.");
  });

});
