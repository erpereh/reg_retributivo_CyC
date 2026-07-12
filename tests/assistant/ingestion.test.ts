import * as XLSX from "xlsx";
import { describe, expect, test, vi } from "vitest";
import { chunkSanitizedUnits } from "@/lib/assistant/documents/chunker";
import {
  buildReceiptPageUnit,
  parseClientDocument,
  parseCsvText,
  parseDocxBuffer,
  parseRegistroWorkbook,
} from "@/lib/assistant/documents/clientParsers";
import { AssistantIngestionService, preserveAnalysisResultWhenIngestionFails, startAnalysisDocumentIngestion } from "@/lib/assistant/documents/ingestionService";
import { DirectIndexExecutor } from "@/lib/assistant/search/directIndex";
import type { SanitizedValue } from "@/lib/assistant/privacy/sanitize";
import { IDBFactory } from "fake-indexeddb";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";

describe("client document parsers", () => {
  test("extracts TXT and Markdown locally as ordered line/block units", async () => {
    const txt = await parseClientDocument(new File(["Línea 1\nLínea 2"], "privado.txt", { type: "text/plain" }), "txt");
    const md = await parseClientDocument(new File(["# Título\n\nTexto"], "privado.md", { type: "text/markdown" }), "markdown");
    expect(txt.units).toEqual([expect.objectContaining({ kind: "text", lines: ["Línea 1", "Línea 2"], lineRange: "1-2" })]);
    expect(md.units).toEqual([expect.objectContaining({ kind: "markdown", blocks: ["# Título", "Texto"] })]);
    expect(JSON.stringify(txt)).not.toContain("privado.txt");
    expect(JSON.stringify(md)).not.toContain("privado.md");
  });

  test("parses quoted CSV into complete cells without losing delimiters or line breaks", () => {
    const csv = parseCsvText('Código;Descripción;Importe\nA1;"Transporte; urbano";20,50\nA2;"Dos\nlíneas";-4,00');
    expect(csv.rows).toHaveLength(3);
    expect(csv.rows[1]?.cells[1]).toEqual(expect.objectContaining({ address: "B2", rawValue: "Transporte; urbano", formattedValue: "Transporte; urbano" }));
    expect(csv.rows[2]?.cells[1]?.rawValue).toBe("Dos\nlíneas");
  });

  test("extracts DOCX locally into ordered structured paragraphs without retaining Office metadata", async () => {
    const parsed = await parseDocxBuffer(new ArrayBuffer(0), async () => ({ value: "Título\n\nPrimer párrafo\nSegundo párrafo", messages: [{ type: "warning", message: "private author" }] }));
    expect(parsed).toEqual({ kind: "docx", paragraphs: [
      { paragraph: 1, text: "Título" },
      { paragraph: 2, text: "Primer párrafo" },
      { paragraph: 3, text: "Segundo párrafo" },
    ], blocks: ["Título", "Primer párrafo\nSegundo párrafo"], text: "Título\n\nPrimer párrafo\nSegundo párrafo" });
    expect(JSON.stringify(parsed)).not.toContain("private author");
  });

  test("builds a complete receipt page unit with safe origin and payroll semantics", () => {
    const unit = buildReceiptPageUnit({
      page: 2,
      text: "001 Transporte 1,00 25,00 25,00\nTOTAL DEVENGADO 25,00\nTOTAL DEDUCCIONES 4,00",
      record: {
        sourceFile: "Recibo matrícula 10048 · enero",
        pageNumber: 2,
        periodLabel: "enero 2026",
        employeeNumber: "10048",
        workerName: "Ana García López",
        concepts: [{ name: "001 Transporte", amount: 25, type: "devengo" }],
        totalDevengado: 25,
        totalDeducir: 4,
        netPay: 21,
        irpfBaseAccumulated: 25,
      },
      sanitizedSourceLabel: "Recibo matrícula 10048 · enero",
    });
    expect(unit).toEqual(expect.objectContaining({
      kind: "receipt_page", page: 2, employeeNumber: "10048", period: "enero 2026",
      safeOrigin: { sanitizedSourceLabel: "Recibo matrícula 10048 · enero", page: 2 },
      totals: { earnings: 25, deductions: 4, net: 21 },
      bases: expect.objectContaining({ irpfAccumulated: 25 }),
      lines: expect.any(Array), blocks: expect.any(Array),
    }));
    expect(unit.concepts[0]).toEqual(expect.objectContaining({ code: "001", description: "Transporte", units: 1, price: 25, amount: 25, section: "earnings" }));
    expect(unit).not.toHaveProperty("position");
    expect(unit).not.toHaveProperty("coordinates");
  });

  test("includes position and coordinates only when the current parser exposes them", () => {
    const unit = buildReceiptPageUnit({
      page: 1,
      text: "Texto",
      sanitizedSourceLabel: "Recibo 1",
      position: "Técnico",
      coordinates: [{ x: 10, y: 20 }],
    });
    expect(unit).toEqual(expect.objectContaining({ position: "Técnico", coordinates: [{ x: 10, y: 20 }] }));
  });

  test("walks every Registro sheet/cell including formatted values, formulas, cached results, relations and merges", async () => {
    const workbook = XLSX.utils.book_new();
    const employees = XLSX.utils.aoa_to_sheet([["ID RH", "Importe"], ["10048", 25]]);
    employees.C1 = { t: "n", f: "SUM(B2:B2)", v: 25, w: "25,00 €" };
    employees["!ref"] = "A1:C2";
    employees["!merges"] = [XLSX.utils.decode_range("A1:B1")];
    XLSX.utils.book_append_sheet(workbook, employees, "Empleados");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Grupo", "Total"], ["A", 25]]), "Agrupación");
    const parsed = await parseRegistroWorkbook(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(["Empleados", "Agrupación"]);
    expect(parsed.sheets[0]?.cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: "C1", rawValue: 25, formattedValue: expect.any(String), formula: "SUM(B2:B2)", cachedResult: 25, row: 1, column: 3 }),
    ]));
    expect(parsed.sheets[0]?.merges).toEqual(["A1:B1"]);
    expect(parsed.sheets[0]?.cells[0]?.relations).toEqual(expect.arrayContaining([expect.objectContaining({ type: "merge", range: "A1:B1" })]));
  });
});

describe("strict local-first ingestion", () => {
  test("runs extraction → PII → anonymization → assertion → chunking → indexing → persistence", async () => {
    const calls: string[] = [];
    const statuses: string[] = [];
    const persisted: unknown[] = [];
    const service = new AssistantIngestionService({
      extract: async () => { calls.push("extract"); return { mediaType: "txt", units: [{ kind: "text", text: "Ana García López cobra 25 EUR" }] }; },
      redact: (value) => { calls.push("pii"); return value as SanitizedValue; },
      sanitize: () => { calls.push("anon"); return [{ kind: "text", text: "matrícula 10048 cobra 25 EUR" }]; },
      assertSafe: () => calls.push("assert"),
      chunk: (input) => { calls.push("chunk"); return chunkSanitizedUnits("document-1", input); },
      index: { execute: (chunks) => { calls.push("index"); return new DirectIndexExecutor().execute(chunks); } },
      persist: async (block) => { calls.push("persist"); persisted.push(block); },
      onStatus: (_documentId, status) => statuses.push(status),
    });
    const result = await service.ingestDocument({
      id: "document-1", file: new File(["raw"], "nomina-ana.txt"), mediaType: "txt",
      scope: { type: "analysis", analysisId: "analysis-1" }, localDisplayName: "nomina-ana.txt",
      sanitizedSourceLabel: "Documento adicional 1",
    });
    expect(calls).toEqual(["extract", "pii", "anon", "assert", "chunk", "index", "persist"]);
    expect(statuses).toEqual(["extracting", "anonymizing", "fragmenting", "indexing", "ready"]);
    expect(result.status).toBe("ready");
    expect(JSON.stringify(persisted)).not.toMatch(/Ana García|nomina-ana|localDisplayName|"raw"/u);
  });

  test.each(["scanned_without_text", "empty_document"] as const)("persists %s safely as non-indexable without chunks", async (nonIndexableReason) => {
    const persist = vi.fn();
    const service = new AssistantIngestionService({
      extract: async () => ({ mediaType: "pdf", units: [], nonIndexableReason }),
      persist,
    });
    const result = await service.ingestDocument({ id: "d", file: new File([new Uint8Array()], "scan.pdf"), mediaType: "pdf", scope: { type: "analysis", analysisId: "a" }, localDisplayName: "scan.pdf", sanitizedSourceLabel: "Recibo 1" });
    expect(result).toEqual(expect.objectContaining({ status: "error", nonIndexableReason }));
    expect(persist).toHaveBeenCalledWith({
      document: expect.objectContaining({ id: "d", status: "error", sanitizedSourceLabel: "Recibo 1" }),
      chunks: [],
      searchTerms: [],
      indexJob: { id: "d-index", documentId: "d", status: "error", indexedChunkIds: [], nonIndexableReason },
    });
  });

  test("does not reject the successful analysis when later ingestion fails", async () => {
    const analysis = { id: "analysis-1", people: 3 };
    const ingest = vi.fn().mockRejectedValue(new Error("private raw path C:\\private\\file.pdf"));
    await expect(preserveAnalysisResultWhenIngestionFails(Promise.resolve(analysis), ingest)).resolves.toEqual(analysis);
    expect(ingest).toHaveBeenCalledOnce();
  });

  test("keeps the newest ready corpus when an obsolete error ingestion finishes last", async () => {
    const factory = new IDBFactory();
    const dbName = "analysis-orchestration-race-test";
    let releaseOld: (() => void) | undefined;
    let markOldStarted: (() => void) | undefined;
    const oldStarted = new Promise<void>((resolve) => { markOldStarted = resolve; });
    const oldRelease = new Promise<void>((resolve) => { releaseOld = resolve; });
    const input = {
      analysisId: "analysis-race", result: { people: [] } as never,
      registroFile: new File(["private binary"], "registro.xlsx"), pdfFiles: [],
    };
    const repositories = () => createIndexedDbRepositories({ factory, dbName });

    const old = startAnalysisDocumentIngestion(input, {
      createRepositories: repositories,
      createIngestionId: () => "old-generation",
      createService: (persist) => new AssistantIngestionService({
        persist,
        extract: async () => {
          markOldStarted?.();
          await oldRelease;
          return { mediaType: "xlsx", units: [], nonIndexableReason: "empty_document" };
        },
      }),
    });
    void old.catch(() => undefined);
    await Promise.race([
      oldStarted,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("old extraction did not start")), 250)),
    ]);
    await startAnalysisDocumentIngestion(input, {
      createRepositories: repositories,
      createIngestionId: () => "new-generation",
      createService: (persist) => new AssistantIngestionService({
        persist,
        extract: async () => ({ mediaType: "xlsx", units: [{ kind: "text", text: "contenido nuevo sanitizado" }] }),
      }),
    });
    releaseOld?.();
    await old;

    const stored = await repositories();
    const chunk = await stored.chunks.get("analysis-race-registro-chunk-1") as { content?: string } | undefined;
    expect(chunk?.content).toContain("contenido nuevo sanitizado");
    expect(await stored.documents.get("analysis-race-registro")).toEqual(expect.objectContaining({ status: "ready" }));
    stored.close();
  });

  test("does not replace the previous corpus with a partial staged ingestion", async () => {
    const factory = new IDBFactory();
    const dbName = "analysis-partial-ingestion-test";
    const createRepositories = () => createIndexedDbRepositories({ factory, dbName });
    const seeded = await createRepositories();
    await seeded.writeIngestionBlock({
      document: { id: "analysis-partial-registro", sanitizedSourceLabel: "Registro Retributivo", scope: { type: "analysis", analysisId: "analysis-partial" }, mediaType: "xlsx", status: "ready", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      chunks: [{ id: "previous-chunk", documentId: "analysis-partial-registro", sequence: 0, content: "corpus anterior sanitizado", snippet: "corpus anterior", sanitizedHash: "old", terms: ["corpus"] }],
      searchTerms: [{ id: "previous-term", documentId: "analysis-partial-registro", chunkId: "previous-chunk", term: "corpus", positions: [0] }],
      indexJob: { id: "analysis-partial-registro-index", documentId: "analysis-partial-registro", status: "ready", indexedChunkIds: ["previous-chunk"] },
    });
    seeded.close();

    await startAnalysisDocumentIngestion({
      analysisId: "analysis-partial", result: { people: [] } as never,
      registroFile: new File(["private binary"], "registro.xlsx"),
      pdfFiles: [new File(["private binary"], "recibo.pdf")],
    }, {
      createRepositories,
      createIngestionId: () => "partial-generation",
      createService: (persist) => new AssistantIngestionService({
        persist,
        extract: async (_file, mediaType) => {
          if (mediaType === "pdf") throw new Error("private parser failure");
          return { mediaType: "xlsx", units: [{ kind: "text", text: "nuevo corpus incompleto sanitizado" }] };
        },
      }),
    });

    const stored = await createRepositories();
    expect(await stored.chunks.get("previous-chunk")).toBeTruthy();
    expect(await stored.searchTerms.get("previous-term")).toBeTruthy();
    expect(await stored.chunks.get("analysis-partial-registro-chunk-1")).toBeUndefined();
    expect(await stored.documents.get("analysis-partial-recibo-1")).toBeUndefined();
    stored.close();
  });

  test("indexes accent-normalized terms at positions in the sanitized content", () => {
    const chunks = chunkSanitizedUnits("d", [{ text: "matrícula matrícula" }]);
    const content = chunks[0]!.content;
    const record = new DirectIndexExecutor().execute(chunks).terms.find((term) => term.term === "matricula");
    expect(record?.positions).toEqual([content.indexOf("matrícula"), content.lastIndexOf("matrícula")]);
  });
});
