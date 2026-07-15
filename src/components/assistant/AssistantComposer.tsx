"use client";

import { Bot, BrainCircuit, ChevronDown, CircleGauge, Cpu, Gem, Plug, Scale, Send, Sparkles, Square, Zap } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { ContextStrategy, Conversation, ModelProfile, ResponseMode } from "@/lib/assistant/domain";
import type { ProviderId } from "@/lib/assistant/providers/types";
import { resolveSelectedModelMetadata } from "@/lib/assistant/modelMetadata";

const responseModeLabels: Record<ResponseMode, string> = { strict: "Estricto", flexible: "Flexible" };
const contextStrategyLabels: Record<ContextStrategy, string> = { automatic: "Automática", full: "Completa", optimized: "Optimizada" };

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function providerIcon(provider: ProviderId) {
  const props = { "aria-hidden": true, className: "size-3.5 shrink-0" };
  switch (provider) {
    case "gemini": return <Gem {...props} />;
    case "openai": return <Sparkles {...props} />;
    case "openrouter": return <Plug {...props} />;
    case "cerebras": return <BrainCircuit {...props} />;
    case "groq": return <Zap {...props} />;
    default: return <Bot {...props} />;
  }
}

function profileModelName(profile: ModelProfile) {
  return resolveSelectedModelMetadata(profile, profile.modelId).selectedModel?.displayName ?? profile.modelId ?? profile.name;
}

const controlClassName = "inline-flex min-h-9 min-w-9 max-w-[12rem] items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-ink hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-45";
const menuClassName = "absolute bottom-[calc(100%+0.375rem)] left-0 z-20 max-h-56 min-w-52 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-lg";
const menuItemClassName = "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-ink hover:bg-slate-50";

export function AssistantComposer({ streaming, disabled = false, conversation, profiles, contextTokens, onSend, onStop, onPreferences, onConfigureModels, onShowContextUsage }: Readonly<{
  streaming: boolean; disabled?: boolean; conversation: Conversation; profiles: readonly ModelProfile[]; contextTokens?: number;
  onSend(value: string): Promise<void>; onStop(): void;
  onPreferences(patch: { modelProfileId?: string; responseMode?: ResponseMode; contextStrategy?: ContextStrategy }): void;
  onConfigureModels?(): void;
  onShowContextUsage?(): void;
}>) {
  const [value, setValue] = useState("");
  const [openMenu, setOpenMenu] = useState<"model" | "mode" | "strategy">();
  const selectedProfile = profiles.find((profile) => profile.id === conversation.modelProfileId);
  const selectedMetadata = selectedProfile ? resolveSelectedModelMetadata(selectedProfile, selectedProfile.modelId) : undefined;
  const selectedModelName = selectedProfile ? profileModelName(selectedProfile) : profiles.length ? "Selecciona un modelo" : "No hay modelos configurados";
  const contextCapacity = selectedMetadata?.contextWindow;
  const contextUsage = `${formatTokens(contextTokens ?? 0)} / ${contextCapacity ? formatTokens(contextCapacity) : "—"}`;
  const controlsDisabled = conversation.status !== "active";

  async function submit(event?: FormEvent) { event?.preventDefault(); const raw = value; if (!raw.trim() || streaming || disabled) return; setValue(""); await onSend(raw); }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return; event.preventDefault(); void submit(); }
  function toggle(menu: "model" | "mode" | "strategy") { setOpenMenu((current) => current === menu ? undefined : menu); }

  return <form onSubmit={(event) => void submit(event)} className="border-t border-line bg-white/95 p-3 backdrop-blur sm:p-4">
    <label htmlFor="assistant-composer" className="sr-only">Pregunta</label>
    <div className="rounded-2xl bg-slate-50 p-2 ring-1 ring-line focus-within:ring-2 focus-within:ring-primary/40">
      <textarea id="assistant-composer" className="max-h-40 min-h-11 w-full resize-y bg-transparent px-2 py-2.5 text-sm leading-6 outline-none placeholder:text-muted" rows={1} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={onKeyDown} placeholder="Escribe una pregunta…" disabled={streaming || disabled} />
      <div data-testid="assistant-composer-controls" className="flex min-w-0 items-end gap-2 px-1 pb-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex-nowrap">
          <div className="relative min-w-0">
            <button type="button" className={controlClassName} aria-label={`Modelo de conversación: ${selectedModelName}`} title={selectedProfile ? `${selectedModelName} · ${selectedProfile.provider}` : selectedModelName} aria-expanded={openMenu === "model"} disabled={controlsDisabled || !profiles.length} onClick={() => toggle("model")}>
              {selectedProfile ? providerIcon(selectedProfile.provider) : <Cpu aria-hidden="true" className="size-3.5 shrink-0" />}<span className="truncate">{selectedModelName}</span><ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
            </button>
            {openMenu === "model" ? <div role="menu" className={menuClassName}>{profiles.map((profile) => {
              const name = profileModelName(profile);
              const context = resolveSelectedModelMetadata(profile, profile.modelId).contextWindow;
              return <button key={profile.id} type="button" role="menuitem" className={menuItemClassName} title={`${name} · ${profile.provider}${context ? ` · ${context.toLocaleString("es-ES")} tokens` : " · Ventana no informada"}`} onClick={() => { onPreferences({ modelProfileId: profile.id }); setOpenMenu(undefined); }}>
                {providerIcon(profile.provider)}<span className="min-w-0 flex-1 truncate">{name}</span><span className="shrink-0 text-[0.6875rem] text-muted">{context ? `${formatTokens(context)}` : "—"}</span>
              </button>;
            })}</div> : null}
          </div>
          <div className="relative">
            <button type="button" className={controlClassName} aria-label={`Modo de respuesta: ${responseModeLabels[conversation.responseMode]}`} title="Modo de respuesta" aria-expanded={openMenu === "mode"} disabled={controlsDisabled} onClick={() => toggle("mode")}><Scale aria-hidden="true" className="size-3.5 shrink-0" /><span>{responseModeLabels[conversation.responseMode]}</span><ChevronDown aria-hidden="true" className="size-3.5 shrink-0" /></button>
            {openMenu === "mode" ? <div role="menu" className={menuClassName}>{(Object.entries(responseModeLabels) as [ResponseMode, string][]).map(([mode, label]) => <button key={mode} type="button" role="menuitem" className={menuItemClassName} onClick={() => { onPreferences({ responseMode: mode }); setOpenMenu(undefined); }}>{label}</button>)}</div> : null}
          </div>
          <div className="relative">
            <button type="button" className={controlClassName} aria-label={`Estrategia de contexto: ${contextStrategyLabels[conversation.contextStrategy]}`} title="Estrategia de contexto" aria-expanded={openMenu === "strategy"} disabled={controlsDisabled} onClick={() => toggle("strategy")}><CircleGauge aria-hidden="true" className="size-3.5 shrink-0" /><span>{contextStrategyLabels[conversation.contextStrategy]}</span><ChevronDown aria-hidden="true" className="size-3.5 shrink-0" /></button>
            {openMenu === "strategy" ? <div role="menu" className={menuClassName}>{(Object.entries(contextStrategyLabels) as [ContextStrategy, string][]).map(([strategy, label]) => <button key={strategy} type="button" role="menuitem" className={menuItemClassName} onClick={() => { onPreferences({ contextStrategy: strategy }); setOpenMenu(undefined); }}>{label}</button>)}</div> : null}
          </div>
          <button type="button" className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2 text-xs font-bold text-muted hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label="Abrir detalle del contexto" title="Ver uso de contexto" onClick={onShowContextUsage}>{contextUsage}</button>
          {!profiles.length && onConfigureModels ? <button type="button" className="btn-secondary min-h-9 shrink-0 px-2 text-xs" onClick={onConfigureModels}>Configurar modelos</button> : null}
        </div>
        {streaming ? <button type="button" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-ink text-white" aria-label="Detener respuesta" onClick={onStop}><Square aria-hidden="true" className="size-4 fill-current" /></button> : <button type="submit" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-blue hover:bg-primary-dark disabled:opacity-40" aria-label="Enviar" disabled={disabled || !value.trim()}><Send aria-hidden="true" className="size-4" /></button>}
      </div>
    </div>
  </form>;
}
