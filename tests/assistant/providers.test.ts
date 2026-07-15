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
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/models/gemini-future")
      ? Response.json({ name: "models/gemini-future", displayName: "Gemini Future", inputTokenLimit: 1_000_000, outputTokenLimit: 8_192, supportedGenerationMethods: ["generateContent", "countTokens"] })
      : Response.json({ models: [{ name: "models/gemini-future", displayName: "Gemini Future", inputTokenLimit: 1_000_000, outputTokenLimit: 8_192, supportedGenerationMethods: ["generateContent", "countTokens"] }] }));
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never, fetcher });
    const controller = new AbortController();

    await expect(adapter.listModels({ apiKey: "secret", signal: controller.signal })).resolves.toEqual([
      expect.objectContaining({ id: "gemini-future", displayName: "Gemini Future", contextWindow: 1_000_000, maxOutputTokens: 8_192 }),
    ]);
    await expect(adapter.getModelMetadata({ apiKey: "secret", modelId: "gemini-future", signal: controller.signal })).resolves.toEqual(expect.objectContaining({ contextWindow: 1_000_000 }));
    await expect(adapter.countTokens({ apiKey: "secret", modelId: "gemini-future", text: "contenido", signal: controller.signal })).resolves.toEqual({ tokens: 37, estimated: false });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/v1beta/models?pageSize=1000"), expect.objectContaining({ signal: controller.signal }));
    expect(fetcher).toHaveBeenCalledWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-future", expect.objectContaining({ signal: controller.signal }));
    expect(models.get).not.toHaveBeenCalled();
    expect(models.countTokens).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ abortSignal: controller.signal }) }));
  });

  test("preserves OpenAI-compatible native tool metadata and does not duplicate a textual result", async () => {
    const nativeToolCall = { id: "call-1", type: "function", index: 0, function: { name: "getPersonProfile", arguments: '{"analysisId":"a1","personId":"10048"}' } };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "Voy a consultarlo.", tool_calls: [nativeToolCall] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 } }))
      .mockResolvedValueOnce(sseResponse(['data: {"choices":[{"delta":{"content":"Respuesta local"},"finish_reason":"stop"}]}\n\n']));
    const adapter = new OpenAICompatibleAdapter({ provider: "openai", baseUrl: PROVIDER_PRESETS.openai.baseUrl!, fetcher });
    const plan = await adapter.planTools({ apiKey: "secret", modelId: "model", messages: [{ role: "user", content: "Consulta" }], tools: [{ name: "getPersonProfile", description: "Perfil", parameters: { type: "object" } }] });
    const call = plan.toolCalls[0]!;
    const events = [];
    for await (const event of adapter.streamResponse({ apiKey: "secret", modelId: "model", messages: [
      { role: "user", content: "Consulta" },
      { role: "assistant_tool_call", calls: [{ executionId: "exec", roundId: "round", requestId: "call-1", name: "getPersonProfile", args: { analysisId: "a1", personId: "10048" }, argsHash: "hash", providerMetadata: call.providerMetadata }] },
      { role: "tool_result", results: [{ executionId: "exec", roundId: "round", requestId: "call-1", name: "getPersonProfile", args: { analysisId: "a1", personId: "10048" }, argsHash: "hash", outcome: { ok: true, data: { personId: "10048" } }, sources: [] }] },
    ] })) events.push(event);

    expect(call.providerMetadata).toEqual(expect.objectContaining({ provider: "openai", nativeToolCall }));
    expect(plan).toMatchObject({ text: "Voy a consultarlo.", finishReason: "tool_calls", usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13, estimated: false } });
    const body = JSON.parse(String((fetcher.mock.calls[1]?.[1] as RequestInit).body));
    expect(body.messages).toEqual([
      { role: "user", content: "Consulta" },
      { role: "assistant", content: null, tool_calls: [nativeToolCall] },
      { role: "tool", tool_call_id: "call-1", content: JSON.stringify({ ok: true, data: { personId: "10048" } }) },
    ]);
    expect(JSON.stringify(body.messages)).not.toContain("Resultados locales autorizados");
    expect(events).toContainEqual({ type: "text_delta", delta: "Respuesta local" });
  });

  test("maps a real Gemini HTTP 413 to the sanitized provider size error", async () => {
    const models = { list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent: vi.fn(), generateContentStream: vi.fn() };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never, fetcher: vi.fn(async () => Response.json({ error: { status: "RESOURCE_EXHAUSTED", message: "private provider detail" } }, { status: 413 })) });

    await expect(adapter.listModels({ apiKey: "secret" })).rejects.toMatchObject({ code: "provider_http_413", classification: "context", publicMessage: "La solicitud supera el tamaño admitido por el proveedor." });
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
      expect.objectContaining({ id: "embedding-001", category: "embedding", supportedMethods: ["embedContent"] }),
    ]);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/v1beta/models?pageSize=1000"), expect.objectContaining({ headers: expect.objectContaining({ "x-goog-api-key": "secret" }) }));
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("pageToken=page-2"), expect.anything());
  });

  test("uses Gemini AUTO tool selection and returns local tool results as function responses", async () => {
    const generateContent = vi.fn(async () => ({ text: "Sin herramientas" }));
    const models = { list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent, generateContentStream: vi.fn() };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });

    await adapter.planTools({
      apiKey: "secret", modelId: "gemini-test", messages: [
        { role: "user", content: "Consulta" },
        { role: "assistant_tool_call", calls: [{ executionId: "exec", roundId: "round", requestId: "tool-1", name: "getAnalysisSummary", args: {}, argsHash: "hash" }] },
        { role: "tool_result", results: [{ executionId: "exec", roundId: "round", requestId: "tool-1", name: "getAnalysisSummary", args: {}, argsHash: "hash", outcome: { ok: true, data: { total: 1 } }, sources: [] }] },
      ], tools: [{ name: "getAnalysisSummary", description: "Resumen", parameters: { type: "object" } }], maxOutputTokens: 321,
    });

    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ maxOutputTokens: 321, toolConfig: { functionCallingConfig: { mode: "AUTO" } } }),
      contents: expect.arrayContaining([expect.objectContaining({ parts: [expect.objectContaining({ functionResponse: expect.objectContaining({ name: "getAnalysisSummary" }) })] })]),
    }));
  });

  test("keeps Gemini planning text, calls, usage and finish metadata together", async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { role: "model", parts: [{ text: "Voy a consultarlo." }, { functionCall: { id: "call-1", name: "getPersonProfile", args: { analysisId: "a1", personId: "10048" } } }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
    }));
    const models = { list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent, generateContentStream: vi.fn() };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });

    const result = await adapter.planTools({
      apiKey: "secret", modelId: "gemini-test", messages: [{ role: "user", content: "Consulta" }],
      tools: [{ name: "getPersonProfile", description: "Perfil", parameters: { type: "object" } }],
    });

    expect(result).toMatchObject({
      text: "Voy a consultarlo.", finishReason: "STOP", usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7, estimated: false },
      toolCalls: [{ id: "call-1", name: "getPersonProfile", args: { analysisId: "a1", personId: "10048" } }],
    });
  });

  test("preserves Gemini native call metadata when returning a function response", async () => {
    const nativePart = { thoughtSignature: "opaque-safe", functionCall: { id: "call-1", name: "getPersonProfile", args: { analysisId: "a1", personId: "10048" } } };
    const generateContent = vi.fn()
      .mockResolvedValueOnce({ candidates: [{ content: { role: "model", parts: [nativePart] } }] })
      .mockResolvedValueOnce({ text: "La matrícula 10048 tiene datos locales." });
    const models = { list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent, generateContentStream: vi.fn() };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });

    const plan = await adapter.planTools({ apiKey: "secret", modelId: "gemini-test", messages: [{ role: "user", content: "Consulta la matrícula 10048" }], tools: [{ name: "getPersonProfile", description: "Perfil", parameters: { type: "object" } }] });
    const call = plan.toolCalls[0]!;
    const roundCall = { executionId: "exec", roundId: "round", requestId: "call-1", name: "getPersonProfile" as const, args: call.args, argsHash: "hash", providerMetadata: call.providerMetadata };
    const events = [];
    for await (const event of adapter.streamResponse({
      apiKey: "secret", modelId: "gemini-test", maxOutputTokens: 64,
      messages: [
        { role: "user", content: "Consulta la matrícula 10048" },
        { role: "assistant_tool_call", calls: [roundCall] },
        { role: "tool_result", results: [{ ...roundCall, outcome: { ok: true, data: { personId: "10048" } }, sources: [] }] },
      ],
    })) events.push(event);

    expect((call as { providerMetadata?: unknown }).providerMetadata).toEqual(expect.objectContaining({ provider: "gemini", nativePart }));
    expect(generateContent).toHaveBeenLastCalledWith(expect.objectContaining({
      contents: [
        { role: "user", parts: [{ text: "Consulta la matrícula 10048" }] },
        { role: "model", parts: [nativePart] },
        { role: "user", parts: [{ functionResponse: { name: "getPersonProfile", response: { result: { personId: "10048" } } } }] },
      ],
    }));
    expect(events).toContainEqual({ type: "text_delta", delta: "La matrícula 10048 tiene datos locales." });
  });

  test("turns a non-streaming Gemini candidate response into internal stream events", async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { role: "model", parts: [{ text: "Hola" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
    }));
    const models = { list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent, generateContentStream: vi.fn() };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });
    const events = [];

    for await (const event of adapter.streamResponse({ apiKey: "secret", modelId: "gemini-test", messages: [{ role: "system", content: "Instrucciones" }, { role: "assistant", content: "Contexto" }, { role: "user", content: "hola" }] })) events.push(event);

    expect(events).toEqual([
      { type: "text_delta", delta: "Hola" },
      { type: "usage", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3, estimated: false } },
      { type: "done", finishReason: "STOP" },
    ]);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-test",
      config: expect.objectContaining({ systemInstruction: expect.anything() }),
      contents: [
        { role: "model", parts: [{ text: "Contexto" }] },
        { role: "user", parts: [{ text: "hola" }] },
      ],
    }));
    expect(models.generateContentStream).not.toHaveBeenCalled();
  });

  test("resolves Gemini metadata through the normalized REST resource name", async () => {
    const fetcher = vi.fn(async () => Response.json({
      name: "models/gemini-manual", baseModelId: "gemini-manual", displayName: "Gemini Manual", inputTokenLimit: 16_000, outputTokenLimit: 4_096, supportedGenerationMethods: ["generateContent"],
    }));
    const models = { list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent: vi.fn(), generateContentStream: vi.fn() };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never, fetcher });

    await expect(adapter.getModelMetadata({ apiKey: "secret", modelId: "models/gemini-manual" })).resolves.toMatchObject({
      id: "gemini-manual", providerModelName: "models/gemini-manual", generationModelId: "gemini-manual",
    });
    expect(fetcher).toHaveBeenCalledWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-manual", expect.objectContaining({ headers: expect.objectContaining({ "x-goog-api-key": "secret" }) }));
    expect(models.get).not.toHaveBeenCalled();
  });

  test("preserves Gemini's actual HTTP status while classifying a 400 key failure safely", async () => {
    const adapter = new GeminiAdapter({
      clientFactory: () => ({ models: { list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent: vi.fn(), generateContentStream: vi.fn() } }) as never,
      fetcher: vi.fn(async () => Response.json({ error: { status: "INVALID_ARGUMENT", message: "API key not valid. secret-key" } }, { status: 400 })),
    });

    await expect(adapter.listModels({ apiKey: "secret-key" })).rejects.toMatchObject({ code: "gemini_auth_error", classification: "auth", httpStatus: 400 });
  });

  test("turns a Gemini prompt block into a typed error instead of a completed response", async () => {
    const models = {
      list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent: vi.fn(async () => ({ promptFeedback: { blockReason: "SAFETY" } })), generateContentStream: vi.fn(),
    };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });
    const consume = async () => { for await (const _ of adapter.streamResponse({ apiKey: "secret", modelId: "gemini-test", messages: [{ role: "user", content: "Consulta" }] })) { /* consume */ } };

    await expect(consume()).rejects.toMatchObject({ code: "gemini_blocked", classification: "provider" });
  });

  test("converts a normal non-streaming Gemini result to text and done events", async () => {
    const models = {
      list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent: vi.fn(async () => ({ text: "Texto final", candidates: [{ finishReason: "STOP" }] })), generateContentStream: vi.fn(),
    };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });
    const events = [];
    for await (const event of adapter.streamResponse({ apiKey: "secret", modelId: "gemini-test", messages: [{ role: "user", content: "Consulta" }] })) events.push(event);
    expect(events).toEqual([{ type: "text_delta", delta: "Texto final" }, { type: "done", finishReason: "STOP" }]);
  });

  test("classifies invalid non-streaming Gemini data", async () => {
    const models = {
      list: vi.fn(), get: vi.fn(), countTokens: vi.fn(), generateContent: vi.fn(async () => { throw new SyntaxError("invalid JSON payload"); }), generateContentStream: vi.fn(),
    };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });
    const consume = async () => { for await (const _ of adapter.streamResponse({ apiKey: "secret", modelId: "gemini-test", messages: [{ role: "user", content: "Consulta" }] })) { /* consume */ } };
    await expect(consume()).rejects.toMatchObject({ code: "gemini_invalid_json", classification: "provider" });
  });

  test("exposes distinct safe messages for empty output, tool limits and truncated streams", () => {
    expect(new ProviderAdapterError("provider", "empty_response").publicMessage).toBe("El modelo no devolvió contenido.");
    expect(new ProviderAdapterError("provider", "tool_round_limit").publicMessage).toBe("El asistente necesitó demasiadas rondas de herramientas.");
    expect(new ProviderAdapterError("provider", "stream_truncated").publicMessage).toBe("La respuesta se interrumpió antes de completarse.");
  });

});
