"use client";

import { BrainCircuit, Copy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppState } from "@/components/app/AppState";
import {
  clearAiExplanationCache,
  createAiExplanationCacheKey,
  readCachedAiExplanation,
  writeCachedAiExplanation,
} from "@/lib/ai/explainCache";
import {
  AI_EXPLAIN_FALLBACK_MESSAGE,
  AI_NOT_CONFIGURED_MESSAGE,
  normalizeAiExplanation,
  type AiExplanation,
  type ExplainPayload,
  type ExplainRequestType,
} from "@/lib/ai/explainTypes";
import { cn } from "@/lib/utils/classNames";

interface AiExplanationPanelProps {
  readonly type: ExplainRequestType;
  readonly payload: ExplainPayload;
}

interface ExplainResponse {
  readonly explanation?: AiExplanation;
  readonly error?: string;
}

function SectionList({ title, items }: Readonly<{ title: string; items: readonly string[] }>) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <ul className="mt-2 space-y-1.5 text-sm leading-6 text-muted">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

export function AiExplanationPanel({ type, payload }: AiExplanationPanelProps) {
  const { activeAnalysis, aiStatus } = useAppState();
  const [explanation, setExplanation] = useState<AiExplanation | undefined>();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [cacheHit, setCacheHit] = useState(false);
  const analysisId = activeAnalysis?.id;
  const disabledReason = !aiStatus?.configured || !aiStatus.enabled ? AI_NOT_CONFIGURED_MESSAGE : undefined;
  const cacheKey = useMemo(() => createAiExplanationCacheKey(type, payload, analysisId), [analysisId, payload, type]);

  const requestExplanation = useCallback(
    async (forceRefresh: boolean) => {
      if (disabledReason) {
        setErrorMessage(undefined);
        return;
      }

      setLoading(true);
      setErrorMessage(undefined);

      try {
        if (!forceRefresh) {
          const cached = readCachedAiExplanation(type, payload, analysisId);
          if (cached) {
            setExplanation(cached);
            setCacheHit(true);
            return;
          }
        }

        const response = await fetch("/api/explain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type, payload }),
        });
        const body = (await response.json().catch(() => ({}))) as ExplainResponse;
        if (!response.ok || !body.explanation) {
          throw new Error(body.error ?? AI_EXPLAIN_FALLBACK_MESSAGE);
        }

        const normalized = normalizeAiExplanation(body.explanation);
        writeCachedAiExplanation(type, payload, normalized, analysisId);
        setExplanation(normalized);
        setCacheHit(true);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ai-explain] Explanation request failed", error);
        }
        setErrorMessage(AI_EXPLAIN_FALLBACK_MESSAGE);
      } finally {
        setLoading(false);
      }
    },
    [analysisId, disabledReason, payload, type],
  );

  useEffect(() => {
    const cached = readCachedAiExplanation(type, payload, analysisId);
    setExplanation(cached);
    setErrorMessage(undefined);
    setCacheHit(Boolean(cached));
  }, [analysisId, cacheKey, payload, type]);

  const copyExplanation = useCallback(() => {
    if (!explanation) {
      return;
    }

    const text = [
      `Resumen: ${explanation.summary}`,
      `Causas probables: ${explanation.probableCauses.join("; ")}`,
      `Revisar en Reg. Retrib.: ${explanation.registroReview.join("; ")}`,
      `Revisar en Recibo: ${explanation.pdfReview.join("; ")}`,
      `Acciones recomendadas: ${explanation.recommendedActions.join("; ")}`,
      `Confianza: ${explanation.confidence}`,
    ].join("\n");
    void navigator.clipboard?.writeText(text);
  }, [explanation]);

  return (
    <section className="mt-6 rounded-3xl border border-blue-100 bg-blue-50/60 p-4 sm:p-5" aria-label="Explicación IA">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-subtle">
            <BrainCircuit className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-ink">Explicación IA</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Bajo demanda, sobre datos estructurados ya calculados. No recalcula ni modifica resultados. No se envían nombres, NIF, IBAN, bancos ni documentos completos.
            </p>
            {disabledReason ? <p className="mt-2 text-sm font-semibold text-orange-700">{disabledReason}</p> : null}
            {cacheHit ? <p className="mt-2 text-xs font-semibold uppercase text-primary">Explicación IA guardada para este análisis.</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className={cn(explanation ? "btn-secondary" : "btn-primary")}
            disabled={Boolean(disabledReason) || loading}
            title={disabledReason}
            onClick={() => void requestExplanation(Boolean(explanation))}
          >
            {explanation ? <RefreshCw className="size-4" aria-hidden="true" /> : <BrainCircuit className="size-4" aria-hidden="true" />}
            {loading ? "Analizando..." : explanation ? "Regenerar IA" : "Analizar con IA"}
          </button>
          {explanation ? (
            <button type="button" className="btn-secondary" onClick={copyExplanation}>
              <Copy className="size-4" aria-hidden="true" />
              Copiar explicación
            </button>
          ) : null}
        </div>
      </div>

      {errorMessage ? (
        <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-orange-700" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {!explanation && !loading ? (
        <p className="mt-4 rounded-2xl bg-white/75 px-4 py-3 text-sm leading-6 text-muted">
          La explicación determinista anterior se mantiene disponible. Lanza la IA solo cuando necesites una lectura adicional.
        </p>
      ) : null}

      {explanation ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-4 lg:col-span-2">
            <p className="text-sm font-semibold text-ink">Resumen</p>
            <p className="mt-2 text-sm leading-6 text-muted">{explanation.summary}</p>
          </div>
          <SectionList title="Causas probables" items={explanation.probableCauses} />
          <SectionList title="Qué revisar en Reg. Retrib." items={explanation.registroReview} />
          <SectionList title="Qué revisar en Recibo" items={explanation.pdfReview} />
          <SectionList title="Acciones recomendadas" items={explanation.recommendedActions} />
          <div className="rounded-2xl bg-white p-4 lg:col-span-2">
            <p className="text-sm font-semibold text-ink">Nivel de confianza</p>
            <p className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-ink">{explanation.confidence}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export { clearAiExplanationCache };
