"use client";

import { Download, FileSpreadsheet, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { useAppState } from "@/components/app/AppState";
import type { AppView } from "@/lib/types";
import { cn } from "@/lib/utils/classNames";

const TABS: ReadonlyArray<{ id: AppView; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "tablas", label: "Tablas" },
  { id: "historial", label: "Historial" },
  { id: "ajustes", label: "Ajustes" },
];

export function TopNav() {
  const { view, setView, result, exporting, exportActiveAnalysis, resetForNewAnalysis } = useAppState();

  return (
    <header className="relative z-30">
      <nav
        aria-label="Navegación principal"
        className="flex flex-col gap-4 rounded-[32px] border border-white/80 bg-white/95 p-4 shadow-nav backdrop-blur md:flex-row md:items-center md:justify-between"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-blue">
            <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-xl font-semibold text-ink">Retributivo</span>
        </div>

        <div className="flex flex-wrap rounded-full bg-slate-100 p-1" role="tablist" aria-label="Vistas">
          {TABS.map((tab) => {
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(tab.id)}
                className={cn(
                  "relative min-h-10 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors",
                  active ? "text-white" : "text-muted hover:text-ink",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="active-tab-pill"
                    className="absolute inset-0 rounded-full bg-ink shadow-subtle"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                ) : null}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void exportActiveAnalysis()} disabled={!result || exporting} className="btn-secondary">
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting ? "Exportando..." : "Exportar Excel"}
          </button>
          <button type="button" onClick={resetForNewAnalysis} className="btn-primary">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Nuevo análisis
          </button>
        </div>
      </nav>
    </header>
  );
}
