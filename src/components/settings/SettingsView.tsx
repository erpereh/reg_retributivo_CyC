"use client";

import { BrainCircuit, CheckCircle2, LockKeyhole, ShieldCheck, SlidersHorizontal, Trash2, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppState } from "@/components/app/AppState";
import { Badge } from "@/components/common/Badge";
import { Card } from "@/components/common/Card";
import { SectionHeader } from "@/components/common/SectionHeader";
import { Toggle } from "@/components/common/Toggle";
import { ConceptMapEditor } from "@/components/settings/concept-map/ConceptMapEditor";
import { clearAiExplanationCache } from "@/lib/ai/explainCache";

function NumberSetting({
  id,
  label,
  value,
  onChange,
  helper,
}: Readonly<{ id: string; label: string; value: number; onChange: (value: number) => void; helper: string }>) {
  return (
    <label className="block text-sm font-semibold text-ink" htmlFor={id}>
      {label}
      <input
        id={id}
        type="number"
        min="0"
        step="0.5"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 h-12 w-full rounded-full border border-line bg-white px-4 text-sm font-medium text-ink shadow-subtle"
      />
      <span className="mt-2 block text-sm font-normal leading-5 text-muted">{helper}</span>
    </label>
  );
}

export function SettingsView() {
  const {
    settings,
    updateSettings,
    aiStatus,
    aiTesting,
    aiTestMessage,
    refreshAiStatus,
    testAiConnection,
  } = useAppState();
  const [aiCacheMessage, setAiCacheMessage] = useState<string | undefined>();

  useEffect(() => {
    void refreshAiStatus();
  }, [refreshAiStatus]);

  function clearAiCache() {
    clearAiExplanationCache();
    setAiCacheMessage("Caché de explicaciones IA borrada.");
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Ajustes"
        subtitle="Configura tolerancias, preferencias de IA, caché de explicaciones y opciones de visualización de la comparativa."
      />

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-primary">
                <BrainCircuit className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-ink">Inteligencia Artificial</h2>
                <p className="text-sm text-muted">La API key se configura desde el archivo .env.</p>
              </div>
            </div>
            <Badge value={aiStatus?.configured ? "API configurada" : "API no configurada"} />
          </div>

          <div className="mt-6 space-y-5">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-muted">Modelo actual</p>
              <p className="mt-1 font-mono text-sm font-semibold text-ink">{aiStatus?.model ?? settings.aiModel}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <Toggle
                checked={settings.enableAIByDefault}
                onChange={(enableAIByDefault) => updateSettings({ enableAIByDefault })}
                label="Activar IA por defecto"
                description="Si falta API key o ENABLE_AI_REVIEW=false, se usarán observaciones deterministas."
              />
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <Toggle
                checked={settings.autoExplainOnOpen}
                onChange={(autoExplainOnOpen) => updateSettings({ autoExplainOnOpen })}
                label="Abrir explicación IA automáticamente"
                description="Desactivado por defecto. Si se activa, solo lanza una explicación al abrir un modal y nunca bloquea el detalle determinista."
              />
            </div>
            <p className="text-sm leading-6 text-muted">La API key se configura desde el archivo .env. No se guarda en el navegador.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void testAiConnection()} disabled={aiTesting || !aiStatus?.configured} className="btn-primary">
                <Wifi className="h-4 w-4" aria-hidden="true" />
                {aiTesting ? "Probando conexión..." : "Probar conexión IA"}
              </button>
              <button type="button" onClick={clearAiCache} className="btn-secondary">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Borrar caché de explicaciones
              </button>
            </div>
            {aiTestMessage ? (
              <p className="rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary" aria-live="polite">
                {aiTestMessage}
              </p>
            ) : null}
            {aiCacheMessage ? (
              <p className="rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary" aria-live="polite">
                {aiCacheMessage}
              </p>
            ) : null}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-primary">
              <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-ink">Análisis</h2>
              <p className="text-sm text-muted">Valores por defecto para nuevos análisis.</p>
            </div>
          </div>
          <div className="mt-6 grid gap-5">
            <NumberSetting
              id="defaultTolerance"
              label="Tolerancia salarial por defecto"
              value={settings.defaultTolerance}
              onChange={(defaultTolerance) => updateSettings({ defaultTolerance })}
              helper="Importes dentro de esta tolerancia se consideran OK."
            />
            <NumberSetting
              id="reviewThreshold"
              label="Umbral Revisar"
              value={settings.reviewThreshold}
              onChange={(reviewThreshold) => updateSettings({ reviewThreshold })}
              helper="Desde este importe se marca como revisión si supera la tolerancia."
            />
            <NumberSetting
              id="incidentThreshold"
              label="Umbral Incidencia"
              value={settings.incidentThreshold}
              onChange={(incidentThreshold) => updateSettings({ incidentThreshold })}
              helper="Desde este importe se marca como incidencia salarial."
            />
          </div>
        </Card>
      </section>

      <ConceptMapEditor />

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-success">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-ink">Privacidad</h2>
            <p className="text-sm text-muted">Reglas aplicadas en análisis, IA y exportación.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {[
            "No se exportan IBAN.",
            "No se envían datos bancarios a IA.",
            "La IA solo genera observaciones, no calcula importes.",
            "Los análisis se guardan localmente en el navegador.",
          ].map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-ink">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              {item}
            </div>
          ))}
        </div>
        <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-muted">
          <LockKeyhole className="h-4 w-4" aria-hidden="true" />
          No hay login, usuarios ni backend externo en esta versión.
        </p>
      </Card>
    </div>
  );
}
