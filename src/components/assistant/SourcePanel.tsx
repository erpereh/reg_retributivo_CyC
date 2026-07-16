"use client";

import { X } from "lucide-react";
import { SourceDetails } from "@/components/assistant/SourceDetails";
import type { SourceReference } from "@/lib/assistant/domain";

export function SourcePanel({ source, onClose }: Readonly<{ source: SourceReference; onClose(): void }>) {
  const sourceKind = source.sourceType === "person_analysis" ? "Evidencia retributiva" : "Fuente de análisis";
  const title = source.sanitizedSourceLabel.replace("Análisis retributivo · getPersonProfile", "Evidencia retributiva");
  return <aside className="absolute inset-y-0 right-0 z-40 flex w-[min(48rem,96vw)] flex-col border-l border-line bg-white shadow-2xl" aria-label="Detalle de la fuente">
    <header className="flex items-start gap-3 border-b border-line p-4"><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wide text-primary">{sourceKind}</p><h2 className="mt-1 break-words font-bold text-ink">{title}</h2></div><button type="button" className="flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-slate-100" aria-label="Cerrar fuente" onClick={onClose}><X className="size-4" /></button></header>
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5"><SourceDetails source={source} /></div>
  </aside>;
}
