"use client";

import { useEffect, useRef, useState } from "react";
import { BrainCircuit, CheckCircle2, Copy, Ellipsis, KeyRound, LoaderCircle, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import { Card } from "@/components/common/Card";
import type { ModelProfile } from "@/lib/assistant/domain";
import { PROVIDER_PRESETS, type ProviderId, type ProviderModel } from "@/lib/assistant/providers/types";
import type { EphemeralKeyScope } from "@/lib/assistant/providers/ephemeralKeyVault";

const providers = Object.keys(PROVIDER_PRESETS) as ProviderId[];
const LOCAL_STORAGE_WARNING = "Las conversaciones y el contexto sanitizado se almacenan localmente en este navegador.";
const DETECTION_TIMEOUT_MS = 30_000;

type ModelsResponse = { models?: unknown; error?: unknown };
type DetectionOperation = { controller: AbortController; timeout: ReturnType<typeof setTimeout>; timedOut: boolean };

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

function isProviderModel(value: unknown): value is ProviderModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Record<string, unknown>;
  return typeof model.id === "string" && Boolean(model.id) && typeof model.displayName === "string" && Boolean(model.displayName)
    && (model.contextWindow === undefined || (typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow) && model.contextWindow > 0))
    && (model.maxOutputTokens === undefined || (typeof model.maxOutputTokens === "number" && Number.isFinite(model.maxOutputTokens) && model.maxOutputTokens > 0));
}

function publicError(payload: ModelsResponse | undefined): string {
  const error = payload?.error;
  if (typeof error !== "string" || !error.trim() || error.length > 240) return "No se pudo obtener el listado de modelos.";
  const message = error.trim();
  if (/^(?:GEMINI_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|CEREBRAS_API_KEY|GROQ_API_KEY) no está configurada\.$/.test(message)) return message;
  if (/(?:authorization|bearer|stack|api[_-]?key\s*[:=]|sk-)/i.test(message)) return "No se pudo obtener el listado de modelos.";
  return message;
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
  const [message, setMessage] = useState<string>();
  const [busyProfileId, setBusyProfileId] = useState<string>();
  const [openMenuId, setOpenMenuId] = useState<string>();
  const keyInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const operation = useRef<DetectionOperation | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(operation.current?.timeout);
      operation.current?.controller.abort();
      clearKey();
    };
  }, [clearKey]);

  function openDraft(profile: ModelProfile) {
    clearKey();
    setDetectedModels(profile.detectedModels ?? []);
    setModelQuery("");
    setMessage(undefined);
    setDraft({ ...profile });
  }

  function changeDraftProvider(provider: ProviderId) {
    if (!draft) return;
    clearKey();
    setDetectedModels([]);
    setModelQuery("");
    setMessage(undefined);
    setDraft(emptyProfile(provider, draft.id));
  }

  async function detectAndSave(profile: ModelProfile, closeDraft: boolean) {
    operation.current?.controller.abort();
    clearTimeout(operation.current?.timeout);
    const controller = new AbortController();
    const current: DetectionOperation = {
      controller,
      timedOut: false,
      timeout: setTimeout(() => { current.timedOut = true; controller.abort(); }, DETECTION_TIMEOUT_MS),
    };
    operation.current = current;
    setBusyProfileId(profile.id);
    setMessage(`Conectando con ${PROVIDER_PRESETS[profile.provider].label}…`);
    try {
      const models = await withKey(keyScope(profile), async (apiKey) => {
        if (profile.provider === "manual" && !apiKey) throw new Error("Introduce una clave API para el proveedor Manual.");
        if (mounted.current && operation.current === current) setMessage("Detectando modelos disponibles…");
        const response = await fetch("/api/assistant/models", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ operation: "list", provider: profile.provider, ...(profile.provider === "manual" ? { baseUrl: profile.baseUrl, ...(apiKey ? { apiKey } : {}) } : {}) }),
        });
        const payload = await response.json().catch(() => undefined) as ModelsResponse | undefined;
        if (!response.ok) throw new Error(publicError(payload));
        const listed = Array.isArray(payload?.models) ? payload.models.filter(isProviderModel) : [];
        if (!listed.length) throw new Error("No se han detectado modelos compatibles.");
        return listed;
      });
      if (controller.signal.aborted || operation.current !== current) return;
      const selected = models.find((model) => model.id === profile.modelId) ?? models[0];
      const updated: ModelProfile = {
        ...profile,
        modelId: selected.id,
        detectedModels: models.map(({ id: modelId, displayName, contextWindow, maxOutputTokens }) => ({
          id: modelId,
          displayName,
          ...(contextWindow !== undefined ? { contextWindow } : {}),
          ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
        })),
        detectedContextWindow: selected.contextWindow,
        maxOutputTokens: selected.maxOutputTokens ?? profile.maxOutputTokens,
        generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true,
        capabilitiesSource: "detected", verifiedAt: new Date().toISOString(), lastVerificationError: undefined,
      };
      await saveModelProfile(updated);
      clearKey();
      if (!mounted.current || operation.current !== current) return;
      setDetectedModels(models);
      setMessage(`Conexión correcta · ${models.length} modelos detectados`);
      if (closeDraft) {
        if (keyInput.current) keyInput.current.value = "";
        setDraft(undefined);
      } else if (draft?.id === updated.id) setDraft(updated);
    } catch (error) {
      if (operation.current !== current || !mounted.current) return;
      if (controller.signal.aborted) setMessage(current.timedOut ? "La conexión tardó demasiado. Inténtalo de nuevo." : "La conexión fue cancelada.");
      else setMessage(`No se pudo conectar: ${error instanceof Error ? publicError({ error: error.message }) : "No se pudo obtener el listado de modelos."}`);
    } finally {
      clearTimeout(current.timeout);
      if (mounted.current && operation.current === current) {
        operation.current = undefined;
        setBusyProfileId(undefined);
      }
    }
  }

  function submitProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!draft?.name.trim()) { setMessage("Indica un nombre para el perfil."); return; }
    if (draft.provider === "manual" && !manualUrlIsAllowed(draft.baseUrl)) { setMessage("La Base URL Manual debe ser segura y válida."); return; }
    void detectAndSave({ ...draft, name: draft.name.trim(), baseUrl: (PROVIDER_PRESETS[draft.provider].baseUrl ?? draft.baseUrl).replace(/\/+$/, "") }, true);
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

  const busy = Boolean(draft && busyProfileId === draft.id);
  const visibleModels = detectedModels.filter((model) => `${model.displayName} ${model.id}`.toLocaleLowerCase("es").includes(modelQuery.trim().toLocaleLowerCase("es")));

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-primary"><BrainCircuit aria-hidden="true" /></span><div><h2 className="text-lg font-semibold text-ink">Proveedores y modelos</h2><p className="mt-1 text-sm text-muted">Guardar detecta los modelos y configura el perfil en una sola operación.</p></div></div>
          <div className="flex items-center gap-2"><select className="filter-control w-36" aria-label="Proveedor para añadir" value={providerToAdd} onChange={(event) => setProviderToAdd(event.target.value as ProviderId)}>{providers.map((provider) => <option key={provider} value={provider}>{PROVIDER_PRESETS[provider].label}</option>)}</select><button type="button" className="btn-secondary" onClick={() => openDraft(emptyProfile(providerToAdd))}><Plus aria-hidden="true" />Añadir perfil</button></div>
        </div>

        {draft ? <form className="mt-5 grid gap-4 rounded-2xl border border-line bg-slate-50/70 p-4 md:grid-cols-2" onSubmit={submitProfile}>
          <label className="text-sm font-semibold text-ink">Nombre del perfil<input className="filter-control mt-2" value={draft.name} disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="text-sm font-semibold text-ink">Proveedor<select className="filter-control mt-2" value={draft.provider} disabled={busy} onChange={(event) => changeDraftProvider(event.target.value as ProviderId)}>{providers.map((provider) => <option key={provider} value={provider}>{PROVIDER_PRESETS[provider].label}</option>)}</select></label>
          <label className="text-sm font-semibold text-ink">Base URL<input aria-label="Base URL" className="filter-control mt-2" value={draft.baseUrl} disabled={busy} readOnly={draft.provider !== "manual"} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
          <p className="self-end text-sm text-muted">Variable server-side: <code>{PROVIDER_PRESETS[draft.provider].envName ?? "Clave efímera"}</code></p>
          {draft.provider === "manual" ? <label className="text-sm font-semibold text-ink">Clave efímera<input ref={keyInput} aria-label="Clave efímera" className="filter-control mt-2" type="password" autoComplete="off" disabled={busy} onChange={(event) => setKey(keyScope(draft), event.target.value)} /><span className="mt-1 block font-normal text-muted">Solo vive en memoria.</span></label> : null}
          {detectedModels.length ? <label className="text-sm font-semibold text-ink md:col-span-2">Modelo detectado{detectedModels.length > 8 ? <input aria-label="Buscar modelo detectado" className="filter-control mt-2" value={modelQuery} disabled={busy} onChange={(event) => setModelQuery(event.target.value)} placeholder="Buscar modelo" /> : null}<select aria-label="Modelo detectado" className="filter-control mt-2" value={draft.modelId} disabled={busy} onChange={(event) => { const selected = detectedModels.find((model) => model.id === event.target.value); setDraft({ ...draft, modelId: event.target.value, detectedContextWindow: selected?.contextWindow, maxOutputTokens: selected?.maxOutputTokens }); }}>{visibleModels.map((model) => <option key={model.id} value={model.id}>{modelLabel(model)}</option>)}</select></label> : null}
          <details className="md:col-span-2"><summary className="cursor-pointer text-sm font-semibold text-ink">Opciones avanzadas</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm text-muted">Ventana manual<input className="filter-control mt-1" type="number" min="1" disabled={busy} value={draft.manualContextWindow ?? ""} onChange={(event) => setDraft({ ...draft, manualContextWindow: event.target.value ? Number(event.target.value) : undefined })} /></label><label className="text-sm text-muted">Salida máxima<input className="filter-control mt-1" type="number" min="1" disabled={busy} value={draft.maxOutputTokens ?? ""} onChange={(event) => setDraft({ ...draft, maxOutputTokens: event.target.value ? Number(event.target.value) : undefined })} /></label></div></details>
          <div className="flex flex-wrap gap-2 md:col-span-2"><button className="btn-primary" type="submit" disabled={busy}>{busy ? <><LoaderCircle aria-hidden="true" className="animate-spin" />Conectando y guardando…</> : "Guardar perfil"}</button><button className="btn-secondary" type="button" disabled={busy} onClick={() => { clearKey(); setDraft(undefined); setDetectedModels([]); setMessage(undefined); }}>Cancelar</button></div>
        </form> : null}

        <div className="mt-5 grid gap-3">{modelProfiles.length ? modelProfiles.map((profile) => <article key={profile.id} className="rounded-2xl border border-line p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-ink">{profile.name}</h3><p className="mt-1 font-mono text-xs text-muted">{PROVIDER_PRESETS[profile.provider].label} · {profile.modelId} · {profile.detectedContextWindow ?? profile.manualContextWindow ?? "Ventana no informada"}</p><p className="mt-2 text-xs text-muted">Última conexión: {profile.verifiedAt ? new Date(profile.verifiedAt).toLocaleString("es-ES") : "Nunca"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${profile.enabled ? "bg-emerald-50 text-success" : "bg-slate-100 text-muted"}`}>{profile.enabled ? "Activo" : "Desactivado"}</span></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => openDraft(profile)}><Pencil aria-hidden="true" />Editar</button><button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => void detectAndSave(profile, false)}>{busyProfileId === profile.id ? <><LoaderCircle aria-hidden="true" className="animate-spin" />Actualizando modelos…</> : <><CheckCircle2 aria-hidden="true" />Actualizar modelos</>}</button><div className="relative"><button type="button" aria-label={`Más acciones para ${profile.name}`} className="btn-secondary" onClick={() => setOpenMenuId(openMenuId === profile.id ? undefined : profile.id)}><Ellipsis aria-hidden="true" /></button>{openMenuId === profile.id ? <div className="absolute right-0 z-10 mt-2 grid min-w-48 gap-1 rounded-xl border border-line bg-white p-2 shadow-lg"><button type="button" className="btn-secondary justify-start" onClick={() => void duplicateModelProfile(profile.id)}><Copy aria-hidden="true" />Duplicar</button><button type="button" className="btn-secondary justify-start" onClick={() => void saveModelProfile({ ...profile, enabled: !profile.enabled })}>{profile.enabled ? "Desactivar" : "Activar"}</button><button type="button" className="btn-secondary justify-start text-danger" aria-label={`Eliminar perfil ${profile.name}`} onClick={() => void removeProfile(profile)}><Trash2 aria-hidden="true" />Eliminar perfil</button></div> : null}</div></div></article>) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-muted">No hay perfiles configurados.</p>}</div>
      </Card>

      <Card className="p-4 sm:p-6"><h2 className="text-lg font-semibold text-ink">Comportamiento predeterminado</h2><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3"><label className="text-sm font-semibold text-ink">Modelo general predeterminado<select className="filter-control mt-2" value={assistantSettings.defaultGeneralModelProfileId ?? ""} onChange={(event) => void updateAssistantSettings({ defaultGeneralModelProfileId: event.target.value || undefined })}><option value="">Sin seleccionar</option>{modelProfiles.filter((item) => item.enabled && item.generalChatCompatible).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm font-semibold text-ink">Modelo de análisis predeterminado<select className="filter-control mt-2" value={assistantSettings.defaultAnalysisModelProfileId ?? ""} onChange={(event) => void updateAssistantSettings({ defaultAnalysisModelProfileId: event.target.value || undefined })}><option value="">Sin seleccionar</option>{modelProfiles.filter((item) => item.enabled && item.analysisCompatible).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"><ShieldAlert className="mt-0.5 shrink-0" aria-hidden="true" />Las opciones avanzadas solo se usan cuando el proveedor no informa los límites.</p></Card>
      <Card className="p-4 sm:p-6"><div className="flex items-center gap-3"><KeyRound className="text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold text-ink">Privacidad y almacenamiento local</h2></div><p className="mt-4 text-sm leading-6 text-muted">{LOCAL_STORAGE_WARNING}</p><button type="button" className="btn-secondary mt-4" onClick={() => void clearAssistantContent()}><Trash2 aria-hidden="true" />Borrar conversaciones y contexto</button></Card>
      {message ? <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary" role="status" aria-live="polite">{message}</p> : null}
    </div>
  );
}
