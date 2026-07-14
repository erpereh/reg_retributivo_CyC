"use client";

import { useEffect, useRef, useState } from "react";
import { BrainCircuit, CheckCircle2, Copy, KeyRound, Pencil, Plus, RotateCcw, ShieldAlert, Trash2, Wifi } from "lucide-react";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import { Card } from "@/components/common/Card";
import type { ModelProfile } from "@/lib/assistant/domain";
import { PROVIDER_PRESETS, type ProviderId } from "@/lib/assistant/providers/types";
import type { EphemeralKeyScope } from "@/lib/assistant/providers/ephemeralKeyVault";

const MANUAL_WARNING = "Compatibilidad habilitada manualmente y no garantizada.";
const LOCAL_STORAGE_WARNING = "Las conversaciones y el contexto sanitizado se almacenan localmente en este navegador. Cualquier persona con acceso al perfil del navegador podría acceder a estos datos.";
const providers = Object.keys(PROVIDER_PRESETS) as ProviderId[];

function id(): string {
  return `model-profile-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

function emptyProfile(provider: ProviderId): ModelProfile {
  return {
    id: id(), name: PROVIDER_PRESETS[provider].label, provider, baseUrl: PROVIDER_PRESETS[provider].baseUrl ?? "", modelId: "", enabled: true,
    generalChatCompatible: false, analysisCompatible: false, supportsStreaming: false, supportsTools: false, supportsStructuredOutput: false,
    capabilitiesSource: "detected",
  };
}

function formatBytes(value?: number): string {
  if (!value) return "0 MB";
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function keyScope(profile: ModelProfile): EphemeralKeyScope {
  return { profileId: profile.id, endpoint: (PROVIDER_PRESETS[profile.provider].baseUrl ?? profile.baseUrl).replace(/\/+$/, "") };
}

export function AssistantAiSettings() {
  const {
    ready, error: initializationError, modelProfiles, assistantSettings, saveModelProfile, duplicateModelProfile, deleteModelProfile, updateAssistantSettings,
    setKey, clearKey, withKey, clearAssistantContent,
  } = useAssistant();
  const [draft, setDraft] = useState<ModelProfile>();
  const [providerToAdd, setProviderToAdd] = useState<ProviderId>("manual");
  const [message, setMessage] = useState<string>();
  const [storageUsage, setStorageUsage] = useState<string>();
  const [busyProfileId, setBusyProfileId] = useState<string>();
  const keyInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const operation = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      clearKey();
    };
  }, [clearKey]);

  function beginOperation(profileId: string): AbortController {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusyProfileId(profileId);
    return controller;
  }

  function finishOperation(controller: AbortController) {
    if (mounted.current && operation.current === controller) {
      operation.current = undefined;
      setBusyProfileId(undefined);
    }
  }

  async function runLocal(action: () => Promise<unknown>, publicError: string) {
    try { await action(); } catch { if (mounted.current) setMessage(publicError); }
  }

  async function submitProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!draft?.name.trim() || !draft.modelId.trim()) return setMessage("Completa nombre y modelo.");
    if (busyProfileId === draft.id) return setMessage("Espera a que termine la verificación del perfil.");
    if (draft.provider === "manual") {
      try {
        const url = new URL(draft.baseUrl);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
      } catch { return setMessage("La URL Manual debe ser HTTPS y no incluir credenciales."); }
    }
    try {
      const current = modelProfiles.find((profile) => profile.id === draft.id);
      const editable = {
        name: draft.name.trim(),
        modelId: draft.modelId.trim(),
        baseUrl: (PROVIDER_PRESETS[draft.provider].baseUrl ?? draft.baseUrl).replace(/\/+$/, ""),
        manualContextWindow: draft.manualContextWindow,
      };
      await saveModelProfile(current ? { ...current, ...editable } : { ...draft, ...editable });
      if (keyInput.current) keyInput.current.value = "";
      if (mounted.current) { setDraft(undefined); setMessage("Perfil guardado."); }
    } catch { if (mounted.current) setMessage("No se pudo guardar el perfil."); }
  }

  async function callModels(operation: "probe" | "restore_detected", profile: ModelProfile) {
    const controller = beginOperation(profile.id);
    setMessage(operation === "probe" ? "Verificando capacidades..." : "Restaurando capacidades detectadas...");
    try {
      await withKey(keyScope(profile), async (apiKey) => {
        const response = await fetch("/api/assistant/models", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ operation, profile, ...(profile.provider === "manual" && apiKey ? { apiKey } : {}) }),
        });
        const payload = await response.json() as { profile?: ModelProfile };
        if (!response.ok || !payload.profile) throw new Error("verification_failed");
        if (controller.signal.aborted) return;
        await saveModelProfile(payload.profile);
        if (mounted.current && !controller.signal.aborted) setMessage(operation === "probe" ? "Capacidades verificadas." : "Capacidades detectadas restauradas.");
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        await saveModelProfile({ ...profile, verifiedAt: new Date().toISOString(), lastVerificationError: "No se pudo verificar el modelo." }).catch(() => undefined);
        if (mounted.current) setMessage("No se pudo verificar el modelo.");
      }
    } finally { finishOperation(controller); }
  }

  async function testConnection(profile: ModelProfile) {
    const controller = beginOperation(profile.id);
    setMessage("Probando conexión...");
    try {
      await withKey(keyScope(profile), async (apiKey) => {
        const response = await fetch("/api/assistant/models", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ operation: "list", provider: profile.provider, ...(profile.provider === "manual" ? { baseUrl: profile.baseUrl, ...(apiKey ? { apiKey } : {}) } : {}) }),
        });
        const payload = await response.json() as { models?: unknown[] };
        if (!response.ok || !payload.models) throw new Error("connection_failed");
        await saveModelProfile({ ...profile, verifiedAt: new Date().toISOString(), lastVerificationError: undefined });
        if (mounted.current) setMessage("Conexión correcta.");
      });
    } catch {
      if (!controller.signal.aborted) {
        await saveModelProfile({ ...profile, verifiedAt: new Date().toISOString(), lastVerificationError: "No se pudo conectar con el proveedor." }).catch(() => undefined);
        if (mounted.current) setMessage("No se pudo conectar con el proveedor.");
      }
    } finally { finishOperation(controller); }
  }

  async function estimateStorage() {
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (mounted.current) setStorageUsage(`${formatBytes(estimate?.usage)} usados de ${formatBytes(estimate?.quota)}`);
    } catch { if (mounted.current) setMessage("No se pudo calcular el almacenamiento local."); }
  }

  if (!ready) return <p role="status" className="text-sm text-muted">{initializationError ?? "Cargando ajustes del Asistente..."}</p>;

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-primary"><BrainCircuit aria-hidden="true" /></span>
            <div><h2 className="text-lg font-semibold text-ink">Proveedores y modelos</h2><p className="mt-1 text-sm text-muted">Perfiles configurables sin una lista cerrada de modelos.</p></div>
          </div>
          <div className="flex items-center gap-2">
            <select className="filter-control w-36" aria-label="Proveedor para añadir" value={providerToAdd} onChange={(event) => setProviderToAdd(event.target.value as ProviderId)}>{providers.map((provider) => <option key={provider} value={provider}>{PROVIDER_PRESETS[provider].label}</option>)}</select>
            <button type="button" className="btn-secondary" aria-label={`Añadir proveedor ${PROVIDER_PRESETS[providerToAdd].label}`} onClick={() => { setDraft(emptyProfile(providerToAdd)); clearKey(); }}><Plus aria-hidden="true" />Añadir perfil</button>
          </div>
          <div className="hidden" aria-hidden="true">
            {providers.map((provider) => <button key={provider} type="button" className="btn-secondary" onClick={() => { setDraft(emptyProfile(provider)); clearKey(); }} aria-label={`Añadir proveedor ${PROVIDER_PRESETS[provider].label}`}><Plus aria-hidden="true" />{PROVIDER_PRESETS[provider].label}</button>)}
          </div>
        </div>

        {draft ? (
          <form className="mt-5 grid gap-4 rounded-2xl border border-line bg-slate-50/70 p-4 md:grid-cols-2" onSubmit={(event) => void submitProfile(event)}>
            <label className="text-sm font-semibold text-ink">Nombre del perfil<input className="filter-control mt-2" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label className="text-sm font-semibold text-ink">Proveedor<select className="filter-control mt-2" value={draft.provider} onChange={(event) => { clearKey(); setDraft(emptyProfile(event.target.value as ProviderId)); }}>{providers.map((provider) => <option key={provider} value={provider}>{PROVIDER_PRESETS[provider].label}</option>)}</select></label>
            <label className="text-sm font-semibold text-ink">URL base HTTPS<input className="filter-control mt-2" value={draft.baseUrl} disabled={draft.provider !== "manual"} onChange={(event) => { clearKey(); setDraft({ ...draft, baseUrl: event.target.value }); }} /></label>
            <label className="text-sm font-semibold text-ink">Modelo<input className="filter-control mt-2" value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} /></label>
            {draft.provider === "manual" ? <label className="text-sm font-semibold text-ink">Clave efímera<input ref={keyInput} aria-label="Clave efímera" className="filter-control mt-2" type="password" autoComplete="off" onChange={(event) => setKey(keyScope(draft), event.target.value)} /><span className="mt-2 block font-normal text-muted">Solo vive en memoria hasta recargar o desmontar.</span></label> : <p className="text-sm text-muted">Variable server-only: <code>{PROVIDER_PRESETS[draft.provider].envName}</code></p>}
            <label className="text-sm font-semibold text-ink">Ventana manual<input className="filter-control mt-2" type="number" min="1" value={draft.manualContextWindow ?? ""} onChange={(event) => setDraft({ ...draft, manualContextWindow: event.target.value ? Number(event.target.value) : undefined })} /></label>
            <div className="flex flex-wrap gap-2 md:col-span-2"><button className="btn-primary" type="submit" disabled={busyProfileId === draft.id}>Guardar perfil</button><button className="btn-secondary" type="button" onClick={() => { setDraft(undefined); clearKey(); }}>Cancelar</button></div>
          </form>
        ) : null}

        <div className="mt-5 grid gap-3">
          {modelProfiles.length ? modelProfiles.map((profile) => (
            <article key={profile.id} className="rounded-2xl border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-semibold text-ink">{profile.name}</h3><p className="mt-1 font-mono text-xs text-muted">{PROVIDER_PRESETS[profile.provider].label} · {profile.modelId}</p></div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${profile.enabled ? "bg-emerald-50 text-success" : "bg-slate-100 text-muted"}`}>{profile.enabled ? "Activo" : "Desactivado"}</span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-muted">Ventana</dt><dd className="font-semibold">{profile.detectedContextWindow ?? profile.manualContextWindow ?? "Sin verificar"}</dd></div>
                <div><dt className="text-muted">Streaming</dt><dd className="font-semibold">{profile.supportsStreaming ? "Compatible" : "No verificado"}</dd></div>
                <div><dt className="text-muted">Herramientas</dt><dd className="font-semibold">{profile.supportsTools ? "Compatible" : "No verificado"}</dd></div>
                <div><dt className="text-muted">Última verificación</dt><dd className="font-semibold">{profile.verifiedAt ? new Date(profile.verifiedAt).toLocaleString("es-ES") : "Nunca"}</dd></div>
              </dl>
              {profile.lastVerificationError ? <p className="mt-3 text-sm font-semibold text-danger">{profile.lastVerificationError}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => { clearKey(); setDraft(profile); }} aria-label={`Editar ${profile.name}`}><Pencil aria-hidden="true" />Editar</button>
                <button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => void runLocal(() => duplicateModelProfile(profile.id), "No se pudo duplicar el perfil.")} aria-label={`Duplicar ${profile.name}`}><Copy aria-hidden="true" />Duplicar</button>
                <button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => void runLocal(() => saveModelProfile({ ...profile, enabled: !profile.enabled }), "No se pudo actualizar el perfil.")} aria-label={`${profile.enabled ? "Desactivar" : "Activar"} ${profile.name}`}><CheckCircle2 aria-hidden="true" />{profile.enabled ? "Desactivar" : "Activar"}</button>
                <button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => void testConnection(profile)} aria-label={`Probar conexión ${profile.name}`}><Wifi aria-hidden="true" />Probar conexión</button>
                <button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => void callModels("probe", profile)} aria-label={`Verificar capacidades ${profile.name}`}><ShieldAlert aria-hidden="true" />Verificar capacidades</button>
                {profile.capabilitiesSource !== "manual" ? <button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => void runLocal(() => saveModelProfile({ ...profile, capabilitiesSource: "manual", generalChatCompatible: true, analysisCompatible: true, supportsStreaming: true, supportsTools: true, supportsStructuredOutput: true }), "No se pudo actualizar la compatibilidad.")} aria-label={`Habilitar compatibilidad manual ${profile.name}`}><KeyRound aria-hidden="true" />Habilitar manualmente</button> : null}
                <button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => void callModels("restore_detected", profile)} aria-label={`Restaurar detectados ${profile.name}`}><RotateCcw aria-hidden="true" />Restaurar detectados</button>
                {profile.provider === "manual" ? <button type="button" className="btn-secondary" disabled={busyProfileId === profile.id} onClick={() => { clearKey(); void runLocal(() => deleteModelProfile(profile.id), "No se pudo eliminar el perfil."); }} aria-label={`Eliminar ${profile.name}`}><Trash2 aria-hidden="true" />Eliminar</button> : null}
              </div>
            </article>
          )) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-muted">Añade un proveedor y un modelo para comenzar.</p>}
        </div>
      </Card>

      <Card className="p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-ink">Comportamiento predeterminado</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm font-semibold text-ink">Modelo general predeterminado<select className="filter-control mt-2" value={assistantSettings.defaultGeneralModelProfileId ?? ""} onChange={(event) => void runLocal(() => updateAssistantSettings({ defaultGeneralModelProfileId: event.target.value || undefined }), "No se pudo actualizar el modelo predeterminado.")}><option value="">Sin seleccionar</option>{modelProfiles.filter((item) => item.enabled && item.generalChatCompatible).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-sm font-semibold text-ink">Modelo de análisis predeterminado<select className="filter-control mt-2" value={assistantSettings.defaultAnalysisModelProfileId ?? ""} onChange={(event) => void runLocal(() => updateAssistantSettings({ defaultAnalysisModelProfileId: event.target.value || undefined }), "No se pudo actualizar el modelo predeterminado.")}><option value="">Sin seleccionar</option>{modelProfiles.filter((item) => item.enabled && item.analysisCompatible).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-sm font-semibold text-ink">Modo de respuesta<select className="filter-control mt-2" value={assistantSettings.responseMode} onChange={(event) => void runLocal(() => updateAssistantSettings({ responseMode: event.target.value as "strict" | "flexible" }), "No se pudo actualizar el modo de respuesta.")}><option value="strict">Estricto</option><option value="flexible">Flexible</option></select></label>
          <label className="text-sm font-semibold text-ink">Estrategia de contexto<select className="filter-control mt-2" value={assistantSettings.contextStrategy} onChange={(event) => void runLocal(() => updateAssistantSettings({ contextStrategy: event.target.value as "automatic" | "full" | "optimized" }), "No se pudo actualizar la estrategia de contexto.")}><option value="automatic">Automática</option><option value="full">Completa</option><option value="optimized">Optimizada</option></select></label>
          <label className="text-sm font-semibold text-ink">Margen de seguridad (%)<input className="filter-control mt-2" type="number" min="0" max="50" value={assistantSettings.safetyMarginPercent} onChange={(event) => void runLocal(() => updateAssistantSettings({ safetyMarginPercent: Number(event.target.value) }), "No se pudo actualizar el margen de seguridad.")} /></label>
          <label className="text-sm font-semibold text-ink">Aviso de contexto (%)<input className="filter-control mt-2" type="number" min="1" max="99" value={assistantSettings.warningThresholdPercent} onChange={(event) => void runLocal(() => updateAssistantSettings({ warningThresholdPercent: Number(event.target.value) }), "No se pudo actualizar el aviso de contexto.")} /></label>
          <label className="text-sm font-semibold text-ink">Compactación (%)<input className="filter-control mt-2" type="number" min="1" max="100" value={assistantSettings.compactionThresholdPercent} onChange={(event) => void runLocal(() => updateAssistantSettings({ compactionThresholdPercent: Number(event.target.value) }), "No se pudo actualizar la compactación.")} /></label>
        </div>
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"><ShieldAlert className="mt-0.5 shrink-0" aria-hidden="true" />{MANUAL_WARNING}</p>
      </Card>

      <Card className="p-4 sm:p-6">
        <div className="flex items-center gap-3"><KeyRound className="text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold text-ink">Privacidad y almacenamiento local</h2></div>
        <p className="mt-4 text-sm leading-6 text-muted">{LOCAL_STORAGE_WARNING}</p>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={() => void estimateStorage()}>Calcular uso local</button><button type="button" className="btn-secondary" onClick={() => void runLocal(clearAssistantContent, "No se pudo borrar el contenido local.")}><Trash2 aria-hidden="true" />Borrar conversaciones y contexto</button></div>
        {storageUsage ? <p className="mt-3 text-sm font-semibold text-ink" aria-live="polite">{storageUsage}</p> : null}
      </Card>
      {message ? <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary" aria-live="polite">{message}</p> : null}
    </div>
  );
}
