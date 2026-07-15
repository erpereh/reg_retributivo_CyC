import { z } from "zod";
import { assistantStreamEventSchema, contextSnapshotSchema, documentScopeSchema, modelProfileSchema, sourceReferenceSchema, type AssistantStreamEvent } from "@/lib/assistant/schemas";
import { assertSafeForProvider } from "@/lib/assistant/privacy/assertions";
import { ANALYSIS_TOOL_DESCRIPTIONS, ANALYSIS_TOOL_NAMES, ANALYSIS_TOOL_SCHEMAS, type AnalysisToolName } from "@/lib/assistant/tools/registry";
import { ContextPlanner, responseModeInstructions, type ContextCandidate } from "@/lib/assistant/context/contextPlanner";
import { GeminiAdapter } from "@/lib/assistant/providers/geminiAdapter";
import { OpenAICompatibleAdapter } from "@/lib/assistant/providers/openAiCompatibleAdapter";
import { createPinnedManualFetcher, validateManualEndpointUrl } from "@/lib/assistant/server/manualEndpoint";
import { PROVIDER_PRESETS, ProviderAdapterError, sanitizeProviderError, type AIProviderAdapter, type ProviderId, type ProviderMessage, type ProviderStreamEvent, type ProviderTool } from "@/lib/assistant/providers/types";
import { SafeDeltaBuffer } from "@/lib/assistant/streamProtocol";
import { canonicalizePrivacyText } from "@/lib/assistant/privacy/patterns";
import { resolveSelectedModelMetadata } from "@/lib/assistant/modelMetadata";
import { assertEphemeralProviderMetadata, canonicalizeToolArguments, createLocalToolRequestId, toolCallsMatch, type ToolRound } from "@/lib/assistant/toolRounds";
import { verifyToolGrounding } from "@/lib/assistant/toolGrounding";

const id = z.string().min(1).max(256);
const contextCandidateSchema = z.object({ id, kind: z.enum(["tool", "metadata", "lexical", "chunk", "message"]), content: z.string().max(32_768), tokens: z.number().int().nonnegative(), relevance: z.number().min(0).max(1), sourceId: id, sanitizedHash: id, factKey: id, facets: z.record(z.array(z.string())).optional(), scope: documentScopeSchema }).strict();
const generalHistorySchema = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8_192) }).strict()).max(12);
const compactedContextSchema = z.object({ snapshot: contextSnapshotSchema, payloadMessages: z.array(z.object({ id, content: z.string().max(32_768), tokens: z.number().int().nonnegative() }).strict()).max(256) }).strict();
const compactionLineageSchema = z.object({ decisions: z.array(z.string().max(1_000)).max(256), figures: z.array(z.number().finite()).max(256), sourceIds: z.array(id).max(256), actionIds: z.array(id).max(256), personIds: z.array(id).max(256), analysisVersion: id }).strict();
const analysisContextSchema = z.object({ associatedPersonIds: z.array(id).max(100), primaryPersonId: id.optional(), analysisVersion: id.optional() }).strict();
const common = { executionId: z.string().uuid().optional(), conversationId: id, analysisId: id.optional(), analysisContext: analysisContextSchema.optional(), roundId: id, roundNumber: z.number().int().min(1).max(3), modelProfileId: id, modelId: id, profile: modelProfileSchema.optional(), apiKey: z.string().min(1).max(4_096).optional(), privacyBlockedTerms: z.array(z.string().min(2).max(256)).max(200).optional(), responseMode: z.enum(["strict", "flexible"]), contextStrategy: z.enum(["automatic", "full", "optimized"]), contextCandidates: z.array(contextCandidateSchema).max(256).optional(), generalHistory: generalHistorySchema.optional(), compactedContext: compactedContextSchema.optional(), compactionLineage: compactionLineageSchema.optional(), safetyMarginPercent: z.number().min(0).max(50).optional(), warningThresholdPercent: z.number().min(1).max(99).optional(), compactionThresholdPercent: z.number().min(1).max(100).optional() };
const general = z.object({ phase: z.literal("general"), ...common, question: z.string().min(1).max(16_384) }).strict();
const plan = z.object({ phase: z.literal("plan"), ...common, question: z.string().min(1).max(16_384), tools: z.array(z.enum(ANALYSIS_TOOL_NAMES)).max(18) }).strict();
const toolCall = z.object({ executionId: id, roundId: id, requestId: id, name: z.enum(ANALYSIS_TOOL_NAMES), args: z.unknown(), argsHash: z.string().min(32).max(128), providerMetadata: z.unknown().optional() }).strict();
const toolOutcome = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }).strict(),
  z.object({ ok: z.literal(true), data: z.null(), empty: z.literal(true), message: z.string().min(1).max(500) }).strict(),
  z.object({ ok: z.literal(false), error: z.object({ code: id, message: z.string().min(1).max(500) }).strict() }).strict(),
]);
const toolResult = z.object({ executionId: id, roundId: id, requestId: id, name: z.enum(ANALYSIS_TOOL_NAMES), args: z.unknown(), argsHash: z.string().min(32).max(128), outcome: toolOutcome, sources: z.array(sourceReferenceSchema).max(100).default([]) }).strict();
const toolRound = z.object({ executionId: id, roundId: id, text: z.string().max(16_384).optional(), calls: z.array(toolCall).min(1).max(18), results: z.array(toolResult).min(1).max(18) }).strict();
const respond = z.object({ phase: z.literal("respond"), ...common, question: z.string().min(1).max(16_384), tools: z.array(z.enum(ANALYSIS_TOOL_NAMES)).max(18).optional(), toolRounds: z.array(toolRound).min(1).max(3) }).strict();
const continuation = z.object({ phase: z.literal("continue"), ...common, question: z.string().min(1).max(16_384), tools: z.array(z.enum(ANALYSIS_TOOL_NAMES)).max(18).optional(), toolRounds: z.array(toolRound).min(1).max(3).optional(), interruptedMessageId: id.optional(), continuationContext: z.string().min(1).max(16_384).optional() }).strict();
export const chatRequestSchema = z.discriminatedUnion("phase", [general, plan, respond, continuation]).superRefine((value, context) => {
  if (value.phase === "general" && value.analysisId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["analysisId"], message: "El chat general no puede acceder a un análisis." });
  if (value.profile && (value.profile.id !== value.modelProfileId || value.profile.modelId !== value.modelId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "El perfil y el modelo no coinciden con la ronda." });
  if (value.analysisId && value.profile && !value.profile.analysisCompatible) context.addIssue({ code: z.ZodIssueCode.custom, message: "El perfil no es compatible con análisis." });
  if (!value.analysisId && value.profile && !value.profile.generalChatCompatible) context.addIssue({ code: z.ZodIssueCode.custom, message: "El perfil no es compatible con chat general." });
  const expected = value.analysisId ? { type: "analysis", analysisId: value.analysisId } as const : { type: "conversation", conversationId: value.conversationId } as const;
  for (const [index, candidate] of (value.contextCandidates ?? []).entries()) if (!sameScope(candidate.scope, expected)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["contextCandidates", index, "scope"], message: "El contexto no pertenece a esta ronda." });
  if (value.compactedContext && (value.compactedContext.snapshot.conversationId !== value.conversationId || value.compactedContext.snapshot.analysisId !== value.analysisId || value.compactedContext.snapshot.actualStrategy !== value.contextStrategy || value.compactedContext.snapshot.actualResponseMode !== value.responseMode)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["compactedContext"], message: "El snapshot no pertenece a esta ronda." });
  if (value.analysisContext?.primaryPersonId && !value.analysisContext.associatedPersonIds.includes(value.analysisContext.primaryPersonId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["analysisContext", "primaryPersonId"], message: "La persona principal debe estar asociada a la conversación." });
  const toolRounds = value.phase === "respond" || value.phase === "continue" ? value.toolRounds ?? [] : [];
  for (const [roundIndex, round] of toolRounds.entries()) {
    if (!value.executionId || round.executionId !== value.executionId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toolRounds", roundIndex, "executionId"], message: "La ronda no pertenece a la ejecución activa." });
    const requestIds = new Set<string>(); const resultIds = new Set<string>();
    for (const [callIndex, call] of round.calls.entries()) {
      if (call.executionId !== round.executionId || call.roundId !== round.roundId || requestIds.has(call.requestId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toolRounds", roundIndex, "calls", callIndex], message: "La llamada de herramienta no pertenece a la ronda." });
      requestIds.add(call.requestId);
    }
    for (const [resultIndex, result] of round.results.entries()) {
      const call = round.calls.find((candidate) => candidate.requestId === result.requestId);
      if (resultIds.has(result.requestId) || !call || call.executionId !== result.executionId || call.roundId !== result.roundId || call.name !== result.name || call.argsHash !== result.argsHash) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toolRounds", roundIndex, "results", resultIndex], message: "El resultado no corresponde a una llamada previa." });
      resultIds.add(result.requestId);
      for (const [sourceIndex, source] of result.sources.entries()) if (source.availability !== "available" || source.conversationId !== value.conversationId || source.analysisId !== value.analysisId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toolRounds", roundIndex, "results", resultIndex, "sources", sourceIndex], message: "La fuente no pertenece al scope disponible de la ronda." });
    }
    if (round.results.length !== round.calls.length || resultIds.size !== requestIds.size || [...requestIds].some((requestId) => !resultIds.has(requestId))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toolRounds", roundIndex, "results"], message: "Cada llamada debe tener exactamente un resultado." });
  }
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
async function validateToolRounds(input: ChatRequest): Promise<void> {
  if (input.phase !== "respond" && input.phase !== "continue") return;
  if (!input.analysisId) throw new ProviderAdapterError("privacy", "tool_analysis_required");
  for (const round of input.toolRounds ?? []) {
    if (!input.executionId || round.executionId !== input.executionId) throw new ProviderAdapterError("privacy", "tool_execution_mismatch");
    const requestIds = new Set<string>(); const resultIds = new Set<string>();
    for (const call of round.calls) {
      if (requestIds.has(call.requestId) || call.executionId !== round.executionId || call.roundId !== round.roundId) throw new ProviderAdapterError("privacy", "tool_call_mismatch");
      requestIds.add(call.requestId);
      assertEphemeralProviderMetadata(call.providerMetadata);
      const canonical = await canonicalizeToolArguments(call.name, call.args);
      if (canonical.hash !== call.argsHash || (canonical.args as { analysisId?: unknown }).analysisId !== input.analysisId) throw new ProviderAdapterError("privacy", "tool_call_mismatch");
    }
    for (const result of round.results) {
      const call = round.calls.find((candidate) => candidate.requestId === result.requestId);
      const canonical = await canonicalizeToolArguments(result.name, result.args);
      if (resultIds.has(result.requestId) || !call || canonical.hash !== result.argsHash || !toolCallsMatch(call, result) || (canonical.args as { analysisId?: unknown }).analysisId !== input.analysisId) throw new ProviderAdapterError("privacy", "tool_result_mismatch");
      resultIds.add(result.requestId);
      if (result.outcome.ok && !("empty" in result.outcome)) ANALYSIS_TOOL_SCHEMAS[result.name].output.parse(result.outcome.data);
    }
    if (round.results.length !== round.calls.length || resultIds.size !== requestIds.size || [...requestIds].some((requestId) => !resultIds.has(requestId))) throw new ProviderAdapterError("privacy", "tool_result_mismatch");
  }
}

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
    try { assertRequestSafe(parsed.data); await validateToolRounds(parsed.data); } catch { return Response.json({ error: "La solicitud fue bloqueada por privacidad o validación." }, { status: 400 }); }
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

export function providerTools(names: readonly AnalysisToolName[]): ProviderTool[] { return names.map((name) => ({ name, description: ANALYSIS_TOOL_DESCRIPTIONS[name], parameters: ANALYSIS_TOOL_SCHEMAS[name].provider })); }

async function counted(adapter: AIProviderAdapter, apiKey: string, modelId: string, text: string, signal: AbortSignal): Promise<number> { const count = await adapter.countTokens({ apiKey, modelId, text, signal }); if (!Number.isInteger(count.tokens) || count.tokens < 0) throw new ProviderAdapterError("provider", "invalid_token_count"); return count.tokens; }
function analysisDomainInstruction(input: ChatRequest): string {
  const associated = input.analysisContext?.associatedPersonIds ?? [];
  const people = associated.length ? `\n\nPersonas asociadas a la conversación:\n${associated.map((personId) => `- matrícula ${personId}${personId === input.analysisContext?.primaryPersonId ? ", principal" : ""}`).join("\n")}` : "";
  return `Se está trabajando en una aplicación de auditoría retributiva. “Matrícula” significa el identificador interno de una persona trabajadora, nunca una matrícula de vehículo, aeronave, embarcación, estudiante, patente o registro público. El análisis activo y las personas asociadas son la fuente autorizada. Los resultados de herramientas son datos locales válidos de este análisis y debes responder basándote en ellos. No pidas país, institución o jurisdicción cuando exista una persona asociada o una herramienta haya devuelto su perfil. No afirmes que careces de información cuando acabas de recibir un resultado válido. No inventes datos ausentes.\n\nUsa exclusivamente los resultados de las herramientas y el contexto sanitizado para responder. Cuando una herramienta devuelva datos de una matrícula, considérala una persona trabajadora del análisis retributivo activo. Cita las cifras relevantes. No reinterpretar “matrícula” fuera de este dominio.${people}`;
}
function inputToolRounds(input: ChatRequest): readonly ToolRound[] { return input.phase === "respond" || input.phase === "continue" ? (input.toolRounds ?? []) as readonly ToolRound[] : []; }
function providerMessageTokenText(messages: readonly ProviderMessage[]): string {
  return messages.map((message) => {
    if (message.role === "assistant_tool_call") return `${message.content ?? ""}\n${message.calls.map((call) => `${call.name}:${JSON.stringify(call.args)}`).join("\n")}`;
    if (message.role === "tool_result") return message.results.map((result) => `${result.name}:${JSON.stringify(result.outcome)}`).join("\n");
    return message.content;
  }).join("\n");
}
async function messagesFor(input: ChatRequest, adapter: AIProviderAdapter, apiKey: string, tools: readonly ProviderTool[], signal: AbortSignal) {
  const instruction = responseModeInstructions(input.responseMode); const domain = analysisDomainInstruction(input); const question = input.question;
  const selectedMetadata = resolveSelectedModelMetadata(input.profile, input.modelId);
  const generationModelId = selectedMetadata.generationModelId || input.modelId;
  const { requestedMaxOutputTokens } = selectedMetadata;
  const promptTokens = await counted(adapter, apiKey, generationModelId, `${instruction}\n${domain}\n${question}`, signal); const toolSchemaTokens = await counted(adapter, apiKey, generationModelId, JSON.stringify(tools), signal);
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
  const messages: ProviderMessage[] = [{ role: "system", content: `${instruction}\n\n${domain}${context ? `\n\nContexto sanitizado:\n${context}` : ""}` }, { role: "user", content: input.question }];
  for (const round of inputToolRounds(input)) {
    messages.push({ role: "assistant_tool_call", ...(round.text?.trim() ? { content: round.text } : {}), calls: round.calls });
    messages.push({ role: "tool_result", results: round.results });
  }
  if (input.phase === "continue" && input.continuationContext?.trim()) messages.push({ role: "assistant", content: input.continuationContext }, { role: "user", content: "Continúa la respuesta desde el texto parcial sin repetirlo." });
  const finalTokens = await counted(adapter, apiKey, generationModelId, providerMessageTokenText(messages) + JSON.stringify(tools), signal); if (finalTokens + requestedMaxOutputTokens + Math.ceil(contextWindow * ((input.safetyMarginPercent ?? 10) / 100)) > contextWindow) throw new ProviderAdapterError("context", "context_overflow");
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

const PERSON_SCOPED_TOOLS = new Set<AnalysisToolName>(["findPersonByEmployeeId", "getPersonProfile", "getPersonPayrollPeriods", "getPersonConceptDifferences", "getPersonCuadreReg", "getPersonNormalizedData", "getPersonGroupings"]);
function questionHasExplicitPersonId(question: string): boolean { return /\bmatr[ií]cula\s*(?:n(?:ú|u)mero\s*)?[#:ºo.]?\s*[a-z0-9-]{1,64}\b/iu.test(question); }
async function normalizeProviderToolCall(input: ChatRequest, call: { readonly id?: string; readonly name: string; readonly args: unknown; readonly providerMetadata?: unknown }, ordinal: number) {
  if (!ANALYSIS_TOOL_NAMES.includes(call.name as AnalysisToolName)) throw new ProviderAdapterError("provider", "tool_not_allowed");
  const name = call.name as AnalysisToolName;
  let args = call.args;
  const primary = input.analysisContext?.primaryPersonId;
  if (PERSON_SCOPED_TOOLS.has(name) && !questionHasExplicitPersonId(input.question) && primary && input.analysisContext?.associatedPersonIds.includes(primary) && args && typeof args === "object" && !("personId" in args)) args = { ...args as Record<string, unknown>, personId: primary };
  const canonical = await canonicalizeToolArguments(name, args);
  assertSafeForProvider(canonical.args);
  assertEphemeralProviderMetadata(call.providerMetadata);
  return {
    requestId: call.id?.trim() || createLocalToolRequestId(input.executionId ?? "legacy", input.roundId, ordinal),
    tool: name,
    args: canonical.args,
    ...(call.providerMetadata === undefined ? {} : { providerMetadata: call.providerMetadata }),
  };
}

function semanticToolFallback(rounds: readonly ToolRound[]): string {
  const lines = ["Resultados locales autorizados:"];
  for (const result of rounds.flatMap((round) => round.results)) {
    if (!result.outcome.ok || "empty" in result.outcome) continue;
    const data = result.outcome.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== "object") continue;
    lines.push(`Herramienta: ${result.name}`);
    if (typeof data.personId === "string") lines.push(`Matrícula: ${data.personId}`);
    const totals = data.totals as Record<string, unknown> | undefined;
    if (totals && typeof totals === "object") {
      if (typeof totals.registro === "number") lines.push(`Registro Retributivo: ${totals.registro} EUR`);
      if (typeof totals.payroll === "number") lines.push(`Recibos: ${totals.payroll} EUR`);
      if (typeof totals.difference === "number") lines.push(`Diferencia: ${totals.difference} EUR`);
    }
    if (Array.isArray(data.concepts)) lines.push(`Diferencias por concepto disponibles: ${data.concepts.length}`);
  }
  return lines.join("\n").slice(0, 8 * 1024);
}

async function collectFinalText(adapter: AIProviderAdapter, request: { apiKey: string; signal: AbortSignal; modelId: string; messages: readonly ProviderMessage[]; maxOutputTokens: number }) {
  let text = ""; let usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimated: boolean } | undefined; let finishReason = "STOP";
  for await (const event of adapter.streamResponse(request)) {
    if (event.type === "text_delta") { text += event.delta; if (text.length > 16_384) throw new RangeError("output_too_large"); }
    else if (event.type === "usage") usage = event.usage;
    else finishReason = event.finishReason;
  }
  if (!text.trim()) throw new ProviderAdapterError("provider", "empty_response");
  return { text, usage, finishReason };
}

async function groundedFinal(input: ChatRequest, adapter: AIProviderAdapter, apiKey: string, modelId: string, maxOutputTokens: number, messages: readonly ProviderMessage[], text: string, signal: AbortSignal): Promise<{ text: string; usedSources: readonly import("@/lib/assistant/domain").SourceReference[]; usage?: { inputTokens: number; outputTokens: number; totalTokens: number; estimated: boolean }; finishReason?: string; replacedPriorText?: boolean }> {
  const rounds = inputToolRounds(input);
  const priorText = rounds.map((round) => round.text?.trim()).filter((item): item is string => Boolean(item)).join("\n");
  let verification = verifyToolGrounding(priorText ? `${priorText}\n${text}` : text, rounds);
  if (verification.valid || rounds.length === 0) return { text, usedSources: verification.usedSources };
  const systemMessage = messages.find((message) => message.role === "system");
  const system = systemMessage?.role === "system" ? systemMessage.content : analysisDomainInstruction(input);
  const fallback = semanticToolFallback(rounds);
  if (!fallback.trim()) throw new ProviderAdapterError("provider", "tool_grounding_failed");
  const retried = await collectFinalText(adapter, { apiKey, signal, modelId, maxOutputTokens, messages: [{ role: "system", content: `${system}\n\n${fallback}` }, { role: "user", content: input.question }] });
  verification = verifyToolGrounding(retried.text, rounds);
  if (!verification.valid) throw new ProviderAdapterError("provider", "tool_grounding_failed");
  return { text: retried.text, usedSources: verification.usedSources, ...(retried.usage ? { usage: retried.usage } : {}), finishReason: retried.finishReason, ...(priorText ? { replacedPriorText: true } : {}) };
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
    for (const result of inputToolRounds(input).flatMap((round) => round.results)) yield { type: "tool_result_ack", roundId: input.roundId, requestId: result.requestId };
    yield { type: "status", roundId: input.roundId, label: "Planificando herramientas" };
    const result = await adapter.planTools({ apiKey, signal, modelId: prepared.generationModelId, messages, tools, maxOutputTokens: prepared.requestedMaxOutputTokens });
    if (result.blockReason) throw new ProviderAdapterError("provider", "gemini_blocked");
    if (result.toolCalls.length) {
      if (result.usage) yield { type: "usage", roundId: input.roundId, usage: result.usage };
      const calls = await Promise.all(result.toolCalls.map((call, ordinal) => normalizeProviderToolCall(input, call, ordinal)));
      for (const [index, call] of calls.entries()) yield { type: "tool_request", roundId: input.roundId, requestId: call.requestId, tool: call.tool, args: call.args, ...(index === 0 && result.text ? { assistantText: result.text } : {}), ...(call.providerMetadata === undefined ? {} : { providerMetadata: call.providerMetadata }) };
      yield { type: "done", roundId: input.roundId, finishReason: "tool_request" };
      return;
    }
    const providerFinal = result.text ? { text: result.text, ...(result.usage ? { usage: result.usage } : {}), finishReason: result.finishReason ?? "STOP" } : await collectFinalText(adapter, { apiKey, signal, modelId: prepared.generationModelId, messages, maxOutputTokens: prepared.requestedMaxOutputTokens });
    const final = await groundedFinal(input, adapter, apiKey, prepared.generationModelId, prepared.requestedMaxOutputTokens, messages, providerFinal.text, signal);
    if (final.replacedPriorText) yield { type: "status", roundId: input.roundId, code: "tool_grounding_retried", label: "Revisando la síntesis con los datos locales." };
    yield { type: "text_delta", roundId: input.roundId, messageId: `${input.executionId ?? "legacy"}:message:${input.roundNumber}`, delta: final.text };
    for (const source of final.usedSources) yield { type: "source", roundId: input.roundId, source };
    const usage = final.usage ?? providerFinal.usage; if (usage) yield { type: "usage", roundId: input.roundId, usage };
    yield { type: "done", roundId: input.roundId, finishReason: final.finishReason ?? providerFinal.finishReason ?? "STOP" };
  } };
}
function providerEvent(input: ChatRequest, event: ProviderStreamEvent): AssistantStreamEvent | undefined { if (event.type === "text_delta") return { type: "text_delta", roundId: input.roundId, messageId: `${input.executionId ?? "legacy"}:message:${input.roundNumber}`, delta: event.delta }; if (event.type === "usage") return { type: "usage", roundId: input.roundId, usage: event.usage }; return { type: "done", roundId: input.roundId, finishReason: event.finishReason }; }
