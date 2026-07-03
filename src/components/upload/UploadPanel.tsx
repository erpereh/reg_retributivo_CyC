"use client";

import { FileArchive, FileSpreadsheet, FolderUp, Loader2, Sparkles, UploadCloud } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState, type DragEvent, type ReactNode } from "react";
import { useAppState } from "@/components/app/AppState";
import { Card } from "@/components/common/Card";
import { Toggle } from "@/components/common/Toggle";
import { cn } from "@/lib/utils/classNames";

function fileSummary(files: readonly File[], empty: string): string {
  if (!files.length) {
    return empty;
  }

  if (files.length === 1) {
    return files[0].name;
  }

  return `${files.length} PDFs seleccionados`;
}

function DropCard({
  title,
  description,
  icon,
  children,
  active,
  onDrop,
}: Readonly<{
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
  active: boolean;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}>) {
  const [dragging, setDragging] = useState(false);
  const isActive = active || dragging;

  return (
    <motion.div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        setDragging(false);
        onDrop(event);
      }}
      animate={{
        borderColor: isActive ? "rgba(37,99,235,0.75)" : "rgba(226,232,240,1)",
        backgroundColor: isActive ? "rgba(239,246,255,1)" : "rgba(248,250,252,0.85)",
      }}
      transition={{ duration: 0.2 }}
      className="min-w-0 rounded-[24px] border border-dashed p-5"
    >
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-subtle">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </motion.div>
  );
}

export function UploadPanel() {
  const {
    pdfFiles,
    registroFile,
    settings,
    analyzing,
    setPdfFiles,
    setRegistroFile,
    updateSettings,
    analyze,
    status,
  } = useAppState();
  const reduceMotion = useReducedMotion();
  const disabled = analyzing;
  const canAnalyze = pdfFiles.length > 0 && Boolean(registroFile) && !analyzing;

  return (
    <Card className="p-5 sm:p-6">
      <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr_340px]">
        <DropCard
          title="Nóminas PDF"
          description="Arrastra los recibos o selecciona archivos/carpeta."
          icon={<FolderUp className="h-5 w-5" aria-hidden="true" />}
          active={pdfFiles.length > 0}
          onDrop={(event) => {
            event.preventDefault();
            setPdfFiles(Array.from(event.dataTransfer.files).filter((file) => file.name.toLowerCase().endsWith(".pdf")));
          }}
        >
          <div className="flex flex-wrap gap-2">
            <label className="btn-secondary cursor-pointer">
              Seleccionar PDFs
              <input
                type="file"
                multiple
                accept="application/pdf,.pdf"
                className="sr-only"
                disabled={disabled}
                onChange={(event) => setPdfFiles(Array.from(event.target.files ?? []))}
              />
            </label>
            <label className="btn-ghost cursor-pointer">
              Seleccionar carpeta
              <input
                type="file"
                multiple
                accept="application/pdf,.pdf"
                className="sr-only"
                disabled={disabled}
                {...({ webkitdirectory: "true" } as Record<string, string>)}
                onChange={(event) => setPdfFiles(Array.from(event.target.files ?? []))}
              />
            </label>
          </div>
          <motion.p
            key={pdfFiles.length}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 truncate text-sm font-medium text-ink"
          >
            {fileSummary(pdfFiles, "Ningún PDF seleccionado")}
          </motion.p>
        </DropCard>

        <DropCard
          title="Excel Registro"
          description="Sube el Registro Retributivo heredado o equivalente."
          icon={<FileSpreadsheet className="h-5 w-5" aria-hidden="true" />}
          active={Boolean(registroFile)}
          onDrop={(event) => {
            event.preventDefault();
            const file = Array.from(event.dataTransfer.files).find((item) => /\.(xlsx|xlsm|xls)$/i.test(item.name));
            setRegistroFile(file);
          }}
        >
          <label className="btn-secondary cursor-pointer">
            Seleccionar Excel
            <input
              type="file"
              accept=".xlsx,.xlsm,.xls"
              className="sr-only"
              disabled={disabled}
              onChange={(event) => setRegistroFile(event.target.files?.[0])}
            />
          </label>
          <motion.p
            key={registroFile?.name ?? "empty"}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 truncate text-sm font-medium text-ink"
          >
            {registroFile?.name ?? "Ningún Excel seleccionado"}
          </motion.p>
        </DropCard>

        <div className="min-w-0 rounded-[24px] border border-line bg-slate-50/80 p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-primary shadow-subtle">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-ink">Configuración rápida</h3>
              <p className="text-sm text-muted">Se guarda para próximos análisis.</p>
            </div>
          </div>

          <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="tolerance">
            Tolerancia EUR
            <input
              id="tolerance"
              type="number"
              min="0"
              step="0.5"
              value={settings.defaultTolerance}
              disabled={disabled}
              onChange={(event) => updateSettings({ defaultTolerance: Number(event.target.value) })}
              className="mt-2 h-12 w-full rounded-full border border-line bg-white px-4 text-sm font-medium text-ink shadow-subtle"
            />
          </label>

          <div className="mt-5 rounded-2xl bg-white p-4 shadow-subtle">
            <Toggle
              checked={settings.enableAIByDefault}
              onChange={(enableAIByDefault) => updateSettings({ enableAIByDefault })}
              label="Usar IA en observaciones"
              description="Gemini solo redacta observaciones si hay API key."
              disabled={disabled}
            />
          </div>

          <button type="button" onClick={analyze} disabled={!canAnalyze} className="btn-primary mt-5 w-full">
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileArchive className="h-4 w-4" aria-hidden="true" />}
            {analyzing ? "Analizando..." : "Analizar"}
          </button>
          <p className={cn("mt-3 text-sm leading-5 text-muted", analyzing && "animate-pulse")} aria-live="polite">
            {analyzing ? "Analizando nóminas..." : status}
          </p>
        </div>
      </div>
    </Card>
  );
}
