"use client";

import { AssistantComposer } from "@/components/assistant/AssistantComposer";
import { AssistantMessage } from "@/components/assistant/AssistantMessage";
import { ConversationEvent } from "@/components/assistant/ConversationEvent";
import type { AssistantContextValue } from "@/components/assistant/AssistantProvider";

export function ConversationTimeline({ assistant, onManagePeople }: Readonly<{ assistant: AssistantContextValue; onManagePeople?(): void }>) {
  const conversation = assistant.conversation;
  const latestAssistantId = [...assistant.messages].reverse().find((message) => message.role === "assistant")?.id;
  const repeatableIds = new Set(assistant.repeatableMessageIds);
  const timeline = [
    ...assistant.events.map((event) => ({ kind: "event" as const, id: event.id, createdAt: event.createdAt, event })),
    ...assistant.messages.map((message) => ({ kind: "message" as const, id: message.id, createdAt: message.createdAt, message })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col bg-slate-50/80" aria-labelledby="assistant-title">
      <header className="flex min-h-16 items-center border-b border-line bg-white px-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Asistente retributivo</p>
          <h1 id="assistant-title" className="truncate text-lg font-bold text-ink">{conversation?.title ?? "Nueva conversación"}</h1>
        </div>
        {conversation?.type === "general" ? <button type="button" className="btn-secondary ms-3 shrink-0" disabled={conversation.status !== "active" || assistant.streaming || assistant.selectionLoading} onClick={() => void assistant.convertToActiveAnalysis()}>Convertir al análisis activo</button> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
        {!conversation ? (
          <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center text-center">
            <p className="text-xl font-bold text-ink">Consulta el análisis con privacidad local</p>
            <p className="mt-2 text-sm leading-6 text-muted">Las conversaciones, fuentes y asociaciones permanecen en este navegador.</p>
            <button type="button" className="btn-primary mt-5" onClick={() => void assistant.createGeneralConversation()}>Crear conversación general</button>
          </div>
        ) : (
          <>
            {assistant.hasMoreMessages ? <button type="button" className="mx-auto mb-4 block min-h-11 rounded-xl px-4 text-sm font-bold text-primary hover:bg-blue-50" onClick={() => void assistant.loadMoreMessages()}>Cargar mensajes anteriores</button> : null}
            <ul className="mx-auto max-w-[52rem] space-y-4">
              {timeline.map((item) => item.kind === "event" ? <ConversationEvent key={item.id} event={item.event} /> : (() => { const message = item.message; return (
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
                />
              ); })())}
            </ul>
          </>
        )}
      </div>
      {conversation ? <AssistantComposer streaming={assistant.streaming} disabled={assistant.selectionLoading || conversation.status !== "active" || !assistant.canSend} conversation={conversation} profiles={assistant.modelProfiles.filter((profile) => profile.enabled && (conversation.type === "analysis" ? profile.analysisCompatible : profile.generalChatCompatible))} personCount={conversation.associatedPersonIds.length} contextTokens={[...assistant.messages].reverse().find((message) => message.usage)?.usage?.inputTokens} onSend={assistant.send} onStop={assistant.stop} onPreferences={(patch) => void assistant.updateConversationPreferences(patch)} onConfigureModels={assistant.openModelSettings} onManagePeople={onManagePeople} /> : null}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{assistant.announcement}</div>
      {assistant.error ? <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-danger">{assistant.error}</p> : null}
    </main>
  );
}
