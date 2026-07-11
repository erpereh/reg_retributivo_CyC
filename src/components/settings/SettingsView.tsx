"use client";

import { BrainCircuit, CheckCircle2, LockKeyhole, ShieldCheck, SlidersHorizontal, Trash2, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppState } from "@/components/app/AppState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { SectionHeader } from "@/components/common/SectionHeader";
import { SectionTabs } from "@/components/common/SectionTabs";
import { EmployeeExclusionsCard } from "@/components/settings/EmployeeExclusionsCard";
import { ConceptMapEditor } from "@/components/settings/concept-map/ConceptMapEditor";
import { NormalizedConceptsManager } from "@/components/settings/normalized-concepts/NormalizedConceptsManager";
import { clearAiExplanationCache } from "@/lib/ai/explainCache";

type SettingsSection = "general" | "exclusions" | "concepts" | "privacy";
type ConceptSection = "non-normalized" | "normalized";

const SETTINGS_SECTIONS = [
  { value: "general", label: "General", tabId: "settings-general-tab", panelId: "settings-general-panel" },
  { value: "exclusions", label: "Exclusiones", tabId: "settings-exclusions-tab", panelId: "settings-exclusions-panel" },
  { value: "concepts", label: "Conceptos", tabId: "settings-concepts-tab", panelId: "settings-concepts-panel" },
  { value: "privacy", label: "Privacidad", tabId: "settings-privacy-tab", panelId: "settings-privacy-panel" },
] as const;

const CONCEPT_SECTIONS = [
  { value: "non-normalized", label: "No Norm.", tabId: "concepts-non-normalized-tab", panelId: "concepts-non-normalized-panel" },
  { value: "normalized", label: "Normalizado", tabId: "concepts-normalized-tab", panelId: "concepts-normalized-panel" },
] as const;

function NumberSetting({ id, label, value, onChange, helper }: Readonly<{ id: string; label: string; value: number; onChange: (value: number) => void; helper: string }>) {
  return (
    <label className="block text-sm font-semibold text-ink" htmlFor={id}>
      {label}
      <input id={id} type="number" min="0" step="0.5" value={value} onChange={(event) => onChange(Number(event.target.value))} className="filter-control mt-2" />
      <span className="mt-2 block text-sm font-normal leading-5 text-muted">{helper}</span>
    </label>
  );
}

function SettingsPanel({ id, labelledBy, label, active, children }: Readonly<{ id: string; labelledBy: string; label: string; active: boolean; children: React.ReactNode }>) {
  return <section id={id} role="tabpanel" aria-labelledby={labelledBy} aria-label={label} hidden={!active} aria-hidden={!active ? "true" : undefined}>{children}</section>;
}

export function SettingsView() {
  const { settings, updateSettings, aiStatus, aiTesting, aiTestMessage, refreshAiStatus, testAiConnection } = useAppState();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [visited, setVisited] = useState<ReadonlySet<SettingsSection>>(() => new Set(["general"]));
  const [conceptView, setConceptView] = useState<ConceptSection>("non-normalized");
  const [visitedConcepts, setVisitedConcepts] = useState<ReadonlySet<ConceptSection>>(() => new Set(["non-normalized"]));
  const [aiCacheMessage, setAiCacheMessage] = useState<string | undefined>();

  useEffect(() => { void refreshAiStatus(); }, [refreshAiStatus]);

  function selectSection(value: SettingsSection) {
    setVisited((current) => new Set(current).add(value));
    setActiveSection(value);
  }

  function selectConceptView(value: ConceptSection) {
    setVisitedConcepts((current) => new Set(current).add(value));
    setConceptView(value);
  }

  function clearAiCache() {
    clearAiExplanationCache();
    setAiCacheMessage("Caché de explicaciones IA borrada.");
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Ajustes" subtitle="Configura el análisis, las exclusiones y los conceptos sin alterar los resultados ya calculados." />
      <SectionTabs label="Secciones de ajustes" value={activeSection} items={SETTINGS_SECTIONS} onValueChange={selectSection} />

      {visited.has("general") ? (
        <SettingsPanel id="settings-general-panel" labelledBy="settings-general-tab" label="General" active={activeSection === "general"}>
          <Card className="p-4 sm:p-6">
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <section aria-labelledby="settings-ai-heading" className="min-w-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-primary"><BrainCircuit aria-hidden="true" /></span>
                    <div>
                      <h2 id="settings-ai-heading" className="text-lg font-semibold text-ink">Inteligencia Artificial</h2>
                      <p className="mt-1 text-sm text-muted">Explicaciones bajo demanda; nunca recalcula resultados.</p>
                    </div>
                  </div>
                  <StatusBadge value={aiStatus?.configured ? "API configurada" : "API no configurada"} />
                </div>

                <div className="mt-5 rounded-2xl border border-line bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Modelo actual</p>
                  <p className="mt-1 font-mono text-sm font-semibold text-ink">{aiStatus?.model ?? settings.aiModel}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">La API key se configura en el entorno y no se guarda en el navegador.</p>
                </div>

                <section aria-labelledby="settings-connection-heading" className="mt-5 border-t border-line pt-5">
                  <h3 id="settings-connection-heading" className="text-sm font-semibold text-ink">Conexión y caché</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">Comprueba la disponibilidad de IA o borra solo las explicaciones almacenadas.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void testAiConnection()} disabled={aiTesting || !aiStatus?.configured} className="btn-primary">
                      <Wifi aria-hidden="true" />{aiTesting ? "Probando conexión..." : "Probar conexión IA"}
                    </button>
                    <button type="button" onClick={clearAiCache} className="btn-secondary"><Trash2 aria-hidden="true" />Borrar caché de explicaciones</button>
                  </div>
                  {aiTestMessage ? <p className="mt-3 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary" aria-live="polite">{aiTestMessage}</p> : null}
                  {aiCacheMessage ? <p className="mt-3 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary" aria-live="polite">{aiCacheMessage}</p> : null}
                </section>
              </section>

              <section aria-labelledby="settings-analysis-heading" className="rounded-2xl bg-slate-50 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-white text-primary shadow-subtle"><SlidersHorizontal aria-hidden="true" /></span>
                  <div>
                    <h2 id="settings-analysis-heading" className="text-lg font-semibold text-ink">Parámetros de análisis</h2>
                    <p className="mt-1 text-sm text-muted">Valores por defecto para nuevos análisis.</p>
                  </div>
                </div>
                <div className="mt-5 grid gap-4">
                  <NumberSetting id="defaultTolerance" label="Tolerancia salarial por defecto" value={settings.defaultTolerance} onChange={(defaultTolerance) => updateSettings({ defaultTolerance })} helper="Importes dentro de esta tolerancia se consideran OK." />
                  <NumberSetting id="reviewThreshold" label="Umbral Revisar" value={settings.reviewThreshold} onChange={(reviewThreshold) => updateSettings({ reviewThreshold })} helper="Desde este importe se marca como revisión si supera la tolerancia." />
                  <NumberSetting id="incidentThreshold" label="Umbral Incidencia" value={settings.incidentThreshold} onChange={(incidentThreshold) => updateSettings({ incidentThreshold })} helper="Desde este importe se marca como incidencia salarial." />
                </div>
              </section>
            </div>
          </Card>
        </SettingsPanel>
      ) : null}

      {visited.has("exclusions") ? <SettingsPanel id="settings-exclusions-panel" labelledBy="settings-exclusions-tab" label="Exclusiones" active={activeSection === "exclusions"}><EmployeeExclusionsCard /></SettingsPanel> : null}

      {visited.has("concepts") ? (
        <SettingsPanel id="settings-concepts-panel" labelledBy="settings-concepts-tab" label="Conceptos" active={activeSection === "concepts"}>
          <div className="flex flex-col gap-4">
            <SectionTabs label="Vistas de conceptos" value={conceptView} items={CONCEPT_SECTIONS} onValueChange={selectConceptView} />
            {visitedConcepts.has("non-normalized") ? <SettingsPanel id="concepts-non-normalized-panel" labelledBy="concepts-non-normalized-tab" label="No Norm." active={conceptView === "non-normalized"}><ConceptMapEditor /></SettingsPanel> : null}
            {visitedConcepts.has("normalized") ? <SettingsPanel id="concepts-normalized-panel" labelledBy="concepts-normalized-tab" label="Normalizado" active={conceptView === "normalized"}><NormalizedConceptsManager /></SettingsPanel> : null}
          </div>
        </SettingsPanel>
      ) : null}

      {visited.has("privacy") ? (
        <SettingsPanel id="settings-privacy-panel" labelledBy="settings-privacy-tab" label="Privacidad" active={activeSection === "privacy"}>
          <Card className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-50 text-success"><ShieldCheck aria-hidden="true" /></span>
              <div><h2 className="text-lg font-semibold text-ink">Privacidad</h2><p className="mt-1 text-sm text-muted">Garantías aplicadas a exportación e IA.</p></div>
            </div>
            <div className="mt-5 grid gap-2 md:grid-cols-2">
              {[
                "No se exportan IBAN ni datos bancarios.",
                "La IA se ejecuta exclusivamente bajo demanda.",
                "La IA no recibe nombres ni documentos completos.",
                "La IA no recibe datos bancarios.",
                "Los cálculos se completan antes de solicitar una explicación.",
              ].map((item) => <div key={item} className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-ink"><CheckCircle2 className="mt-1 shrink-0 text-success" aria-hidden="true" />{item}</div>)}
            </div>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-muted"><LockKeyhole aria-hidden="true" />Los análisis permanecen en el almacenamiento local del navegador.</p>
          </Card>
        </SettingsPanel>
      ) : null}
    </div>
  );
}
