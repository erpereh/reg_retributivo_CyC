"use client";

import { MessageSquareText } from "lucide-react";
import type { PersonComparisonRow } from "@/lib/types";

export function PersonDetail({ row, ready, busy, onContinue }: Readonly<{
  row: PersonComparisonRow;
  ready: boolean;
  busy: boolean;
  onContinue: (personId: string) => Promise<void>;
}>) {
  return (
    <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Integración con Asistente">
      <div>
        <h3 className="text-sm font-semibold text-blue-950">Continuar con esta matrícula</h3>
        <p className="mt-1 text-sm text-blue-900">Reutiliza o crea una conversación de este análisis sin enviar ninguna pregunta.</p>
      </div>
      <button type="button" className="btn-primary shrink-0" disabled={!ready || busy} onClick={() => void onContinue(row.employeeNumber)}>
        <MessageSquareText className="size-4" aria-hidden="true" />
        {busy ? "Abriendo…" : !ready ? "Asistente no disponible" : "Continuar en Asistente"}
      </button>
    </section>
  );
}
