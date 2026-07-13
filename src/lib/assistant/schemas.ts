import { z } from "zod";
import type { AssistantSettings } from "@/lib/assistant/domain";

const id = z.string().min(1).max(256);
const date = z.string().min(1);
export const tokenUsageSchema = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative(), estimated: z.boolean() }).strict();

export const modelProfileSchema = z.object({
  id, name: z.string().min(1).max(200), provider: z.enum(["gemini", "openai", "openrouter", "cerebras", "groq", "manual"]),
  baseUrl: z.string().max(2_048), modelId: z.string().min(1).max(256), enabled: z.boolean(), generalChatCompatible: z.boolean(), analysisCompatible: z.boolean(),
  supportsStreaming: z.boolean(), supportsTools: z.boolean(), supportsStructuredOutput: z.boolean(), detectedContextWindow: z.number().int().positive().optional(),
  manualContextWindow: z.number().int().positive().optional(), maxOutputTokens: z.number().int().positive().optional(), capabilitiesSource: z.enum(["detected", "manual"]),
  verifiedAt: date.max(64).optional(), lastVerificationError: z.string().max(500).optional(),
}).strict();

export const assistantSettingsSchema = z.object({
  id: z.literal("assistant-settings"), defaultGeneralModelProfileId: id.optional(), defaultAnalysisModelProfileId: id.optional(),
  responseMode: z.enum(["strict", "flexible"]), contextStrategy: z.enum(["automatic", "full", "optimized"]),
  safetyMarginPercent: z.number().min(0).max(50), warningThresholdPercent: z.number().min(1).max(99), compactionThresholdPercent: z.number().min(1).max(100),
}).strict().superRefine((value, context) => {
  if (value.warningThresholdPercent >= value.compactionThresholdPercent) context.addIssue({ code: z.ZodIssueCode.custom, path: ["warningThresholdPercent"], message: "El aviso debe ser anterior a la compactación." });
});

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  id: "assistant-settings", defaultGeneralModelProfileId: undefined, defaultAnalysisModelProfileId: undefined,
  responseMode: "strict", contextStrategy: "automatic", safetyMarginPercent: 10, warningThresholdPercent: 75, compactionThresholdPercent: 85,
};

export const conversationSchema = z.object({
  id, type: z.enum(["general", "analysis"]), analysisId: id.optional(), title: z.string(), associatedPersonIds: z.array(id),
  primaryPersonId: id.optional(), modelProfileId: id, responseMode: z.enum(["strict", "flexible"]),
  contextStrategy: z.enum(["automatic", "full", "optimized"]), analysisVersion: id.optional(),
  status: z.enum(["active", "archived", "archived_analysis_deleted"]), createdAt: date, updatedAt: date,
}).strict().superRefine((value, context) => {
  if (value.type === "analysis" && !value.analysisId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["analysisId"], message: "analysisId is required" });
  if (value.type === "general" && value.analysisId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["analysisId"], message: "general conversations cannot access an analysis" });
});

export const chatMessageSchema = z.object({
  id, conversationId: id, role: z.enum(["user", "assistant"]), content: z.string(),
  status: z.enum(["streaming", "completed", "stopped", "interrupted", "failed"]), contextOrigin: z.enum(["general", "analysis"]),
  modelProfileId: id, responseMode: z.enum(["strict", "flexible"]), contextStrategy: z.enum(["automatic", "full", "optimized"]),
  analysisVersion: id.optional(), sourceRefIds: z.array(id), actionIds: z.array(id), usage: tokenUsageSchema.optional(), createdAt: date,
}).strict();

export const documentScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("analysis"), analysisId: id }).strict(),
  z.object({ type: z.literal("conversation"), conversationId: id }).strict(),
]);

const openPersonAction = z.object({ type: z.literal("open_person"), analysisId: id, personId: id }).strict();
const openCuadreAction = z.object({ type: z.literal("open_cuadre"), analysisId: id, personId: id.optional(), view: z.enum(["non_normalized", "normalized_variables"]).optional() }).strict();
const openGroupingAction = z.object({ type: z.literal("open_grouping"), analysisId: id, groupingId: id }).strict();
const showSourcesAction = z.object({ type: z.literal("show_sources"), sourceIds: z.array(id) }).strict();
const personAction = (type: "add_person" | "remove_person" | "set_primary_person") => z.object({ type: z.literal(type), analysisId: id, personId: id }).strict();
const peopleAction = (type: "compare_people" | "show_comparison_table") => z.object({ type: z.literal(type), analysisId: id, personIds: z.array(id) }).strict();
const generateVisualAction = z.object({ type: z.literal("generate_visual"), analysisId: id, visual: z.enum(["person_summary", "people_comparison", "period_timeline"]), personIds: z.array(id) }).strict();
const timelineAction = z.object({ type: z.literal("show_timeline"), analysisId: id, personId: id.optional(), periods: z.array(z.string()).optional() }).strict();
const createConversationAction = z.object({ type: z.literal("create_conversation"), sourceConversationId: id }).strict();
const copyDocumentContextAction = z.object({ type: z.literal("copy_document_context"), sourceConversationId: id, targetConversationId: id, documentIds: z.array(id) }).strict();
export const chatActionPayloadSchema = z.discriminatedUnion("type", [openPersonAction, openCuadreAction, openGroupingAction, showSourcesAction, personAction("add_person"), personAction("remove_person"), personAction("set_primary_person"), peopleAction("compare_people"), peopleAction("show_comparison_table"), generateVisualAction, timelineAction, createConversationAction, copyDocumentContextAction]);
export const chatActionSchema = z.object({ id, conversationId: id, messageId: id, label: z.string(), description: z.string(), action: chatActionPayloadSchema, status: z.enum(["pending", "accepted", "rejected", "failed"]), createdAt: date, resolvedAt: date.optional() }).strict();

export const sourceReferenceSchema = z.object({
  id, conversationId: id, messageId: id.optional(), analysisId: id.optional(), documentId: id.optional(), personId: id.optional(),
  sourceType: id, sanitizedSourceLabel: id, availability: z.enum(["available", "historical_unavailable", "deleted"]),
  page: z.number().int().positive().optional(), sheet: z.string().optional(), rowRange: z.string().optional(), cellRange: z.string().optional(), period: z.string().optional(),
  conceptIds: z.array(id), excerpt: z.string(), sanitizedHash: id,
}).strict();

const getPersonProfileToolRequestSchema = z.object({
  type: z.literal("tool_request"),
  roundId: id,
  requestId: id,
  tool: z.literal("getPersonProfile"),
  args: z.object({ analysisId: id, personId: id }).strict(),
}).strict();

export const assistantStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), roundId: id, label: z.string() }).strict(),
  getPersonProfileToolRequestSchema,
  z.object({ type: z.literal("tool_result_ack"), roundId: id, requestId: id }).strict(),
  z.object({ type: z.literal("text_delta"), roundId: id, messageId: id, delta: z.string() }).strict(),
  z.object({ type: z.literal("source"), roundId: id, source: sourceReferenceSchema }).strict(),
  z.object({ type: z.literal("action"), roundId: id, action: chatActionSchema }).strict(),
  z.object({ type: z.literal("usage"), roundId: id, usage: tokenUsageSchema }).strict(),
  z.object({ type: z.literal("done"), roundId: id, finishReason: z.string() }).strict(),
  z.object({ type: z.literal("error"), roundId: id, code: id, message: z.string(), retryable: z.boolean() }).strict(),
]);
export type AssistantStreamEvent = z.infer<typeof assistantStreamEventSchema>;
