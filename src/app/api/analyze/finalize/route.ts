import { NextResponse } from "next/server";
import { getGeminiModel } from "@/lib/ai/geminiClient";
import { compareAnalysis } from "@/lib/compare/comparePeople";
import { buildDefaultConceptMap, mergeConceptMap, validateConceptMapForCodes } from "@/lib/compare/conceptMapping";
import type { AnalysisConfig, AnalysisError, AnalysisResult, PayrollRecord, RegistroParseResult } from "@/lib/types";
import { validationError } from "@/lib/utils/fileValidation";

export const runtime = "nodejs";

type RegistroPayload = RegistroParseResult & {
  readonly groupedExcelSheets?: AnalysisResult["groupedExcelSheets"];
  readonly fileName?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      registroParsed?: RegistroPayload;
      payrollRecords?: PayrollRecord[];
      pdfErrors?: AnalysisError[];
      config?: AnalysisConfig;
    };
    if (!body.registroParsed || !Array.isArray(body.payrollRecords) || !body.config) {
      return NextResponse.json({ error: "Faltan datos procesados para completar el análisis." }, { status: 400 });
    }

    const registro = body.registroParsed;
    const config = body.config;
    const errors: AnalysisError[] = [
      ...registro.warnings.map((message) => validationError(registro.fileName ?? "Registro.xlsx", message)),
      ...(body.pdfErrors ?? []),
    ];
    const conceptMap = validateConceptMapForCodes(
      mergeConceptMap([...buildDefaultConceptMap(registro.conceptCodes), ...(config.conceptMap ?? [])]),
      registro.conceptCodes,
    );
    const result = await compareAnalysis(body.payrollRecords, registro.records, {
      tolerance: config.tolerance,
      enableAI: false,
      aiModel: getGeminiModel(),
      reviewThreshold: config.thresholds.reviewThreshold,
      incidentThreshold: config.thresholds.incidentThreshold,
      conceptMap,
      internalExcelChecks: registro.internalChecks,
      excludedEmployeeIds: config.excludedEmployeeIds,
    });
    const response: AnalysisResult = {
      ...result,
      summary: {
        ...result.summary,
        pdfsFailed: errors.filter((error) => error.type === "pdf").length,
        groupingDifferences: 0,
      },
      groupings: [],
      groupedExcelSheets: registro.groupedExcelSheets,
      errors: [...result.errors, ...errors],
      criteria: [
        ...result.criteria,
        `Hoja Registro detectada: ${registro.sheetName}.`,
        `Hojas agrupadas Registro leídas: ${registro.groupedExcelSheets?.filter((sheet) => sheet.status === "ready").length ?? 0} hojas.`,
        ...registro.warnings,
      ],
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al completar el análisis." }, { status: 500 });
  }
}
