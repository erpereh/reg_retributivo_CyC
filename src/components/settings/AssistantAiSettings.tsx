"use client";

import { useMemo, useState } from "react";
import { BrainCircuit, CheckCircle2, LoaderCircle, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import { Card } from "@/components/common/Card";
import { normalizeBaseUrl, type ProviderConfig, type ProviderType } from "@/lib/assistant/catalog/domain";

const PRESETS: Readonly<Record<Exclude<ProviderType, "openai-compatible">, Readonly<{ label: string; baseUrl: string; envVarName: string }>>> = {
  gemini: { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com", envVarName: "GEMINI_API_KEY" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", envVarName: "OPENAI_API_KEY" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", envVarName: "OPENROUTER_API_KEY" },
  cerebras: { label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", envVarName: "CEREBRAS_API_KEY" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", envVarName: "GROQ_API_KEY" },
};

const STATUS: Readonly<Record<ProviderConfig["connectionStatus"], string>> = {
  active: "Activo", inactive: "Inactivo", missing_key: "Falta API key", error: "Error", connected: "Conectado",
};

function newProvider(type: ProviderType): ProviderConfig {
  const now = new Date().toISOString();
  const preset = type === "openai-compatible" ? undefined : PRESETS[type];
  return {
    id: `provider-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    providerType: type,
    displayName: preset?.label ?? "Proveedor compatible",
    baseUrl: preset?.baseUrl ?? "https://api.example.com/v1",
    envVarName: preset?.envVarName ?? "OPENAI_COMPATIBLE_MY_PROVIDER_API_KEY",
    enabled: true,
    connectionStatus: "missing_key",
    createdAt: now,
    updatedAt: now,
  };
}

function formatDate(value?: string) { return value ? new Date(value).toLocaleString("es-ES") : "Nunca"; }

export function AssistantAiSettings() {
  const { ready, providerConfigs, modelCatalog, saveProviderConfig, deleteProviderConfig, checkProvider, refreshProviderCatalog, clearAssistantContent, error } = useAssistant();
  const [draft, setDraft] = useState<ProviderConfig>();
  const [type, setType] = useState<ProviderType>("gemini");
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const counts = useMemo(() => new Map(providerConfigs.map((provider) => [provider.id, modelCatalog.filter((model) => model.providerId === provider.id).length])), [modelCatalog, providerConfigs]);

  async function run(id: string, action: () => Promise<void>, success: string) {
    setBusy(id); setMessage(undefined);
    try { await action(); setMessage(success); } catch { setMessage("No se pudo completar la operación. Se conserva el último catálogo válido."); }
    finally { setBusy(undefined); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    let safe: ProviderConfig;
    try { safe = { ...draft, baseUrl: normalizeBaseUrl(draft.baseUrl), updatedAt: new Date().toISOString() }; }
    catch { setMessage("Introduce una URL absoluta válida."); return; }
    await run(safe.id, () => saveProviderConfig(safe), "Proveedor guardado. La clave se comprueba exclusivamente en el servidor.");
    setDraft(undefined);
  }

  return <div className="flex flex-col gap-5">
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-primary"><BrainCircuit aria-hidden="true" /></span><div><h2 className="text-lg font-semibold text-ink">Proveedores de IA</h2><p className="mt-1 text-sm text-muted">Aquí se configuran proveedores. El modelo se elige en cada conversación.</p></div></div>
        <div className="flex gap-2"><select className="filter-control" aria-label="Tipo de proveedor" value={type} onChange={(event) => setType(event.target.value as ProviderType)}>{[...Object.keys(PRESETS), "openai-compatible"].map((item) => <option key={item} value={item}>{item === "openai-compatible" ? "OpenAI-compatible" : PRESETS[item as keyof typeof PRESETS].label}</option>)}</select><button type="button" className="btn-secondary" disabled={!ready} onClick={() => setDraft(newProvider(type))}><Plus aria-hidden="true" />Añadir proveedor</button></div>
      </div>

      {draft ? <form className="mt-5 grid gap-4 rounded-2xl border border-line bg-slate-50/70 p-4 md:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <label className="text-sm font-semibold text-ink">Nombre visible<input className="filter-control mt-2" value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
        <label className="text-sm font-semibold text-ink">Variable de entorno<input className="filter-control mt-2 font-mono" value={draft.envVarName} readOnly={draft.providerType !== "openai-compatible"} onChange={(event) => setDraft({ ...draft, envVarName: event.target.value })} /><span className="mt-1 block font-normal text-muted">Solo se guarda el nombre; nunca el valor.</span></label>
        <label className="text-sm font-semibold text-ink md:col-span-2">URL base<input className="filter-control mt-2 font-mono" value={draft.baseUrl} readOnly={draft.providerType !== "openai-compatible"} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
        <div className="flex gap-2 md:col-span-2"><button className="btn-primary" type="submit" disabled={busy === draft.id}>Guardar proveedor</button><button className="btn-secondary" type="button" onClick={() => setDraft(undefined)}>Cancelar</button></div>
      </form> : null}

      <div className="mt-5 grid gap-3">{providerConfigs.length ? providerConfigs.map((provider) => <article key={provider.id} className="rounded-2xl border border-line p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-ink">{provider.displayName}</h3><p className="mt-1 font-mono text-xs text-muted">{provider.providerType} · {provider.envVarName}</p><p className="mt-1 text-xs text-muted">Última comprobación: {formatDate(provider.lastCheckedAt)} · Catálogo: {formatDate(provider.lastCatalogRefreshAt)} · {counts.get(provider.id) ?? 0} modelos</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-ink">{STATUS[provider.connectionStatus]}</span></div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={busy === provider.id} onClick={() => void run(provider.id, () => checkProvider(provider.id), "Conexión comprobada.")}><CheckCircle2 aria-hidden="true" />Comprobar conexión</button>
          <button type="button" className="btn-secondary" disabled={busy === provider.id || !provider.enabled} onClick={() => void run(provider.id, () => refreshProviderCatalog(provider.id), "Catálogo actualizado sin probes de inferencia.")}>{busy === provider.id ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Actualizar modelos</button>
          <button type="button" className="btn-secondary" disabled={busy === provider.id} onClick={() => void saveProviderConfig({ ...provider, enabled: !provider.enabled, connectionStatus: provider.enabled ? "inactive" : "active", updatedAt: new Date().toISOString() })}>{provider.enabled ? "Desactivar" : "Activar"}</button>
          <button type="button" className="btn-secondary text-danger" disabled={busy === provider.id} onClick={() => void run(provider.id, () => deleteProviderConfig(provider.id), "Configuración eliminada; las conversaciones se conservan.")}><Trash2 aria-hidden="true" />Eliminar</button>
        </div>
      </article>) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-muted">No hay proveedores configurados.</p>}</div>
    </Card>
    <Card className="p-4 sm:p-6"><div className="flex items-center gap-3"><Server className="text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold text-ink">Privacidad local</h2></div><p className="mt-3 text-sm leading-6 text-muted">Las API keys se leen solo desde variables de entorno del servidor. Conversaciones y contexto sanitizado permanecen en IndexedDB.</p><button type="button" className="btn-secondary mt-4" onClick={() => void clearAssistantContent()}><Trash2 aria-hidden="true" />Borrar conversaciones y contexto</button></Card>
    {message ? <p role="status" className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-danger">{error}</p> : null}
  </div>;
}
