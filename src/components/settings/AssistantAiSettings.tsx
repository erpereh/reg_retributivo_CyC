"use client";

import { useEffect, useRef, useState } from "react";
import { BrainCircuit, CheckCircle2, Copy, Ellipsis, KeyRound, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import { Card } from "@/components/common/Card";
import type { ModelProfile } from "@/lib/assistant/domain";
import { PROVIDER_PRESETS, type ProviderId, type ProviderModel } from "@/lib/assistant/providers/types";
import type { EphemeralKeyScope } from "@/lib/assistant/providers/ephemeralKeyVault";

const providers = Object.keys(PROVIDER_PRESETS) as ProviderId[];
const LOCAL_STORAGE_WARNING = "Las conversaciones y el contexto sanitizado se almacenan localmente en este navegador.";

function id(): string {
  return `model-profile-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

function emptyProfile(provider: ProviderId, existingId?: string): ModelProfile {
  return {
    id: existingId ?? id(), name: PROVIDER_PRESETS[provider].label, provider, baseUrl: PROVIDER_PRESETS[provider].baseUrl ?? "", modelId: "", enabled: true,
    generalChatCompatible: false, analysisCompatible: false, supportsStreaming: false, supportsTools: false, supportsStructuredOutput: false,
    capabilitiesSource: "detected",
  };
}

function keyScope(profile: ModelProfile): EphemeralKeyScope {
  return { profileId: profile.id, endpoint: (PROVIDER_PRESETS[profile.provider].baseUrl ?? profile.baseUrl).replace(/\/+$/, "") };
}

function modelLabel(model: ProviderModel): string {
  return model.contextWindow ? `${model.displayName} · ${model.contextWindow.toLocaleString("es-ES")} tokens` : `${model.displayName} · Ventana no informada`;
}

function manualUrlIsAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return (url.protocol === "https:" || (local && url.protocol === "http:")) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function AssistantAiSettings() {
  const {
    ready, error: initializationError, modelProfiles, assistantSettings, saveModelProfile, duplicateModelProfile, deleteModelProfile, updateAssistantSettings,
    setKey, clearKey, withKey, clearAssistantContent,
  } = useAssistant();
  const [draft, setDraft] = useState<ModelProfile>();
  const [providerToAdd, setProviderToAdd] = useState<ProviderId>("manual");
  const [detectedModels, setDetectedModels] = useState<ProviderModel[]>([]);
  const [modelQuery, setModelQuery] = useState("");
  const [manualModelAllowed, setManualModelAllowed] = useState(false);
  const [message, setMessage] = useState<string>();
  const [busyProfileId, setBusyProfileId] = useState<string>();
  const [openMenuId, setOpenMenuId] = useState<string>();
  const keyInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const operation = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => {
    mounted.current = false;
    operation.current?.abort();
    clearKey();
  }, [clearKey]);

  function openDraft(profile: ModelProfile) {
    clearKey();
    setDetectedModels([]);
    setModelQuery("");
    setManualModelAllowed(profile.provider === "manual" && Boolean(profile.modelId));
    setDraft({ ...profile });
  }

  function changeDraftProvider(provider: ProviderId) {
    if (!draft) return;
    clearKey();
    setDetectedModels([]);
    setModelQuery("");
    setManualModelAllowed(false);
    setDraft(emptyProfile(provider, draft.id));
  }

  async function detect(profile: ModelProfile, persist = false) {
    const controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    setBusyProfileId(profile.id);
    setMessage("Conectando y detectando modelos…");
    try {
      const models = await withKey(keyScope(profile), async (apiKey) => {
        const response = await fetch("/api/assistant/models", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ operation: "list", provider: profile.provider, ...(profile.provider === "manual" ? { baseUrl: profile.baseUrl, ...(apiKey ? { apiKey } : {}) } : {}) }),
        });
        const payload = await response.json().catch(() => undefined) as { models?: ProviderModel[] } | undefined;
        if (!response.ok || !Array.isArray(payload?.models)) throw new Error("models_unavailable");
        return payload.models.filter((model) => model.id && model.displayName);
      });
      if (controller.signal.aborted) return;
      const selected = models.find((model) => model.id === profile.modelId) ?? models[0];
      const updated: ModelProfile = {
        ...profile,
        modelId: selected?.id ?? profile.modelId,
        detectedContextWindow: selected?.contextWindow,
        maxOutputTokens: selected?.maxOutputTokens ?? profile.maxOutputTokens,
        generalChatCompatible: Boolean(selected), analysisCompatible: Boolean(selected), supportsStreaming: Boolean(selected),
        capabilitiesSource: "detected", verifiedAt: new Date().toISOString(), lastVerificationError: undefined,
      };
      if (persist) await saveModelProfile(updated);
      else if (mounted.current) setDraft(updated);
      if (mounted.current) {
        setDetectedModels(models);
        setManualModelAllowed(false);
        setMessage(`Conexión correcta · ${models.length} modelos detectados`);
      }
    } catch {
      if (controller.signal.aborted) return;
      if (profile.provider === "manual") {
        setManualModelAllowed(true);
        setMessage("No se pudo listar los modelos. Puedes introducir un modelId manual.");
      } else setMessage("No se pudo conectar con el proveedor.");
    } finally {
      if (mounted.current && operation.current === controller) {
        operation.current = undefined;
        setBusyProfileId(undefined);
      }
    }
  }

  async function submitProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!draft?.name.trim() || !draft.modelId.trim()) return setMessage("Detecta y selecciona un modelo antes de guardar.");
    if (draft.provider === "manual" && !manualUrlIsAllowed(draft.baseUrl)) return setMessage("La Base URL Manual debe ser segura y válida.");
    try {
      await saveModelProfile({ ...draft, name: draft.name.trim(), modelId: draft.modelId.trim(), baseUrl: (PROVIDER_PRESETS[draft.provider].baseUrl ?? draft.baseUrl).replace(/\/+$/, "") });
      if (keyInput.current) keyInput.current.value = "";
      clearKey();
      setDraft(undefined);
      setDetectedModels([]);
      setMessage("Perfil guardado.");
    } catch { setMessage("No se pudo guardar el perfil."); }
  }

  async function removeProfile(profile: ModelProfile) {
    if (!window.confirm(`¿Eliminar el perfil “${profile.name}”?`)) return;
    clearKey();
    try {
      await deleteModelProfile(profile.id);
      setMessage("Perfil eliminado.");
    } catch { setMessage("No se pudo eliminar el perfil."); }
  }

  if (!ready) return <p role="status" className="text-sm text-muted">{initializationError ?? "Cargando ajustes del Asistente…"}</p>;

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-primary"><BrainCircuit aria-hidden="true" /></span><div><h2 className="text-lg font-semibold text-ink">Proveedores y modelos</h2><p className="mt-1 text-sm text-muted">Detecta los modelos disponibles antes de guardar cada perfil.</p></div></div>
          <div className="flex items-center gap-2"><select className="filter-control w-36" aria-label="Proveedor para añadir" value={providerToAdd} onChange={(event) => setProviderToAdd(event.target.value as ProviderId)}>{providers.map((provider) => <option key={provider} value={provider}>{PROVIDER_PRESETS[provider].label}</option>)}</select><button type="button" className="btn-secondary" onClick={() => openDraft(emptyProfile(providerToAdd))}><Plus aria-hidden="true" />Añadir perfil</button></div>
        </div>

        {draft ? <form className="mt-5 grid gap-4 rounded-2xl border border-line bg-slate-50/70 p-4 md:grid-cols-2" onSubmit={(event) => void submitProfile(event)}>
          <label className="text-sm font-semibold text-ink">Nombre del perfil<input className="filter-control mt-2" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="text-sm font-semibold text-ink">Proveedor<select className="filter-control mt-2" value={draft.provider} onChange={(event) => changeDraftProvider(event.target.value as ProviderId)}>{providers.map((provider) => <option key={provider} value={provider}>{PROVIDER_PRESETS[provider].label}</option>)}</select></label>
          <label className="text-sm font-semibold text-ink">Base URL<input aria-label="Base URL" className="filter-control mt-2" value={draft.baseUrl} readOnly={draft.provider !== "manual"} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
          <p className="self-end text-sm text-muted">Variable server-side: <code>{PROVIDER_PRESETS[draft.provider].envName ?? "Clave efímera"}</code></p>
          {draft.provider === "manual" ? <label className="text-sm font-semibold text-ink">Clave efímera<input ref={keyInput} aria-label="Clave efímera" className="filter-control mt-2" type="password" autoComplete="off" onChange={(event) => setKey(keyScope(draft), event.target.value)} /><span className="mt-1 block font-normal text-muted">Solo vive en memoria.</span></label> : null}
          <div className="flex items-end"><button type="button" className="btn-secondary" disabled={busyProfileId === draft.id} onClick={() => void detect(draft)}><CheckCircle2 aria-hidden="true" />Conectar y detectar modelos</button></div>
          {detectedModels.length ? <label className="text-sm font-semibold text-ink md:col-span-2">Modelo{detectedModels.length > 8 ? <input aria-label="Buscar modelo detectado" className="filter-control mt-2" value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="Buscar modelo" /> : null}<select aria-label="Modelo detectado" className="filter-control mt-2" value={draft.modelId} onChange={(event) => { const selected = detectedModels.find((model) => model.id === event.target.value); setDraft({ ...draft, modelId: event.target.value, detectedContextWindow: selected?.contextWindow, maxOutputTokens: selected?.maxOutputTokens }); }}>{detectedModels.filter((model) => `${model.displayName} ${model.id}`.toLocaleLowerCase("es").includes(modelQuery.trim().toLocaleLowerCase("es"))).map((model) => <option key={model.id} value={model.id}>{modelLabel(model)}</option>)}</select></label> : null}
          {draft.provider === "manual" && manualModelAllowed ? <label className="text-sm font-semibold text-ink">ModelId manual<input className="filter-control mt-2" value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} /></label> : null}
          <details className="md:col-span-2"><summary className="cursor-pointer text-sm font-semibold text-ink">Opciones avanzadas</summary><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-sm text-muted">Ventana manual<input className="filter-control mt-1" type="number" min="1" value={draft.manualContextWindow ?? ""} onChange={(event) => setDraft({ ...draft, manualContextWindow: event.target.value ? Number(event.target.value) : undefined })} /></label><label className="text-sm text-muted">Salida máxima<input className="filter-control mt-1" type="number" min="1" value={draft.maxOutputTokens ?? ""} onChange={(event) => setDraft({ ...draft, maxOutputTokens: event.target.value ? Number(event.target.value) : undefined })} /></label><label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={draft.capabilitiesSource === "manual"} onChange={(event) => setDraft({ ...draft, capabilitiesSource: event.target.checked ? "manual" : "detected", generalChatCompatible: event.target.checked || draft.generalChatCompatible, analysisCompatible: event.target.checked || draft.analysisCompatible, supportsStreaming: event.target.checked || draft.supportsStreaming })} />Compatibilidad manual</label></div></details>
          <div className="flex flex-wrap gap-2 md:col-span-2"><button className="btn-primary" type="submit" disabled={busyProfileId === draft.id}>Guardar</button><button className="btn-secondary" type="button" onClick={() => { clearKey(); setDraft(undefined); setDetectedModels([]); }}>Cancelar</button></div>
        </form> : null}

        <div className="mt-5 grid gap-3">{modelProfiles.length ? modelProfiles.map((profile) => <article key={profile.id} className="rounded-2xl border border-line p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-ink">{profile.name}</h3><p className="mt-1 font-mono text-xs text-muted">{PROVIDER_PRESETS[profile.provider].label} · {profile.modelId || "Modelo no seleccionado"} · {profile.detectedContextWindow ?? profile.manualContextWindow ?? "Ventana no informada"}</p><p className="mt-2 text-xs text-muted">Última conexión: {profile.verifiedAt ? new Date(profile.verifiedAt).toLocaleString("es-ES") : "Nunca"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${profile.enabled ? "bg-emerald-50 text-success" : "bg-slate-100 text-muted"}`}>{profile.enabled ? "Activo" : "Desactivado"}</span></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => openDraft(profile)}><Pencil aria-hidden="true" />Editar</button><button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => void detect(profile, true)}>Actualizar modelos</button><div className="relative"><button type="button" aria-label={`Más acciones para ${profile.name}`} className="btn-secondary" onClick={() => setOpenMenuId(openMenuId === profile.id ? undefined : profile.id)}><Ellipsis aria-hidden="true" /></button>{openMenuId === profile.id ? <div className="absolute right-0 z-10 mt-2 grid min-w-48 gap-1 rounded-xl border border-line bg-white p-2 shadow-lg"><button type="button" className="btn-secondary justify-start" onClick={() => void duplicateModelProfile(profile.id)}><Copy aria-hidden="true" />Duplicar</button><button type="button" className="btn-secondary justify-start" onClick={() => void saveModelProfile({ ...profile, enabled: !profile.enabled })}>{profile.enabled ? "Desactivar" : "Activar"}</button><button type="button" className="btn-secondary justify-start text-danger" aria-label={`Eliminar perfil ${profile.name}`} onClick={() => void removeProfile(profile)}><Trash2 aria-hidden="true" />Eliminar perfil</button></div> : null}</div></div></article>) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-muted">No hay perfiles configurados.</p>}</div>
      </Card>

      <Card className="p-4 sm:p-6"><h2 className="text-lg font-semibold text-ink">Comportamiento predeterminado</h2><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3"><label className="text-sm font-semibold text-ink">Modelo general predeterminado<select className="filter-control mt-2" value={assistantSettings.defaultGeneralModelProfileId ?? ""} onChange={(event) => void updateAssistantSettings({ defaultGeneralModelProfileId: event.target.value || undefined })}><option value="">Sin seleccionar</option>{modelProfiles.filter((item) => item.enabled && item.generalChatCompatible).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm font-semibold text-ink">Modelo de análisis predeterminado<select className="filter-control mt-2" value={assistantSettings.defaultAnalysisModelProfileId ?? ""} onChange={(event) => void updateAssistantSettings({ defaultAnalysisModelProfileId: event.target.value || undefined })}><option value="">Sin seleccionar</option>{modelProfiles.filter((item) => item.enabled && item.analysisCompatible).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"><ShieldAlert className="mt-0.5 shrink-0" aria-hidden="true" />Las opciones avanzadas solo se usan cuando el proveedor no informa los límites.</p></Card>
      <Card className="p-4 sm:p-6"><div className="flex items-center gap-3"><KeyRound className="text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold text-ink">Privacidad y almacenamiento local</h2></div><p className="mt-4 text-sm leading-6 text-muted">{LOCAL_STORAGE_WARNING}</p><button type="button" className="btn-secondary mt-4" onClick={() => void clearAssistantContent()}><Trash2 aria-hidden="true" />Borrar conversaciones y contexto</button></Card>
      {message ? <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary" aria-live="polite">{message}</p> : null}
    </div>
  );
}
