"use client";

import { MessageSquarePlus, MoreHorizontal, Pencil, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Conversation } from "@/lib/assistant/domain";

function sectionLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startValue = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startToday - startValue) / 86_400_000);
  if (days <= 0) return "HOY";
  if (days === 1) return "AYER";
  if (days < 7) return "ESTA SEMANA";
  return "ANTERIORES";
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function ConversationSidebar({ conversations, selectedId, hasMore, transitionPending, onLoadMore, onSelect, onCreate, onRename, onDelete }: Readonly<{ conversations: readonly Conversation[]; selectedId?: string; hasMore: boolean; transitionPending: boolean; onLoadMore(): void; onSelect(id: string): void; onCreate(): void; onRename(title: string): void; onDelete(): void }>) {
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedReadOnly = conversations.find((conversation) => conversation.id === selectedId)?.status === "archived_analysis_deleted";
  const sections = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    const visible = conversations.filter((conversation) => !normalized || conversation.title.toLocaleLowerCase("es").includes(normalized));
    const grouped = new Map<string, Conversation[]>();
    for (const conversation of visible) {
      const label = sectionLabel(conversation.updatedAt);
      grouped.set(label, [...(grouped.get(label) ?? []), conversation]);
    }
    return [...grouped.entries()];
  }, [conversations, query]);

  return (
    <nav aria-label="Conversaciones" className="assistant-conversation-panel">
      <div className="assistant-conversation-panel__brand">
        <span className="assistant-conversation-panel__orb" aria-hidden="true">AI</span>
        <span><strong>Asistente</strong><small>Retributivo AI</small></span>
      </div>

      <button type="button" className="assistant-new-conversation" disabled={transitionPending} onClick={onCreate}>
        <MessageSquarePlus aria-hidden="true" className="size-4" />
        Nueva conversación
      </button>

      <label className="assistant-conversation-search">
        <Search aria-hidden="true" className="size-4" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar conversaciones" aria-label="Buscar conversaciones" />
      </label>

      <div className="assistant-conversation-panel__scroll" data-testid="conversation-list">
        {sections.map(([label, items]) => (
          <section key={label} className="assistant-conversation-group" aria-label={label}>
            <h3>{label}</h3>
            <ul>
              {items.map((conversation) => {
                const active = conversation.id === selectedId;
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      disabled={transitionPending}
                      className={active ? "assistant-conversation-item assistant-conversation-item--active" : "assistant-conversation-item"}
                      onClick={() => onSelect(conversation.id)}
                    >
                      <span className="assistant-conversation-item__copy">
                        <strong>{conversation.title}</strong>
                        <small>{conversation.status === "archived_analysis_deleted" ? "Análisis eliminado · solo lectura" : conversation.type === "analysis" ? "Consulta de análisis" : "Consulta general"}</small>
                      </span>
                      <time dateTime={conversation.updatedAt}>{timeLabel(conversation.updatedAt)}</time>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {!sections.length ? <p className="assistant-conversation-empty">No hay conversaciones que coincidan.</p> : null}
        {hasMore ? <button type="button" className="assistant-load-more" onClick={onLoadMore}>Cargar más conversaciones</button> : null}
      </div>

      {selectedId ? (
        <div className="assistant-conversation-actions">
          <button type="button" aria-label="Más acciones de conversación" onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal className="size-4" /></button>
          {menuOpen ? (
            <div className="assistant-conversation-menu">
              <button type="button" disabled={selectedReadOnly || transitionPending} onClick={() => { const value = window.prompt("Nuevo nombre de la conversación"); if (value?.trim()) onRename(value); setMenuOpen(false); }}><Pencil className="size-4" />Renombrar</button>
              <button type="button" disabled={transitionPending} className="danger" onClick={() => { onDelete(); setMenuOpen(false); }}><Trash2 className="size-4" />Eliminar</button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="assistant-privacy-note"><ShieldCheck aria-hidden="true" className="size-4" /><span>Contexto protegido activado</span></div>
    </nav>
  );
}
