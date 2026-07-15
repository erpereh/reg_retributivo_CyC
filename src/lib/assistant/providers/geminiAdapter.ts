import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  ProviderAdapterError,
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
interface GeminiPartLike {
  readonly text?: string;
  readonly functionCall?: { readonly id?: string; readonly name?: string; readonly args?: unknown };
}
interface GeminiCandidateLike {
  readonly content?: { readonly role?: string; readonly parts?: readonly GeminiPartLike[] };
  readonly finishReason?: string;
}
interface GeminiResponseLike {
  readonly text?: string;
  readonly functionCalls?: readonly { readonly id?: string; readonly name?: string; readonly args?: unknown }[];
  readonly usageMetadata?: { readonly promptTokenCount?: number; readonly candidatesTokenCount?: number; readonly totalTokenCount?: number };
  readonly candidates?: readonly GeminiCandidateLike[];
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
  return name?.trim().replace(/^(?:models\/)+/u, "") ?? "";
}

function geminiModelIdentity(name?: string) {
  const generationModelId = modelId(name);
  return { generationModelId, providerModelName: generationModelId ? `models/${generationModelId}` : "" };
}

function asModel(model: GeminiModelLike): ProviderModel {
  const { generationModelId: id, providerModelName } = geminiModelIdentity(model.name ?? model.baseModelId);
  if (!id) throw new ProviderAdapterError("provider");
  const supportedMethods = [...(model.supportedGenerationMethods ?? model.supportedActions ?? [])];
  return { id, providerModelName, generationModelId: id, baseModelId: model.baseModelId ? modelId(model.baseModelId) : undefined, category: geminiCategory(id, supportedMethods), displayName: model.displayName ?? model.baseModelId ?? model.name ?? id, contextWindow: model.inputTokenLimit, maxOutputTokens: model.outputTokenLimit, supportedMethods, supportedParameters: supportedMethods };
}

function supportsGenerateContent(methods: readonly string[]): boolean {
  return methods.some((method) => method.replace(/[^a-z0-9]/giu, "").toLocaleLowerCase("en") === "generatecontent");
}

function geminiContents(messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[]): unknown[] {
  return messages.flatMap<unknown>((message) => {
    if (message.role === "system") return [];
    if (message.role !== "tool") return [{ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] }];
    try {
      const results = JSON.parse(message.content) as unknown;
      if (!Array.isArray(results) || !results.length) throw new Error("invalid tool results");
      const parts = results.map((result) => {
        if (!result || typeof result !== "object") throw new Error("invalid tool result");
        const entry = result as { tool?: unknown; requestId?: unknown; args?: unknown; data?: unknown; result?: unknown };
        if (typeof entry.tool !== "string" || !entry.tool) throw new Error("invalid tool name");
        return { name: entry.tool, id: typeof entry.requestId === "string" ? entry.requestId : undefined, args: entry.args && typeof entry.args === "object" ? entry.args : {} , result: entry.data ?? entry.result ?? {} };
      });
      return [
        { role: "model", parts: parts.map(({ name, id, args }) => ({ functionCall: { name, ...(id ? { id } : {}), args } })) },
        { role: "user", parts: parts.map(({ name, id, result }) => ({ functionResponse: { name, ...(id ? { id } : {}), response: { result } } })) },
      ];
    } catch {
      return [{ role: "user", parts: [{ text: message.content }] }];
    }
  });
}

function geminiCategory(id: string, methods: readonly string[]): NonNullable<ProviderModel["category"]> {
  const signature = `${id} ${methods.join(" ")}`.toLocaleLowerCase("en");
  if (/embed/.test(signature)) return "embedding";
  if (/bidi|live/.test(signature)) return "live";
  if (/tts|speech/.test(signature)) return "tts";
  if (/veo|video/.test(signature)) return "video";
  if (/imagen|image/.test(signature)) return "image";
  if (/audio/.test(signature)) return "audio";
  return supportsGenerateContent(methods) ? "chat" : "specialized";
}

function geminiSystemInstruction(messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[]) {
  const text = messages.filter((message) => message.role === "system").map((message) => message.content.trim()).filter(Boolean).join("\n\n");
  return text ? { parts: [{ text }] } : undefined;
}

function responseUsage(response: GeminiResponseLike) {
  const usage = response.usageMetadata;
  return usage?.totalTokenCount === undefined ? undefined : { inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0, totalTokens: usage.totalTokenCount, estimated: false };
}

function responseFinishReason(response: GeminiResponseLike): string | undefined {
  return response.candidates?.find((candidate) => Boolean(candidate.finishReason))?.finishReason;
}

function responseFunctionCalls(response: GeminiResponseLike) {
  return response.functionCalls ?? response.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).flatMap((part) => part.functionCall ? [part.functionCall] : []) ?? [];
}

export function extractGeminiText(response: GeminiResponseLike): string {
  const directText = typeof response.text === "string" ? response.text.trim() : "";
  if (directText) return directText;
  return (response.candidates ?? []).flatMap((candidate) => candidate.content?.parts ?? []).filter((part): part is GeminiPartLike & { text: string } => typeof part.text === "string").map((part) => part.text).join("").trim();
}

function finishReasonCode(reason: string): string {
  return reason.trim().toLocaleLowerCase("en").replace(/[^a-z0-9]+/giu, "_").replace(/^_+|_+$/gu, "") || "unknown";
}

function geminiHttpError(status: number, providerStatus?: string, detail?: string): ProviderAdapterError {
  const normalized = `${providerStatus ?? ""} ${detail ?? ""}`.toUpperCase();
  if (status === 401 || /UNAUTHENTICATED|API.?KEY|INVALID.?KEY|CREDENTIAL/.test(normalized)) return new ProviderAdapterError("auth", "gemini_auth_error", status);
  if (status === 403 || /PERMISSION|FORBIDDEN|ACCESS.?DENIED/.test(normalized)) return new ProviderAdapterError("auth", "gemini_forbidden", status);
  if (status === 404 || /NOT.?FOUND|MODEL/.test(normalized)) return new ProviderAdapterError("incompatible", "gemini_model_not_found", status);
  if (status === 429 || /RESOURCE.?EXHAUSTED|RATE.?LIMIT|QUOTA/.test(normalized)) return new ProviderAdapterError("transient", "gemini_rate_limited", status);
  return new ProviderAdapterError(status >= 500 ? "transient" : "provider", "gemini_http_error", status);
}

async function throwGeminiHttpError(response: Response): Promise<never> {
  const payload = await response.json().catch(() => undefined) as { error?: { status?: unknown; message?: unknown; details?: unknown } } | undefined;
  const providerStatus = typeof payload?.error?.status === "string" ? payload.error.status : undefined;
  const detail = [payload?.error?.message, ...(Array.isArray(payload?.error?.details) ? payload.error.details : [])].filter((value): value is string => typeof value === "string").join(" ");
  throw geminiHttpError(response.status, providerStatus, detail);
}

function geminiResponseError(response: GeminiResponseLike): ProviderAdapterError {
  if (response.promptFeedback?.blockReason) return new ProviderAdapterError("provider", "gemini_blocked");
  const finishReason = responseFinishReason(response);
  if (finishReason && finishReasonCode(finishReason) !== "stop") return new ProviderAdapterError("provider", `gemini_finish_${finishReasonCode(finishReason)}`);
  if (!response.candidates?.length) return new ProviderAdapterError("provider", "gemini_empty_candidates");
  if (!response.candidates.some((candidate) => candidate.content?.parts?.length)) return new ProviderAdapterError("provider", "gemini_empty_parts");
  return new ProviderAdapterError("provider", "gemini_empty_response");
}

function sanitizeGeminiError(error: unknown): ProviderAdapterError {
  if (error instanceof ProviderAdapterError) return error;
  if (error instanceof DOMException && error.name === "AbortError") return new ProviderAdapterError("cancelled");
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : Number.NaN;
  const providerStatus = typeof error === "object" && error !== null && "statusText" in error ? String((error as { statusText?: unknown }).statusText) : undefined;
  const detail = typeof error === "object" && error !== null && "message" in error ? String((error as { message?: unknown }).message) : undefined;
  if (Number.isInteger(status)) return geminiHttpError(status, providerStatus, detail);
  return sanitizeProviderError(error);
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
        if (!response.ok) await throwGeminiHttpError(response);
        const payload = await response.json() as { models?: unknown; nextPageToken?: unknown };
        if (!Array.isArray(payload.models) || (payload.nextPageToken !== undefined && typeof payload.nextPageToken !== "string")) throw new ProviderAdapterError("provider", "gemini_models_parse");
        for (const raw of payload.models) {
          if (!raw || typeof raw !== "object") throw new ProviderAdapterError("provider", "gemini_models_parse");
          const model = raw as GeminiModelLike;
          const normalized = asModel(model);
          const identity = normalized.providerModelName?.trim().toLocaleLowerCase("en");
          if (!identity || seen.has(identity)) continue;
          seen.add(identity); result.push(normalized);
        }
        pageToken = payload.nextPageToken || undefined;
        if (pageToken && seenTokens.has(pageToken)) throw new ProviderAdapterError("provider", "gemini_models_pagination");
        if (pageToken) seenTokens.add(pageToken);
      } while (pageToken);
      return result;
    } catch (error) { throw sanitizeGeminiError(error); }
  }

  async getModelMetadata({ apiKey, modelId: id, signal }: { apiKey: string; modelId: string; signal?: AbortSignal }): Promise<ModelMetadata> {
    try {
      if (signal?.aborted) throw new ProviderAdapterError("cancelled");
      const identity = geminiModelIdentity(id);
      if (!identity.generationModelId) throw new ProviderAdapterError("incompatible", "gemini_model_not_found");
      const response = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/${identity.providerModelName}`, { method: "GET", headers: { "x-goog-api-key": apiKey, accept: "application/json" }, signal });
      if (!response.ok) await throwGeminiHttpError(response);
      const payload = await response.json().catch(() => { throw new ProviderAdapterError("provider", "gemini_invalid_json"); }) as unknown;
      if (!payload || typeof payload !== "object") throw new ProviderAdapterError("provider", "gemini_invalid_json");
      return asModel(payload as GeminiModelLike);
    } catch (error) { throw sanitizeGeminiError(error); }
  }

  async countTokens({ apiKey, modelId: id, text, signal }: TokenCountRequest): Promise<TokenCount> {
    try {
      if (signal?.aborted) throw new ProviderAdapterError("cancelled");
      const response = await this.client(apiKey).models.countTokens({ model: modelId(id), contents: text, config: { abortSignal: signal } });
      if (!Number.isInteger(response.totalTokens) || response.totalTokens! < 0) throw new ProviderAdapterError("provider");
      return { tokens: response.totalTokens!, estimated: false };
    } catch (error) { throw sanitizeGeminiError(error); }
  }

  async planTools(request: ToolPlanRequest): Promise<ToolPlan> {
    try {
      if (request.signal?.aborted) throw new ProviderAdapterError("cancelled");
      const response = await this.client(request.apiKey).models.generateContent({
        model: modelId(request.modelId),
        contents: geminiContents(request.messages),
        config: {
          abortSignal: request.signal,
          ...(geminiSystemInstruction(request.messages) ? { systemInstruction: geminiSystemInstruction(request.messages) } : {}),
          tools: [{ functionDeclarations: request.tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        },
      });
      const text = extractGeminiText(response);
      const calls = responseFunctionCalls(response);
      if (!text && !calls.length) throw geminiResponseError(response);
      const finishReason = responseFinishReason(response);
      return { toolCalls: calls.map((call, index) => ({ id: call.id ?? `gemini-call-${index}`, name: call.name ?? "", args: call.args })), ...(text ? { text } : {}), ...(responseUsage(response) ? { usage: responseUsage(response) } : {}), ...(finishReason ? { finishReason } : {}) };
    } catch (error) { throw sanitizeGeminiError(error); }
  }

  async *streamResponse(request: StreamResponseRequest): AsyncIterable<ProviderStreamEvent> {
    try {
      if (request.signal?.aborted) throw new ProviderAdapterError("cancelled");
      const response = await this.client(request.apiKey).models.generateContent({
        model: modelId(request.modelId),
        contents: geminiContents(request.messages),
        config: { maxOutputTokens: request.maxOutputTokens, abortSignal: request.signal, ...(geminiSystemInstruction(request.messages) ? { systemInstruction: geminiSystemInstruction(request.messages) } : {}) },
      });
      const text = extractGeminiText(response);
      if (!text) throw geminiResponseError(response);
      yield { type: "text_delta", delta: text };
      const usage = responseUsage(response); if (usage) yield { type: "usage", usage };
      yield { type: "done", finishReason: responseFinishReason(response) ?? "STOP" };
    } catch (error) {
      if (error instanceof SyntaxError) throw new ProviderAdapterError("provider", "gemini_invalid_json");
      throw sanitizeGeminiError(error);
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
