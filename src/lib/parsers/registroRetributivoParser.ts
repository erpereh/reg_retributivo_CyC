import * as XLSX from "xlsx";
import type { RegistroRecord } from "@/lib/types";
import { parseSpanishMoney, roundMoney } from "@/lib/utils/money";
import { normalizeComparableText, normalizeEmployeeNumber, normalizeNif } from "@/lib/utils/normalize";
import { toIsoDate } from "@/lib/utils/spanishDates";

export interface RegistroColumnMap {
  readonly salary: readonly string[];
  readonly gt: readonly string[];
  readonly workplace: readonly string[];
  readonly professionalGroup: readonly string[];
  readonly employeeNumber?: string;
  readonly nif?: string;
  readonly workerName?: string;
  readonly seniorityDate?: string;
}

export interface RegistroParseResult {
  readonly sheetName: string;
  readonly headerRows: { readonly group: number; readonly subheader: number; readonly firstData: number };
  readonly columnMap: RegistroColumnMap;
  readonly records: readonly RegistroRecord[];
  readonly warnings: readonly string[];
}

function colLetter(index: number): string {
  return XLSX.utils.encode_col(index);
}

function cell(rows: readonly unknown[][], row: number, col: number): unknown {
  return rows[row]?.[col];
}

function resolveMergedValue(sheet: XLSX.WorkSheet, rowIndex: number, colIndex: number): unknown {
  const merges = sheet["!merges"] ?? [];
  for (const range of merges) {
    if (range.s.r <= rowIndex && rowIndex <= range.e.r && range.s.c <= colIndex && colIndex <= range.e.c) {
      return cell(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: undefined, blankrows: true }) as unknown[][], range.s.r, range.s.c);
    }
  }

  return undefined;
}

function combinedHeader(sheet: XLSX.WorkSheet, rows: readonly unknown[][], col: number, groupRowIndex: number, subheaderRowIndex: number): string {
  const group = cell(rows, groupRowIndex, col) ?? resolveMergedValue(sheet, groupRowIndex, col) ?? "";
  const sub = cell(rows, subheaderRowIndex, col) ?? "";
  return normalizeComparableText(`${group} ${sub}`);
}

function findByHeader(headers: readonly string[], patterns: readonly RegExp[]): number | undefined {
  return headers.findIndex((header) => patterns.every((pattern) => pattern.test(header)));
}

function valueAt(row: readonly unknown[], letter?: string): unknown {
  if (!letter) {
    return undefined;
  }

  return row[XLSX.utils.decode_col(letter)];
}

export async function parseRegistroRetributivo(input: Buffer | ArrayBuffer | Uint8Array): Promise<RegistroParseResult> {
  const workbook = XLSX.read(input, {
    type: "buffer",
    cellDates: true,
    raw: true,
  });
  const sheetName = workbook.SheetNames.find((name) => normalizeComparableText(name) === "empleados") ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error("No se encontro ninguna hoja legible en el Registro Retributivo.");
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: undefined, blankrows: true }) as unknown[][];
  const groupRowIndex = rows.findIndex((row) =>
    row.some((value) => normalizeComparableText(value).includes("total retribuciones")),
  );
  if (groupRowIndex < 0) {
    throw new Error("No se encontro la cabecera agrupada del Registro Retributivo.");
  }
  const subheaderRowIndex = groupRowIndex + 1;
  const firstDataRowIndex = subheaderRowIndex + 1;
  const maxCols = Math.max(...rows.map((row) => row.length));
  const headers = Array.from({ length: maxCols }, (_, col) => combinedHeader(sheet, rows, col, groupRowIndex, subheaderRowIndex));

  const salaryCols = [5, 6, 7].filter((col) => headers[col]?.includes("total retribuciones"));
  const nifIndex = findByHeader(headers, [/(nif|dni|documento)/]) ?? -1;
  const nameIndex = headers.findIndex((header) => /\b(nombre|trabajador|persona)\b/.test(header));
  const employeeIndex = findByHeader(headers, [/(id rh|matricula|cod empleado)/]) ?? 0;
  const seniorityIndex = headers.findIndex((header) => header.includes("informacion adicional del empleado antiguedad"));
  const gtCols = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header.includes("grupo de cotizacion") && !header.endsWith(" inicio"))
    .map(({ index }) => index);
  const professionalCols = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => (header.includes("categoria id categoria") || header === "categoria categoria") && !header.endsWith(" inicio"))
    .map(({ index }) => index);
  const workplaceCols = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header.includes("centro de trabajo") && !header.endsWith(" inicio"))
    .map(({ index }) => index);

  const columnMap: RegistroColumnMap = {
    salary: salaryCols.map(colLetter),
    gt: gtCols.map(colLetter),
    workplace: workplaceCols.map(colLetter),
    professionalGroup: professionalCols.map(colLetter),
    employeeNumber: colLetter(employeeIndex),
    nif: nifIndex >= 0 ? colLetter(nifIndex) : undefined,
    workerName: nameIndex >= 0 ? colLetter(nameIndex) : undefined,
    seniorityDate: seniorityIndex >= 0 ? colLetter(seniorityIndex) : undefined,
  };

  const warnings: string[] = [];
  if (!columnMap.salary.length) {
    warnings.push("No se detectaron columnas salariales principales en TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES.");
  }
  if (!columnMap.nif) {
    warnings.push("No se detecto columna NIF/DNI en el Registro; se usara matricula/ID RH como fallback.");
  }

  const records: RegistroRecord[] = [];
  for (let rowIndex = firstDataRowIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const employeeNumber = normalizeEmployeeNumber(valueAt(row, columnMap.employeeNumber));
    if (!employeeNumber) {
      continue;
    }

    const salaryParts = columnMap.salary
      .map((letter) => parseSpanishMoney(valueAt(row, letter)))
      .filter((value): value is number => value !== undefined);
    const expectedSalary = salaryParts.length ? roundMoney(salaryParts.reduce((sum, value) => sum + value, 0)) : undefined;
    const nif = normalizeNif(valueAt(row, columnMap.nif));

    records.push({
      sourceRow: rowIndex + 1,
      workerNif: nif || employeeNumber,
      workerName: String(valueAt(row, columnMap.workerName) ?? "").trim() || undefined,
      employeeNumber,
      workplace: String(valueAt(row, columnMap.workplace[1] ?? columnMap.workplace[0]) ?? "").trim() || undefined,
      professionalGroup: String(valueAt(row, columnMap.professionalGroup[1] ?? columnMap.professionalGroup[0]) ?? "").trim() || undefined,
      gt: String(valueAt(row, columnMap.gt[1] ?? columnMap.gt[0]) ?? "").trim() || undefined,
      seniorityDate: toIsoDate(valueAt(row, columnMap.seniorityDate)),
      expectedSalary,
      expectedNormalizedSalary: expectedSalary,
      expectedVariableSalary: parseSpanishMoney(valueAt(row, "L")),
      expectedSalaryCriterion: "Suma de TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES: Salario + C. Salarial + Extrasalarial.",
      raw: Object.fromEntries(
        headers.map((header, index) => [header || colLetter(index), row[index]]).filter(([, value]) => value !== undefined),
      ),
    });
  }

  return {
    sheetName,
    headerRows: { group: 11, subheader: 12, firstData: 13 },
    columnMap,
    records,
    warnings,
  };
}
