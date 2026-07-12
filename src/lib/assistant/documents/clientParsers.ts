import type { PayrollConcept, PayrollRecord } from "@/lib/types";

export type AssistantMediaType = "pdf" | "xlsx" | "docx" | "csv" | "txt" | "markdown";

export interface ExtractedDocument {
  readonly mediaType: AssistantMediaType;
  readonly units: readonly unknown[];
  readonly nonIndexableReason?: "scanned_without_text" | "empty_document";
}

export interface CsvCell { readonly address: string; readonly rawValue: string; readonly formattedValue: string }
export interface CsvRow { readonly row: number; readonly cells: readonly CsvCell[] }
export interface CsvUnit { readonly kind: "csv"; readonly rows: readonly CsvRow[] }

export interface ReceiptConceptUnit {
  readonly code?: string; readonly description: string; readonly units?: number; readonly price?: number;
  readonly amount: number; readonly section: string;
}
export interface ReceiptPageUnit {
  readonly kind: "receipt_page"; readonly page: number; readonly employeeNumber?: string; readonly period?: string;
  readonly company?: string; readonly workplace?: string; readonly position?: string; readonly category?: string;
  readonly professionalGroup?: string; readonly dates: Readonly<Record<string, unknown>>; readonly lines: readonly Readonly<Record<string, unknown>>[];
  readonly blocks: readonly Readonly<Record<string, unknown>>[]; readonly concepts: readonly ReceiptConceptUnit[];
  readonly earnings: readonly ReceiptConceptUnit[]; readonly deductions: readonly ReceiptConceptUnit[];
  readonly bases: Readonly<Record<string, unknown>>; readonly totals: Readonly<Record<string, unknown>>;
  readonly coordinates?: readonly unknown[]; readonly text: string; readonly safeOrigin: { readonly sanitizedSourceLabel: string; readonly page: number };
}
export interface RegistroCellUnit {
  readonly address: string; readonly row: number; readonly column: number; readonly rawValue: unknown;
  readonly formattedValue: string; readonly formula?: string; readonly cachedResult?: unknown;
  readonly relations: readonly { readonly type: "merge"; readonly range: string }[];
}
export interface RegistroSheetUnit { readonly name: string; readonly headers: readonly RegistroCellUnit[]; readonly cells: readonly RegistroCellUnit[]; readonly merges: readonly string[] }
export interface RegistroWorkbookUnit { readonly kind: "registro_workbook"; readonly sheets: readonly RegistroSheetUnit[] }

function columnLetter(index: number): string {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function detectDelimiter(input: string): string {
  const firstRecord = input.split(/\r?\n/u, 1)[0] ?? "";
  return [";", ",", "\t"].map((delimiter) => ({ delimiter, count: firstRecord.split(delimiter).length })).sort((a, b) => b.count - a.count)[0]?.delimiter ?? ";";
}

export function parseCsvText(input: string): CsvUnit {
  const delimiter = detectDelimiter(input);
  const records: string[][] = [[]];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? "";
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      records.at(-1)!.push(value); value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      records.at(-1)!.push(value); value = "";
      records.push([]);
    } else value += character;
  }
  records.at(-1)!.push(value);
  if (records.at(-1)?.length === 1 && records.at(-1)?.[0] === "") records.pop();
  return {
    kind: "csv",
    rows: records.map((record, rowIndex) => ({
      row: rowIndex + 1,
      cells: record.map((cell, columnIndex) => ({ address: `${columnLetter(columnIndex)}${rowIndex + 1}`, rawValue: cell, formattedValue: cell })),
    })),
  };
}

interface DocxExtractionResult { readonly value: string; readonly messages: readonly unknown[] }
type DocxExtractor = (input: { readonly arrayBuffer: ArrayBuffer }) => Promise<DocxExtractionResult>;

export async function parseDocxBuffer(input: ArrayBuffer, extractor?: DocxExtractor): Promise<Record<string, unknown>> {
  const extract = extractor ?? (async (request) => {
    const mammoth = await import("mammoth");
    return mammoth.extractRawText(request);
  });
  const result = await extract({ arrayBuffer: input });
  const text = result.value.replace(/\r\n?/gu, "\n").trim();
  const paragraphs = text.split(/\n+/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  return {
    kind: "docx",
    paragraphs: paragraphs.map((paragraph, index) => ({ paragraph: index + 1, text: paragraph })),
    blocks: text.split(/\n\s*\n/u).map((block) => block.trim()).filter(Boolean),
    text,
  };
}

function parseSpanishNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function conceptDetail(concept: PayrollConcept, text: string): ReceiptConceptUnit {
  const firstLine = text.split(/\r?\n/u).find((line) => line.includes(concept.name)) ?? concept.name;
  const numbers = firstLine.match(/-?\d{1,3}(?:\.\d{3})*(?:,\d{2})/gu)?.map(parseSpanishNumber).filter((value): value is number => value !== undefined) ?? [];
  const codeMatch = /^(\d{2,5})\s+(.+)$/u.exec(concept.name.trim());
  return {
    code: codeMatch?.[1], description: codeMatch?.[2] ?? concept.name,
    units: numbers.length >= 3 ? numbers.at(-3) : undefined,
    price: numbers.length >= 2 ? numbers.at(-2) : undefined,
    amount: concept.amount,
    section: concept.type === "devengo" ? "earnings" : concept.type === "deduccion" || concept.type === "retencion" || concept.type === "cotizacion" ? "deductions" : concept.type,
  };
}

export function buildReceiptPageUnit(input: {
  readonly page: number; readonly text: string; readonly record?: PayrollRecord; readonly sanitizedSourceLabel: string;
  readonly position?: string; readonly coordinates?: readonly unknown[];
}): ReceiptPageUnit {
  const lines = input.text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const record = input.record;
  return {
    kind: "receipt_page", page: input.page, employeeNumber: record?.employeeNumber, period: record?.periodLabel,
    company: record?.companyName, workplace: record?.workplace, ...(input.position ? { position: input.position } : {}), category: record?.professionalGroup,
    professionalGroup: record?.professionalGroup, dates: { periodStart: record?.periodStart, periodEnd: record?.periodEnd, seniority: record?.seniorityDate },
    lines: lines.map((text, index) => ({ line: index + 1, text })),
    blocks: lines.map((text, index) => ({ block: index + 1, lineRange: `${index + 1}-${index + 1}`, text })),
    concepts: record?.concepts.map((concept) => conceptDetail(concept, input.text)) ?? [],
    earnings: record?.concepts.filter((concept) => concept.type === "devengo").map((concept) => conceptDetail(concept, input.text)) ?? [],
    deductions: record?.concepts.filter((concept) => ["deduccion", "retencion", "cotizacion"].includes(concept.type)).map((concept) => conceptDetail(concept, input.text)) ?? [],
    bases: { irpfAccumulated: record?.irpfBaseAccumulated, irpfFeeAccumulated: record?.irpfFeeAccumulated, socialSecurityAccumulated: record?.ssFeeAccumulated },
    totals: { earnings: record?.totalDevengado, deductions: record?.totalDeducir, net: record?.netPay },
    ...(input.coordinates?.length ? { coordinates: input.coordinates } : {}), text: input.text,
    safeOrigin: { sanitizedSourceLabel: input.sanitizedSourceLabel, page: input.page },
  };
}

export async function parseRegistroWorkbook(input: ArrayBuffer | Uint8Array): Promise<RegistroWorkbookUnit> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(input, { type: "array", raw: true, cellFormula: true, cellText: true, cellStyles: true });
  return {
    kind: "registro_workbook",
    sheets: workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name]!;
      const merges = (sheet["!merges"] ?? []).map((range) => XLSX.utils.encode_range(range));
      const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : undefined;
      const cells: RegistroCellUnit[] = [];
      if (range) {
        for (let row = range.s.r; row <= range.e.r; row += 1) for (let column = range.s.c; column <= range.e.c; column += 1) {
          const address = XLSX.utils.encode_cell({ r: row, c: column });
          const cell = sheet[address];
          if (!cell) continue;
          const relations = merges.filter((merge) => {
            const decoded = XLSX.utils.decode_range(merge);
            return row >= decoded.s.r && row <= decoded.e.r && column >= decoded.s.c && column <= decoded.e.c;
          }).map((merge) => ({ type: "merge" as const, range: merge }));
          cells.push({ address, row: row + 1, column: column + 1, rawValue: cell.v, formattedValue: cell.w ?? String(cell.v ?? ""), formula: cell.f, cachedResult: cell.f ? cell.v : undefined, relations });
        }
      }
      return { name, headers: cells.filter((cell) => cell.row === 1), cells, merges };
    }),
  };
}

async function parsePdf(file: File, sanitizedSourceLabel: string): Promise<ExtractedDocument> {
  const [{ extractText }, { parsePayrollPdf }] = await Promise.all([import("unpdf"), import("@/lib/parsers/payrollPdfParser")]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extracted = await extractText(bytes, { mergePages: false });
  const pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  if (!pages.some((page) => page.trim())) return { mediaType: "pdf", units: [], nonIndexableReason: "scanned_without_text" };
  const payroll = await parsePayrollPdf(bytes, sanitizedSourceLabel);
  return { mediaType: "pdf", units: pages.map((text, index) => buildReceiptPageUnit({ page: index + 1, text, record: payroll.records.find((record) => record.pageNumber === index + 1), sanitizedSourceLabel })) };
}

export async function parseClientDocument(file: File, mediaType: AssistantMediaType, sanitizedSourceLabel = "Documento adicional"): Promise<ExtractedDocument> {
  if (mediaType === "txt" || mediaType === "markdown" || mediaType === "csv") {
    const text = await file.text();
    if (!text.trim()) return { mediaType, units: [], nonIndexableReason: "empty_document" };
    if (mediaType === "csv") return { mediaType, units: [parseCsvText(text)] };
    const lines = text.split(/\r?\n/u);
    return mediaType === "txt"
      ? { mediaType, units: [{ kind: "text", lines, lineRange: `1-${lines.length}`, text }] }
      : { mediaType, units: [{ kind: "markdown", blocks: text.split(/\r?\n\s*\r?\n/u).filter(Boolean), text }] };
  }
  if (mediaType === "xlsx") return { mediaType, units: [await parseRegistroWorkbook(await file.arrayBuffer())] };
  if (mediaType === "pdf") return parsePdf(file, sanitizedSourceLabel);
  if (mediaType === "docx") {
    const unit = await parseDocxBuffer(await file.arrayBuffer());
    return String(unit.text ?? "").trim() ? { mediaType, units: [unit] } : { mediaType, units: [], nonIndexableReason: "empty_document" };
  }
  throw new Error("Formato documental no compatible.");
}
