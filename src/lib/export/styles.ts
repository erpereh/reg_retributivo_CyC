import type ExcelJS from "exceljs";

export const COLORS = {
  header: "0F172A",
  white: "FFFFFF",
  line: "CBD5E1",
  successBg: "DCFCE7",
  successText: "15803D",
  warningBg: "FFEDD5",
  warningText: "C2410C",
  dangerBg: "FEE2E2",
  dangerText: "B91C1C",
  infoBg: "DBEAFE",
  infoText: "1D4ED8",
} as const;

export function styleTitle(cell: ExcelJS.Cell): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.header}` } };
  cell.font = { bold: true, color: { argb: `FF${COLORS.white}` }, size: 16 };
  cell.alignment = { vertical: "middle" };
}

export function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 34;
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.header}` } };
    cell.font = { bold: true, color: { argb: `FF${COLORS.white}` }, size: 10 };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: `FF${COLORS.line}` } },
      bottom: { style: "thin", color: { argb: `FF${COLORS.line}` } },
    };
  });
}

export function styleBodyRows(sheet: ExcelJS.Worksheet): void {
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        bottom: { style: "hair", color: { argb: `FF${COLORS.line}` } },
      };
    });
  });
}

export function applyStatusStyle(cell: ExcelJS.Cell, value: unknown): void {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("alta") || text.includes("incidencia") || text.includes("falta") || text.includes("diferencia")) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.dangerBg}` } };
    cell.font = { bold: true, color: { argb: `FF${COLORS.dangerText}` } };
  } else if (text.includes("media") || text.includes("revisar")) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.warningBg}` } };
    cell.font = { bold: true, color: { argb: `FF${COLORS.warningText}` } };
  } else if (text.includes("ok")) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.successBg}` } };
    cell.font = { bold: true, color: { argb: `FF${COLORS.successText}` } };
  } else if (text.includes("baja") || text.includes("sin ")) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.infoBg}` } };
    cell.font = { bold: true, color: { argb: `FF${COLORS.infoText}` } };
  }
}
