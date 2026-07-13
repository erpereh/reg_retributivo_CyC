"use client";

import { Copy, RefreshCw, RotateCcw } from "lucide-react";
import { ActionProposal } from "@/components/assistant/ActionProposal";
import { SafeMarkdown } from "@/components/assistant/SafeMarkdown";
import { SourceSummary } from "@/components/assistant/SourceSummary";
import type { ChatAction, ChatMessage, SourceReference } from "@/lib/assistant/domain";

export function AssistantMessage({ message, sources, actions, latestAssistant, repeatable, onCopy, onRetry, onRegenerate }: Readonly<{
  message: ChatMessage;
  sources: readonly SourceReference[];
  actions: readonly ChatAction[];
  latestAssistant: boolean;
  repeatable: boolean;
  onCopy(messageId: string): void;
  onRetry(messageId: string): void;
  onRegenerate(messageId: string): void;
}>) {
  const assistant = message.role === "assistant";
  return (
    <li className={assistant ? "me-auto w-full max-w-[48rem]" : "ms-auto max-w-[85%] sm:max-w-[75%]"}>
      <article aria-label={assistant ? "Respuesta del Asistente" : "Tu pregunta"} className={assistant ? "rounded-2xl bg-white p-4 shadow-subtle ring-1 ring-line/80 sm:p-5" : "rounded-2xl rounded-br-md bg-ink px-4 py-3 text-white shadow-subtle"}>
        {assistant ? <SafeMarkdown content={message.content || (message.status === "streaming" ? "Preparando respuesta…" : "Respuesta sin contenido.")} /> : <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>}
        {assistant ? actions.map((action) => <ActionProposal key={action.id} action={action} />) : null}
        {assistant ? <SourceSummary sources={sources} /> : null}
        {assistant ? (
          <footer className="mt-3 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2">
            <span className="me-auto text-xs font-medium text-muted">{message.status === "streaming" ? "Generando" : message.status === "stopped" ? "Detenida" : message.status === "failed" ? "Fallida" : "Respuesta"}</span>
            <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-muted hover:bg-slate-100 hover:text-ink" aria-label="Copiar respuesta" onClick={() => onCopy(message.id)}><Copy aria-hidden="true" className="size-4" /></button>
            {repeatable && (message.status === "failed" || message.status === "stopped" || message.status === "interrupted") ? <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-bold text-ink hover:bg-slate-100" aria-label="Reintentar respuesta" onClick={() => onRetry(message.id)}><RotateCcw aria-hidden="true" className="size-4" />Reintentar</button> : null}
            {repeatable && latestAssistant && message.status === "completed" ? <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-bold text-ink hover:bg-slate-100" aria-label="Regenerar respuesta" onClick={() => onRegenerate(message.id)}><RefreshCw aria-hidden="true" className="size-4" />Regenerar</button> : null}
          </footer>
        ) : null}
      </article>
    </li>
  );
}
