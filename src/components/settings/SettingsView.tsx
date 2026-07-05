"use client";

import { BrainCircuit, CheckCircle2, LockKeyhole, ShieldCheck, SlidersHorizontal, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppState } from "@/components/app/AppState";
import { Badge } from "@/components/common/Badge";
import { Card } from "@/components/common/Card";
import { SectionHeader } from "@/components/common/SectionHeader";
import { Toggle } from "@/components/common/Toggle";
import { normalizePdfConcept } from "@/lib/compare/conceptMapping";
import type { ConceptMappingRule } from "@/lib/types";

const PENDING_REVIEW_RULE_TEMPLATES: readonly ConceptMappingRule[] = [
  {
    pdfConcept: "Prestacion Teorica Maternidad",
    normalizedPdfConcept: normalizePdfConcept("Prestacion Teorica Maternidad"),
    block: "C. Salarial",
    blockKey: "salaryComplement",
    registroCode: "CSP_I_AJUSTE_MATERNIDAD",
    status: "Pendiente revisión",
    sourceType: "devengo",
    allowInformative: false,
    dedupePriority: "devengo",
    includedInComparison: false,
    reason: "Concepto teorica con codigo similar en Registro a 0; no se incluye automaticamente.",
  },
  {
    pdfConcept: "Paga 40 Anos",
    normalizedPdfConcept: normalizePdfConcept("Paga 40 Anos"),
    block: "C. Salarial",
    blockKey: "salaryComplement",
    status: "Pendiente revisión",
    sourceType: "devengo",
    allowInformative: false,
    dedupePriority: "devengo",
    includedInComparison: false,
    reason: "No existe codigo exacto de Paga 40 Anos en Registro; no se mapea automaticamente.",
  },
];

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
  const [mapDraft, setMapDraft] = useState("");
  const [mapMessage, setMapMessage] = useState<string | undefined>();

  useEffect(() => {
    void refreshAiStatus();
  }, [refreshAiStatus]);

  useEffect(() => {
    setMapDraft(JSON.stringify(settings.conceptMap ?? [], null, 2));
  }, [settings.conceptMap]);

  function normalizeRules(input: unknown): ConceptMappingRule[] {
    if (!Array.isArray(input)) {
      throw new Error("El mapa debe ser un array JSON.");
    }
    return input.map((item) => {
      const rule = item as Partial<ConceptMappingRule>;
      if (!rule.pdfConcept || !rule.block || !rule.blockKey || !rule.status) {
        throw new Error("Cada regla necesita pdfConcept, block, blockKey y status.");
      }
      return {
        pdfConcept: rule.pdfConcept,
        normalizedPdfConcept: rule.normalizedPdfConcept || normalizePdfConcept(rule.pdfConcept),
        block: rule.block,
        blockKey: rule.blockKey,
        registroCode: rule.registroCode,
        status: rule.status,
        sourceType: rule.sourceType,
        allowInformative: rule.allowInformative,
        dedupePriority: rule.dedupePriority,
        includedInComparison: rule.includedInComparison,
        reason: rule.reason,
      };
    });
  }

  function saveConceptMap() {
    try {
      const rules = normalizeRules(JSON.parse(mapDraft));
      updateSettings({ conceptMap: rules });
      setMapMessage("Mapa de conceptos guardado. Reanaliza para aplicar cambios.");
    } catch (error) {
      setMapMessage(error instanceof Error ? error.message : "No se pudo guardar el mapa.");
    }
  }

  function exportConceptMap() {
    const blob = new Blob([JSON.stringify(settings.conceptMap ?? [], null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mapa_conceptos_retributivo.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function importConceptMap() {
    const pasted = window.prompt("Pega el JSON del mapa de conceptos");
    if (!pasted) {
      return;
    }
    setMapDraft(pasted);
    try {
      const rules = normalizeRules(JSON.parse(pasted));
      updateSettings({ conceptMap: rules });
      setMapMessage("Mapa importado. Reanaliza para aplicar cambios.");
    } catch (error) {
      setMapMessage(error instanceof Error ? error.message : "No se pudo importar el mapa.");
    }
  }

  function addPendingReviewTemplates() {
    const existing = new Set((settings.conceptMap ?? []).map((rule) => normalizePdfConcept(rule.pdfConcept)));
    const next = [
      ...(settings.conceptMap ?? []),
      ...PENDING_REVIEW_RULE_TEMPLATES.filter((rule) => !existing.has(normalizePdfConcept(rule.pdfConcept))),
    ];
    updateSettings({ conceptMap: next });
    setMapDraft(JSON.stringify(next, null, 2));
    setMapMessage("Plantillas pendientes añadidas fuera del calculo. Edita includedInComparison/status solo si procede.");
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Ajustes"
        subtitle="Configura IA, tolerancias de análisis y revisa las reglas de privacidad de la herramienta."
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
            <p className="text-sm leading-6 text-muted">La API key se configura desde el archivo .env. No se guarda en el navegador.</p>
            <button type="button" onClick={() => void testAiConnection()} disabled={aiTesting || !aiStatus?.configured} className="btn-primary">
              <Wifi className="h-4 w-4" aria-hidden="true" />
              {aiTesting ? "Probando conexión..." : "Probar conexión IA"}
            </button>
            {aiTestMessage ? (
              <p className="rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary" aria-live="polite">
                {aiTestMessage}
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

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-primary">
            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-ink">Mapa de conceptos</h2>
            <p className="text-sm text-muted">Reglas manuales PDF → código Registro. Los códigos se revalidan contra el Excel cargado antes de analizar.</p>
          </div>
        </div>
        <div className="mt-5 rounded-2xl bg-slate-50 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">Pendientes activables manualmente</p>
              <p className="mt-1 text-sm text-muted">Prestacion Teorica Maternidad y Paga 40 Anos quedan fuera del calculo por defecto.</p>
            </div>
            <button type="button" onClick={addPendingReviewTemplates} className="btn-secondary">
              Añadir plantillas pendientes
            </button>
          </div>
        </div>
        <textarea
          value={mapDraft}
          onChange={(event) => setMapDraft(event.target.value)}
          className="mt-5 min-h-64 w-full rounded-2xl border border-line bg-white p-4 font-mono text-xs text-ink shadow-subtle"
          spellCheck={false}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={saveConceptMap} className="btn-primary">
            Guardar mapa
          </button>
          <button type="button" onClick={exportConceptMap} className="btn-secondary">
            Exportar mapa
          </button>
          <button type="button" onClick={importConceptMap} className="btn-secondary">
            Importar mapa
          </button>
          <button
            type="button"
            onClick={() => {
              updateSettings({ conceptMap: [] });
              setMapMessage("Mapa manual restaurado. Se usará el mapa por defecto dinámico.");
            }}
            className="btn-danger"
          >
            Restaurar defecto
          </button>
        </div>
        {mapMessage ? <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold text-primary">{mapMessage}</p> : null}
      </Card>

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
