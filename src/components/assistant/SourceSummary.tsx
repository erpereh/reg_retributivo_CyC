"use client";

import { BookOpen, CircleSlash2, History } from "lucide-react";
import { useState } from "react";
import { SourceDetails } from "@/components/assistant/SourceDetails";
import type { SourceReference } from "@/lib/assistant/domain";

const labels = {
  available: "Disponible",
  historical_unavailable: "Histórica no disponible",
  deleted: "Eliminada",
} as const;

export function SourceSummary({ sources }: Readonly<{ sources: readonly SourceReference[] }>) {
  const [expanded, setExpanded] = useState<string>();
  if (!sources.length) return null;
  return (
    <section aria-label="Fuentes" className="mt-4 border-t border-slate-200 pt-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">Fuentes</h3>
      <ul className="space-y-2">
        {sources.map((source) => {
          const available = source.availability === "available";
          const Icon = available ? BookOpen : source.availability === "deleted" ? CircleSlash2 : History;
          const unavailableLabel = source.availability === "deleted" ? "Fuente eliminada" : "Fuente histórica no disponible";
          return (
            <li key={source.id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/80">
              <div className="flex min-w-0 items-center gap-2">
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{source.sanitizedSourceLabel}</p>
                  <p className="text-xs text-muted">{labels[source.availability]}</p>
                </div>
                <button
                  type="button"
                  className="min-h-11 min-w-11 rounded-xl px-3 text-xs font-bold text-primary enabled:hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-muted"
                  disabled={!available}
                  aria-label={available ? `Abrir fuente ${source.sanitizedSourceLabel}` : unavailableLabel}
                  onClick={() => setExpanded((current) => current === source.id ? undefined : source.id)}
                >
                  {available ? "Abrir" : "No disponible"}
                </button>
              </div>
              {expanded === source.id ? <SourceDetails source={source} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
