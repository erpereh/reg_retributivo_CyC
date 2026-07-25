"use client";

import { BookOpen, Bot, Check, Copy, RefreshCw, RotateCcw, Sparkles, UserRound } from "lucide-react";
import { useState } from "react";
import { ActionProposal } from "@/components/assistant/ActionProposal";
import { ModalShell } from "@/components/common/ModalShell";
import { SafeMarkdown } from "@/components/assistant/SafeMarkdown";
import { SourceDetails } from "@/components/assistant/SourceDetails";
import { SourceSummary } from "@/components/assistant/SourceSummary";
import type { ChatAction, ChatMessage, SourceReference } from "@/lib/assistant/domain";

function messageTime(value: string): string {
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function AssistantMessage({ message, sources, revealedSourceIds, actions, actionOutputs, resolvingActionIds, actionsDisabled, latestAssistant, repeatable, onCopy, onRetry, onRegenerate, onAcceptAction, onRejectAction, onOpenSource }: Readonly<{
  message: ChatMessage;
  sources: readonly SourceReference[];
  revealedSourceIds: readonly string[];
  actions: readonly ChatAction[];
  actionOutputs: Readonly<Record<string, unknown>>;
  resolvingActionIds: readonly string[];
  actionsDisabled: boolean;
  latestAssistant: boolean;
  repeatable: boolean;
  onCopy(messageId: string): void;
  onRetry(messageId: string): void;
  onRegenerate(messageId: string): void;
  onAcceptAction(actionId: string): void;
  onRejectAction(actionId: string): void;
  onOpenSource?(source: SourceReference): void;
}>) {
  const [copied, setCopied] = useState(false);
  const [personExplanation, setPersonExplanation] = useState<SourceReference>();
  const assistant = message.role === "assistant";
  const personSource = sources.find((source) => source.presentation?.kind === "person_analysis");

  function copy() {
    onCopy(message.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <li className={assistant ? "assistant-timeline-item assistant-timeline-item--assistant" : "assistant-timeline-item assistant-timeline-item--user"}>
      <article aria-label={assistant ? "Respuesta del Asistente" : "Tu pregunta"} className={assistant ? "assistant-chat-message assistant-chat-message--assistant" : "assistant-chat-message assistant-chat-message--user"}>
        <div className="assistant-message-meta">
          <span className={assistant ? "assistant-message-avatar assistant-message-avatar--bot" : "assistant-message-avatar"} aria-hidden="true">
            {assistant ? <Sparkles className="size-4" /> : <UserRound className="size-4" />}
          </span>
          <span title={assistant && message.modelId ? message.modelId : undefined}>{assistant ? `Retributivo${message.modelId ? ` · ${message.modelId}` : ""}` : "Tú"} · {messageTime(message.createdAt)}</span>
          {assistant && message.status === "completed" ? <span className="assistant-message-status"><i />Configurado</span> : null}
        </div>

        <div className={assistant ? "assistant-answer-card" : "assistant-user-bubble"}>
          {assistant ? <SafeMarkdown content={message.content || (message.status === "streaming" ? "Preparando respuesta…" : "Respuesta sin contenido.")} onCitation={(index) => { const source = sources[index - 1]; if (source) onOpenSource?.(source); }} /> : <p>{message.content}</p>}

          {assistant ? actions.map((action) => <ActionProposal key={action.id} action={action} output={actionOutputs[action.id]} disabled={actionsDisabled || resolvingActionIds.includes(action.id)} onAccept={onAcceptAction} onReject={onRejectAction} />) : null}

          {assistant && personSource ? (
            <button type="button" className="assistant-person-explanation" onClick={() => setPersonExplanation(personSource)}>
              <Bot aria-hidden="true" className="size-4" />
              Abrir explicación completa de la persona
            </button>
          ) : null}

          {assistant ? <SourceSummary sources={sources} revealedSourceIds={revealedSourceIds} onOpenSource={onOpenSource} /> : null}

          {assistant ? (
            <footer className="assistant-message-actions">
              <button type="button" aria-label="Copiar respuesta" onClick={copy}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copiado" : "Copiar respuesta"}</button>
              {repeatable && (message.status === "failed" || message.status === "stopped" || message.status === "interrupted") ? <button type="button" aria-label="Reintentar respuesta" onClick={() => onRetry(message.id)}><RotateCcw className="size-4" />Reintentar</button> : null}
              {repeatable && latestAssistant && message.status === "completed" ? <button type="button" aria-label="Regenerar respuesta" onClick={() => onRegenerate(message.id)}><RefreshCw className="size-4" />Regenerar</button> : null}
              <span>{message.status === "streaming" ? "Generando…" : message.status === "failed" ? "Respuesta fallida" : message.status === "stopped" ? "Respuesta detenida" : message.status === "interrupted" ? "Respuesta interrumpida" : "Respuesta verificada con fuentes"}</span>
            </footer>
          ) : null}
        </div>
      </article>

      {personExplanation ? (
        <ModalShell
          title="Explicación de la revisión de persona"
          maxWidth="2xl"
          onClose={() => setPersonExplanation(undefined)}
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPersonExplanation(undefined)}>Cerrar explicación</button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const source = personExplanation;
                  setPersonExplanation(undefined);
                  onOpenSource?.(source);
                }}
              >
                <BookOpen aria-hidden="true" className="size-4" />
                Abrir fuente completa
              </button>
            </div>
          )}
        >
          <div data-testid="assistant-person-explanation-modal" className="assistant-person-explanation-modal">
            <div className="assistant-person-explanation-modal__header"><span><Sparkles className="size-4" /></span><div><p>Evidencia retributiva</p><h3>{personExplanation.sanitizedSourceLabel}</h3></div></div>
            <SourceDetails source={personExplanation} />
          </div>
        </ModalShell>
      ) : null}
    </li>
  );
}
