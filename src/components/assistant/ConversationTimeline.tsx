"use client";

import { ArchiveX, ChevronDown, FileSpreadsheet, FileText, UserRound } from "lucide-react";
import { AssistantComposer } from "@/components/assistant/AssistantComposer";
import { AssistantMessage } from "@/components/assistant/AssistantMessage";
import { ConversationEvent } from "@/components/assistant/ConversationEvent";
import type { AssistantContextValue } from "@/components/assistant/AssistantProvider";
import type { SourceReference } from "@/lib/assistant/domain";

type TimelineItem =
  | { kind: "event"; id: string; createdAt: string; event: AssistantContextValue["events"][number] }
  | { kind: "message"; id: string; createdAt: string; message: AssistantContextValue["messages"][number] };

function timelineOrder(item: TimelineItem): number {
  if (item.kind === "event") return 0;
  return item.message.role === "user" ? 1 : 2;
}

function compareTimeline(left: TimelineItem, right: TimelineItem): number {
  return left.createdAt.localeCompare(right.createdAt) || timelineOrder(left) - timelineOrder(right) || left.id.localeCompare(right.id);
}

function tokenPercent(used?: number, maximum?: number): number {
  if (!used || !maximum) return 0;
  return Math.max(0, Math.min(100, Math.round((used / maximum) * 100)));
}

export function ConversationTimeline({ assistant, onShowContextUsage, onOpenSource }: Readonly<{ assistant: AssistantContextValue; onShowContextUsage?(): void; onOpenSource?(source: SourceReference): void }>) {
  const activeAnalysis = assistant.activeAnalysisSummary;
  const conversation = assistant.conversation;
  const latestAssistantId = [...assistant.messages].reverse().find((message) => message.role === "assistant")?.id;
  const latestUsage = [...assistant.messages].reverse().find((message) => message.usage)?.usage;
  const selectedModel = assistant.modelCatalog.find((entry) => entry.providerId === conversation?.providerId && entry.canonicalModelId === conversation?.modelId);
  const repeatableIds = new Set(assistant.repeatableMessageIds);
  const timeline = [
    ...assistant.events.map((event) => ({ kind: "event" as const, id: event.id, createdAt: event.createdAt, event })),
    ...assistant.messages.map((message) => ({ kind: "message" as const, id: message.id, createdAt: message.createdAt, message })),
  ].sort(compareTimeline);
  const percent = tokenPercent(latestUsage?.inputTokens, selectedModel?.contextWindow);
  const periods = activeAnalysis?.periods ?? [];

  return (
    <main className="assistant-chat-shell" aria-labelledby="assistant-title">
      <header className="assistant-chat-header">
        <div className="assistant-chat-header__copy">
          <span>{conversation?.type === "analysis" ? "Consulta de análisis" : "Consulta general"}</span>
          <h1 id="assistant-title">{conversation?.title ?? "Nueva conversación"}</h1>
        </div>
        {conversation?.type === "analysis" ? (
          <button type="button" className="assistant-linked-analysis" onClick={onShowContextUsage}>
            <FileSpreadsheet aria-hidden="true" className="size-4" />
            <span><strong>{activeAnalysis?.registroFileName ?? "Análisis retributivo"}</strong><small>{activeAnalysis ? `${activeAnalysis.uniquePeople} personas · ${activeAnalysis.pdfCount + 1} documentos` : "Contexto histórico"}</small></span>
            <ChevronDown aria-hidden="true" className="size-4" />
          </button>
        ) : conversation ? (
          <button type="button" className="assistant-linked-analysis" disabled={conversation.status !== "active" || assistant.streaming || assistant.selectionLoading || assistant.conversationTransitionPending} onClick={() => void assistant.convertToActiveAnalysis()}>
            <FileSpreadsheet aria-hidden="true" className="size-4" />
            <span><strong>Añadir contexto</strong><small>Vincular el análisis activo</small></span>
            <ChevronDown aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </header>

      {conversation ? (
        <div className="assistant-context-bar">
          <div className="assistant-context-bar__type"><span>Contexto</span><strong>{conversation.type === "analysis" ? (conversation.contextStrategy === "full_analysis" || conversation.contextStrategy === "full" ? "Análisis completo" : "Personas asociadas") : "Chat general"}</strong></div>
          {conversation.primaryPersonId ? <div><UserRound aria-hidden="true" className="size-4" /><span>Principal: <strong>{conversation.primaryPersonId}</strong></span></div> : null}
          {conversation.associatedPersonIds.length ? <div><span>Asociadas: <strong>{conversation.associatedPersonIds.filter((id) => id !== conversation.primaryPersonId).slice(0, 3).join(", ") || "—"}</strong></span></div> : null}
          {conversation.type === "analysis" ? <div><span>Periodos: <strong>{periods.length || "—"}</strong></span></div> : null}
          <button type="button" className="assistant-context-usage" onClick={onShowContextUsage}>
            <span>Uso del contexto</span><i><b style={{ width: `${percent}%` }} /></i><strong>{percent || 0}%</strong>
          </button>
          <button type="button" className="assistant-context-sources" onClick={onShowContextUsage}><FileText aria-hidden="true" className="size-4" /><strong>{assistant.sources.length} fuentes</strong></button>
        </div>
      ) : null}

      {conversation?.status === "archived_analysis_deleted" ? (
        <div role="alert" className="assistant-historical-notice">
          <ArchiveX aria-hidden="true" className="size-4" />
          <span><strong>El análisis original fue eliminado.</strong> Esta conversación conserva evidencia histórica y es de solo lectura.</span>
        </div>
      ) : null}

      <div className="assistant-chat-messages">
        {!conversation ? (
          <div className="assistant-empty-chat">
            <span className="assistant-empty-chat__orb">AI</span>
            <h2>Consulta tu análisis retributivo</h2>
            <p>Las conversaciones y sus fuentes se guardan de forma persistente y privada en este navegador.</p>
            <button type="button" className="btn-primary" onClick={() => void assistant.createGeneralConversation()}>Crear conversación general</button>
          </div>
        ) : (
          <>
            {assistant.hasMoreMessages ? <button type="button" className="assistant-load-previous" onClick={() => void assistant.loadMoreMessages()}>Cargar mensajes anteriores</button> : null}
            <ul className="assistant-timeline">
              {timeline.map((item) => item.kind === "event" ? <ConversationEvent key={item.id} event={item.event} /> : (() => {
                const message = item.message;
                return (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    sources={assistant.sources.filter((source) => message.sourceRefIds.includes(source.id))}
                    revealedSourceIds={assistant.revealedSourceIds}
                    actions={assistant.actions.filter((action) => action.messageId === message.id)}
                    actionOutputs={assistant.actionOutputs}
                    resolvingActionIds={assistant.resolvingActionIds}
                    actionsDisabled={conversation.status !== "active" || assistant.selectionLoading}
                    latestAssistant={message.id === latestAssistantId}
                    repeatable={repeatableIds.has(message.id)}
                    onCopy={(id) => void assistant.copyResponse(id)}
                    onRetry={(id) => void assistant.retryResponse(id)}
                    onRegenerate={(id) => void assistant.regenerateResponse(id)}
                    onAcceptAction={(id) => void assistant.acceptAction(id)}
                    onRejectAction={(id) => void assistant.rejectAction(id)}
                    onOpenSource={onOpenSource}
                  />
                );
              })())}
            </ul>
          </>
        )}
      </div>

      {conversation ? <AssistantComposer streaming={assistant.streaming} controlsDisabled={assistant.selectionLoading || conversation.status !== "active"} sendDisabled={!assistant.canSend} conversation={conversation} catalog={assistant.modelCatalog} providers={assistant.providerConfigs.filter((provider) => provider.enabled)} preferences={assistant.modelPreferences} checkingCompatibilityEntryIds={assistant.checkingCompatibilityEntryIds} contextTokens={latestUsage?.inputTokens} onSend={assistant.send} onStop={assistant.stop} onSelectModel={(providerId, modelId) => void assistant.selectConversationModel(providerId, modelId)} onToggleFavorite={(entryId) => void assistant.toggleModelFavorite(entryId)} onCheckCompatibility={(entry) => void assistant.checkModelCompatibility(entry)} onPreferences={(patch) => void assistant.updateConversationPreferences(patch)} onConfigureProviders={assistant.openModelSettings} onShowContextUsage={onShowContextUsage} /> : null}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{assistant.announcement}</div>
      {assistant.error ? <p role="alert" className="assistant-chat-error">{assistant.error}</p> : null}
    </main>
  );
}
