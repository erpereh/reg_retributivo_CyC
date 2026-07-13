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
      gemini: { envName: "GEMINI_API_KEY" },
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

  test("probes an OpenRouter model from its dynamic list with independent behavioral evidence", async () => {
    let cancellationStarted = false;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models/__assistant_error_probe__")) return new Response("private upstream body", { status: 401 });
      if (url.endsWith("/models")) return Response.json({ data: [{ id: "author/future-model", name: "Future", context_length: 128_000, max_completion_tokens: 8_192 }] });
      const payload = JSON.parse(String(init?.body ?? "{}"));
      const prompt = payload.messages?.[0]?.content;
      if (prompt === "assistant_cancel_probe") {
        cancellationStarted = true;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      if (payload.stream) return sseResponse(['data: {"choices":[{"delta":{"content":"OK"}}]}\n\n', "data: [DONE]\n\n"]);
      if (payload.tools) return Response.json({ choices: [{ message: { tool_calls: [{ id: "call-1", function: { name: "assistant_probe", arguments: '{"value":"ok"}' } }] } }] });
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    });
    const adapter = new OpenAICompatibleAdapter({ provider: "openrouter", baseUrl: PROVIDER_PRESETS.openrouter.baseUrl!, fetcher });

    await expect(adapter.getModelMetadata({ apiKey: "secret", modelId: "author/future-model" })).resolves.toMatchObject({ contextWindow: 128_000 });
    const result = await adapter.probeCapabilities({ apiKey: "secret", modelId: "author/future-model" });
    expect(result).toEqual({ connection: true, streaming: true, tools: true, structuredArguments: true, structuredOutput: true, cancellation: true, sanitizedErrors: true });
    expect(cancellationStarted).toBe(true);
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining("models/author%2Ffuture-model"), expect.anything());
  });

  test("does not count an empty stream or a successful error probe as behavioral evidence", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("__assistant_error_probe__")) return Response.json({ id: "unexpected-success" });
      if (url.endsWith("/models/model")) return Response.json({ id: "model" });
      const payload = JSON.parse(String(init?.body ?? "{}"));
      if (payload.messages?.[0]?.content === "assistant_cancel_probe") return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      if (payload.stream) return sseResponse(["data: [DONE]\n\n"]);
      if (payload.tools) throw new Error("tools fail independently");
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    });
    const adapter = new OpenAICompatibleAdapter({ provider: "openai", baseUrl: PROVIDER_PRESETS.openai.baseUrl!, fetcher });
    await expect(adapter.probeCapabilities({ apiKey: "secret", modelId: "model" })).resolves.toMatchObject({
      connection: true, streaming: false, tools: false, structuredArguments: false, structuredOutput: true, cancellation: true, sanitizedErrors: false,
    });
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
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });
    const controller = new AbortController();

    await expect(adapter.listModels({ apiKey: "secret", signal: controller.signal })).resolves.toEqual([
      expect.objectContaining({ id: "gemini-future", displayName: "Gemini Future", contextWindow: 1_000_000, maxOutputTokens: 8_192 }),
    ]);
    await expect(adapter.getModelMetadata({ apiKey: "secret", modelId: "gemini-future", signal: controller.signal })).resolves.toEqual(expect.objectContaining({ contextWindow: 1_000_000 }));
    await expect(adapter.countTokens({ apiKey: "secret", modelId: "gemini-future", text: "contenido", signal: controller.signal })).resolves.toEqual({ tokens: 37, estimated: false });
    expect(models.list).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ abortSignal: controller.signal }) }));
    expect(models.get).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ abortSignal: controller.signal }) }));
    expect(models.countTokens).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ abortSignal: controller.signal }) }));
  });

  test("propagates AbortSignal through Gemini and certifies cancellation after the request starts", async () => {
    let cancellationStarted = false;
    const models = {
      list: vi.fn(),
      get: vi.fn(async ({ model }: { model: string }) => {
        if (model.includes("error-probe")) throw new Error("private upstream body");
        return { name: "models/gemini-future", inputTokenLimit: 1_000_000, outputTokenLimit: 8_192 };
      }),
      countTokens: vi.fn(),
      generateContent: vi.fn(async (input: { config?: { tools?: unknown } }) => input.config?.tools
        ? { functionCalls: [{ name: "assistant_probe", args: { value: "ok" } }] }
        : { text: '{"ok":true}' }),
      generateContentStream: vi.fn(async (input: { contents?: unknown; config?: { maxOutputTokens?: number; abortSignal?: AbortSignal } }) => {
        if (input.config?.maxOutputTokens === 1) {
          cancellationStarted = true;
          return await new Promise((_resolve, reject) => input.config?.abortSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
        }
        return { async *[Symbol.asyncIterator]() { yield { text: "OK" }; } };
      }),
    };
    const adapter = new GeminiAdapter({ clientFactory: () => ({ models }) as never });
    const controller = new AbortController();
    await expect(adapter.probeCapabilities({ apiKey: "secret", modelId: "gemini-future", signal: controller.signal })).resolves.toMatchObject({
      connection: true, streaming: true, tools: true, structuredArguments: true, structuredOutput: true, cancellation: true, sanitizedErrors: true,
    });
    expect(cancellationStarted).toBe(true);
    expect(models.generateContent).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ abortSignal: controller.signal }) }));
    expect(models.generateContentStream).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ abortSignal: controller.signal }) }));
  });
});
