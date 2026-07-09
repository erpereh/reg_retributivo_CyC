"use client";

import { Search, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "@/components/app/AppState";
import { Card } from "@/components/common/Card";
import type { GroupedExcelCell, GroupedExcelSheet } from "@/lib/types";
import { cn } from "@/lib/utils/classNames";
import { normalizeComparableText } from "@/lib/utils/normalize";

const GROUPED_SHEET_NAMES = [
  "Análisis por puesto",
  "Análisis por valoración puesto",
  "Análisis por categoría",
  "Análisis por familia de puesto",
  "Agrupación Categoría Personal",
] as const;

const MISSING_SHEET_MESSAGE = "No se ha encontrado esta hoja en el Excel Reg. Retrib.";
const EMPTY_SHEET_MESSAGE = "No hay datos visibles en esta hoja.";
const LEGACY_ANALYSIS_MESSAGE = "Este análisis no contiene datos de hojas agrupadas. Vuelve a analizar el Excel para visualizarlas.";
const TRUNCATED_HISTORY_MESSAGE = "Esta hoja se guardó parcialmente en Historial para mantener el rendimiento. Vuelve a analizar el Excel para ver todos los datos.";

function placeholderSheet(sheetName: string): GroupedExcelSheet {
  return {
    sheetName,
    status: "missing",
    columns: [],
    rows: [],
    visibleRowCount: 0,
    visibleColumnCount: 0,
  };
}

function sheetMessage(sheet: GroupedExcelSheet): string | undefined {
  if (sheet.status === "missing") return MISSING_SHEET_MESSAGE;
  if (sheet.status === "empty") return EMPTY_SHEET_MESSAGE;
  return undefined;
}

function cellDisplay(cell: GroupedExcelCell | undefined): string {
  return cell?.display?.trim() || "—";
}

function isNumericCell(cell: GroupedExcelCell | undefined): boolean {
  return cell?.kind === "number" || cell?.kind === "percent";
}

function rowMatchesQuery(row: GroupedExcelSheet["rows"][number], sheet: GroupedExcelSheet, query: string): boolean {
  if (!query) return true;
  const normalizedQuery = normalizeComparableText(query);
  return sheet.columns.some((column) => normalizeComparableText(cellDisplay(row[column.key])).includes(normalizedQuery));
}

export function AgrupacionesView() {
  const { result } = useAppState();
  const groupedExcelSheets = result?.groupedExcelSheets;
  const [activeSheetName, setActiveSheetName] = useState<(typeof GROUPED_SHEET_NAMES)[number]>(GROUPED_SHEET_NAMES[0]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setQuery("");
  }, [activeSheetName]);

  const activeSheet = useMemo(() => {
    return groupedExcelSheets?.find((sheet) => sheet.sheetName === activeSheetName) ?? placeholderSheet(activeSheetName);
  }, [activeSheetName, groupedExcelSheets]);

  const visibleRows = useMemo(() => activeSheet.rows.filter((row) => rowMatchesQuery(row, activeSheet, query)), [activeSheet, query]);

  if (!groupedExcelSheets) {
    return (
      <Card className="p-8 text-center">
        <div className="mx-auto flex max-w-xl flex-col items-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-primary">
            <Table2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-xl font-semibold text-ink">Agrupaciones</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{LEGACY_ANALYSIS_MESSAGE}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max gap-2">
          {GROUPED_SHEET_NAMES.map((sheetName) => (
            <button
              key={sheetName}
              type="button"
              onClick={() => setActiveSheetName(sheetName)}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                activeSheetName === sheetName ? "bg-primary text-white shadow-subtle" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
            >
              {sheetName}
            </button>
          ))}
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        {[
          ["Hoja", activeSheet.sheetName],
          ["Filas visibles", visibleRows.length],
          ["Columnas visibles", activeSheet.visibleColumnCount],
        ].map(([label, value]) => (
          <Card key={label} className="min-h-[84px] p-4">
            <p className="text-xs font-semibold uppercase text-muted">{label}</p>
            <p className="mt-2 text-lg font-semibold text-ink tabular-nums">{value}</p>
          </Card>
        ))}
      </section>

      {activeSheet.truncated ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">{TRUNCATED_HISTORY_MESSAGE}</div>
      ) : null}

      <Card className="p-5">
        <label className="text-sm font-semibold text-ink">
          Buscar en esta hoja
          <span className="relative mt-2 block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar en esta hoja"
              className="filter-control pl-11"
            />
          </span>
        </label>
      </Card>

      <Card className="overflow-hidden p-0">
        {sheetMessage(activeSheet) ? (
          <p className="p-6 text-sm font-semibold text-muted">{sheetMessage(activeSheet)}</p>
        ) : (
          <div className="max-h-[70dvh] overflow-auto">
            <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-20 bg-slate-100 text-muted shadow-subtle">
                <tr>
                  {activeSheet.columns.map((column) => (
                    <th key={column.key} className="min-w-[160px] border-b border-line px-4 py-3 text-xs font-semibold uppercase">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, rowIndex) => (
                  <tr key={`${activeSheet.sheetName}-${rowIndex}`} className="odd:bg-white even:bg-slate-50">
                    {activeSheet.columns.map((column) => {
                      const cell = row[column.key];
                      return (
                        <td
                          key={`${rowIndex}-${column.key}`}
                          className={cn(
                            "border-b border-line/70 px-4 py-3 align-top",
                            isNumericCell(cell) ? "text-right font-mono tabular-nums" : "text-left",
                          )}
                        >
                          {cellDisplay(cell)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleRows.length ? <p className="p-6 text-sm text-muted">No hay filas con la búsqueda actual.</p> : null}
          </div>
        )}
      </Card>
    </div>
  );
}
