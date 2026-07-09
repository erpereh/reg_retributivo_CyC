"use client";

import { FileArchive, FileSpreadsheet, FolderUp } from "lucide-react";

interface FileUploadProps {
  readonly pdfFiles: readonly File[];
  readonly registroFile?: File;
  readonly tolerance: number;
  readonly analyzing: boolean;
  readonly onPdfsChange: (files: readonly File[]) => void;
  readonly onRegistroChange: (file?: File) => void;
  readonly onToleranceChange: (value: number) => void;
  readonly onAnalyze: () => void;
}

export function FileUpload({
  pdfFiles,
  registroFile,
  tolerance,
  analyzing,
  onPdfsChange,
  onRegistroChange,
  onToleranceChange,
  onAnalyze,
}: FileUploadProps) {
  return (
    <section className="rounded-md border border-line bg-white p-4 shadow-sm">
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_220px]">
        <label className="block rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 transition hover:border-primary">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FolderUp className="h-4 w-4 text-primary" aria-hidden="true" />
            Carpeta o múltiples recibos
          </span>
          <span className="mt-1 block text-xs text-muted">Selecciona todos los recibos a comparar.</span>
          <span className="mt-3 inline-flex min-h-10 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink">
            Seleccionar recibos
          </span>
          <span className="ml-3 text-sm text-muted">
            {pdfFiles.length ? `${pdfFiles.length} archivo(s)` : "Ningun archivo seleccionado"}
          </span>
          <input
            type="file"
            multiple
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={analyzing}
            onChange={(event) => onPdfsChange(Array.from(event.target.files ?? []))}
          />
          <input
            type="file"
            multiple
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={analyzing}
            {...({ webkitdirectory: "true" } as Record<string, string>)}
            onChange={(event) => onPdfsChange(Array.from(event.target.files ?? []))}
          />
        </label>

        <label className="block rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 transition hover:border-primary">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FileSpreadsheet className="h-4 w-4 text-primary" aria-hidden="true" />
            Excel Reg. Retrib.
          </span>
          <span className="mt-1 block text-xs text-muted">Usa el Registro Retributivo heredado o equivalente.</span>
          <span className="mt-3 inline-flex min-h-10 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink">
            Seleccionar Excel
          </span>
          <span className="ml-3 text-sm text-muted">{registroFile?.name ?? "Ningun archivo seleccionado"}</span>
          <input
            type="file"
            accept=".xlsx,.xlsm,.xls"
            className="sr-only"
            disabled={analyzing}
            onChange={(event) => onRegistroChange(event.target.files?.[0])}
          />
        </label>

        <div className="rounded-md border border-line p-4">
          <label className="text-sm font-semibold text-ink" htmlFor="tolerance">
            Tolerancia EUR
          </label>
          <input
            id="tolerance"
            type="number"
            min="0"
            step="0.5"
            value={tolerance}
            onChange={(event) => onToleranceChange(Number(event.target.value))}
            className="mt-2 h-11 w-full rounded-md border border-line px-3 text-sm"
            disabled={analyzing}
          />
          <button
            type="button"
            onClick={onAnalyze}
            disabled={analyzing || !pdfFiles.length || !registroFile}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FileArchive className="h-4 w-4" aria-hidden="true" />
            {analyzing ? "Analizando" : "Analizar"}
          </button>
        </div>
      </div>
    </section>
  );
}
