import { z } from "zod";
import { assistantStreamEventSchema, contextSnapshotSchema, documentScopeSchema, modelProfileSchema, sourceReferenceSchema, type AssistantStreamEvent } from "@/lib/assistant/schemas";
import { assertSafeForProvider } from "@/lib/assistant/privacy/assertions";
import { ANALYSIS_TOOL_NAMES, ANALYSIS_TOOL_SCHEMAS, type AnalysisToolName } from "@/lib/assistant/tools/registry";
import { ContextPlanner, responseModeInstructions, type ContextCandidate } from "@/lib/assistant/context/contextPlanner";
import { ProviderAdapterError, sanitizeProviderError, type AIProviderAdapter, type ProviderMessage, type ProviderStreamEvent, type ProviderTool } from "@/lib/assistant/providers/types";
import { SafeDeltaBuffer } from "@/lib/assistant/streamProtocol";
import { canonicalizePrivacyText } from "@/lib/assistant/privacy/patterns";
import { providerRuntime, type ProviderRuntimeService } from "@/lib/assistant/server/providerRuntime";
import { MAX_CHAT_REQUEST_BYTES, MAX_PRIVACY_BLOCKED_TERMS } from "@/lib/assistant/transportLimits";

const id = z.string().min(1).max(256);
const contextCandidateSchema = z.object({ id, kind: z.enum(["tool", "metadata", "lexical", "chunk", "message"]), content: z.string().max(32_768), tokens: z.number().int().nonnegative(), relevance: z.number().min(0).max(1), sourceId: id, sanitizedHash: id, factKey: id, facets: z.record(z.array(z.string())).optional(), scope: documentScopeSchema }).strict();
const compactedContextSchema = z.object({ snapshot: contextSnapshotSchema, payloadMessages: z.array(z.object({ id, content: z.string().max(32_768), tokens: z.number().int().nonnegative() }).strict()).max(256) }).strict();
const compactionLineageSchema = z.object({ decisions: z.array(z.string().max(1_000)).max(256), figures: z.array(z.number().finite()).max(256), sourceIds: z.array(id).max(256), actionIds: z.array(id).max(256), personIds: z.array(id).max(256), analysisVersion: id }).strict();
const modelMetadataSchema = z.object({ contextWindow: z.number().int().positive(), maxOutputTokens: z.number().int().positive().optional(), generationModelId: id.optional() }).strict();
const analysisContextSchema = z.object({ associatedPersonIds: z.array(id).max(20), primaryPersonId: id.optional(), strategy: z.enum(["associated_people", "full_analysis"]), periods: z.array(z.string().min(1).max(64)).max(100), sourceTypes: z.array(z.string().min(1).max(64)).max(20), aggregate: z.record(z.number().finite()).refine((value) => Object.keys(value).length <= 50) }).strict();
const providerDescriptorSchema = z.object({ providerId: id, providerType: z.enum(["gemini", "openai", "openrouter", "cerebras", "groq", "openai-compatible"]), baseUrl: z.string().url().max(2_048), envVarName: z.string().min(1).max(128) }).strict();
const common = { executionId: z.string().uuid().optional(), conversationId: id, analysisId: id.optional(), analysisContext: analysisContextSchema.optional(), roundId: id, roundNumber: z.number().int().min(1).max(3), providerId: id.optional(), provider: providerDescriptorSchema.optional(), modelProfileId: id, modelId: id, modelMetadata: modelMetadataSchema.optional(), profile: modelProfileSchema.optional(), privacyBlockedTerms: z.array(z.string().min(2).max(256)).max(MAX_PRIVACY_BLOCKED_TERMS).optional(), responseMode: z.enum(["strict", "flexible"]), contextStrategy: z.enum(["associated_people", "full_analysis", "automatic", "full", "optimized"]), contextCandidates: z.array(contextCandidateSchema).max(256).optional(), compactedContext: compactedContextSchema.optional(), compactionLineage: compactionLineageSchema.optional(), safetyMarginPercent: z.number().min(0).max(50).optional(), warningThresholdPercent: z.number().min(1).max(99).optional(), compactionThresholdPercent: z.number().min(1).max(100).optional() };
const plan = z.object({ phase: z.literal("plan"), ...common, question: z.string().min(1).max(16_384), tools: z.array(z.enum(ANALYSIS_TOOL_NAMES)).max(19) }).strict();
const toolResult = z.object({ requestId: id, tool: z.enum(ANALYSIS_TOOL_NAMES), args: z.unknown().optional(), status: z.enum(["success", "empty", "failed", "cancelled"]).optional(), data: z.unknown().optional(), result: z.unknown().optional(), error: z.object({ code: id, message: z.string().min(1).max(200) }).strict().optional(), sources: z.array(sourceReferenceSchema).max(100).optional() }).strict().superRefine((value, context) => { if ((!value.status || value.status === "success" || value.status === "empty") && value.data === undefined && value.result === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: "Falta el resultado de la herramienta." }); if ((value.status === "failed" || value.status === "cancelled") && !value.error) context.addIssue({ code: z.ZodIssueCode.custom, message: "Falta el error sanitizado." }); });
const respond = z.object({ phase: z.literal("respond"), ...common, question: z.string().min(1).max(16_384), tools: z.array(z.enum(ANALYSIS_TOOL_NAMES)).max(19).optional(), toolResults: z.array(toolResult).min(1).max(19) }).strict();
const continuation = z.object({ phase: z.literal("continue"), ...common, question: z.string().min(1).max(16_384).optional(), tools: z.array(z.enum(ANALYSIS_TOOL_NAMES)).max(19).optional(), toolResults: z.array(toolResult).max(19).optional(), interruptedMessageId: id, continuationContext: z.string().min(1).max(16_384) }).strict();
export const chatRequestSchema = z.discriminatedUnion("phase", [plan, respond, continuation]).superRefine((value, context) => {
  if (Boolean(value.providerId) !== Boolean(value.provider) || (value.providerId && value.provider?.providerId !== value.providerId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["provider"], message: "El descriptor no pertenece al proveedor seleccionado." });
  const expected = value.analysisId ? { type: "analysis", analysisId: value.analysisId } as const : { type: "conversation", conversationId: value.conversationId } as const;
  for (const [index, candidate] of (value.contextCandidates ?? []).entries()) if (!sameScope(candidate.scope, expected)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["contextCandidates", index, "scope"], message: "El contexto no pertenece a esta ronda." });
  if (value.compactedContext && (value.compactedContext.snapshot.conversationId !== value.conversationId || value.compactedContext.snapshot.analysisId !== value.analysisId || value.compactedContext.snapshot.actualStrategy !== value.contextStrategy || value.compactedContext.snapshot.actualResponseMode !== value.responseMode)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["compactedContext"], message: "El snapshot no pertenece a esta ronda." });
  for (const [resultIndex, result] of (value.phase === "plan" ? [] : value.toolResults ?? []).entries()) for (const [sourceIndex, source] of (result.sources ?? []).entries()) if (source.availability !== "available" || source.conversationId !== value.conversationId || source.analysisId !== value.analysisId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toolResults", resultIndex, "sources", sourceIndex], message: "La fuente no pertenece al scope disponible de la ronda." });
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export interface ChatExecutionService { execute(input: ChatRequest, signal: AbortSignal): AsyncIterable<AssistantStreamEvent> }
export const DEFAULT_CHAT_DEADLINE_MS = 60_000;
export { MAX_CHAT_REQUEST_BYTES } from "@/lib/assistant/transportLimits";

function sameScope(left: z.infer<typeof documentScopeSchema>, right: z.infer<typeof documentScopeSchema>): boolean { return left.type === right.type && (left.type === "analysis" ? right.type === "analysis" && left.analysisId === right.analysisId : right.type === "conversation" && left.conversationId === right.conversationId); }
function deadlineSignal(parent: AbortSignal, milliseconds: number) { const controller = new AbortController(); const abort = () => { if (!controller.signal.aborted) controller.abort(new DOMException("Cancelled", "AbortError")); }; if (parent.aborted) abort(); else parent.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, milliseconds); return { signal: controller.signal, abort, dispose() { clearTimeout(timer); parent.removeEventListener("abort", abort); } }; }

function safeError(roundId: string, error: unknown): AssistantStreamEvent {
  const safe = sanitizeProviderError(error);
  return { type: "error", roundId, code: safe.code, classification: safe.classification, message: safe.publicMessage, retryable: safe.classification === "transient" };
}

function assertNoBlockedTerms(value: unknown, terms: readonly string[]): void { const serialized = canonicalizePrivacyText(JSON.stringify(value)); if (terms.some((term) => { const canonical = canonicalizePrivacyText(term); return canonical.length > 1 && serialized.includes(canonical); })) throw new ProviderAdapterError("privacy", "privacy_known_name"); }
function assertRequestSafe(input: ChatRequest): void { const { privacyBlockedTerms = [], ...providerInput } = input; assertSafeForProvider(providerInput); assertNoBlockedTerms(providerInput, privacyBlockedTerms); }

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
    try { assertRequestSafe(parsed.data); for (const entry of parsed.data.phase === "plan" ? [] : parsed.data.toolResults ?? []) if (!entry.status || entry.status === "success" || entry.status === "empty") ANALYSIS_TOOL_SCHEMAS[entry.tool].output.parse(entry.data ?? entry.result); } catch { return Response.json({ error: "La solicitud fue bloqueada por privacidad o validación." }, { status: 400 }); }
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
export function createProductionChatAdapterResolver(runtime: ProviderRuntimeService = providerRuntime): ChatAdapterResolver {
  return async (input) => {
    if (input.providerId && input.provider) {
      const binding = await runtime.resolve(input.provider);
      return { adapter: binding.adapter, apiKey: binding.apiKey };
    }
    throw new ProviderAdapterError("incompatible", "provider_not_selected");
  };
}

const TOOL_DESCRIPTIONS: Readonly<Record<AnalysisToolName, string>> = {
  getAnalysisSummary: "Devuelve únicamente agregados globales del análisis, sin cargar personas ni documentos.",
  findPersonByEmployeeId: "Busca una matrícula exacta dentro del alcance autorizado y devuelve su identificador anonimizado.",
  searchPeople: "Busca personas por criterios anonimizados, con límite estricto y orden por relevancia.",
  getPersonProfile: "Obtiene la ficha retributiva anonimizada de una matrícula concreta. Úsala antes de responder sobre esa matrícula.",
  getPersonPayrollPeriods: "Lista de forma acotada los periodos de nómina disponibles para una persona concreta.",
  getPersonConcepts: "Recupera los conceptos retributivos de una persona concreta; no consulta el corpus completo.",
  getPersonConceptDifferences: "Compara importes por concepto para una persona concreta y devuelve solo diferencias estructuradas.",
  getPersonCuadreReg: "Obtiene el cuadre entre periodo y desglose del registro para una persona concreta.",
  getPersonNormalizedData: "Obtiene los cálculos normalizados y sus diferencias para una persona concreta.",
  getPersonGroupings: "Obtiene agrupaciones laborales anonimizadas de una persona concreta.",
  comparePeople: "Compara entre dos y veinte identificadores de persona explícitamente indicados.",
  getTopDifferences: "Devuelve un ranking limitado de las mayores diferencias del análisis.",
  getDifferencesByCenter: "Agrega diferencias por centro de trabajo sin devolver fichas personales completas.",
  getDifferencesByPosition: "Agrega diferencias por puesto sin devolver fichas personales completas.",
  getDifferencesByConcept: "Agrega diferencias por concepto retributivo sin cargar documentos completos.",
  getPendingConcepts: "Devuelve conceptos pendientes de revisión dentro del análisis actual.",
  getDisabledConcepts: "Devuelve conceptos deshabilitados dentro del análisis actual.",
  searchDocumentChunks: "Busca fragmentos relevantes en fuentes autorizadas, paginados y limitados; nunca carga un documento completo.",
  getSourceDetails: "Recupera el detalle sanitizado de una fuente exacta ya identificada.",
};

export function providerTools(names: readonly AnalysisToolName[]): ProviderTool[] {
  return names.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    parameters: ANALYSIS_TOOL_SCHEMAS[name].provider,
  }));
}

async function counted(adapter: AIProviderAdapter, input: ChatRequest, apiKey: string, text: string, signal: AbortSignal): Promise<number> { const count = await adapter.countTokens({ apiKey, modelId: input.modelId, providerModelName: input.profile?.providerModelName, text, signal }); if (!Number.isInteger(count.tokens) || count.tokens < 0) throw new ProviderAdapterError("provider", "invalid_token_count"); return count.tokens; }
function nativeToolMessages(results: readonly z.infer<typeof toolResult>[]): ProviderMessage[] {
  if (!results.length) return [];
  return [
    { role: "assistant", content: "", toolCalls: results.map((entry) => ({ id: entry.requestId, name: entry.tool, args: entry.args ?? {} })) },
    ...results.map((entry): ProviderMessage => ({
      role: "tool", toolCallId: entry.requestId, toolName: entry.tool,
      content: JSON.stringify(entry.status === "failed" || entry.status === "cancelled" ? { ok: false, error: entry.error } : { ok: true, data: entry.data ?? entry.result ?? null, sources: (entry.sources ?? []).map((source) => ({ id: source.id, label: source.sanitizedSourceLabel })), ...(entry.status === "empty" ? { empty: true, message: "No se encontraron datos para los criterios indicados." } : {}) }),
    })),
  ];
}
async function messagesFor(input: ChatRequest, adapter: AIProviderAdapter, apiKey: string, tools: readonly ProviderTool[], signal: AbortSignal) {
  const instruction = responseModeInstructions(input.responseMode); const continuationInstruction = "Continúa exactamente desde el contenido parcial anterior, sin repetirlo ni reiniciar la respuesta."; const question = input.phase === "continue" ? continuationInstruction : input.question;
  const promptTokens = await counted(adapter, input, apiKey, `${instruction}\n${question}`, signal); const toolSchemaTokens = await counted(adapter, input, apiKey, JSON.stringify(tools), signal);
  const scope = input.analysisId ? { type: "analysis", analysisId: input.analysisId } as const : { type: "conversation", conversationId: input.conversationId } as const;
  const candidates: ContextCandidate[] = []; for (const candidate of input.contextCandidates ?? []) candidates.push({ ...candidate, tokens: await counted(adapter, input, apiKey, candidate.content, signal) });
  const contextWindow = input.modelMetadata?.contextWindow ?? input.profile?.detectedContextWindow ?? input.profile?.manualContextWindow; if (!contextWindow) throw new ProviderAdapterError("context", "context_window_unknown");
  let plan; try { plan = new ContextPlanner().plan({ strategy: input.contextStrategy, responseMode: input.responseMode, candidates, scope, contextWindow, promptTokens, toolSchemaTokens, safetyMarginPercent: input.safetyMarginPercent, warningThresholdPercent: input.warningThresholdPercent, compactionThresholdPercent: input.compactionThresholdPercent }); } catch { throw new ProviderAdapterError("context", "context_budget_invalid"); }
  const statuses: AssistantStreamEvent[] = []; if (plan.budget.warning) statuses.push({ type: "status", roundId: input.roundId, code: "context_warning", label: "El contexto supera el umbral de aviso." });
  let contextItems = plan.items.map((item) => item.content);
  if (plan.budget.requiresCompaction) {
    const summarized = plan.items.filter((item) => item.kind === "message"); const summary = `Resumen de contexto previo (${summarized.length} mensajes): ${summarized.map((item) => item.content.slice(0, 512)).join(" ")}`;
    try { assertSafeForProvider(summary); assertNoBlockedTerms(summary, input.privacyBlockedTerms ?? []); } catch { throw new ProviderAdapterError("privacy", "privacy_compaction"); }
    const summaryTokens = await counted(adapter, input, apiKey, summary, signal); const compacted: ContextCandidate = { id: `${input.executionId ?? "legacy"}:summary`, kind: "message", content: summary, tokens: summaryTokens, relevance: 1, sourceId: `${input.executionId ?? "legacy"}:snapshot-source`, sanitizedHash: `summary-${summaryTokens}`, factKey: "context:summary", scope };
    try { plan = new ContextPlanner().plan({ strategy: input.contextStrategy, responseMode: input.responseMode, candidates: [...plan.items.filter((item) => item.kind !== "message"), compacted], scope, contextWindow, promptTokens, toolSchemaTokens, safetyMarginPercent: input.safetyMarginPercent, warningThresholdPercent: input.warningThresholdPercent, compactionThresholdPercent: input.compactionThresholdPercent }); } catch { throw new ProviderAdapterError("context", "context_compaction_failed"); }
    if (plan.budget.requiresCompaction) throw new ProviderAdapterError("context", "context_compaction_insufficient");
    contextItems = plan.items.map((item) => item.content);
    const lineage = input.compactionLineage;
    const snapshot = contextSnapshotSchema.parse({ id: `${input.executionId ?? "legacy"}:snapshot:${input.roundNumber}`, conversationId: input.conversationId, ...(input.analysisId ? { analysisId: input.analysisId } : {}), summary, summarizedMessageIds: summarized.map((item) => item.id), decisions: lineage?.decisions ?? [], figures: lineage?.figures ?? [], sourceIds: [...new Set([...(lineage?.sourceIds ?? []), ...summarized.map((item) => item.sourceId)])], actionIds: lineage?.actionIds ?? [], personIds: lineage?.personIds ?? [], analysisVersion: lineage?.analysisVersion ?? input.compactedContext?.snapshot.analysisVersion ?? "current", actualStrategy: input.contextStrategy, actualResponseMode: input.responseMode, createdAt: new Date().toISOString() });
    statuses.push({ type: "status", roundId: input.roundId, code: "context_compacted", label: "El contexto fue compactado automáticamente.", snapshot });
  }
  const context = contextItems.join("\n\n");
  const analysisSummary = input.analysisId && input.analysisContext ? `\n\nEstás en una aplicación de análisis retributivo. Análisis: ${input.analysisId}. Matrículas asociadas: ${input.analysisContext.associatedPersonIds.join(", ") || "ninguna"}. Matrícula principal: ${input.analysisContext.primaryPersonId ?? "ninguna"}. Estrategia: ${input.analysisContext.strategy}. Periodos disponibles: ${input.analysisContext.periods.join(", ") || "no informados"}. Tipos de fuentes: ${input.analysisContext.sourceTypes.join(", ") || "no informados"}. Resumen agregado: ${JSON.stringify(input.analysisContext.aggregate)}. En este contexto, matrícula es el identificador interno de una persona trabajadora. No debe interpretarse como matrícula de vehículo, universidad, aeronave, patente ni otro significado externo.` : "";
  const toolInstruction = tools.length
    ? "\n\nPara consultas sobre datos del análisis, debes usar primero la herramienta local adecuada y responder únicamente con los resultados devueltos. Para una matrícula concreta, no respondas todavía: solicita primero su ficha mediante una herramienta."
    : "";
  const messages: ProviderMessage[] = [{ role: "system", content: `${instruction}${analysisSummary}${toolInstruction}${context ? `\n\nContexto sanitizado:\n${context}` : ""}` }];
  if (input.phase === "respond") { messages.push({ role: "user", content: input.question }, ...nativeToolMessages(input.toolResults)); }
  else if (input.phase === "continue") {
    messages.push({ role: "assistant", content: input.continuationContext });
    if (input.toolResults?.length) messages.push(...nativeToolMessages(input.toolResults));
    messages.push({ role: "user", content: continuationInstruction });
  }
  else messages.push({ role: "user", content: input.question });
  const finalTokens = await counted(adapter, input, apiKey, messages.map((message) => message.content).join("\n") + JSON.stringify(tools), signal); if (finalTokens + 2_048 + Math.ceil(contextWindow * ((input.safetyMarginPercent ?? 10) / 100)) > contextWindow) throw new ProviderAdapterError("context", "context_overflow");
  return { messages, statuses };
}

export function createChatService(resolveAdapter: ChatAdapterResolver = createProductionChatAdapterResolver()): ChatExecutionService {
  return { async *execute(input, signal) { assertRequestSafe(input); const { adapter, apiKey } = await resolveAdapter(input); const toolNames = input.phase === "plan" ? input.tools : input.tools ?? ANALYSIS_TOOL_NAMES; const tools = providerTools(toolNames); const prepared = await messagesFor(input, adapter, apiKey, tools, signal); const { messages } = prepared; for (const status of prepared.statuses) yield status;
    for (const result of input.phase === "plan" ? [] : input.toolResults ?? []) yield { type: "tool_result_ack", roundId: input.roundId, requestId: result.requestId };
    if (tools.length) {
      yield { type: "status", roundId: input.roundId, label: "Planificando herramientas" };
      const result = await adapter.planTools({ apiKey, signal, modelId: input.modelId, providerModelName: input.profile?.providerModelName, messages, tools });
      if (result.toolCalls.length) { for (const call of result.toolCalls) { if (!ANALYSIS_TOOL_NAMES.includes(call.name as AnalysisToolName)) throw new ProviderAdapterError("provider", "tool_not_allowed"); const tool = call.name as AnalysisToolName; ANALYSIS_TOOL_SCHEMAS[tool].input.parse(call.args); assertSafeForProvider(call.args); yield { type: "tool_request", roundId: input.roundId, requestId: call.id, tool, args: call.args }; } yield { type: "done", roundId: input.roundId, finishReason: "tool_request" }; return; }
    }
    for await (const event of adapter.streamResponse({ apiKey, signal, modelId: input.modelMetadata?.generationModelId ?? input.modelId, providerModelName: input.profile?.providerModelName, messages, maxOutputTokens: Math.min(2_048, input.modelMetadata?.maxOutputTokens ?? input.profile?.maxOutputTokens ?? 2_048) })) { const converted = providerEvent(input, event); if (converted) yield converted; }
  } };
}
function providerEvent(input: ChatRequest, event: ProviderStreamEvent): AssistantStreamEvent | undefined { if (event.type === "text_delta") return { type: "text_delta", roundId: input.roundId, messageId: `${input.executionId ?? "legacy"}:message:${input.roundNumber}`, delta: event.delta }; if (event.type === "usage") return { type: "usage", roundId: input.roundId, usage: event.usage }; return { type: "done", roundId: input.roundId, finishReason: event.finishReason }; }
