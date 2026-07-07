import { NextResponse } from "next/server";
import { getGeminiModel, isGeminiEnabled } from "@/lib/ai/geminiClient";
import { compareAnalysis } from "@/lib/compare/comparePeople";
import { buildDefaultConceptMap, mergeConceptMap, validateConceptMapForCodes } from "@/lib/compare/conceptMapping";
import { DEFAULT_INCIDENT_THRESHOLD, DEFAULT_REVIEW_THRESHOLD } from "@/lib/compare/salaryDiff";
import { buildRegistroGroupingComparisons, enrichRegistroGroupingsWithPdf } from "@/lib/groupings/registroGroupings";
import { parsePayrollPdf } from "@/lib/parsers/payrollPdfParser";
import { parseRegistroRetributivo } from "@/lib/parsers/registroRetributivoParser";
import type { AnalysisError, AnalysisResult, PayrollRecord } from "@/lib/types";
import type { ConceptMappingRule } from "@/lib/types";
import { validationError } from "@/lib/utils/fileValidation";

export const runtime = "nodejs";

async function fileToBuffer(file: File): Promise<Buffer> {
  return Buffer.from(await file.arrayBuffer());
}

function finiteNumber(value: FormDataEntryValue | null, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseConceptMap(value: FormDataEntryValue | null): ConceptMappingRule[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ConceptMappingRule[]) : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const registro = formData.get("registro");
    const pdfs = formData.getAll("pdfs").filter((item): item is File => item instanceof File);
    const tolerance = finiteNumber(formData.get("tolerance"), 1);
    const reviewThreshold = finiteNumber(formData.get("reviewThreshold"), DEFAULT_REVIEW_THRESHOLD);
    const incidentThreshold = finiteNumber(formData.get("incidentThreshold"), DEFAULT_INCIDENT_THRESHOLD);
    const requestedAI = formData.get("enableAI") !== "false";
    const aiModel = getGeminiModel();
    const enableAI = requestedAI && isGeminiEnabled();
    const errors: AnalysisError[] = [];

    if (!(registro instanceof File)) {
      return NextResponse.json({ error: "Falta el Excel del Registro Retributivo." }, { status: 400 });
    }
    if (!pdfs.length) {
      return NextResponse.json({ error: "No hay PDFs de nominas para analizar." }, { status: 400 });
    }

    const registroBuffer = await fileToBuffer(registro);
    const registroParsed = await parseRegistroRetributivo(registroBuffer);
    errors.push(...registroParsed.warnings.map((message) => validationError(registro.name, message)));
    const groupingResult = buildRegistroGroupingComparisons(registroBuffer, registroParsed.records, {
      tolerance,
      reviewThreshold,
      incidentThreshold,
    });
    errors.push(...groupingResult.warnings.map((message) => validationError(registro.name, message)));
    const userConceptMap = parseConceptMap(formData.get("conceptMap"));
    const conceptMap = validateConceptMapForCodes(
      mergeConceptMap([...buildDefaultConceptMap(registroParsed.conceptCodes), ...userConceptMap]),
      registroParsed.conceptCodes,
    );

    const payrollRecords: PayrollRecord[] = [];
    for (const pdf of pdfs) {
      try {
        const parsed = await parsePayrollPdf(await fileToBuffer(pdf), pdf.name);
        payrollRecords.push(...parsed.records);
        errors.push(...parsed.errors);
      } catch (error) {
        errors.push({
          file: pdf.name,
          type: "pdf",
          message: error instanceof Error ? error.message : "No se pudo procesar el PDF.",
          recommendedAction: "Revisar si el PDF contiene texto seleccionable.",
        });
      }
    }

    const result = await compareAnalysis(payrollRecords, registroParsed.records, {
      tolerance,
      enableAI,
      aiModel,
      reviewThreshold,
      incidentThreshold,
      conceptMap,
      internalExcelChecks: registroParsed.internalChecks,
    });
    const enrichedGroupings = enrichRegistroGroupingsWithPdf(
      groupingResult.rows,
      registroParsed.records,
      result.people,
      result.pdfWithoutRegistro,
      {
        tolerance,
        reviewThreshold,
        incidentThreshold,
      },
    );
    const response: AnalysisResult = {
      ...result,
      summary: {
        ...result.summary,
        pdfsFailed: errors.filter((error) => error.type === "pdf").length,
        groupingDifferences: enrichedGroupings.filter((row) => row.status !== "OK").length,
      },
      groupings: enrichedGroupings,
      errors: [...result.errors, ...errors],
      criteria: [
        ...result.criteria,
        `Hoja Registro detectada: ${registroParsed.sheetName}.`,
        `Agrupaciones Registro detectadas: ${groupingResult.detectedSheets.length} hojas y ${groupingResult.groupCount} agrupaciones.`,
        ...registroParsed.warnings,
        ...groupingResult.warnings,
      ],
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error inesperado durante el analisis.",
      },
      { status: 500 },
    );
  }
}
