"use client";

import { Send, Square, Users } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { ContextStrategy, Conversation, ModelProfile, ResponseMode } from "@/lib/assistant/domain";

export function AssistantComposer({ streaming, disabled = false, conversation, profiles, personCount, contextTokens, onSend, onStop, onPreferences, onConfigureModels, onManagePeople }: Readonly<{
  streaming: boolean; disabled?: boolean; conversation: Conversation; profiles: readonly ModelProfile[]; personCount: number; contextTokens?: number;
  onSend(value: string): Promise<void>; onStop(): void;
  onPreferences(patch: { modelProfileId?: string; responseMode?: ResponseMode; contextStrategy?: ContextStrategy }): void;
  onConfigureModels?(): void;
  onManagePeople?(): void;
}>) {
  const [value, setValue] = useState("");
  async function submit(event?: FormEvent) { event?.preventDefault(); const raw = value; if (!raw.trim() || streaming || disabled) return; setValue(""); await onSend(raw); }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return; event.preventDefault(); void submit(); }
  return <form onSubmit={(event) => void submit(event)} className="border-t border-line bg-white/95 p-3 backdrop-blur sm:p-4">
    <label htmlFor="assistant-composer" className="sr-only">Pregunta</label>
    <div className="rounded-2xl bg-slate-50 p-2 ring-1 ring-line focus-within:ring-2 focus-within:ring-primary/40"><textarea id="assistant-composer" className="max-h-40 min-h-11 w-full resize-y bg-transparent px-2 py-2.5 text-sm leading-6 outline-none placeholder:text-muted" rows={1} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={onKeyDown} placeholder="Escribe una pregunta…" disabled={streaming || disabled} />
      <div className="flex items-center gap-2 overflow-x-auto px-1 pb-1"><button type="button" className="btn-secondary shrink-0" aria-label="Gestionar contexto" onClick={onManagePeople}><Users aria-hidden="true" className="size-4" />{personCount ? `${personCount} personas` : "Añadir contexto"}</button><select aria-label="Modelo de conversación" className="filter-control shrink-0" disabled={conversation.status !== "active" || !profiles.length} value={conversation.modelProfileId ?? ""} onChange={(event) => onPreferences({ modelProfileId: event.target.value || undefined })}><option value="">{profiles.length ? "Selecciona un modelo" : "No hay modelos configurados"}</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><select aria-label="Modo de respuesta" className="filter-control shrink-0" disabled={conversation.status !== "active"} value={conversation.responseMode} onChange={(event) => onPreferences({ responseMode: event.target.value as ResponseMode })}><option value="strict">Estricto</option><option value="flexible">Flexible</option></select><select aria-label="Estrategia de contexto" className="filter-control shrink-0" disabled={conversation.status !== "active"} value={conversation.contextStrategy} onChange={(event) => onPreferences({ contextStrategy: event.target.value as ContextStrategy })}><option value="automatic">Automático</option><option value="full">Completo</option><option value="optimized">Optimizado</option></select><span className="shrink-0 text-xs font-semibold text-muted">{contextTokens ? `${contextTokens.toLocaleString("es-ES")} tokens` : "Uso no disponible"}</span>{!profiles.length && onConfigureModels ? <button type="button" className="btn-secondary shrink-0" onClick={onConfigureModels}>Configurar modelos</button> : null}<span className="flex-1" />{streaming ? <button type="button" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-ink text-white" aria-label="Detener respuesta" onClick={onStop}><Square aria-hidden="true" className="size-4 fill-current" /></button> : <button type="submit" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-blue hover:bg-primary-dark disabled:opacity-40" aria-label="Enviar" disabled={disabled || !value.trim()}><Send aria-hidden="true" className="size-4" /></button>}</div>
    </div>
  </form>;
}
