"use client";

import { Archive, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import type { Conversation } from "@/lib/assistant/domain";

export function ConversationSidebar({ conversations, selectedId, hasMore, transitionPending, onLoadMore, onSelect, onCreate, onRename, onArchive, onDelete }: Readonly<{
  conversations: readonly Conversation[];
  selectedId?: string;
  hasMore: boolean;
  transitionPending: boolean;
  onLoadMore(): void;
  onSelect(id: string): void;
  onCreate(): void;
  onRename(title: string): void;
  onArchive(): void;
  onDelete(): void;
}>) {
  const selectedReadOnly = conversations.find((conversation) => conversation.id === selectedId)?.status !== "active";
  return (
    <nav aria-label="Conversaciones" className="flex h-full min-h-0 flex-col bg-white">
      <div className="border-b border-line p-3">
        <button type="button" className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-40" disabled={transitionPending} onClick={onCreate}><MessageSquarePlus aria-hidden="true" className="size-4" />Nueva conversación</button>
      </div>
      <ul data-testid="conversation-list" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button type="button" aria-current={conversation.id === selectedId ? "page" : undefined} disabled={transitionPending} className={`min-h-11 w-full rounded-xl px-3 py-2 text-left text-sm transition-colors duration-180 disabled:cursor-not-allowed disabled:opacity-40 ${conversation.id === selectedId ? "bg-slate-900 font-semibold text-white" : "text-slate-700 hover:bg-slate-100"}`} onClick={() => onSelect(conversation.id)}>
              <span className="block truncate">{`${conversation.title}\u200b`}</span>
              <span className={`mt-0.5 block text-xs ${conversation.id === selectedId ? "text-slate-300" : "text-muted"}`}>{conversation.status === "active" ? "Activa" : "Archivada"}</span>
            </button>
          </li>
        ))}
      </ul>
      {hasMore ? <button type="button" className="mx-3 mb-2 min-h-11 rounded-xl text-sm font-bold text-primary hover:bg-blue-50" onClick={onLoadMore}>Cargar más conversaciones</button> : null}
      {selectedId ? (
        <div className="grid grid-cols-3 gap-1 border-t border-line p-2">
          <button type="button" disabled={selectedReadOnly || transitionPending} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-muted hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Renombrar conversación" onClick={() => { const value = window.prompt("Nuevo nombre de la conversación"); if (value?.trim()) onRename(value); }}><Pencil aria-hidden="true" className="size-4" /></button>
          <button type="button" disabled={selectedReadOnly || transitionPending} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-muted hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Archivar conversación" onClick={onArchive}><Archive aria-hidden="true" className="size-4" /></button>
          <button type="button" disabled={transitionPending} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-danger hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Eliminar conversación" onClick={onDelete}><Trash2 aria-hidden="true" className="size-4" /></button>
        </div>
      ) : null}
    </nav>
  );
}
