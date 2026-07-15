import { z } from "zod";
import { assistantStreamEventSchema, contextSnapshotSchema, documentScopeSchema, modelProfileSchema, sourceReferenceSchema, type AssistantStreamEvent } from "@/lib/assistant/schemas";
import { assertSafeForProvider } from "@/lib/assistant/privacy/assertions";
import { ANALYSIS_TOOL_NAMES, ANALYSIS_TOOL_SCHEMAS, type AnalysisToolName } from "@/lib/assistant/tools/registry";
import { ContextPlanner, responseModeInstructions, type ContextCandidate } from "@/lib/assistant/context/contextPlanner";
import { GeminiAdapter } from "@/lib/assistant/providers/geminiAdapter";
import { OpenAICompatibleAdapter } from "@/lib/assistant/providers/openAiCompatibleAdapter";
import { createPinnedManualFetcher, validateManualEndpointUrl } from "@/lib/assistant/server/manualEndpoint";
import { PROVIDER_PRESETS, ProviderAdapterError, sanitizeProviderError, type AIProviderAdapter, type ProviderId, type ProviderMessage, type ProviderStreamEvent, type ProviderTool } from "@/lib/assistant/providers/types";
import { SafeDeltaBuffer } from "@/lib/assistant/streamProtocol";
import { canonicalizePrivacyText } from "@/lib/assistant/privacy/patterns";
import { resolveSelectedModelMetadata } from "@/lib/assistant/modelMetadata";

const id = z.string().min(1).max(256);
const contextCandidateSchema = z.object({ id, kind: z.enum(["tool", "metadata", "lexical", "chunk", "message"]), content: z.string().max(32_768), tokens: z.number().int().nonnegative(), relevance: z.number().min(0).max(1), sourceId: id, sanitizedHash: id, factKey: id, facets: z.record(z.array(z.string())).optional(), scope: documentScopeSchema }).strict();
const generalHistorySchema = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8_192) }).strict()).max(12);
const compactedContextSchema = z.object({ snapshot: contextSnapshotSchema, payloadMessages: z.array(z.object({ id, content: z.string().max(32_768), tokens: z.number().int().nonnegative() }).strict()).max(256) }).strict();
const compactionLineageSchema = z.object({ decisions: z.array(z.string().max(1_000)).max(256), figures: z.array(z.number().finite()).max(256), sourceIds: z.array(id).max(256), actionIds: z.array(id).max(256), personIds: z.array(id).max(256), analysisVersion: id }).strict();
const common = { executionId: z.string().uuid().optional(), conversationId: id, analysisId: id.optional(), roundId: id, roundNumber: z.number().int().min(1).max(3), modelProfileId: id, modelId: id, profile: modelProfileSchema.optional(), apiKey: z.string().min(1).max(4_096).optional(), privacyBlockedTerms: z.array(z.string().min(2).max(256)).max(200).optional(), responseMode: z.enum(["strict", "flexible"]), contextStrategy: z.enum(["automatic", "full", "optimized"]), contextCandidates: z.array(contextCandidateSchema).max(256).optional(), generalHistory: generalHistorySchema.optional(), compactedContext: compactedContextSchema.optional(), compactionLineage: compactionLineageSchema.optional(), safetyMarginPercent: z.number().min(0).max(50).optional(), warningThresholdPercent: z.number().min(1).max(99).optional(), compactionThresholdPercent: z.number().min(1).max(100).optional() };
const general = z.object({ phase: z.literal("general"), ...common, question: z.string().min(1).max(16_384) }).strict();
const plan = z.object({ phase: z.literal("plan"), ...common, question: z.string().min(1).max(16_384), tools: z.array(z.enum(ANALYSIS_TOOL_NAMES)).max(18) }).strict();
const toolResult = z.object({ requestId: id, tool: z.enum(ANALYSIS_TOOL_NAMES), args: z.unknown().optional(), data: z.unknown().optional(), result: z.unknown().optional(), sources: z.array(sourceReferenceSchema).max(100).optional() }).strict().superRefine((value, context) => { if (value.data === undefined && value.result === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: "Falta el resultado de la herramienta." }); });
const respond = z.object({ phase: z.literal("respond"), ...common, question: z.string().min(1).max(16_384), tools: z.array(z.enum(ANALYSIS_TOOL_NAMES)).max(18).optional(), toolResults: z.array(toolResult).min(1).max(18) }).strict();
const continuation = z.object({ phase: z.literal("continue"), ...common, question: z.string().min(1).max(16_384).optional(), tools: z.array(z.enum(ANALYSIS_TOOL_NAMES)).max(18).optional(), toolResults: z.array(toolResult).max(18).optional(), interruptedMessageId: id, continuationContext: z.string().min(1).max(16_384) }).strict();
export const chatRequestSchema = z.discriminatedUnion("phase", [general, plan, respond, continuation]).superRefine((value, context) => {
  if (value.phase === "general" && value.analysisId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["analysisId"], message: "El chat general no puede acceder a un análisis." });
  if (value.profile && (value.profile.id !== value.modelProfileId || value.profile.modelId !== value.modelId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "El perfil y el modelo no coinciden con la ronda." });
  if (value.analysisId && value.profile && !value.profile.analysisCompatible) context.addIssue({ code: z.ZodIssueCode.custom, message: "El perfil no es compatible con análisis." });
  if (!value.analysisId && value.profile && !value.profile.generalChatCompatible) context.addIssue({ code: z.ZodIssueCode.custom, message: "El perfil no es compatible con chat general." });
  const expected = value.analysisId ? { type: "analysis", analysisId: value.analysisId } as const : { type: "conversation", conversationId: value.conversationId } as const;
  for (const [index, candidate] of (value.contextCandidates ?? []).entries()) if (!sameScope(candidate.scope, expected)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["contextCandidates", index, "scope"], message: "El contexto no pertenece a esta ronda." });
  if (value.compactedContext && (value.compactedContext.snapshot.conversationId !== value.conversationId || value.compactedContext.snapshot.analysisId !== value.analysisId || value.compactedContext.snapshot.actualStrategy !== value.contextStrategy || value.compactedContext.snapshot.actualResponseMode !== value.responseMode)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["compactedContext"], message: "El snapshot no pertenece a esta ronda." });
  const toolResults = value.phase === "respond" || value.phase === "continue" ? value.toolResults ?? [] : [];
  for (const [resultIndex, result] of toolResults.entries()) for (const [sourceIndex, source] of (result.sources ?? []).entries()) if (source.availability !== "available" || source.conversationId !== value.conversationId || source.analysisId !== value.analysisId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toolResults", resultIndex, "sources", sourceIndex], message: "La fuente no pertenece al scope disponible de la ronda." });
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export interface ChatExecutionService { execute(input: ChatRequest, signal: AbortSignal): AsyncIterable<AssistantStreamEvent> }
export const DEFAULT_CHAT_DEADLINE_MS = 60_000;
export const MAX_CHAT_REQUEST_BYTES = 128 * 1024;

function sameScope(left: z.infer<typeof documentScopeSchema>, right: z.infer<typeof documentScopeSchema>): boolean { return left.type === right.type && (left.type === "analysis" ? right.type === "analysis" && left.analysisId === right.analysisId : right.type === "conversation" && left.conversationId === right.conversationId); }
function deadlineSignal(parent: AbortSignal, milliseconds: number) { const controller = new AbortController(); const abort = () => { if (!controller.signal.aborted) controller.abort(new DOMException("Cancelled", "AbortError")); }; if (parent.aborted) abort(); else parent.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, milliseconds); return { signal: controller.signal, abort, dispose() { clearTimeout(timer); parent.removeEventListener("abort", abort); } }; }

function safeError(roundId: string, error: unknown): AssistantStreamEvent {
  const safe = sanitizeProviderError(error);
  return { type: "error", roundId, code: safe.code, classification: safe.classification, message: safe.publicMessage, retryable: safe.classification === "transient" };
}

function assertNoBlockedTerms(value: unknown, terms: readonly string[]): void { const serialized = canonicalizePrivacyText(JSON.stringify(value)); if (terms.some((term) => { const canonical = canonicalizePrivacyText(term); return canonical.length > 1 && serialized.includes(canonical); })) throw new ProviderAdapterError("privacy", "privacy_known_name"); }
function assertRequestSafe(input: ChatRequest): void { const { apiKey: _apiKey, privacyBlockedTerms = [], ...providerInput } = input; void _apiKey; assertSafeForProvider(providerInput); assertNoBlockedTerms(providerInput, privacyBlockedTerms); }

async function readLimitedJson(request: Request): Promise<unknown> {
  if (!request.body) return undefined;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_CHAT_REQUEST_BYTES) { await reader.cancel(); throw new RangeError("request_too_large"); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
}

export function createChatPostHandler(service: ChatExecutionService, options: { deadlineMs?: number } = {}) {
  // Esta frontera del servidor valida estructura y privacidad; la autorización pertenece al validator local enlazado a repositorios.
  return async (request: Request): Promise<Response> => {
    const declared = Number(request.headers.get("content-length")); if (Number.isFinite(declared) && declared > MAX_CHAT_REQUEST_BYTES) return Response.json({ error: "Solicitud de chat no válida." }, { status: 413 });
    let body: unknown; try { body = await readLimitedJson(request); } catch (error) { return Response.json({ error: "Solicitud de chat no válida." }, { status: error instanceof RangeError ? 413 : 400 }); }
    const parsed = chatRequestSchema.safeParse(body); if (!parsed.success) return Response.json({ error: "Solicitud de chat no válida." }, { status: 400 });
    try { assertRequestSafe(parsed.data); const toolResults = parsed.data.phase === "respond" || parsed.data.phase === "continue" ? parsed.data.toolResults ?? [] : []; for (const entry of toolResults) ANALYSIS_TOOL_SCHEMAS[entry.tool].output.parse(entry.data ?? entry.result); } catch { return Response.json({ error: "La solicitud fue bloqueada por privacidad o validación." }, { status: 400 }); }
    const deadline = deadlineSignal(request.signal, options.deadlineMs ?? DEFAULT_CHAT_DEADLINE_MS); const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ async start(controller) {
      const blocked = parsed.data.privacyBlockedTerms ?? []; const messageId = `${parsed.data.executionId ?? "legacy"}:message:${parsed.data.roundNumber}`; let eventCount = 0;
      const emit = (event: AssistantStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(assistantStreamEventSchema.parse(event))}\n`));
      const auditText = (text: string) => { try { assertSafeForProvider(text); assertNoBlockedTerms(text, blocked); } catch { throw new ProviderAdapterError("privacy", "privacy_output"); } };
      const buffer = new SafeDeltaBuffer(auditText);
      const flush = () => { for (const delta of buffer.flush()) emit({ type: "text_delta", roundId: parsed.data.roundId, messageId, delta }); };
      try {
        for await (const raw of service.execute(parsed.data, deadline.signal)) {
          if (++eventCount > 1_000) throw new ProviderAdapterError("context", "too_many_events"); const event = assistantStreamEventSchema.parse(raw);
          if (event.roundId !== parsed.data.roundId) throw new ProviderAdapterError("provider", "round_mismatch");
          if (event.type === "text_delta") { for (const delta of buffer.push(event.delta)) emit({ type: "text_delta", roundId: event.roundId, messageId, delta }); continue; }
          if (event.type === "done" || event.type === "error") flush();
          assertSafeForProvider(event); assertNoBlockedTerms(event, blocked); emit(event);
        }
        flush();
      } catch (error) {
        let outgoing = error instanceof RangeError ? new ProviderAdapterError("context", "output_too_large") : error; try { flush(); } catch (privacy) { outgoing = privacy; }
        try { emit(safeError(parsed.data.roundId, outgoing)); } catch { /* cancelled consumer */ }
      } finally { deadline.dispose(); try { controller.close(); } catch { /* cancelled consumer */ } }
    }, cancel() { deadline.abort(); deadline.dispose(); } });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  };
}

export function createAssistantChatRoute(resolveAdapter: ChatAdapterResolver = createProductionChatAdapterResolver()) { return createChatPostHandler(createChatService(resolveAdapter)); }

export interface ChatAdapterBinding { readonly adapter: AIProviderAdapter; readonly apiKey: string }
export type ChatAdapterResolver = (input: ChatRequest) => Promise<ChatAdapterBinding>;
type ServerEnv = Readonly<Record<string, string | undefined>>;
export function createProductionChatAdapterResolver(options: { env?: ServerEnv; resolveAdapter?: (provider: ProviderId, baseUrl: string) => AIProviderAdapter } = {}): ChatAdapterResolver {
  const env = options.env ?? process.env;
  const adapterFactory = options.resolveAdapter ?? ((provider, baseUrl) => provider === "gemini" ? new GeminiAdapter() : new OpenAICompatibleAdapter({ provider, baseUrl, ...(provider === "manual" ? { fetcher: createPinnedManualFetcher() } : {}) }));
  return async (input) => {
    const profile = input.profile; if (!profile || !profile.enabled) throw new ProviderAdapterError("incompatible", "profile_unavailable");
    let baseUrl = profile.provider === "manual" ? validateManualEndpointUrl(profile.baseUrl).toString().replace(/\/+$/, "") : (PROVIDER_PRESETS[profile.provider].baseUrl ?? "");
    const apiKey = profile.provider === "manual" ? input.apiKey : env[PROVIDER_PRESETS[profile.provider].envName ?? ""];
    if (!apiKey) throw new ProviderAdapterError("auth", "provider_auth");
    return { adapter: adapterFactory(profile.provider, baseUrl), apiKey };
  };
}

export function providerTools(names: readonly AnalysisToolName[]): ProviderTool[] { return names.map((name) => ({ name, description: `Consulta local ${name}`, parameters: ANALYSIS_TOOL_SCHEMAS[name].provider })); }

async function counted(adapter: AIProviderAdapter, apiKey: string, modelId: string, text: string, signal: AbortSignal): Promise<number> { const count = await adapter.countTokens({ apiKey, modelId, text, signal }); if (!Number.isInteger(count.tokens) || count.tokens < 0) throw new ProviderAdapterError("provider", "invalid_token_count"); return count.tokens; }
async function messagesFor(input: ChatRequest, adapter: AIProviderAdapter, apiKey: string, tools: readonly ProviderTool[], signal: AbortSignal) {
  const instruction = responseModeInstructions(input.responseMode); const continuationInstruction = "Continúa exactamente desde el contenido parcial anterior, sin repetirlo ni reiniciar la respuesta."; const question = input.phase === "continue" ? continuationInstruction : input.question;
  const selectedMetadata = resolveSelectedModelMetadata(input.profile, input.modelId);
  const generationModelId = selectedMetadata.generationModelId || input.modelId;
  const { requestedMaxOutputTokens } = selectedMetadata;
  const promptTokens = await counted(adapter, apiKey, generationModelId, `${instruction}\n${question}`, signal); const toolSchemaTokens = await counted(adapter, apiKey, generationModelId, JSON.stringify(tools), signal);
  const scope = input.analysisId ? { type: "analysis", analysisId: input.analysisId } as const : { type: "conversation", conversationId: input.conversationId } as const;
  const candidates: ContextCandidate[] = []; for (const candidate of input.contextCandidates ?? []) candidates.push({ ...candidate, tokens: await counted(adapter, apiKey, generationModelId, candidate.content, signal) });
  const contextWindow = selectedMetadata.contextWindow; if (!contextWindow) throw new ProviderAdapterError("context", "context_window_unknown");
  let plan; try { plan = new ContextPlanner().plan({ strategy: input.contextStrategy, responseMode: input.responseMode, candidates, scope, contextWindow, promptTokens, toolSchemaTokens, outputTokens: requestedMaxOutputTokens, safetyMarginPercent: input.safetyMarginPercent, warningThresholdPercent: input.warningThresholdPercent, compactionThresholdPercent: input.compactionThresholdPercent }); } catch { throw new ProviderAdapterError("context", "context_budget_invalid"); }
  const statuses: AssistantStreamEvent[] = []; if (plan.budget.warning) statuses.push({ type: "status", roundId: input.roundId, code: "context_warning", label: "El contexto supera el umbral de aviso." });
  let contextItems = plan.items.map((item) => item.content);
  if (plan.budget.requiresCompaction) {
    const summarized = plan.items.filter((item) => item.kind === "message"); const summary = `Resumen de contexto previo (${summarized.length} mensajes): ${summarized.map((item) => item.content.slice(0, 512)).join(" ")}`;
    try { assertSafeForProvider(summary); assertNoBlockedTerms(summary, input.privacyBlockedTerms ?? []); } catch { throw new ProviderAdapterError("privacy", "privacy_compaction"); }
    const summaryTokens = await counted(adapter, apiKey, generationModelId, summary, signal); const compacted: ContextCandidate = { id: `${input.executionId ?? "legacy"}:summary`, kind: "message", content: summary, tokens: summaryTokens, relevance: 1, sourceId: `${input.executionId ?? "legacy"}:snapshot-source`, sanitizedHash: `summary-${summaryTokens}`, factKey: "context:summary", scope };
    try { plan = new ContextPlanner().plan({ strategy: input.contextStrategy, responseMode: input.responseMode, candidates: [...plan.items.filter((item) => item.kind !== "message"), compacted], scope, contextWindow, promptTokens, toolSchemaTokens, outputTokens: requestedMaxOutputTokens, safetyMarginPercent: input.safetyMarginPercent, warningThresholdPercent: input.warningThresholdPercent, compactionThresholdPercent: input.compactionThresholdPercent }); } catch { throw new ProviderAdapterError("context", "context_compaction_failed"); }
    if (plan.budget.requiresCompaction) throw new ProviderAdapterError("context", "context_compaction_insufficient");
    contextItems = plan.items.map((item) => item.content);
    const lineage = input.compactionLineage;
    const snapshot = contextSnapshotSchema.parse({ id: `${input.executionId ?? "legacy"}:snapshot:${input.roundNumber}`, conversationId: input.conversationId, ...(input.analysisId ? { analysisId: input.analysisId } : {}), summary, summarizedMessageIds: summarized.map((item) => item.id), decisions: lineage?.decisions ?? [], figures: lineage?.figures ?? [], sourceIds: [...new Set([...(lineage?.sourceIds ?? []), ...summarized.map((item) => item.sourceId)])], actionIds: lineage?.actionIds ?? [], personIds: lineage?.personIds ?? [], analysisVersion: lineage?.analysisVersion ?? input.compactedContext?.snapshot.analysisVersion ?? "current", actualStrategy: input.contextStrategy, actualResponseMode: input.responseMode, createdAt: new Date().toISOString() });
    statuses.push({ type: "status", roundId: input.roundId, code: "context_compacted", label: "El contexto fue compactado automáticamente.", snapshot });
  }
  const context = contextItems.join("\n\n");
  const messages: ProviderMessage[] = [{ role: "system", content: `${instruction}${context ? `\n\nContexto sanitizado:\n${context}` : ""}` }];
  if (input.phase === "respond") { messages.push({ role: "user", content: input.question }); messages.push({ role: "tool", content: JSON.stringify(input.toolResults.map((entry) => ({ requestId: entry.requestId, tool: entry.tool, args: entry.args, data: entry.data ?? entry.result, sources: entry.sources ?? [] }))) }); }
  else if (input.phase === "continue") { messages.push({ role: "assistant", content: input.continuationContext }); messages.push({ role: "user", content: continuationInstruction }); if (input.toolResults?.length) messages.push({ role: "tool", content: JSON.stringify(input.toolResults.map((entry) => ({ requestId: entry.requestId, tool: entry.tool, args: entry.args, data: entry.data ?? entry.result, sources: entry.sources ?? [] }))) }); }
  else messages.push({ role: "user", content: input.question });
  const finalTokens = await counted(adapter, apiKey, generationModelId, messages.map((message) => message.content).join("\n") + JSON.stringify(tools), signal); if (finalTokens + requestedMaxOutputTokens + Math.ceil(contextWindow * ((input.safetyMarginPercent ?? 10) / 100)) > contextWindow) throw new ProviderAdapterError("context", "context_overflow");
  return { messages, statuses, generationModelId, requestedMaxOutputTokens };
}

function messagesForGeneral(input: Extract<ChatRequest, { phase: "general" }>): readonly ProviderMessage[] {
  const maxInputCharacters = 16_000;
  const context = (input.contextCandidates ?? []).map((candidate) => candidate.content).join("\n\n").slice(0, 4_000);
  const system = `${responseModeInstructions(input.responseMode)}${context ? `\n\nContexto sanitizado:\n${context}` : ""}`;
  const history = [...(input.generalHistory ?? [])].reverse().reduce<{ role: "user" | "assistant"; content: string }[]>((kept, message) => {
    const used = kept.reduce((sum, item) => sum + item.content.length, system.length + input.question.length);
    return used + message.content.length > maxInputCharacters ? kept : [message, ...kept];
  }, []);
  return [
    { role: "system", content: system },
    ...history,
    { role: "user", content: input.question },
  ];
}

export function createChatService(resolveAdapter: ChatAdapterResolver = createProductionChatAdapterResolver()): ChatExecutionService {
  return { async *execute(input, signal) { assertRequestSafe(input); const { adapter, apiKey } = await resolveAdapter(input);
    if (input.phase === "general") {
      const selectedMetadata = resolveSelectedModelMetadata(input.profile, input.modelId);
      yield { type: "status", roundId: input.roundId, label: "Generando respuesta" };
      for await (const event of adapter.streamResponse({ apiKey, signal, modelId: selectedMetadata.generationModelId || input.modelId, messages: messagesForGeneral(input), maxOutputTokens: selectedMetadata.requestedMaxOutputTokens })) {
        const converted = providerEvent(input, event); if (converted) yield converted;
      }
      return;
    }
    const toolNames = input.phase === "plan" ? input.tools : input.tools ?? ANALYSIS_TOOL_NAMES; const tools = providerTools(toolNames); const prepared = await messagesFor(input, adapter, apiKey, tools, signal); const { messages } = prepared; for (const status of prepared.statuses) yield status;
    for (const result of input.phase === "plan" ? [] : input.toolResults ?? []) yield { type: "tool_result_ack", roundId: input.roundId, requestId: result.requestId };
    yield { type: "status", roundId: input.roundId, label: "Planificando herramientas" };
    const result = await adapter.planTools({ apiKey, signal, modelId: prepared.generationModelId, messages, tools, maxOutputTokens: prepared.requestedMaxOutputTokens });
    if (result.blockReason) throw new ProviderAdapterError("provider", "gemini_blocked");
    if (result.text) yield { type: "text_delta", roundId: input.roundId, messageId: `${input.executionId ?? "legacy"}:message:${input.roundNumber}`, delta: result.text };
    if (result.usage) yield { type: "usage", roundId: input.roundId, usage: result.usage };
    if (result.toolCalls.length) { for (const call of result.toolCalls) { if (!ANALYSIS_TOOL_NAMES.includes(call.name as AnalysisToolName)) throw new ProviderAdapterError("provider", "tool_not_allowed"); const tool = call.name as AnalysisToolName; ANALYSIS_TOOL_SCHEMAS[tool].input.parse(call.args); assertSafeForProvider(call.args); yield { type: "tool_request", roundId: input.roundId, requestId: call.id, tool, args: call.args }; } yield { type: "done", roundId: input.roundId, finishReason: "tool_request" }; return; }
    if (result.text) { yield { type: "done", roundId: input.roundId, finishReason: result.finishReason ?? "STOP" }; return; }
    for await (const event of adapter.streamResponse({ apiKey, signal, modelId: prepared.generationModelId, messages, maxOutputTokens: prepared.requestedMaxOutputTokens })) { const converted = providerEvent(input, event); if (converted) yield converted; }
  } };
}
function providerEvent(input: ChatRequest, event: ProviderStreamEvent): AssistantStreamEvent | undefined { if (event.type === "text_delta") return { type: "text_delta", roundId: input.roundId, messageId: `${input.executionId ?? "legacy"}:message:${input.roundNumber}`, delta: event.delta }; if (event.type === "usage") return { type: "usage", roundId: input.roundId, usage: event.usage }; return { type: "done", roundId: input.roundId, finishReason: event.finishReason }; }
