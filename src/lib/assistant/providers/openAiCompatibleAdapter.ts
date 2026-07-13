import { z } from "zod";
import {
  ProviderAdapterError,
  providerErrorFromStatus,
  sanitizeProviderError,
  type AIProviderAdapter,
  type BehavioralProbeResult,
  type ModelMetadata,
  type ProviderId,
  type ProviderModel,
  type ProviderStreamEvent,
  type StreamResponseRequest,
  type TokenCount,
  type TokenCountRequest,
  type ToolPlan,
  type ToolPlanRequest,
} from "@/lib/assistant/providers/types";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const modelSchema = z.object({
  id: z.string().min(1), name: z.string().optional(), display_name: z.string().optional(), context_length: z.number().int().positive().optional(),
  context_window: z.number().int().positive().optional(), max_completion_tokens: z.number().int().positive().optional(), output_token_limit: z.number().int().positive().optional(),
  supported_parameters: z.array(z.string()).optional(), top_provider: z.object({ context_length: z.number().int().positive().optional(), max_completion_tokens: z.number().int().positive().optional() }).passthrough().optional(),
}).passthrough();
const listSchema = z.object({ data: z.array(modelSchema) }).passthrough();
const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }).passthrough() }).passthrough()).nullable().optional() }).passthrough() }).passthrough()),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative() }).passthrough().optional(),
}).passthrough();
const streamChunkSchema = z.object({
  choices: z.array(z.object({ delta: z.object({ content: z.string().nullable().optional() }).passthrough(), finish_reason: z.string().nullable().optional() }).passthrough()).default([]),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative() }).passthrough().nullable().optional(),
}).passthrough();

function asModel(input: z.infer<typeof modelSchema>): ProviderModel {
  return {
    id: input.id,
    displayName: input.name ?? input.display_name ?? input.id,
    contextWindow: input.context_length ?? input.context_window ?? input.top_provider?.context_length,
    maxOutputTokens: input.max_completion_tokens ?? input.output_token_limit ?? input.top_provider?.max_completion_tokens,
    supportedParameters: input.supported_parameters,
  };
}

function safeJson(response: Response): Promise<unknown> {
  return response.json().catch(() => { throw new ProviderAdapterError("provider"); });
}

export class OpenAICompatibleAdapter implements AIProviderAdapter {
  readonly provider: Exclude<ProviderId, "gemini">;
  readonly baseUrl: string;
  private readonly fetcher: Fetcher;

  constructor(options: { provider: Exclude<ProviderId, "gemini">; baseUrl: string; fetcher?: Fetcher }) {
    this.provider = options.provider;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetcher = options.fetcher ?? fetch;
  }

  private headers(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  }

  private async call(path: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers: { ...this.headers(apiKey), ...(init.headers as Record<string, string> | undefined) } });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw providerErrorFromStatus(response.status);
      }
      return response;
    } catch (error) {
      throw sanitizeProviderError(error);
    }
  }

  async listModels({ apiKey, signal }: { apiKey: string; signal?: AbortSignal }): Promise<readonly ProviderModel[]> {
    const parsed = listSchema.safeParse(await safeJson(await this.call("/models", apiKey, { method: "GET", signal })));
    if (!parsed.success) throw new ProviderAdapterError("provider");
    return parsed.data.data.map(asModel);
  }

  async getModelMetadata({ apiKey, modelId, signal }: { apiKey: string; modelId: string; signal?: AbortSignal }): Promise<ModelMetadata> {
    if (this.provider === "openrouter") {
      const model = (await this.listModels({ apiKey, signal })).find((item) => item.id === modelId);
      if (!model) throw new ProviderAdapterError("incompatible");
      return model;
    }
    const parsed = modelSchema.safeParse(await safeJson(await this.call(`/models/${encodeURIComponent(modelId)}`, apiKey, { method: "GET", signal })));
    if (!parsed.success) throw new ProviderAdapterError("provider");
    return asModel(parsed.data);
  }

  async countTokens({ text }: TokenCountRequest): Promise<TokenCount> {
    return { tokens: Math.max(1, Math.ceil(text.length / 4)), estimated: true };
  }

  async planTools(request: ToolPlanRequest): Promise<ToolPlan> {
    const response = await this.call("/chat/completions", request.apiKey, {
      method: "POST", signal: request.signal,
      body: JSON.stringify({
        model: request.modelId, messages: request.messages,
        tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: true } })),
        tool_choice: "required", stream: false,
      }),
    });
    const parsed = completionSchema.safeParse(await safeJson(response));
    if (!parsed.success) throw new ProviderAdapterError("provider");
    const calls = parsed.data.choices[0]?.message.tool_calls ?? [];
    return {
      toolCalls: calls.map((call) => {
        let args: unknown;
        try { args = JSON.parse(call.function.arguments); } catch { throw new ProviderAdapterError("incompatible"); }
        return { id: call.id, name: call.function.name, args };
      }),
    };
  }

  async *streamResponse(request: StreamResponseRequest): AsyncIterable<ProviderStreamEvent> {
    if (request.signal?.aborted) throw new ProviderAdapterError("cancelled");
    const response = await this.call("/chat/completions", request.apiKey, {
      method: "POST", signal: request.signal,
      body: JSON.stringify({ model: request.modelId, messages: request.messages, max_completion_tokens: request.maxOutputTokens, stream: true, stream_options: { include_usage: true } }),
    });
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderAdapterError("incompatible");
    }
    if (!response.body) throw new ProviderAdapterError("provider");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finishReason = "stop";
    let sawDataFrame = false;
    let reachedEof = false;
    try {
      while (true) {
        request.signal?.throwIfAborted();
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        if (done && buffer.trim()) {
          frames.push(buffer);
          buffer = "";
        }
        for (const frame of frames) {
          for (const line of frame.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let payload: unknown;
            try { payload = JSON.parse(data); } catch { throw new ProviderAdapterError("provider"); }
            const chunk = streamChunkSchema.safeParse(payload);
            if (!chunk.success) throw new ProviderAdapterError("provider");
            sawDataFrame = true;
            const delta = chunk.data.choices[0]?.delta.content;
            if (delta) yield { type: "text_delta", delta };
            if (chunk.data.choices[0]?.finish_reason) finishReason = chunk.data.choices[0].finish_reason!;
            if (chunk.data.usage) yield { type: "usage", usage: { inputTokens: chunk.data.usage.prompt_tokens, outputTokens: chunk.data.usage.completion_tokens, totalTokens: chunk.data.usage.total_tokens, estimated: false } };
          }
        }
        if (done) { reachedEof = true; break; }
      }
      if (!sawDataFrame) throw new ProviderAdapterError("incompatible");
      yield { type: "done", finishReason };
    } catch (error) {
      throw sanitizeProviderError(error);
    } finally {
      if (!reachedEof) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  private async probeStructuredOutput(apiKey: string, modelId: string, signal?: AbortSignal): Promise<boolean> {
    const response = await this.call("/chat/completions", apiKey, {
      method: "POST", signal,
      body: JSON.stringify({
        model: modelId, messages: [{ role: "user", content: "Devuelve un objeto JSON con ok=true." }], stream: false,
        response_format: { type: "json_schema", json_schema: { name: "assistant_probe", strict: true, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } },
      }),
    });
    const parsed = completionSchema.safeParse(await safeJson(response));
    const content = parsed.success ? parsed.data.choices[0]?.message.content : undefined;
    if (!content) return false;
    try { return z.object({ ok: z.literal(true) }).strict().safeParse(JSON.parse(content)).success; } catch { return false; }
  }

  async probeCapabilities({ apiKey, modelId, signal }: { apiKey: string; modelId: string; signal?: AbortSignal }): Promise<BehavioralProbeResult> {
    const ensureActive = () => { if (signal?.aborted) throw new ProviderAdapterError("cancelled"); };
    let connection = false;
    let streaming = false;
    let tools = false;
    let structuredArguments = false;
    let structuredOutput = false;
    try { await this.getModelMetadata({ apiKey, modelId, signal }); connection = true; } catch { /* independent */ }
    ensureActive();
    try {
      for await (const event of this.streamResponse({ apiKey, modelId, signal, messages: [{ role: "user", content: "Responde solo OK." }], maxOutputTokens: 8 })) {
        if (event.type === "text_delta" && event.delta.length > 0) streaming = true;
      }
    } catch { /* independent */ }
    ensureActive();
    try {
      const plan = await this.planTools({ apiKey, modelId, signal, messages: [{ role: "user", content: "Llama assistant_probe con value=ok." }], tools: [{ name: "assistant_probe", description: "Capability probe", parameters: { type: "object", properties: { value: { type: "string", const: "ok" } }, required: ["value"], additionalProperties: false } }] });
      const call = plan.toolCalls.find((item) => item.name === "assistant_probe");
      tools = Boolean(call);
      structuredArguments = z.object({ value: z.literal("ok") }).strict().safeParse(call?.args).success;
    } catch { /* independent */ }
    ensureActive();
    try { structuredOutput = await this.probeStructuredOutput(apiKey, modelId, signal); } catch { /* independent */ }
    ensureActive();

    const cancellation = await (async (): Promise<boolean> => {
      const controller = new AbortController();
      const iterator = this.streamResponse({ apiKey, modelId, signal: controller.signal, messages: [{ role: "user", content: "assistant_cancel_probe" }], maxOutputTokens: 1 })[Symbol.asyncIterator]();
      const pending = iterator.next();
      await Promise.resolve();
      controller.abort();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          pending.then(() => false, (error) => error instanceof ProviderAdapterError && error.classification === "cancelled"),
          new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), 500); }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
        void iterator.return?.().catch(() => undefined);
      }
    })();

    let sanitizedErrors = false;
    try {
      await this.call("/models/__assistant_error_probe__", apiKey, { method: "GET", signal });
    } catch (error) {
      sanitizedErrors = error instanceof ProviderAdapterError && !JSON.stringify(error).includes(apiKey);
    }
    ensureActive();
    return { connection, streaming, tools, structuredArguments, structuredOutput, cancellation, sanitizedErrors };
  }
}
