import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  ProviderAdapterError,
  providerErrorFromStatus,
  sanitizeProviderError,
  type AIProviderAdapter,
  type BehavioralProbeResult,
  type ModelMetadata,
  type ProviderModel,
  type ProviderStreamEvent,
  type StreamResponseRequest,
  type TokenCount,
  type TokenCountRequest,
  type ToolPlan,
  type ToolPlanRequest,
} from "@/lib/assistant/providers/types";

interface GeminiModelLike {
  readonly name?: string;
  readonly baseModelId?: string;
  readonly displayName?: string;
  readonly inputTokenLimit?: number;
  readonly outputTokenLimit?: number;
  readonly supportedActions?: readonly string[];
  readonly supportedGenerationMethods?: readonly string[];
}
interface GeminiResponseLike {
  readonly text?: string;
  readonly functionCalls?: readonly { readonly id?: string; readonly name?: string; readonly args?: unknown }[];
  readonly usageMetadata?: { readonly promptTokenCount?: number; readonly candidatesTokenCount?: number; readonly totalTokenCount?: number };
  readonly candidates?: readonly { readonly finishReason?: string }[];
  readonly promptFeedback?: { readonly blockReason?: string };
}
interface GeminiClientLike {
  readonly models: {
    list(input?: unknown): Promise<AsyncIterable<GeminiModelLike>>;
    get(input: unknown): Promise<GeminiModelLike>;
    countTokens(input: unknown): Promise<{ readonly totalTokens?: number }>;
    generateContent(input: unknown): Promise<GeminiResponseLike>;
    generateContentStream(input: unknown): Promise<AsyncIterable<GeminiResponseLike>>;
  };
}

function modelId(name?: string): string {
  return name?.replace(/^models\//, "") ?? "";
}

function asModel(model: GeminiModelLike): ProviderModel {
  const id = modelId(model.name);
  if (!id) throw new ProviderAdapterError("provider");
  const supportedMethods = [...(model.supportedGenerationMethods ?? model.supportedActions ?? [])];
  return { id, providerModelName: model.name, baseModelId: model.baseModelId, displayName: model.displayName ?? model.baseModelId ?? model.name ?? id, contextWindow: model.inputTokenLimit, maxOutputTokens: model.outputTokenLimit, supportedMethods, supportedParameters: supportedMethods };
}

function supportsGenerateContent(methods: readonly string[]): boolean {
  return methods.some((method) => method.replace(/[^a-z0-9]/giu, "").toLocaleLowerCase("en") === "generatecontent");
}

function geminiContents(messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[]) {
  return messages.map((message) => {
    if (message.role !== "tool") return { role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] };
    try {
      const results = JSON.parse(message.content) as unknown;
      if (!Array.isArray(results) || !results.length) throw new Error("invalid tool results");
      const parts = results.map((result) => {
        if (!result || typeof result !== "object") throw new Error("invalid tool result");
        const entry = result as { tool?: unknown; requestId?: unknown; data?: unknown; result?: unknown };
        if (typeof entry.tool !== "string" || !entry.tool) throw new Error("invalid tool name");
        return { functionResponse: { name: entry.tool, response: { requestId: typeof entry.requestId === "string" ? entry.requestId : undefined, result: entry.data ?? entry.result ?? {} } } };
      });
      return { role: "user", parts };
    } catch {
      return { role: "user", parts: [{ text: message.content }] };
    }
  });
}

function finishReasonCode(reason: string): string {
  return reason.trim().toLocaleLowerCase("en").replace(/[^a-z0-9]+/giu, "_").replace(/^_+|_+$/gu, "") || "unknown";
}

type GeminiFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class GeminiAdapter implements AIProviderAdapter {
  private readonly clientFactory: (apiKey: string) => GeminiClientLike;
  private readonly fetcher: GeminiFetcher;

  constructor(options: { clientFactory?: (apiKey: string) => GeminiClientLike; fetcher?: GeminiFetcher } = {}) {
    this.clientFactory = options.clientFactory ?? ((apiKey) => new GoogleGenAI({ apiKey }) as unknown as GeminiClientLike);
    this.fetcher = options.fetcher ?? fetch;
  }

  private client(apiKey: string): GeminiClientLike {
    return this.clientFactory(apiKey);
  }

  async listModels({ apiKey, signal }: { apiKey: string; signal?: AbortSignal }): Promise<readonly ProviderModel[]> {
    try {
      if (signal?.aborted) throw new ProviderAdapterError("cancelled");
      const result: ProviderModel[] = [];
      const seen = new Set<string>();
      const seenTokens = new Set<string>();
      let pageToken: string | undefined;
      do {
        if (signal?.aborted) throw new ProviderAdapterError("cancelled");
        const query = new URLSearchParams({ pageSize: "1000" });
        if (pageToken) query.set("pageToken", pageToken);
        const response = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models?${query}`, { method: "GET", headers: { "x-goog-api-key": apiKey, accept: "application/json" }, signal });
        if (!response.ok) throw providerErrorFromStatus(response.status);
        const payload = await response.json() as { models?: unknown; nextPageToken?: unknown };
        if (!Array.isArray(payload.models) || (payload.nextPageToken !== undefined && typeof payload.nextPageToken !== "string")) throw new ProviderAdapterError("provider", "gemini_models_parse");
        for (const raw of payload.models) {
          if (!raw || typeof raw !== "object") throw new ProviderAdapterError("provider", "gemini_models_parse");
          const model = raw as GeminiModelLike;
          const normalized = asModel(model);
          if (!supportsGenerateContent(normalized.supportedMethods ?? [])) continue;
          const identity = normalized.providerModelName?.trim().toLocaleLowerCase("en");
          if (!identity || seen.has(identity)) continue;
          seen.add(identity); result.push(normalized);
        }
        pageToken = payload.nextPageToken || undefined;
        if (pageToken && seenTokens.has(pageToken)) throw new ProviderAdapterError("provider", "gemini_models_pagination");
        if (pageToken) seenTokens.add(pageToken);
      } while (pageToken);
      return result;
    } catch (error) { throw sanitizeProviderError(error); }
  }

  async getModelMetadata({ apiKey, modelId: id, signal }: { apiKey: string; modelId: string; signal?: AbortSignal }): Promise<ModelMetadata> {
    try {
      if (signal?.aborted) throw new ProviderAdapterError("cancelled");
      return asModel(await this.client(apiKey).models.get({ model: id, config: { abortSignal: signal } }));
    } catch (error) { throw sanitizeProviderError(error); }
  }

  async countTokens({ apiKey, modelId: id, text, signal }: TokenCountRequest): Promise<TokenCount> {
    try {
      if (signal?.aborted) throw new ProviderAdapterError("cancelled");
      const response = await this.client(apiKey).models.countTokens({ model: id, contents: text, config: { abortSignal: signal } });
      if (!Number.isInteger(response.totalTokens) || response.totalTokens! < 0) throw new ProviderAdapterError("provider");
      return { tokens: response.totalTokens!, estimated: false };
    } catch (error) { throw sanitizeProviderError(error); }
  }

  async planTools(request: ToolPlanRequest): Promise<ToolPlan> {
    try {
      if (request.signal?.aborted) throw new ProviderAdapterError("cancelled");
      const response = await this.client(request.apiKey).models.generateContent({
        model: request.modelId,
        contents: geminiContents(request.messages),
        config: {
          abortSignal: request.signal,
          tools: [{ functionDeclarations: request.tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        },
      });
      if (response.promptFeedback?.blockReason) throw new ProviderAdapterError("provider", "gemini_response_blocked");
      return { toolCalls: (response.functionCalls ?? []).map((call, index) => ({ id: call.id ?? `gemini-call-${index}`, name: call.name ?? "", args: call.args })) };
    } catch (error) { throw sanitizeProviderError(error); }
  }

  async *streamResponse(request: StreamResponseRequest): AsyncIterable<ProviderStreamEvent> {
    try {
      if (request.signal?.aborted) throw new ProviderAdapterError("cancelled");
      const stream = await this.client(request.apiKey).models.generateContentStream({
        model: request.modelId,
        contents: geminiContents(request.messages),
        config: { maxOutputTokens: request.maxOutputTokens, abortSignal: request.signal },
      });
      let finishReason = "stop";
      let sawText = false;
      for await (const chunk of stream) {
        if (request.signal?.aborted) throw new ProviderAdapterError("cancelled");
        if (chunk.promptFeedback?.blockReason) throw new ProviderAdapterError("provider", "gemini_response_blocked");
        if (chunk.text) { sawText = true; yield { type: "text_delta", delta: chunk.text }; }
        const usage = chunk.usageMetadata;
        if (usage?.totalTokenCount !== undefined) yield { type: "usage", usage: { inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0, totalTokens: usage.totalTokenCount, estimated: false } };
        finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
      }
      if (!sawText && finishReason !== "stop") throw new ProviderAdapterError("provider", `gemini_finish_${finishReasonCode(finishReason)}`);
      if (!sawText) throw new ProviderAdapterError("provider", "empty_response");
      yield { type: "done", finishReason };
    } catch (error) {
      if (error instanceof SyntaxError) throw new ProviderAdapterError("provider", "gemini_stream_parse");
      throw sanitizeProviderError(error);
    }
  }

  private async structuredOutput(apiKey: string, id: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    const response = await this.client(apiKey).models.generateContent({
      model: id, contents: "Devuelve un objeto con ok=true.",
      config: { abortSignal: signal, responseMimeType: "application/json", responseJsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } },
    });
    try { return z.object({ ok: z.literal(true) }).strict().safeParse(JSON.parse(response.text ?? "")).success; } catch { return false; }
  }

  async probeCapabilities({ apiKey, modelId: id, signal }: { apiKey: string; modelId: string; signal?: AbortSignal }): Promise<BehavioralProbeResult> {
    const ensureActive = () => { if (signal?.aborted) throw new ProviderAdapterError("cancelled"); };
    let connection = false;
    let streaming = false;
    let tools = false;
    let structuredArguments = false;
    let structuredOutput = false;
    try { await this.getModelMetadata({ apiKey, modelId: id, signal }); connection = true; } catch { /* independent */ }
    ensureActive();
    try {
      for await (const event of this.streamResponse({ apiKey, modelId: id, signal, messages: [{ role: "user", content: "Responde solo OK." }], maxOutputTokens: 8 })) {
        if (event.type === "text_delta" && event.delta.length > 0) streaming = true;
      }
    } catch { /* independent */ }
    ensureActive();
    try {
      const plan = await this.planTools({ apiKey, modelId: id, signal, messages: [{ role: "user", content: "Llama assistant_probe con value=ok." }], tools: [{ name: "assistant_probe", description: "Capability probe", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } }] });
      const call = plan.toolCalls.find((item) => item.name === "assistant_probe");
      tools = Boolean(call);
      structuredArguments = z.object({ value: z.literal("ok") }).strict().safeParse(call?.args).success;
    } catch { /* independent */ }
    ensureActive();
    try { structuredOutput = await this.structuredOutput(apiKey, id, signal); } catch { /* independent */ }
    ensureActive();

    const cancellation = await (async (): Promise<boolean> => {
      const controller = new AbortController();
      const iterator = this.streamResponse({ apiKey, modelId: id, signal: controller.signal, messages: [{ role: "user", content: "assistant_cancel_probe" }], maxOutputTokens: 1 })[Symbol.asyncIterator]();
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
      await this.getModelMetadata({ apiKey, modelId: `${id}-assistant-error-probe`, signal });
    } catch (error) {
      sanitizedErrors = error instanceof ProviderAdapterError && !JSON.stringify(error).includes(apiKey);
    }
    ensureActive();
    return { connection, streaming, tools, structuredArguments, structuredOutput, cancellation, sanitizedErrors };
  }
}
