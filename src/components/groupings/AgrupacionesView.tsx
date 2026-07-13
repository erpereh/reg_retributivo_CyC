"use client";

import { Search, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAppState } from "@/components/app/AppState";
import { Card } from "@/components/common/Card";
import { DataTableShell } from "@/components/common/DataTableShell";
import type { GroupedExcelCell, GroupedExcelHeaderCell, GroupedExcelSheet } from "@/lib/types";
import { cn } from "@/lib/utils/classNames";
import { normalizeComparableText } from "@/lib/utils/normalize";

const GROUPED_SHEETS = [
  { fullName: "Análisis por puesto", shortLabel: "Puesto", idLabel: "Puesto ID", nameLabel: "Puesto" },
  { fullName: "Análisis por valoración puesto", shortLabel: "Valoración", idLabel: "Valoración ID", nameLabel: "Valoración" },
  { fullName: "Análisis por categoría", shortLabel: "Categoría", idLabel: "Categoría ID", nameLabel: "Categoría" },
  { fullName: "Análisis por familia de puesto", shortLabel: "Familia", idLabel: "Familia ID", nameLabel: "Familia" },
  { fullName: "Agrupación Categoría Personal", shortLabel: "Cat. personal", idLabel: "Agrupación ID", nameLabel: "Agrupación" },
] as const;

type GroupedSheetName = (typeof GROUPED_SHEETS)[number]["fullName"];

const MISSING_SHEET_MESSAGE = "No se ha encontrado esta hoja en el Excel Reg. Retrib.";
const EMPTY_SHEET_MESSAGE = "No hay datos visibles en esta hoja.";
const LEGACY_ANALYSIS_MESSAGE = "Este análisis no contiene datos de hojas agrupadas. Vuelve a analizar el Excel para visualizarlas.";
const TRUNCATED_HISTORY_MESSAGE = "Esta hoja se guardó parcialmente en Historial para mantener el rendimiento. Vuelve a analizar el Excel para ver todos los datos.";
const HEADER_ROW_HEIGHT = 36;
const SHEET_PANEL_ID = "agrupaciones-sheet-panel";

function sheetTabId(index: number): string {
  return `agrupaciones-sheet-tab-${index}`;
}

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

function splitHeaderLabel(label: string): string[] {
  return label
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isMetricHeader(label: string): boolean {
  const normalized = normalizeComparableText(label);
  return (
    normalized.includes("total personas") ||
    normalized.includes("retribucion") ||
    normalized.includes("registro retributivo") ||
    normalized.includes("mujeres") ||
    normalized.includes("varones") ||
    normalized.includes("diferencia")
  );
}

function sheetMetadata(sheetName: string) {
  return GROUPED_SHEETS.find((sheet) => sheet.fullName === sheetName);
}

function naturalFirstColumnLabel(sheet: GroupedExcelSheet, columnIndex: number): string | undefined {
  if (columnIndex > 1) return undefined;

  const metadata = sheetMetadata(sheet.sheetName);
  if (!metadata) return undefined;

  const current = sheet.columns[columnIndex]?.label ?? "";
  const previous = sheet.columns[columnIndex - 1]?.label ?? "";
  const next = sheet.columns[columnIndex + 1]?.label ?? "";
  const normalizedCurrent = normalizeComparableText(current);
  const normalizedPrevious = normalizeComparableText(previous);
  const normalizedNext = normalizeComparableText(next);

  if (columnIndex === 0) {
    if (normalizedCurrent.includes(" id") || normalizedCurrent.startsWith("id ") || normalizedCurrent === "id" || normalizedCurrent === normalizedNext) {
      return metadata.idLabel;
    }

    if (!isMetricHeader(current)) {
      return metadata.nameLabel;
    }
  }

  if (columnIndex === 1 && (normalizedCurrent === normalizedPrevious || !isMetricHeader(current))) {
    return metadata.nameLabel;
  }

  return undefined;
}

function rowMatchesQuery(row: GroupedExcelSheet["rows"][number], sheet: GroupedExcelSheet, query: string): boolean {
  if (!query) return true;
  const normalizedQuery = normalizeComparableText(query);
  return sheet.columns.some((column) => normalizeComparableText(cellDisplay(row[column.key])).includes(normalizedQuery));
}

function fallbackColumnPath(sheet: GroupedExcelSheet, columnIndex: number): string[] {
  const naturalLabel = naturalFirstColumnLabel(sheet, columnIndex);
  if (naturalLabel) return [naturalLabel];

  const label = sheet.columns[columnIndex]?.label ?? `Columna ${columnIndex + 1}`;
  const parts = splitHeaderLabel(label);
  return parts.length ? parts : [label];
}

function headerPartAtLevel(path: readonly string[], level: number, maxDepth: number): { label: string; rowSpan?: number; partIndex: number } | undefined {
  if (!path.length) return undefined;

  const leadingRowSpan = Math.max(1, maxDepth - path.length + 1);
  if (level === 0 && leadingRowSpan > 1) {
    return { label: path[0], rowSpan: leadingRowSpan, partIndex: 0 };
  }
  if (level > 0 && level < leadingRowSpan) {
    return undefined;
  }

  const partIndex = leadingRowSpan > 1 ? level - leadingRowSpan + 1 : level;
  const label = path[partIndex];
  return label ? { label, partIndex } : undefined;
}

function sameHeaderCell(pathA: readonly string[], pathB: readonly string[], partIndex: number, label: string): boolean {
  if (pathB[partIndex] !== label) return false;
  return pathA.slice(0, partIndex + 1).join("\u0000") === pathB.slice(0, partIndex + 1).join("\u0000");
}

function buildFallbackGroupedHeaders(sheet: GroupedExcelSheet): GroupedExcelHeaderCell[][] {
  if (!sheet.columns.length) return [];

  const paths = sheet.columns.map((_, index) => fallbackColumnPath(sheet, index));
  const maxDepth = Math.max(...paths.map((path) => path.length), 1);

  return Array.from({ length: maxDepth }, (_, level) => {
    const cells: GroupedExcelHeaderCell[] = [];
    let columnIndex = 0;
    while (columnIndex < sheet.columns.length) {
      const currentPath = paths[columnIndex];
      const current = headerPartAtLevel(currentPath, level, maxDepth);
      if (!current) {
        columnIndex += 1;
        continue;
      }

      let endColumn = columnIndex;
      while (endColumn + 1 < sheet.columns.length && sameHeaderCell(currentPath, paths[endColumn + 1], current.partIndex, current.label)) {
        endColumn += 1;
      }

      cells.push({
        label: current.label,
        colSpan: endColumn - columnIndex + 1,
        rowSpan: current.rowSpan,
        startColumn: columnIndex,
        endColumn,
        level,
        path:
          currentPath.length === 1 && columnIndex === endColumn
            ? sheet.columns[columnIndex]?.label || currentPath[0]
            : currentPath.slice(0, current.partIndex + 1).join(" > "),
      });
      columnIndex = endColumn + 1;
    }
    return cells;
  });
}

function groupedHeadersForSheet(sheet: GroupedExcelSheet): readonly (readonly GroupedExcelHeaderCell[])[] {
  return sheet.groupedHeaders?.length ? sheet.groupedHeaders : buildFallbackGroupedHeaders(sheet);
}

function displayHeaderLabel(cell: GroupedExcelHeaderCell): string {
  const normalized = normalizeComparableText(cell.label);
  if (normalized === "mujeres") return "Mujeres";
  if (normalized === "varones") return "Varones";
  if (normalized === "% mujeres") return "% Mujeres";
  if (normalized === "diferencia %") return "Diferencia %";
  if (normalized === "media") return "Media";
  if (normalized === "mediana") return "Mediana";
  if (cell.level === 0 && isMetricHeader(cell.label)) return cell.label.toLocaleUpperCase("es-ES");
  return cell.label;
}

function headerTone(cell: GroupedExcelHeaderCell): string {
  const normalized = normalizeComparableText(cell.label);
  if (normalized.includes("total personas")) return "bg-emerald-50 text-emerald-950";
  if (normalized.includes("total retribuciones normalizadas") && normalized.includes("variables")) return "bg-amber-50 text-amber-950";
  if (normalized.includes("retribuciones normalizadas")) return "bg-sky-50 text-sky-950";
  if (normalized.includes("periodo completo")) return "bg-slate-100 text-slate-800";
  if (cell.level === 0) return "bg-slate-100 text-slate-800";
  if (cell.level === 1) return "bg-slate-50 text-slate-700";
  return "bg-white text-slate-700";
}

function stickyIdentifierColumnCount(sheet: GroupedExcelSheet): number {
  return sheet.columns.slice(0, 2).filter((column) => !isMetricHeader(column.label)).length;
}

function stickyColumnClass(columnIndex: number, stickyCount: number): string {
  if (columnIndex === 0 && stickyCount >= 1) return "sticky left-0 z-30 min-w-[144px]";
  if (columnIndex === 1 && stickyCount >= 2) return "sticky left-[144px] z-30 min-w-[260px] shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]";
  return "min-w-[132px]";
}

function headerStickyColumnClass(cell: GroupedExcelHeaderCell, stickyCount: number): string {
  if (cell.startColumn === 0 && cell.colSpan === 1 && stickyCount >= 1) return "left-0 z-40 min-w-[144px]";
  if (cell.startColumn === 1 && cell.colSpan === 1 && stickyCount >= 2) return "left-[144px] z-40 min-w-[260px] shadow-[10px_0_16px_-16px_rgba(15,23,42,0.55)]";
  return "z-20 min-w-[132px]";
}

export function AgrupacionesView() {
  const { result, assistantNavigationIntent, consumeAssistantNavigationIntent } = useAppState();
  const groupedExcelSheets = result?.groupedExcelSheets;
  const [activeSheetName, setActiveSheetName] = useState<GroupedSheetName>(GROUPED_SHEETS[0].fullName);
  const [query, setQuery] = useState("");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (assistantNavigationIntent?.type !== "open_grouping" || !groupedExcelSheets) return;
    const target = groupedExcelSheets.find((sheet) => sheet.rows.some((row) => rowMatchesQuery(row, sheet, assistantNavigationIntent.groupingId)));
    if (target && GROUPED_SHEETS.some((sheet) => sheet.fullName === target.sheetName)) setActiveSheetName(target.sheetName as GroupedSheetName);
    setQuery(assistantNavigationIntent.groupingId);
    consumeAssistantNavigationIntent();
  }, [assistantNavigationIntent, consumeAssistantNavigationIntent, groupedExcelSheets]);

  const activeSheet = useMemo(() => {
    return groupedExcelSheets?.find((sheet) => sheet.sheetName === activeSheetName) ?? placeholderSheet(activeSheetName);
  }, [activeSheetName, groupedExcelSheets]);

  const visibleRows = useMemo(() => activeSheet.rows.filter((row) => rowMatchesQuery(row, activeSheet, query)), [activeSheet, query]);
  const activeGroupedHeaders = useMemo(() => groupedHeadersForSheet(activeSheet), [activeSheet]);
  const stickyColumnCount = useMemo(() => stickyIdentifierColumnCount(activeSheet), [activeSheet]);
  const activeSheetIndex = GROUPED_SHEETS.findIndex((sheet) => sheet.fullName === activeSheetName);

  const selectSheetAt = (index: number) => {
    const sheet = GROUPED_SHEETS[index];
    if (!sheet) return;
    setActiveSheetName(sheet.fullName);
    setQuery("");
    tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % GROUPED_SHEETS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + GROUPED_SHEETS.length) % GROUPED_SHEETS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = GROUPED_SHEETS.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectSheetAt(nextIndex);
  };

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
    <div>

      <DataTableShell
        toolbar={
          <div className="flex flex-col gap-4">
            <div className="no-scrollbar max-w-full overflow-x-auto pb-1">
              <div role="tablist" aria-label="Vistas de Agrupaciones" data-layout="fit-content" className="flex w-max min-w-max gap-1 rounded-2xl bg-slate-100 p-1">
                {GROUPED_SHEETS.map(({ fullName, shortLabel }, index) => (
                  <button
                    key={fullName}
                    ref={(node) => {
                      tabRefs.current[index] = node;
                    }}
                    type="button"
                    id={sheetTabId(index)}
                    role="tab"
                    aria-selected={activeSheetName === fullName}
                    aria-controls={SHEET_PANEL_ID}
                    tabIndex={activeSheetName === fullName ? 0 : -1}
                    title={fullName}
                    onClick={() => selectSheetAt(index)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                    className={cn(
                      "min-h-10 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition-colors",
                      activeSheetName === fullName ? "bg-white text-ink shadow-subtle" : "text-muted hover:text-ink",
                    )}
                  >
                    {shortLabel}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] lg:items-end">
              <div>
                <p
                  className="text-sm font-semibold text-ink"
                  aria-label={`${activeSheet.sheetName} · ${visibleRows.length} filas · ${activeSheet.visibleColumnCount} columnas`}
                >
                  {activeSheet.sheetName} · <span className="tabular-nums">{visibleRows.length} filas</span> · <span className="tabular-nums">{activeSheet.visibleColumnCount} columnas</span>
                </p>
                {activeSheet.truncated ? <p className="mt-2 text-sm font-semibold leading-6 text-amber-800">{TRUNCATED_HISTORY_MESSAGE}</p> : null}
              </div>
              <label className="text-sm font-semibold text-ink">
                Buscar en esta hoja
                <span className="relative mt-2 block">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                  <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en esta hoja" className="filter-control pl-11" />
                </span>
              </label>
            </div>
          </div>
        }
      >
        <div role="tabpanel" id={SHEET_PANEL_ID} aria-labelledby={sheetTabId(activeSheetIndex)}>
          {sheetMessage(activeSheet) ? (
            <p className="p-6 text-sm font-semibold text-muted">{sheetMessage(activeSheet)}</p>
          ) : (
            <>
            <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-left text-sm">
              <thead className="text-muted shadow-subtle">
                {activeGroupedHeaders.map((headerRow, rowIndex) => (
                  <tr key={`header-row-${rowIndex}`} style={{ height: HEADER_ROW_HEIGHT }}>
                    {headerRow.map((headerCell) => (
                      <th
                        key={`${headerCell.level}-${headerCell.startColumn}-${headerCell.endColumn}-${headerCell.label}`}
                        title={headerCell.path || headerCell.label}
                        aria-label={displayHeaderLabel(headerCell)}
                        colSpan={headerCell.colSpan}
                        rowSpan={headerCell.rowSpan}
                        className={cn(
                          "sticky border-b border-r border-line px-3 py-2 text-center text-[11px] font-semibold uppercase leading-4",
                          headerTone(headerCell),
                          headerStickyColumnClass(headerCell, stickyColumnCount),
                        )}
                        style={{ top: headerCell.level * HEADER_ROW_HEIGHT }}
                      >
                        {displayHeaderLabel(headerCell)}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {visibleRows.map((row, rowIndex) => (
                  <tr key={`${activeSheet.sheetName}-${rowIndex}`} className="odd:bg-white even:bg-slate-50">
                    {activeSheet.columns.map((column, columnIndex) => {
                      const cell = row[column.key];
                      return (
                        <td
                          key={`${rowIndex}-${column.key}`}
                          className={cn(
                            "border-b border-line/70 bg-inherit px-4 py-3 align-top",
                            isNumericCell(cell) ? "text-right font-mono tabular-nums" : "text-left",
                            stickyColumnClass(columnIndex, stickyColumnCount),
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
            </>
          )}
        </div>
      </DataTableShell>
    </div>
  );
}
