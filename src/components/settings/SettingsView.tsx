"use client";

import { CheckCircle2, LockKeyhole, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppState } from "@/components/app/AppState";
import { Card } from "@/components/common/Card";
import { SectionHeader } from "@/components/common/SectionHeader";
import { SectionTabs } from "@/components/common/SectionTabs";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { AssistantAiSettings } from "@/components/settings/AssistantAiSettings";
import { EmployeeExclusionsCard } from "@/components/settings/EmployeeExclusionsCard";
import { ConceptMapEditor } from "@/components/settings/concept-map/ConceptMapEditor";
import { NormalizedConceptsManager } from "@/components/settings/normalized-concepts/NormalizedConceptsManager";

type SettingsSection = "general" | "appearance" | "exclusions" | "concepts" | "ai" | "privacy";
type ConceptSection = "non-normalized" | "normalized";

const SETTINGS_SECTIONS = [
  { value: "general", label: "General", tabId: "settings-general-tab", panelId: "settings-general-panel" },
  { value: "appearance", label: "Apariencia", tabId: "settings-appearance-tab", panelId: "settings-appearance-panel" },
  { value: "exclusions", label: "Exclusiones", tabId: "settings-exclusions-tab", panelId: "settings-exclusions-panel" },
  { value: "concepts", label: "Conceptos", tabId: "settings-concepts-tab", panelId: "settings-concepts-panel" },
  { value: "ai", label: "IA", tabId: "settings-ai-tab", panelId: "settings-ai-panel" },
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
  return <section id={id} role="tabpanel" aria-labelledby={labelledBy} aria-label={label} data-surface="settings-panel" hidden={!active} aria-hidden={!active ? "true" : undefined}>{children}</section>;
}

export function SettingsView() {
  const { settings, updateSettings, assistantNavigationIntent, consumeAssistantNavigationIntent } = useAppState();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [visited, setVisited] = useState<ReadonlySet<SettingsSection>>(() => new Set(["general"]));
  const [conceptView, setConceptView] = useState<ConceptSection>("non-normalized");
  const [visitedConcepts, setVisitedConcepts] = useState<ReadonlySet<ConceptSection>>(() => new Set(["non-normalized"]));

  useEffect(() => {
    if (assistantNavigationIntent?.type !== "settings_ai") return;
    setVisited((current) => new Set(current).add("ai"));
    setActiveSection("ai");
    consumeAssistantNavigationIntent();
  }, [assistantNavigationIntent, consumeAssistantNavigationIntent]);

  function selectSection(value: SettingsSection) {
    setVisited((current) => new Set(current).add(value));
    setActiveSection(value);
  }

  function selectConceptView(value: ConceptSection) {
    setVisitedConcepts((current) => new Set(current).add(value));
    setConceptView(value);
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Ajustes" subtitle="Configura el análisis y adapta la interfaz a tu forma de trabajar sin modificar resultados ya calculados." />
      <SectionTabs label="Secciones de ajustes" value={activeSection} items={SETTINGS_SECTIONS} onValueChange={selectSection} />

      {visited.has("general") ? (
        <SettingsPanel id="settings-general-panel" labelledBy="settings-general-tab" label="General" active={activeSection === "general"}>
          <Card data-surface="settings-layout" className="overflow-hidden p-0">
            <section data-surface="settings-parameters" aria-labelledby="settings-analysis-heading" className="min-w-0 p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-primary"><SlidersHorizontal aria-hidden="true" /></span>
                <div>
                  <h2 id="settings-analysis-heading" className="text-lg font-semibold text-ink">Parámetros de análisis</h2>
                  <p className="mt-1 text-sm text-muted">Valores que se aplicarán al iniciar un nuevo análisis.</p>
                </div>
              </div>
              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <NumberSetting id="defaultTolerance" label="Tolerancia salarial" value={settings.defaultTolerance} onChange={(defaultTolerance) => updateSettings({ defaultTolerance })} helper="Las diferencias dentro de este margen se consideran cuadradas." />
                <NumberSetting id="reviewThreshold" label="Umbral de revisión" value={settings.reviewThreshold} onChange={(reviewThreshold) => updateSettings({ reviewThreshold })} helper="A partir de este importe una fila pasa a revisión." />
                <NumberSetting id="incidentThreshold" label="Umbral de incidencia" value={settings.incidentThreshold} onChange={(incidentThreshold) => updateSettings({ incidentThreshold })} helper="A partir de este importe la diferencia se destaca como incidencia." />
              </div>
            </section>
          </Card>
        </SettingsPanel>
      ) : null}

      {visited.has("appearance") ? <SettingsPanel id="settings-appearance-panel" labelledBy="settings-appearance-tab" label="Apariencia" active={activeSection === "appearance"}><AppearanceSettings /></SettingsPanel> : null}
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

      {visited.has("ai") ? <SettingsPanel id="settings-ai-panel" labelledBy="settings-ai-tab" label="IA" active={activeSection === "ai"}><AssistantAiSettings /></SettingsPanel> : null}

      {visited.has("privacy") ? (
        <SettingsPanel id="settings-privacy-panel" labelledBy="settings-privacy-tab" label="Privacidad" active={activeSection === "privacy"}>
          <Card className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-50 text-success"><ShieldCheck aria-hidden="true" /></span>
              <div><h2 className="text-lg font-semibold text-ink">Privacidad</h2><p className="mt-1 text-sm text-muted">Garantías aplicadas a exportación, almacenamiento e IA.</p></div>
            </div>
            <ul className="mt-5 divide-y divide-line border-y border-line">
              {[
                "No se exportan IBAN ni datos bancarios.",
                "La IA se ejecuta exclusivamente bajo demanda.",
                "La IA no recibe nombres ni documentos completos.",
                "La IA no recibe datos bancarios.",
                "Los cálculos se completan antes de solicitar una explicación.",
              ].map((item) => <li key={item} className="flex items-start gap-3 px-1 py-3 text-sm font-semibold leading-6 text-ink"><CheckCircle2 className="mt-1 shrink-0 text-success" aria-hidden="true" />{item}</li>)}
            </ul>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-muted"><LockKeyhole aria-hidden="true" />Los análisis permanecen en el almacenamiento local del navegador.</p>
          </Card>
        </SettingsPanel>
      ) : null}
    </div>
  );
}
