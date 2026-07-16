"use client";

import { X } from "lucide-react";
import { SourceDetails } from "@/components/assistant/SourceDetails";
import type { SourceReference } from "@/lib/assistant/domain";

export function SourcePanel({ source, onClose }: Readonly<{ source: SourceReference; onClose(): void }>) {
  return <aside className="absolute inset-y-0 right-0 z-40 flex w-[min(26rem,92vw)] flex-col border-l border-line bg-white shadow-2xl" aria-label="Detalle de la fuente">
    <header className="flex items-start gap-3 border-b border-line p-4"><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wide text-primary">Fuente {source.sourceType}</p><h2 className="mt-1 truncate font-bold text-ink">{source.sanitizedSourceLabel}</h2></div><button type="button" className="flex size-11 items-center justify-center rounded-xl hover:bg-slate-100" aria-label="Cerrar fuente" onClick={onClose}><X className="size-4" /></button></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4"><SourceDetails source={source} />{source.personId ? <p className="mt-5 rounded-xl bg-blue-50 p-3 text-sm font-semibold text-primary">Matrícula: {source.personId}</p> : null}</div>
  </aside>;
}
