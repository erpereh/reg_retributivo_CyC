"use client";

import { Download, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { useAppState } from "@/components/app/AppState";
import type { AppView } from "@/lib/types";
import { cn } from "@/lib/utils/classNames";

const TABS: ReadonlyArray<{ id: AppView; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "personas", label: "Personas" },
  { id: "cuadre-excel", label: "Cuadre Reg." },
  { id: "agrupaciones", label: "Agrupaciones" },
  { id: "historial", label: "Historial" },
  { id: "ajustes", label: "Ajustes" },
];

function IconAction({
  label,
  disabled,
  onClick,
  variant,
  children,
}: Readonly<{
  label: string;
  disabled?: boolean;
  onClick: () => void;
  variant: "primary" | "secondary";
  children: React.ReactNode;
}>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-tooltip={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group relative flex size-11 items-center justify-center rounded-full border shadow-subtle transition duration-150 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-45",
        "after:pointer-events-none after:absolute after:right-0 after:top-[calc(100%+0.5rem)] after:z-40 after:rounded-full after:bg-ink after:px-3 after:py-1.5 after:text-xs after:font-semibold after:text-white after:opacity-0 after:shadow-lift after:transition after:duration-150 after:content-[attr(data-tooltip)] hover:after:opacity-100 focus-visible:after:opacity-100",
        variant === "primary"
          ? "border-primary bg-primary text-white hover:bg-primary-dark"
          : "border-line bg-white/95 text-ink hover:border-blue-200 hover:bg-blue-50",
      )}
    >
      {children}
    </button>
  );
}

export function TopNav() {
  const { view, setView, result, exporting, exportActiveAnalysis, resetForNewAnalysis } = useAppState();

  return (
    <header className="sticky top-3 z-30 px-1">
      <nav aria-label="Navegación principal" className="mx-auto grid max-w-[1500px] grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div aria-hidden="true" />

        <div className="max-w-[calc(100vw-7rem)] overflow-x-auto rounded-full border border-white/80 bg-white/95 p-1 shadow-subtle md:max-w-none md:overflow-visible">
          <div className="flex min-w-max items-center gap-1" role="tablist" aria-label="Vistas">
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
                    "relative min-h-10 whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-colors duration-150 xl:px-4",
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
        </div>

        <div className="flex items-center justify-end gap-2">
          <IconAction label="Exportar Excel" disabled={!result || exporting} onClick={() => void exportActiveAnalysis()} variant="secondary">
            <Download className="size-4" aria-hidden="true" />
          </IconAction>
          <IconAction label="Nuevo análisis" onClick={resetForNewAnalysis} variant="primary">
            <RotateCcw className="size-4" aria-hidden="true" />
          </IconAction>
        </div>
      </nav>
    </header>
  );
}
