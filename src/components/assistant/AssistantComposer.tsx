"use client";

import { Check, ChevronDown, CircleGauge, Heart, Search, Send, ShieldCheck, Square, Star } from "lucide-react";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ContextStrategy, Conversation, ModelPreferences, ResponseMode } from "@/lib/assistant/domain";
import type { ModelCatalogEntry, ProviderConfig } from "@/lib/assistant/catalog/domain";
import { modelCompatibility } from "@/lib/assistant/catalog/compatibility";

const responseModeLabels: Record<ResponseMode, string> = { strict: "Estricto", flexible: "Flexible" };
function tokens(value?: number) { if (!value) return "—"; return value >= 1_000_000 ? `${Math.round(value / 1_000_000)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(value); }

export function AssistantComposer({ streaming, controlsDisabled = false, sendDisabled = false, conversation, catalog, providers, preferences, checkingCompatibilityEntryIds, contextTokens, onSend, onStop, onSelectModel, onToggleFavorite, onCheckCompatibility, onPreferences, onConfigureProviders, onShowContextUsage }: Readonly<{
  streaming: boolean; controlsDisabled?: boolean; sendDisabled?: boolean; conversation: Conversation; catalog: readonly ModelCatalogEntry[]; providers: readonly ProviderConfig[]; preferences: ModelPreferences; checkingCompatibilityEntryIds: readonly string[]; contextTokens?: number;
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

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!value.trim() || streaming || controlsDisabled || sendDisabled) return;
    const text = value;
    setValue("");
    await onSend(text);
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="assistant-composer-wrap">
      <div className="assistant-composer-options">
        <span className={analysis ? "active" : ""}>{analysis ? "Consulta de análisis" : "Consulta general"}</span>
        <select disabled={controlsDisabled || streaming} aria-label="Modo de respuesta" value={conversation.responseMode} onChange={(event) => onPreferences({ responseMode: event.target.value as ResponseMode })}>
          {Object.entries(responseModeLabels).map(([key, label]) => <option key={key} value={key}>Respuesta: {label}</option>)}
        </select>
        {analysis ? (
          <select disabled={controlsDisabled || streaming} aria-label="Estrategia de contexto" value={conversation.contextStrategy === "full" ? "full_analysis" : conversation.contextStrategy === "automatic" || conversation.contextStrategy === "optimized" ? "associated_people" : conversation.contextStrategy} onChange={(event) => onPreferences({ contextStrategy: event.target.value as ContextStrategy })}>
            <option value="associated_people">Contexto: personas asociadas</option>
            <option value="full_analysis">Contexto: análisis completo</option>
          </select>
        ) : null}
      </div>

      <div className="assistant-composer-box">
        <div className="assistant-model-picker-wrap">
          <button type="button" className="assistant-model-picker" disabled={controlsDisabled || streaming} aria-expanded={modelOpen} aria-label={`Modelo de conversación: ${selected?.displayName ?? "sin seleccionar"}`} onClick={() => setModelOpen((open) => !open)}>
            <span className="assistant-provider-mark">{providerName(selected?.providerId ?? conversation.providerId ?? "AI").slice(0, 1).toUpperCase()}</span>
            <span><strong>{selected?.displayName ?? conversation.modelId ?? "Seleccionar modelo"}</strong><small>{selected ? `${providerName(selected.providerId)} · texto y razonamiento` : "Configura un proveedor"}</small></span>
            <ChevronDown aria-hidden="true" className="size-4" />
          </button>

          {modelOpen ? (
            <div className="assistant-model-popover" role="dialog" aria-label="Catálogo de modelos">
              <div className="assistant-model-popover__header"><div><strong>Seleccionar modelo</strong><small>El modelo queda guardado en esta conversación</small></div><button type="button" aria-label="Cerrar selector" onClick={() => setModelOpen(false)}>×</button></div>
              <fieldset disabled={checkingCompatibilityEntryIds.length > 0} aria-busy={checkingCompatibilityEntryIds.length > 0}>
                <label className="assistant-model-search"><Search className="size-4" /><input aria-label="Buscar modelos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar modelos…" /></label>
                <div className="assistant-model-filters"><select aria-label="Filtrar por proveedor" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="">Todos los proveedores</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}</select><label><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />Ver incompatibles</label></div>
                <div className="assistant-model-groups">
                  {sections.map((section) => (
                    <section key={section.label}>
                      <h3>{section.label.toUpperCase()}</h3>
                      {section.entries.map((entry) => {
                        const compatibility = modelCompatibility(entry, conversation.type);
                        const selectedEntry = entry.providerId === conversation.providerId && entry.canonicalModelId === conversation.modelId;
                        return (
                          <div key={entry.id} className={selectedEntry ? "assistant-model-row assistant-model-row--selected" : "assistant-model-row"}>
                            <button type="button" disabled={!compatibility.selectable} title={compatibility.reason} onClick={() => { onSelectModel(entry.providerId, entry.canonicalModelId); setModelOpen(false); }}>
                              <span className="assistant-provider-mini">{providerName(entry.providerId).slice(0, 1).toUpperCase()}</span>
                              <span><strong>{entry.displayName}</strong><small>{providerName(entry.providerId)} · {tokens(entry.contextWindow)} tokens{entry.capabilities.tools === true ? " · herramientas" : ""}</small>{compatibility.reason ? <em>{compatibility.reason}</em> : null}</span>
                              {selectedEntry ? <Check className="size-4" /> : null}
                            </button>
                            <button type="button" className="assistant-favorite-model" aria-label={`${favoriteSet.has(entry.id) ? "Quitar de" : "Añadir a"} favoritos`} onClick={() => onToggleFavorite(entry.id)}><Star className={favoriteSet.has(entry.id) ? "size-4 fill-current" : "size-4"} /></button>
                            {analysis && entry.capabilities.tools === "unknown" ? <button type="button" className="assistant-check-model" onClick={() => onCheckCompatibility(entry)}>Comprobar</button> : null}
                          </div>
                        );
                      })}
                    </section>
                  ))}
                  {!sections.length ? <p>No hay modelos que coincidan.</p> : null}
                </div>
                {!catalog.length && onConfigureProviders ? <button type="button" className="btn-secondary" onClick={onConfigureProviders}>Configurar proveedores</button> : null}
              </fieldset>
            </div>
          ) : null}
        </div>

        <label htmlFor="assistant-composer" className="sr-only">Pregunta</label>
        <textarea id="assistant-composer" rows={2} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={keyDown} placeholder="Pregunta por personas, conceptos, periodos o diferencias…" disabled={streaming || controlsDisabled} />

        <div data-testid="assistant-composer-controls" className="assistant-composer-bottom">
          <div>
            <button type="button" title="Modelos favoritos" onClick={() => setModelOpen(true)}><Heart className="size-4" />Favoritos</button>
            <button type="button" aria-label="Abrir detalle del contexto" onClick={onShowContextUsage}><CircleGauge className="size-4" />{tokens(contextTokens)} / {tokens(selected?.contextWindow)}</button>
            <span><ShieldCheck className="size-4" />Privacidad alta</span>
          </div>
          {streaming ? <button type="button" className="assistant-send-button shrink-0" aria-label="Detener respuesta" onClick={onStop}><Square className="size-4 fill-current" /></button> : <button type="submit" className="assistant-send-button shrink-0" aria-label="Enviar" disabled={controlsDisabled || sendDisabled || !value.trim()}><Send className="size-4" /></button>}
        </div>
      </div>
      <p className="assistant-composer-note">Las respuestas pueden contener errores. Comprueba siempre las citas y los cálculos.</p>
    </form>
  );
}
