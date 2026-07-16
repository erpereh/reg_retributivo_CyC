import { detectSensitivePatterns, normalizeSensitiveKey } from "@/lib/assistant/privacy/patterns";
import type { PersonAnalysisPresentation } from "@/lib/assistant/tools/personEvidence";

export type ConversationType = "general" | "analysis";
export type ConversationStatus = "active" | "archived" | "archived_analysis_deleted";
export type MessageStatus = "streaming" | "completed" | "stopped" | "interrupted" | "failed";
export type ResponseMode = "strict" | "flexible";
/** The first two values are the active UI contract. The remaining values are read-only legacy values. */
export type ContextStrategy = "associated_people" | "full_analysis" | "automatic" | "full" | "optimized";
export type ContextOrigin = "general" | "analysis";
export type SourceAvailability = "available" | "historical_unavailable" | "deleted";
export type DocumentScope = { type: "analysis"; analysisId: string } | { type: "conversation"; conversationId: string };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  analysisId?: string;
  title: string;
  associatedPersonIds: string[];
  primaryPersonId?: string;
  providerId?: string;
  modelId?: string;
  /** @deprecated Kept only while schema-v5 records are being migrated. */
  modelProfileId?: string;
  responseMode: ResponseMode;
  contextStrategy: ContextStrategy;
  analysisVersion?: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  contextOrigin: ContextOrigin;
  providerId?: string;
  /** @deprecated Kept only for historical messages. */
  modelProfileId: string;
  /** Optional only for records written before schema v2; every new assistant message sets it. */
  modelId?: string;
  responseMode: ResponseMode;
  contextStrategy: ContextStrategy;
  analysisVersion?: string;
  sourceRefIds: string[];
  actionIds: string[];
  usage?: TokenUsage;
  createdAt: string;
}

export type ChatEventPayload =
  | { type: "context_added" | "context_removed"; contextId: string; label: string }
  | { type: "person_added" | "person_removed"; analysisId: string; personId: string }
  | { type: "model_changed"; previousModelProfileId: string; modelProfileId: string }
  | { type: "context_compacted"; snapshotId: string; summarizedMessageIds: string[] }
  | { type: "analysis_updated"; previousVersion: string; analysisVersion: string }
  | { type: "indexing_completed"; documentId: string; status: "ready" | "partial" | "error" }
  | { type: "automatic_fallback"; previousModelProfileId: string; modelProfileId: string }
  | { type: "action_accepted" | "action_rejected" | "action_failed"; actionId: string };

export interface ChatEvent { id: string; conversationId: string; event: ChatEventPayload; createdAt: string }

export type ChatActionPayload =
  | { type: "open_person"; analysisId: string; personId: string }
  | { type: "open_cuadre"; analysisId: string; personId?: string; view?: "non_normalized" | "normalized_variables" }
  | { type: "open_grouping"; analysisId: string; groupingId: string }
  | { type: "show_sources"; sourceIds: string[] }
  | { type: "add_person" | "remove_person" | "set_primary_person"; analysisId: string; personId: string }
  | { type: "compare_people" | "show_comparison_table"; analysisId: string; personIds: string[] }
  | { type: "generate_visual"; analysisId: string; visual: "person_summary" | "people_comparison" | "period_timeline"; personIds: string[] }
  | { type: "show_timeline"; analysisId: string; personId?: string; periods?: string[] }
  | { type: "create_conversation"; sourceConversationId: string }
  | { type: "copy_document_context"; sourceConversationId: string; targetConversationId: string; documentIds: string[] };

export interface ChatAction {
  id: string; conversationId: string; messageId: string; label: string; description: string;
  action: ChatActionPayload; status: "pending" | "accepted" | "rejected" | "failed"; createdAt: string; resolvedAt?: string;
}

export interface AnalysisVersionSnapshot {
  id: string;
  analysisId: string;
  analysisVersion: string;
  canonical: string;
  createdAt: string;
}

export interface ModelProfile {
  id: string; name: string; provider: "gemini" | "openai" | "openrouter" | "cerebras" | "groq" | "manual";
  baseUrl: string; modelId: string; enabled: boolean; generalChatCompatible: boolean; analysisCompatible: boolean;
  supportsStreaming: boolean; supportsTools: boolean; supportsStructuredOutput: boolean; detectedContextWindow?: number;
  manualContextWindow?: number; maxOutputTokens?: number; capabilitiesSource: "detected" | "manual";
  selectedModelCatalogId?: string; providerModelName?: string; detectedModels?: DetectedModel[]; verifiedAt?: string; lastVerificationError?: string;
}

export interface DetectedModel {
  id: string;
  providerModelName?: string;
  baseModelId?: string;
  displayName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportedMethods?: string[];
}

export interface AssistantSettings {
  id: "assistant-settings";
  defaultGeneralModelProfileId?: string;
  defaultAnalysisModelProfileId?: string;
  responseMode: ResponseMode;
  contextStrategy: ContextStrategy;
  safetyMarginPercent: number;
  warningThresholdPercent: number;
  compactionThresholdPercent: number;
}

export interface ModelPreferences {
  id: "model-preferences";
  favoriteCatalogEntryIds: string[];
  recentCatalogEntryIds: string[];
  lastCatalogEntryId?: string;
  updatedAt: string;
}

export interface SourceReference {
  id: string; conversationId: string; messageId?: string; analysisId?: string; documentId?: string; personId?: string;
  sourceType: string; sanitizedSourceLabel: string; availability: SourceAvailability; page?: number; sheet?: string;
  rowRange?: string; cellRange?: string; period?: string; conceptIds: string[]; excerpt: string; sanitizedHash: string; presentation?: PersonAnalysisPresentation;
}

export interface PersistedDocumentMetadata {
  id: string; sanitizedSourceLabel: string; scope: DocumentScope; mediaType: "pdf" | "xlsx" | "docx" | "csv" | "txt" | "markdown";
  status: "extracting" | "anonymizing" | "fragmenting" | "indexing" | "ready" | "partial" | "error";
  createdAt: string; updatedAt: string;
}

export interface EphemeralLocalDocumentMetadata extends Omit<PersistedDocumentMetadata, "id" | "mediaType" | "status" | "createdAt" | "updatedAt"> {
  localDisplayName: string;
  safeDocumentId: string;
}

export interface ConversionResult { conversation: Conversation; messages: ChatMessage[]; event: ChatEvent }

export interface KnownPersonReference { employeeNumber: string; person?: string }
export interface ResolvedChatContent { content: string; explicitPersonIds: string[] }
const SENSITIVE_CHAT_CONTENT_ERROR = "El contenido contiene datos sensibles no permitidos.";

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function personTokens(value: string): Array<{ value: string; start: number; end: number }> {
  return [...value.matchAll(/(?:[\p{L}\p{N}]\p{M}*)+/gu)]
    .map((match) => ({ value: normalizeSensitiveKey(match[0]), start: match.index, end: match.index + match[0].length }))
    .filter((token) => token.value.length > 0);
}

export function resolveChatContent(rawContent: string, knownPeople: readonly KnownPersonReference[], conversationType: ConversationType, allowedPersonIds?: readonly string[], primaryPersonId?: string): ResolvedChatContent {
  let content = rawContent.trim();
  if (conversationType === "analysis") {
    content = content.replace(/(?:^|[^\p{L}\p{N}])((?:este|esta)\s+(?:trabajador(?:a)?|persona))(?![\p{L}\p{N}])/giu, (match, _mention: string, offset: number) => {
      const allowed = allowedPersonIds ?? knownPeople.map((person) => person.employeeNumber);
      const resolved = primaryPersonId && allowed.includes(primaryPersonId) ? primaryPersonId : allowed.length === 1 ? allowed[0] : undefined;
      if (!resolved) throw new Error("ambiguous_person_mention");
      const prefix = match.slice(0, Number(offset) === 0 ? 0 : 1);
      return `${prefix}matrícula ${resolved}`;
    });
    const inputTokens = personTokens(content);
    const names = knownPeople.flatMap((person) => person.person?.trim() ? [{ person, tokens: personTokens(person.person).map((token) => token.value) }] : []);
    const allowed = allowedPersonIds ? new Set(allowedPersonIds) : undefined;
    const replacements: Array<{ start: number; end: number; personId: string }> = [];
    for (let start = 0; start < inputTokens.length;) {
      let bestLength = 0;
      const candidates = new Set<string>();
      for (const { person, tokens } of names) {
        for (let nameStart = 0; nameStart < tokens.length; nameStart += 1) {
          let length = 0;
          while (start + length < inputTokens.length && nameStart + length < tokens.length && inputTokens[start + length]!.value === tokens[nameStart + length]) length += 1;
          if (!length || (length === 1 && inputTokens[start]!.value.length < 3)) continue;
          if (length > bestLength) { bestLength = length; candidates.clear(); }
          if (length === bestLength) candidates.add(person.employeeNumber);
        }
      }
      if (!bestLength) { start += 1; continue; }
      if (candidates.size !== 1) throw new Error("ambiguous_person_mention");
      const personId = [...candidates][0]!;
      if (allowed && !allowed.has(personId)) throw new Error("person_outside_authorized_scope");
      replacements.push({ start: inputTokens[start]!.start, end: inputTokens[start + bestLength - 1]!.end, personId });
      start += bestLength;
    }
    for (const replacement of replacements.reverse()) content = `${content.slice(0, replacement.start)}matrícula ${replacement.personId}${content.slice(replacement.end)}`;
  }
  const structuredMatch = /^(?:Revisa a|Consulta la) matrícula ([\p{L}\p{N}._-]+)$/u.exec(content);
  if (structuredMatch && knownPeople.some((person) => person.employeeNumber === structuredMatch[1])) {
    if (allowedPersonIds && !allowedPersonIds.includes(structuredMatch[1])) throw new Error("person_outside_authorized_scope");
    return { content, explicitPersonIds: [structuredMatch[1]] };
  }
  if (detectSensitivePatterns(content).length) throw new Error(SENSITIVE_CHAT_CONTENT_ERROR);
  const explicitPersonIds = [...new Set(knownPeople.map((person) => person.employeeNumber).filter((employeeId) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegularExpression(employeeId)}(?:$|[^\\p{L}\\p{N}])`, "u").test(content)))];
  if (allowedPersonIds && explicitPersonIds.some((personId) => !allowedPersonIds.includes(personId))) throw new Error("person_outside_authorized_scope");
  return { content, explicitPersonIds };
}

export function sanitizeChatContent(rawContent: string, knownPeople: readonly KnownPersonReference[], conversationType: ConversationType): string {
  return resolveChatContent(rawContent, knownPeople, conversationType).content;
}

export function convertConversationToAnalysis(
  conversation: Conversation,
  messages: readonly ChatMessage[],
  analysisId: string,
  analysisVersion: string,
  now = new Date().toISOString(),
): ConversionResult {
  if (conversation.type === "analysis") {
    throw new Error("Para asociar otro análisis debe crearse otra conversación.");
  }
  const converted: Conversation = { ...conversation, type: "analysis", analysisId, analysisVersion, updatedAt: now };
  return {
    conversation: converted,
    messages: messages.map((message) => ({ ...message, contextOrigin: "general" })),
    event: {
      id: `event-${conversation.id}-${now}`,
      conversationId: conversation.id,
      event: { type: "context_added", contextId: analysisId, label: "Análisis activo" },
      createdAt: now,
    },
  };
}
