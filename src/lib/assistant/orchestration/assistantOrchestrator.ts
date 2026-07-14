import { assertSafeForProvider } from "@/lib/assistant/privacy/assertions";
import { IncrementalNdjsonDecoder, StreamProtocolError } from "@/lib/assistant/streamProtocol";
import type { AssistantStreamEvent } from "@/lib/assistant/schemas";
import type { AnalysisToolRegistry, AnalysisToolName } from "@/lib/assistant/tools/registry";
import type { ContextStrategy, ModelProfile, ResponseMode } from "@/lib/assistant/domain";
import type { ContextCandidate } from "@/lib/assistant/context/contextPlanner";
import { ProviderAdapterError, type ProviderErrorClassification } from "@/lib/assistant/providers/types";
import type { CompactionInput } from "@/lib/assistant/context/compaction";
import type { ContextSnapshot } from "@/lib/assistant/storage/repositories";
import type { AssistantRepositories } from "@/lib/assistant/storage/repositories";
import { canonicalizePrivacyText } from "@/lib/assistant/privacy/patterns";

export type AssistantTransport = (body: Record<string, unknown>, signal?: AbortSignal) => Promise<Response>;
export interface ProducedMessage { readonly id: string; readonly status: "interrupted" | "completed"; readonly content: string; readonly modelProfileId: string; readonly modelId: string }
export interface AssistantRunResult { readonly text: string; readonly events: readonly AssistantStreamEvent[]; readonly rounds: number; readonly producedMessages: readonly ProducedMessage[] }
export interface RunWriteContext { readonly signal: AbortSignal; readonly executionId: string; readonly generation: number; readonly producedMessageIds?: ReadonlySet<string> }
export interface OrchestratorDependencies { readonly transport: AssistantTransport; readonly registry: AnalysisToolRegistry; readonly idFactory?: () => string; readonly validateRequestScope: (body: Readonly<Record<string, unknown>>, context: RunWriteContext) => Promise<void>; readonly persistMessage?: (message: ProducedMessage, context: RunWriteContext) => Promise<void>; readonly persistSnapshot?: (snapshot: ContextSnapshot, context: RunWriteContext) => Promise<void>; readonly persistRunMetadata?: (metadata: { conversationId: string; actualStrategy: ContextStrategy; actualResponseMode: ResponseMode; snapshotId?: string }, context: RunWriteContext) => Promise<void>; readonly markMessageReplaced?: (messageId: string, context: RunWriteContext) => Promise<void> }
export interface SendAssistantInput { readonly conversationId: string; readonly analysisId?: string; readonly question: string; readonly assistantMessageId?: string; readonly modelProfileId: string; readonly modelId: string; readonly profile?: ModelProfile; readonly compatibleDefaultProfile?: ModelProfile; readonly apiKey?: string; readonly privacyBlockedTerms?: readonly string[]; readonly contextCandidates?: readonly ContextCandidate[]; readonly compaction?: Omit<CompactionInput, "idFactory">; readonly responseMode: ResponseMode; readonly contextStrategy: ContextStrategy; readonly signal?: AbortSignal; readonly resumeFrom?: { readonly messageId: string; readonly context: string }; readonly onTextDelta?: (delta: string) => void }

function assertInputSafe(input: SendAssistantInput): void { const { apiKey: _apiKey, privacyBlockedTerms = [], onTextDelta: _onTextDelta, ...candidate } = input; void _apiKey; void _onTextDelta; const safe = Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)); assertSafeForProvider(safe); const serialized = canonicalizePrivacyText(JSON.stringify(safe)); if (privacyBlockedTerms.some((term) => { const canonical = canonicalizePrivacyText(term); return canonical.length > 1 && serialized.includes(canonical); })) throw new ProviderAdapterError("privacy", "privacy_known_name"); }

function recordScopeMatches(record: Record<string, unknown>, conversationId: string, analysisId?: string): boolean {
  const scope = record.scope as { type?: string; analysisId?: string; conversationId?: string } | undefined;
  return scope?.type === "analysis" ? Boolean(analysisId) && scope.analysisId === analysisId : scope?.type === "conversation" && scope.conversationId === conversationId;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
async function sha256(value: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function sameValue(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }

export function createRepositoryRequestScopeValidator(repositories: Pick<AssistantRepositories, "conversations" | "messages" | "documents" | "chunks" | "sources">): OrchestratorDependencies["validateRequestScope"] {
  return async (body, context) => {
    const conversationId = String(body.conversationId ?? ""); const analysisId = typeof body.analysisId === "string" ? body.analysisId : undefined;
    const conversation = await repositories.conversations.get(conversationId);
    if (!conversation || (analysisId ? conversation.type !== "analysis" || conversation.analysisId !== analysisId : conversation.type !== "general")) throw new ProviderAdapterError("privacy", "local_scope_mismatch");
    if (typeof body.interruptedMessageId === "string") { const message = await repositories.messages.get(body.interruptedMessageId); if ((!message || message.conversationId !== conversationId) && !context.producedMessageIds?.has(body.interruptedMessageId)) throw new ProviderAdapterError("privacy", "local_message_scope_mismatch"); }
    const candidates = Array.isArray(body.contextCandidates) ? body.contextCandidates as Record<string, unknown>[] : [];
    for (const candidate of candidates) {
      const candidateId = String(candidate.id ?? ""); const sourceId = String(candidate.sourceId ?? "");
      if (candidate.kind === "chunk") {
        const chunk = await repositories.chunks.get(candidateId) as Record<string, unknown> | undefined;
        const parent = chunk && typeof chunk.documentId === "string" ? await repositories.documents.get(chunk.documentId) : undefined;
        const expectedScope = chunk?.scope ?? (parent as unknown as Record<string, unknown> | undefined)?.scope;
        const exact = chunk && parent && parent.status === "ready" && chunk.documentId === sourceId && recordScopeMatches(parent as unknown as Record<string, unknown>, conversationId, analysisId) && chunk.availability === "available" && candidate.content === chunk.content && candidate.sanitizedHash === chunk.sanitizedHash && candidate.kind === (chunk.kind ?? "chunk") && candidate.factKey === (chunk.factKey ?? `chunk:${candidateId}`) && sourceId === (chunk.sourceId ?? chunk.documentId) && sameValue(candidate.scope, expectedScope) && sameValue(candidate.facets ?? {}, chunk.facets ?? {});
        if (!exact) throw new ProviderAdapterError("privacy", "local_context_chunk_mismatch");
        continue;
      }
      const source = await repositories.sources.get(sourceId) as unknown as Record<string, unknown> | undefined;
      const allowedKind = ["tool", "metadata", "lexical", "message"].includes(String(candidate.kind));
      const exact = source && allowedKind && candidateId === source.id && sourceId === source.id && source.availability === "available" && source.conversationId === conversationId && source.analysisId === analysisId && candidate.content === source.excerpt && candidate.sanitizedHash === source.sanitizedHash;
      if (!exact) throw new ProviderAdapterError("privacy", "local_context_source_mismatch");
    }
    const toolResults = Array.isArray(body.toolResults) ? body.toolResults : [];
    for (const result of toolResults) {
      const sourceList = Array.isArray((result as { sources?: unknown }).sources) ? (result as { sources: Record<string, unknown>[] }).sources : [];
      if (!sourceList.length) throw new ProviderAdapterError("privacy", "local_tool_sources_required");
      for (const source of sourceList) {
      if (source.availability !== "available" || source.conversationId !== conversationId || source.analysisId !== analysisId) throw new ProviderAdapterError("privacy", "local_source_scope_mismatch");
      const stored = typeof source.id === "string" ? await repositories.sources.get(source.id) : undefined;
      if (stored) { const exact = ["id", "conversationId", "analysisId", "documentId", "sourceType", "sanitizedSourceLabel", "availability", "excerpt", "sanitizedHash"].every((key) => sameValue((stored as unknown as Record<string, unknown>)[key], source[key])); if (!exact) throw new ProviderAdapterError("privacy", "local_source_stale"); continue; }
      if (typeof source.documentId === "string") {
        const document = await repositories.documents.get(source.documentId); const record = document as unknown as Record<string, unknown> | undefined;
        const chunk = typeof source.chunkId === "string" ? await repositories.chunks.get(source.chunkId) as Record<string, unknown> | undefined : undefined; const authority = chunk ?? record;
        const exact = document && document.status === "ready" && recordScopeMatches(record!, conversationId, analysisId) && (!chunk || chunk.documentId === document.id) && source.id === `tool-source-${conversationId}-${document.id}` && source.sanitizedSourceLabel === document.sanitizedSourceLabel && source.sourceType === (record?.sourceType ?? document.mediaType) && source.excerpt === authority?.content && source.sanitizedHash === authority?.sanitizedHash;
        if (!exact) throw new ProviderAdapterError("privacy", "local_document_source_mismatch"); continue;
      }
      const tool = String((result as Record<string, unknown>).tool ?? ""); const requestId = String((result as Record<string, unknown>).requestId ?? ""); const data = (result as Record<string, unknown>).data ?? (result as Record<string, unknown>).result; const factKey = `${tool}:${requestId}`; const hash = await sha256(canonicalJson({ tool, requestId, data, factKey })); const excerpt = canonicalJson(data).slice(0, 2_000);
      if (source.id !== `tool-source-${hash}` || source.sanitizedHash !== hash || source.excerpt !== excerpt) throw new ProviderAdapterError("privacy", "local_synthetic_source_mismatch");
      }
    }
  };
}

export function createRepositoryBoundAssistantOrchestrator(dependencies: Omit<OrchestratorDependencies, "validateRequestScope">, repositories: Pick<AssistantRepositories, "conversations" | "messages" | "documents" | "chunks" | "sources">): AssistantOrchestrator {
  return new AssistantOrchestrator({ ...dependencies, validateRequestScope: createRepositoryRequestScopeValidator(repositories) });
}

async function readEvents(response: Response, onEvent: (event: AssistantStreamEvent) => void): Promise<void> {
  if (!response.ok || !response.body) throw new Error("La ruta de chat no respondió correctamente.");
  const decoder = new IncrementalNdjsonDecoder(); const reader = response.body.getReader(); let eventCount = 0; let textLength = 0;
  let terminal = false;
  const bounded = (event: AssistantStreamEvent) => {
    if (terminal) return;
    eventCount += 1; if (event.type === "text_delta") textLength += event.delta.length;
    if (eventCount > 1_000 || textLength > 16_384) throw new Error("El stream del asistente supera el tamaño permitido.");
    onEvent(event);
    if (event.type === "done" || event.type === "error") terminal = true;
  };
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; decoder.push(value).forEach(bounded); }
    decoder.finish().forEach(bounded);
    if (!terminal) throw new ProviderAdapterError("provider", "stream_truncated");
  }
  catch (error) {
    await reader.cancel(error).catch(() => undefined);
    if (error instanceof StreamProtocolError) throw new ProviderAdapterError("provider", error.code);
    throw error;
  }
  finally { reader.releaseLock(); }
}

export class AssistantRunStoppedError extends Error {
  readonly status = "stopped" as const;
  constructor(readonly partialText: string, readonly events: readonly AssistantStreamEvent[]) { super("La respuesta fue detenida."); this.name = "AssistantRunStoppedError"; }
}

export class AssistantOrchestrator {
  private activeController?: AbortController;
  private activeGeneration = 0;
  private lastInput?: SendAssistantInput;
  private lastInterrupted?: { messageId: string; context: string };
  private lastProducedMessageId?: string;
  private retryInFlight = false;
  constructor(private readonly dependencies: OrchestratorDependencies) { if (typeof dependencies.validateRequestScope !== "function") throw new Error("AssistantOrchestrator requiere un validator de scope enlazado al repositorio."); }
  stop(): void { this.activeController?.abort(new DOMException("La respuesta fue detenida.", "AbortError")); }
  retry(onTextDelta?: (delta: string) => void) {
    if (!this.lastInput) return Promise.reject(new Error("No hay una solicitud para reintentar."));
    if (this.retryInFlight) return Promise.reject(new ProviderAdapterError("cancelled", "retry_in_progress"));
    this.retryInFlight = true;
    return this.send({ ...this.lastInput, ...(onTextDelta ? { onTextDelta } : {}), resumeFrom: this.lastInterrupted }).finally(() => { this.retryInFlight = false; });
  }
  async regenerate(onTextDelta?: (delta: string) => void) { if (!this.lastInput) throw new Error("No hay una respuesta para regenerar."); const input = { ...this.lastInput, ...(onTextDelta ? { onTextDelta } : {}), resumeFrom: undefined }; const replacedId = this.lastProducedMessageId; return this.execute(input, replacedId ? (context) => this.dependencies.markMessageReplaced?.(replacedId, context) : undefined); }

  async send(input: SendAssistantInput): Promise<AssistantRunResult> {
    return this.execute(input);
  }

  private async execute(input: SendAssistantInput, beforeRun?: (context: RunWriteContext) => Promise<void> | undefined): Promise<AssistantRunResult> {
    assertInputSafe(input); if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("Cancelled", "AbortError"); this.stop();
    const generation = ++this.activeGeneration; const executionId = (this.dependencies.idFactory ?? (() => crypto.randomUUID()))();
    const controller = new AbortController(); const producedMessageIds = new Set<string>(); const runContext: RunWriteContext = { signal: controller.signal, executionId, generation, producedMessageIds }; const assertActive = () => { if (controller.signal.aborted || this.activeGeneration !== generation) throw controller.signal.reason ?? new DOMException("Stale run", "AbortError"); };
    const abortFromParent = () => controller.abort(input.signal?.reason ?? new DOMException("Cancelled", "AbortError")); input.signal?.addEventListener("abort", abortFromParent, { once: true }); this.activeController = controller; this.lastInput = { ...input, apiKey: undefined, resumeFrom: undefined };
    const allEvents: AssistantStreamEvent[] = [];
    const producedMessages: ProducedMessage[] = [];
    try {
      await beforeRun?.(runContext); assertActive();
      const current = { id: input.modelProfileId, modelId: input.modelId, profile: input.profile };
      const compatible = input.compatibleDefaultProfile && input.compatibleDefaultProfile.enabled && (input.analysisId ? input.compatibleDefaultProfile.analysisCompatible : input.compatibleDefaultProfile.generalChatCompatible);
      const fallback = compatible ? { id: input.compatibleDefaultProfile!.id, modelId: input.compatibleDefaultProfile!.modelId, profile: input.compatibleDefaultProfile } : undefined;
      const profiles = [current, current, ...(fallback && fallback.id !== current.id ? [fallback] : [])];
      let continuation: { messageId: string; context: string } | undefined = input.resumeFrom; let lastError: unknown; let attempt = 0; let posts = 0; let phase: "plan" | "respond" | "continue" = continuation ? "continue" : "plan"; let toolResults: unknown[] = [];
      while (attempt < profiles.length && posts < 3) {
        const producer = profiles[attempt]!; let text = ""; posts += 1; const roundId = `${executionId}:round:${posts}`; const messageId = posts === 1 && input.assistantMessageId ? input.assistantMessageId : `${executionId}:message:${posts}`;
        try {
          const body: Record<string, unknown> = { phase, executionId, conversationId: input.conversationId, analysisId: input.analysisId, roundId, roundNumber: posts, modelProfileId: producer.id, modelId: producer.modelId, profile: producer.profile, apiKey: producer.id === input.modelProfileId ? input.apiKey : undefined, privacyBlockedTerms: input.privacyBlockedTerms ?? this.dependencies.registry.privacyBlockedTerms, contextCandidates: input.contextCandidates, responseMode: input.responseMode, contextStrategy: input.contextStrategy, tools: this.dependencies.registry.names, ...(phase === "plan" ? { question: input.question } : phase === "respond" ? { question: input.question, toolResults } : { toolResults, interruptedMessageId: continuation?.messageId ?? `${executionId}:message:${posts - 1}`, continuationContext: continuation?.context ?? "Continuación de herramientas sin texto previo." }) };
          if (input.compaction) body.compactionLineage = { decisions: input.compaction.decisions, figures: input.compaction.figures, sourceIds: input.compaction.sourceIds, actionIds: input.compaction.actionIds, personIds: input.compaction.personIds, analysisVersion: input.compaction.analysisVersion };
          Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]); const { apiKey: _key, privacyBlockedTerms: _blocked, ...audited } = body; void _key; void _blocked; assertSafeForProvider(audited); await this.dependencies.validateRequestScope(body, runContext); assertActive();
          const events: AssistantStreamEvent[] = []; await readEvents(await this.dependencies.transport(body, controller.signal), (event) => { if (event.roundId !== roundId) throw new Error("El evento no pertenece a la ejecución activa."); this.dependencies.registry.assertSafeOutput?.(event); const normalized = event.type === "text_delta" ? { ...event, messageId } : event; events.push(normalized); allEvents.push(normalized); if (normalized.type === "text_delta") { text += normalized.delta; input.onTextDelta?.(normalized.delta); } }); assertActive();
          for (const status of events) if (status.type === "status" && status.code === "context_compacted" && status.snapshot) { await this.dependencies.persistSnapshot?.(status.snapshot, runContext); assertActive(); }
          const errorEvent = events.find((event): event is Extract<AssistantStreamEvent, { type: "error" }> => event.type === "error"); if (errorEvent) throw new ProviderAdapterError(errorEvent.classification ?? (errorEvent.retryable ? "transient" : "provider"), errorEvent.code);
          const requests = events.filter((event): event is Extract<AssistantStreamEvent, { type: "tool_request" }> => event.type === "tool_request");
          if (!requests.length) {
            if (!text.trim()) throw new ProviderAdapterError("provider", "empty_response");
            const completed = { id: messageId, status: "completed" as const, content: text, modelProfileId: producer.id, modelId: producer.modelId }; producedMessages.push(completed); await this.dependencies.persistMessage?.(completed, runContext); assertActive(); const snapshotId = events.find((event): event is Extract<AssistantStreamEvent, { type: "status" }> & { snapshot: ContextSnapshot } => event.type === "status" && event.code === "context_compacted" && Boolean(event.snapshot))?.snapshot.id; await this.dependencies.persistRunMetadata?.({ conversationId: input.conversationId, actualStrategy: input.contextStrategy, actualResponseMode: input.responseMode, ...(snapshotId ? { snapshotId } : {}) }, runContext); assertActive(); this.lastProducedMessageId = messageId; this.lastInterrupted = undefined; return { text, events: allEvents, rounds: posts, producedMessages };
          }
          toolResults = []; for (const request of requests) { const envelope = this.dependencies.registry.executeEnvelope ? await this.dependencies.registry.executeEnvelope(request.tool as AnalysisToolName, request.args, request.requestId) : { data: await this.dependencies.registry.execute(request.tool as AnalysisToolName, request.args), sources: [] }; assertActive(); assertSafeForProvider(envelope); toolResults.push({ requestId: request.requestId, tool: request.tool, data: envelope.data, sources: envelope.sources }); }
          phase = phase === "plan" ? "respond" : "continue";
        } catch (error) {
          lastError = error; if (controller.signal.aborted) throw error;
          if (text) { const interrupted = { id: messageId, status: "interrupted" as const, content: text, modelProfileId: producer.id, modelId: producer.modelId }; producedMessages.push(interrupted); producedMessageIds.add(messageId); await this.dependencies.persistMessage?.(interrupted, runContext); assertActive(); continuation = { messageId, context: `${continuation?.context ?? ""}${text}` }; this.lastInterrupted = continuation; }
          const classification = error instanceof ProviderAdapterError ? error.classification : "provider";
          if (classification !== "transient") throw error; attempt += 1; phase = continuation ? "continue" : "plan"; toolResults = [];
        }
      }
      throw lastError ?? new ProviderAdapterError("provider", "tool_round_limit");
    } catch (error) {
      if (controller.signal.aborted) {
        const textEvents = allEvents.filter((event): event is Extract<AssistantStreamEvent, { type: "text_delta" }> => event.type === "text_delta");
        const partialText = textEvents.map((event) => event.delta).join("");
        const messageId = textEvents.at(-1)?.messageId ?? `${executionId}:message:1`;
        if (partialText) this.lastInterrupted = { messageId, context: partialText };
        this.lastProducedMessageId = messageId;
        throw new AssistantRunStoppedError(partialText, allEvents);
      }
      throw error;
    } finally { input.signal?.removeEventListener("abort", abortFromParent); if (this.activeController === controller) this.activeController = undefined; }
  }
}

export interface FallbackProfile { readonly id: string; readonly modelId: string }
export interface BoundedFallbackInput { readonly current: FallbackProfile; readonly compatibleDefault?: FallbackProfile; readonly run: (profile: FallbackProfile, emit: (delta: string) => void) => Promise<string>; readonly persistMessage?: (message: ProducedMessage) => Promise<void> }
const NO_FALLBACK = new Set<ProviderErrorClassification>(["auth", "privacy", "incompatible", "context", "cancelled"]);
export async function runWithBoundedFallback(input: BoundedFallbackInput): Promise<{ readonly text: string; readonly attempts: number; readonly messages: readonly ProducedMessage[] }> {
  const profiles = [input.current, input.current, ...(input.compatibleDefault && input.compatibleDefault.id !== input.current.id ? [input.compatibleDefault] : [])]; const messages: ProducedMessage[] = []; let lastError: unknown;
  for (let attempt = 0; attempt < profiles.length; attempt += 1) { const profile = profiles[attempt]; let partial = ""; try { const returned = await input.run(profile, (delta) => { partial += delta; }); const content = partial || returned; const message = { id: `message-${attempt + 1}`, status: "completed" as const, content, modelProfileId: profile.id, modelId: profile.modelId }; await input.persistMessage?.(message); messages.push(message); return { text: content, attempts: attempt + 1, messages }; } catch (error) { lastError = error; if (partial) { const message = { id: `message-${attempt + 1}`, status: "interrupted" as const, content: partial, modelProfileId: profile.id, modelId: profile.modelId }; await input.persistMessage?.(message); messages.push(message); } const classification = error instanceof ProviderAdapterError ? error.classification : "provider"; if (NO_FALLBACK.has(classification) || classification !== "transient") throw error; } }
  throw lastError;
}
