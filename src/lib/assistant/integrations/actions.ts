import type { ChatAction, ChatActionPayload } from "@/lib/assistant/domain";
import { chatActionSchema } from "@/lib/assistant/schemas";
import type { AssistantRepositories } from "@/lib/assistant/storage/repositories";
import { selectPerson, selectPersonProfile } from "@/lib/assistant/tools/sharedSelectors";
import type { AnalysisResult } from "@/lib/types";

export type AppNavigationIntent =
  | { type: "assistant_conversation"; conversationId: string }
  | { type: "open_person"; analysisId: string; personId: string }
  | { type: "open_cuadre"; analysisId: string; personId?: string; view?: "non_normalized" | "normalized_variables" }
  | { type: "open_grouping"; analysisId: string; groupingId: string }
  | { type: "show_sources"; sourceIds: string[] };

interface ExecuteInput { action: ChatAction; repositories: AssistantRepositories; analysis?: { id: string; result: AnalysisResult }; now?: string }
export interface ExecutedChatAction extends ChatAction { intent?: AppNavigationIntent; output?: unknown }

function sameAction(left: ChatAction, right: ChatAction): boolean {
  return JSON.stringify(chatActionSchema.parse(left)) === JSON.stringify(chatActionSchema.parse(right));
}
function referencedAnalysisId(action: ChatActionPayload): string | undefined { return "analysisId" in action ? action.analysisId : undefined; }
function personIds(action: ChatActionPayload): readonly string[] { if ("personIds" in action) return action.personIds; if ("personId" in action && action.personId) return [action.personId]; return []; }

async function requirePendingIdentity(repositories: AssistantRepositories, expected: ChatAction): Promise<void> {
  if (expected.status !== "pending") throw new Error("La acción ya está resuelta.");
  const stored = await repositories.actions.get(expected.id);
  if (!stored || stored.status !== "pending" || !sameAction(stored, expected)) throw new Error("La identidad de la propuesta no coincide.");
}

export async function rejectChatAction(input: { action: ChatAction; repositories: AssistantRepositories; now?: string }): Promise<ChatAction> {
  const action = chatActionSchema.parse(input.action);
  await requirePendingIdentity(input.repositories, action);
  return (await input.repositories.resolveChatAction({ expected: action, status: "rejected", resolvedAt: input.now ?? new Date().toISOString() })).action;
}

export async function executeChatAction(input: ExecuteInput): Promise<ExecutedChatAction> {
  const now = input.now ?? new Date().toISOString();
  const action = chatActionSchema.parse(input.action);
  await requirePendingIdentity(input.repositories, action);
  const reject = async (message: string): Promise<never> => {
    await input.repositories.resolveChatAction({ expected: action, status: "rejected", resolvedAt: now });
    throw new Error(message);
  };
  try {
    const conversation = await input.repositories.conversations.get(action.conversationId);
    if (!conversation || conversation.status !== "active") return await reject("La conversación no está disponible para acciones.");
    const message = await input.repositories.messages.get(action.messageId);
    if (!message || message.conversationId !== conversation.id) return await reject("El mensaje no pertenece a la conversación.");
    const analysisId = referencedAnalysisId(action.action);
    if (analysisId && (conversation.type !== "analysis" || conversation.analysisId !== analysisId || input.analysis?.id !== analysisId)) return await reject("La acción no pertenece al análisis activo.");
    if (analysisId && !input.analysis) return await reject("El análisis no está disponible.");
    for (const id of personIds(action.action)) if (!selectPerson(input.analysis!.result, id)) return await reject("La matrícula no pertenece al análisis.");
    if (action.action.type === "open_grouping") {
      const groupingId = action.action.groupingId;
      if (!input.analysis!.result.groupings.some((grouping) => grouping.groupId === groupingId)) return await reject("La agrupación no pertenece al análisis.");
    }
    if (action.action.type === "show_sources") for (const sourceId of action.action.sourceIds) {
      const source = await input.repositories.sources.get(sourceId);
      if (!source || source.conversationId !== conversation.id || source.availability !== "available") return await reject("La fuente no está disponible.");
    }
    if (action.action.type === "copy_document_context") {
      if (action.action.sourceConversationId !== conversation.id) return await reject("El scope documental de origen no es válido.");
      const target = await input.repositories.conversations.get(action.action.targetConversationId);
      if (!target || target.status !== "active") return await reject("La conversación destino no está disponible.");
    }

    let intent: AppNavigationIntent | undefined;
    let output: unknown;
    switch (action.action.type) {
      case "open_person": case "open_cuadre": case "open_grouping": case "show_sources": intent = action.action; break;
      case "compare_people": case "show_comparison_table": output = action.action.personIds.map((id) => selectPersonProfile(input.analysis!.result, id)); break;
      case "generate_visual": output = { visual: action.action.visual, people: action.action.personIds.map((id) => selectPersonProfile(input.analysis!.result, id)) }; break;
      case "show_timeline": { const ids = action.action.personId ? [action.action.personId] : conversation.associatedPersonIds; output = ids.map((id) => ({ personId: id, periods: selectPersonProfile(input.analysis!.result, id)?.periods ?? [] })); break; }
      default: break;
    }
    const resolved = await input.repositories.resolveChatAction({ expected: action, status: "accepted", resolvedAt: now });
    if (resolved.createdConversation) intent = { type: "assistant_conversation", conversationId: resolved.createdConversation.id };
    if (resolved.documentMappings) output = resolved.documentMappings;
    return { ...resolved.action, intent, output };
  } catch (error) {
    const stored = await input.repositories.actions.get(action.id);
    if (stored?.status === "rejected" || stored?.status === "accepted" || !stored || !sameAction(stored, action)) throw error;
    try { await input.repositories.resolveChatAction({ expected: action, status: "failed", resolvedAt: now }); } catch { /* cleanup or another resolver won the CAS */ }
    throw new Error("No se pudo ejecutar la acción segura.");
  }
}
