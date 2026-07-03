"use client";

import { Download, RotateCcw } from "lucide-react";

interface HeaderProps {
  readonly canExport: boolean;
  readonly onExport: () => void;
  readonly onReset: () => void;
  readonly exporting: boolean;
}

export function Header({ canExport, onExport, onReset, exporting }: HeaderProps) {
  return (
    <header className="border-b border-line bg-white">
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-6 xl:flex-row xl:items-center xl:justify-between xl:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-ink">Comparativa Nominas vs Registro Retributivo</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Analiza PDFs de nomina contra el Excel heredado, detecta diferencias de dato maestro y exporta una comparativa limpia.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={!canExport || exporting}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting ? "Exportando" : "Exportar Excel"}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink transition hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Nuevo analisis
          </button>
        </div>
      </div>
    </header>
  );
}
