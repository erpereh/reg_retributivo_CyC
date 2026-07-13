"use client";

import { useState } from "react";
import type { ChatEvent, ChatMessage, PersistedDocumentMetadata } from "@/lib/assistant/domain";
import type { AssistantStoredRecord, ContextSnapshot } from "@/lib/assistant/storage/repositories";

export function ContextUsageDetails({ messages, snapshots, events, documents, indexJobs }: Readonly<{
  messages: readonly ChatMessage[];
  snapshots: readonly ContextSnapshot[];
  events: readonly ChatEvent[];
  documents: readonly PersistedDocumentMetadata[];
  indexJobs: readonly AssistantStoredRecord[];
}>) {
  const [open, setOpen] = useState(false);
  const usage = [...messages].reverse().find((message) => message.usage)?.usage;
  return (
    <section className="border-t border-line pt-4">
      <button type="button" className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm font-bold text-ink hover:bg-slate-50" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Ver uso de contexto <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          {usage ? <><p>{usage.inputTokens} tokens de entrada</p><p>{usage.outputTokens} tokens de salida</p><p>{usage.totalTokens} tokens totales{usage.estimated ? " (estimados)" : ""}</p></> : <p>Aún no hay datos de uso.</p>}
          {snapshots.map((snapshot) => <div key={snapshot.id} className="border-t border-slate-200 pt-2"><p className="font-semibold text-ink">{snapshot.summary}</p><p className="mt-1 text-xs text-muted">{snapshot.actualStrategy} · {snapshot.actualResponseMode}</p></div>)}
          {documents.map((document) => <div key={document.id} className="border-t border-slate-200 pt-2"><p className="font-semibold text-ink">{document.sanitizedSourceLabel}</p><p className="mt-1 text-xs text-muted">Documento: {document.status}</p></div>)}
          {indexJobs.map((job) => <p key={job.id} className="text-xs text-muted">Indexación: {String(job.status ?? "pendiente")}</p>)}
          {events.flatMap((event) => event.event.type === "indexing_completed" ? [<p key={event.id} className="text-xs text-muted">Índice actualizado: {event.event.status}</p>] : [])}
        </div>
      ) : null}
    </section>
  );
}
