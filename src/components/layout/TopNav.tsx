"use client";

import { Download, RotateCcw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRef, type KeyboardEvent } from "react";
import { useAppState } from "@/components/app/AppState";
import { IconButton } from "@/components/common/IconButton";
import type { AppView } from "@/lib/types";
import { cn } from "@/lib/utils/classNames";

const TABS: ReadonlyArray<{ id: AppView; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "personas", label: "Personas" },
  { id: "cuadre-excel", label: "Cuadre Reg." },
  { id: "agrupaciones", label: "Agrupaciones" },
  { id: "asistente", label: "Asistente" },
  { id: "historial", label: "Historial" },
  { id: "ajustes", label: "Ajustes" },
];

export function TopNav() {
  const { view, setView, result, exporting, exportActiveAnalysis, resetForNewAnalysis } = useAppState();
  const reduceMotion = useReducedMotion();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectTabAt(index: number) {
    const tab = TABS[index];
    if (!tab) return;
    setView(tab.id);
    tabRefs.current[index]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return selectTabAt(0);
    if (event.key === "End") return selectTabAt(TABS.length - 1);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    selectTabAt((index + direction + TABS.length) % TABS.length);
  }

  return (
    <header data-surface="floating-header" className="sticky top-0 z-30 bg-transparent px-3 py-3 sm:px-5 lg:px-7 xl:px-8">
      <nav aria-label="Navegación principal" className="mx-auto grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="hidden lg:block" aria-hidden="true" />
        <div className="no-scrollbar min-w-0 overflow-x-auto rounded-2xl bg-white p-1 shadow-subtle ring-1 ring-line/80 lg:max-w-none lg:overflow-visible">
          <div data-layout="fit-content" className="flex w-max min-w-max items-center gap-1" role="tablist" aria-label="Vistas">
            {TABS.map((tab, index) => {
              const active = view === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setView(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={cn(
                    "relative min-h-10 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition-colors duration-150 xl:px-4",
                    active ? "text-white" : "text-muted hover:bg-slate-50 hover:text-ink",
                  )}
                >
                  {active ? <motion.span layoutId="active-tab-pill" className="absolute inset-0 rounded-xl bg-ink shadow-subtle" transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }} /> : null}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div data-surface="nav-actions" className="flex items-center justify-end gap-2">
          <IconButton label="Exportar Excel" icon={Download} disabled={!result || exporting} onClick={() => void exportActiveAnalysis()} variant="secondary" />
          <IconButton label="Nuevo análisis" icon={RotateCcw} onClick={resetForNewAnalysis} variant="primary" />
        </div>
      </nav>
    </header>
  );
}
