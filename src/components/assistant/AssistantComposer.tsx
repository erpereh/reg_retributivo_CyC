"use client";

import { CircleGauge, Cpu, Heart, Search, Send, Square } from "lucide-react";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ContextStrategy, Conversation, ModelPreferences, ResponseMode } from "@/lib/assistant/domain";
import type { ModelCatalogEntry, ProviderConfig } from "@/lib/assistant/catalog/domain";
import { modelCompatibility } from "@/lib/assistant/catalog/compatibility";

const responseModeLabels: Record<ResponseMode, string> = { strict: "Estricto", flexible: "Flexible" };
const control = "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-ink hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-45";

function tokens(value?: number) { if (!value) return "—"; return value >= 1_000_000 ? `${Math.round(value / 1_000_000)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(value); }
export function AssistantComposer({ streaming, controlsDisabled = false, sendDisabled = false, conversation, catalog, providers, preferences, contextTokens, onSend, onStop, onSelectModel, onToggleFavorite, onCheckCompatibility, onPreferences, onConfigureProviders, onShowContextUsage }: Readonly<{
  streaming: boolean; controlsDisabled?: boolean; sendDisabled?: boolean; conversation: Conversation; catalog: readonly ModelCatalogEntry[]; providers: readonly ProviderConfig[]; preferences: ModelPreferences; contextTokens?: number;
  onSend(value: string): Promise<void>; onStop(): void; onSelectModel(providerId: string, modelId: string): void; onToggleFavorite(entryId: string): void; onCheckCompatibility(entry: ModelCatalogEntry): void;
  onPreferences(patch: { responseMode?: ResponseMode; contextStrategy?: ContextStrategy }): void; onConfigureProviders?(): void; onShowContextUsage?(): void;
}>) {
  const [value, setValue] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const analysis = conversation.type === "analysis";
  const selected = catalog.find((entry) => entry.providerId === conversation.providerId && entry.canonicalModelId === conversation.modelId);
  const providerName = (id: string) => providers.find((provider) => provider.id === id)?.displayName ?? id;
  const activeProviderIds = useMemo(() => new Set(providers.map((provider) => provider.id)), [providers]);
  const visible = useMemo(() => catalog.filter((entry) => {
    if (!activeProviderIds.has(entry.providerId)) return false;
    if (providerFilter && entry.providerId !== providerFilter) return false;
    const haystack = `${entry.displayName} ${entry.canonicalModelId} ${providerName(entry.providerId)}`.toLocaleLowerCase("es");
    if (!haystack.includes(query.trim().toLocaleLowerCase("es"))) return false;
    return showAll || modelCompatibility(entry, conversation.type).selectable;
  }), [activeProviderIds, catalog, conversation.type, providerFilter, query, showAll, providers]);
  const favoriteSet = new Set(preferences.favoriteCatalogEntryIds);
  const recentSet = new Set(preferences.recentCatalogEntryIds);
  const sections = [
    { label: "Favoritos", entries: visible.filter((entry) => favoriteSet.has(entry.id)) },
    { label: "Recientes", entries: visible.filter((entry) => recentSet.has(entry.id) && !favoriteSet.has(entry.id)) },
    ...providers.map((provider) => ({ label: provider.displayName, entries: visible.filter((entry) => entry.providerId === provider.id && !favoriteSet.has(entry.id) && !recentSet.has(entry.id)) })),
  ].filter((section) => section.entries.length);

  async function submit(event?: FormEvent) { event?.preventDefault(); if (!value.trim() || streaming || controlsDisabled || sendDisabled) return; const text = value; setValue(""); await onSend(text); }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }

  return <form onSubmit={(event) => void submit(event)} className="border-t border-line bg-white/95 p-3 backdrop-blur sm:p-4">
    <div className="rounded-2xl bg-slate-50 p-2 ring-1 ring-line focus-within:ring-2 focus-within:ring-primary/40">
      <label htmlFor="assistant-composer" className="sr-only">Pregunta</label><textarea id="assistant-composer" rows={1} className="max-h-40 min-h-11 w-full resize-y bg-transparent px-2 py-2.5 text-sm leading-6 outline-none" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={keyDown} placeholder="Escribe una pregunta…" disabled={streaming || controlsDisabled} />
      <div data-testid="assistant-composer-controls" className="flex items-end gap-2 px-1 pb-1"><div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <div className="relative"><button type="button" className={control} disabled={controlsDisabled || streaming} aria-expanded={modelOpen} aria-label={`Modelo de conversación: ${selected?.displayName ?? "sin seleccionar"}`} onClick={() => setModelOpen((open) => !open)}><Cpu className="size-3.5" aria-hidden="true" /><span className="max-w-40 truncate">{selected?.displayName ?? "Seleccionar modelo"}</span></button>
          {modelOpen ? <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-30 w-[min(38rem,calc(100vw-2rem))] rounded-2xl border border-line bg-white p-3 shadow-xl" role="dialog" aria-label="Catálogo de modelos">
            <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]"><label className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted" aria-hidden="true" /><input className="filter-control pl-9" aria-label="Buscar modelos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, ID o proveedor" /></label><select className="filter-control" aria-label="Filtrar por proveedor" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="">Todos</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}</select><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />Ver todos</label></div>
            <div className="mt-3 max-h-80 overflow-y-auto pr-1">{sections.map((section) => <section key={section.label} className="mb-3"><h3 className="sticky top-0 bg-white py-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted">{section.label}</h3>{section.entries.map((entry) => { const compatibility = modelCompatibility(entry, conversation.type); return <div key={entry.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-slate-50"><button type="button" className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-50" disabled={!compatibility.selectable} title={compatibility.reason} onClick={() => { onSelectModel(entry.providerId, entry.canonicalModelId); setModelOpen(false); }}><span className="block truncate text-sm font-semibold text-ink">{entry.displayName}</span><span className="block truncate text-xs text-muted">{providerName(entry.providerId)} · {entry.canonicalModelId} · {tokens(entry.contextWindow)} tokens</span><span className="mt-1 flex flex-wrap gap-1 text-[0.625rem] font-bold uppercase">{entry.capabilities.chat === true ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-primary">Chat</span> : null}{entry.capabilities.tools === true ? <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">Herramientas</span> : null}{entry.capabilities.vision === true ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">Visión</span> : null}{entry.capabilities.streaming === true ? <span className="rounded bg-slate-100 px-1.5 py-0.5">Streaming</span> : null}</span>{compatibility.reason ? <span className="mt-1 block text-xs text-danger">{compatibility.reason}</span> : null}</button><button type="button" className="rounded-lg p-2 text-muted hover:bg-white hover:text-danger" aria-label={`${favoriteSet.has(entry.id) ? "Quitar de" : "Añadir a"} favoritos`} onClick={() => onToggleFavorite(entry.id)}><Heart className={`size-4 ${favoriteSet.has(entry.id) ? "fill-current text-danger" : ""}`} /></button>{analysis && entry.capabilities.tools === "unknown" ? <button type="button" className="btn-secondary px-2 text-xs" onClick={() => onCheckCompatibility(entry)}>Comprobar compatibilidad</button> : null}</div>; })}</section>)}{!sections.length ? <p className="p-4 text-center text-sm text-muted">No hay modelos que coincidan.</p> : null}</div>
            {!catalog.length && onConfigureProviders ? <button type="button" className="btn-secondary mt-2" onClick={onConfigureProviders}>Configurar proveedores</button> : null}
          </div> : null}
        </div>
        <select className={`${control} bg-transparent`} disabled={controlsDisabled || streaming} aria-label="Modo de respuesta" value={conversation.responseMode} onChange={(event) => onPreferences({ responseMode: event.target.value as ResponseMode })}>{Object.entries(responseModeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        {analysis ? <label className="inline-flex items-center"><CircleGauge className="ml-2 size-3.5" aria-hidden="true" /><select className={`${control} bg-transparent`} disabled={controlsDisabled || streaming} aria-label="Estrategia de contexto" value={conversation.contextStrategy === "full" ? "full_analysis" : conversation.contextStrategy === "automatic" || conversation.contextStrategy === "optimized" ? "associated_people" : conversation.contextStrategy} onChange={(event) => onPreferences({ contextStrategy: event.target.value as ContextStrategy })}><option value="associated_people">Personas asociadas</option><option value="full_analysis">Análisis completo</option></select></label> : <span className="rounded-lg px-2 text-xs font-bold text-muted">Chat general · sin datos retributivos</span>}
        <button type="button" className="px-2 text-xs font-bold text-muted" disabled={controlsDisabled} aria-label="Abrir detalle del contexto" onClick={onShowContextUsage}>{tokens(contextTokens)} / {tokens(selected?.contextWindow)}</button>
      </div>{streaming ? <button type="button" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink text-white" aria-label="Detener respuesta" onClick={onStop}><Square className="size-4 fill-current" /></button> : <button type="submit" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white disabled:opacity-40" aria-label="Enviar" disabled={controlsDisabled || sendDisabled || !value.trim()}><Send className="size-4" /></button>}</div>
    </div>
  </form>;
}
