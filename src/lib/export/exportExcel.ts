import ExcelJS from "exceljs";
import type { AnalysisResult } from "@/lib/types";
import { applyStatusStyle, styleBodyRows, styleHeaderRow, styleTitle } from "@/lib/export/styles";

const EURO_FORMAT = '#,##0.00 [$€-es-ES]';

function asList(values: readonly string[] | undefined): string {
  return values?.join("; ") ?? "";
}

function configureColumns(sheet: ExcelJS.Worksheet, widths: readonly number[]): void {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function addResumen(workbook: ExcelJS.Workbook, analysis: AnalysisResult): void {
  const sheet = workbook.addWorksheet("Resumen", { properties: { defaultRowHeight: 22 } });
  sheet.mergeCells("A1:K1");
  sheet.getCell("A1").value = "Comparativa nominas vs Registro Retributivo";
  styleTitle(sheet.getCell("A1"));
  sheet.mergeCells("A2:K2");
  sheet.getCell("A2").value =
    "Se añade la diferencia salarial: Total deberia segun Registro vs Total esta segun nominas/PDF aportados.";

  sheet.addRow([]);
  sheet.addRow(["Resumen", "", "", "", "Personas por estado", "", "", "Nota de lectura"]);
  sheet.getRow(4).font = { bold: true };
  sheet.addRow([]);
  sheet.addRow(["Metrica", "Valor", "Lectura", "", "Estado", "Personas", "", "Detalle"]);
  styleHeaderRow(sheet.getRow(6));

  const rows = [
    ["Nominas/PDF revisadas", analysis.summary.pdfsAnalyzed, "Paginas con persona detectada"],
    ["PDF con error", analysis.summary.pdfsFailed, "Paginas o archivos no procesados"],
    ["Personas en nominas", analysis.summary.uniquePeople, "Personas unicas detectadas"],
    ["Personas con incidencias", analysis.summary.peopleWithIssues, "Personas con campos o salario a revisar"],
    ["Campos incorrectos", analysis.summary.fieldIssuesCount, "Incidencias de dato maestro"],
    ["Diferencias salariales", analysis.summary.salaryIssuesCount, "Personas fuera de tolerancia"],
    ["Diferencia salarial total", analysis.summary.salaryDifferenceTotal, "Total esta - total deberia"],
    ["Diferencia salarial absoluta total", analysis.summary.salaryDifferenceAbsTotal, "Suma de diferencias absolutas"],
    ["Tolerancia usada", analysis.summary.tolerance, "EUR"],
  ];

  rows.forEach((row) => sheet.addRow(row));
  sheet.getCell("H6").value =
    "La diferencia salarial compara el total del Registro Retributivo con el total devengado real de las nominas/PDF aportados. Los datos bancarios se ignoran por privacidad.";
  sheet.mergeCells("H6:K14");
  sheet.getCell("H6").alignment = { wrapText: true, vertical: "top" };
  configureColumns(sheet, [30, 18, 60, 4, 28, 14, 4, 18, 18, 18, 18]);
}

function addCamposMal(workbook: ExcelJS.Workbook, analysis: AnalysisResult): void {
  const sheet = workbook.addWorksheet("Campos_mal");
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addRow([
    "Prioridad",
    "NIF",
    "Matricula",
    "Trabajador",
    "Campo",
    "Deberia estar (dato)",
    "Como esta (dato)",
    "Salario deberia (€)",
    "Salario esta (€)",
    "Diferencia salarial (€)",
    "N registros afectados",
    "Archivos / periodos afectados",
    "Observaciones",
    "Accion recomendada",
  ]);
  styleHeaderRow(sheet.getRow(1));

  analysis.fieldIssues.forEach((issue) => {
    const row = sheet.addRow([
      issue.severity,
      issue.workerNif,
      issue.employeeNumber,
      issue.workerName,
      issue.field,
      issue.shouldBe,
      issue.actual,
      issue.salaryShouldBe,
      issue.salaryActual,
      issue.salaryDifference,
      issue.affectedFiles.length,
      `${asList(issue.affectedFiles)} (${asList(issue.affectedPeriods)})`,
      issue.observations,
      issue.recommendedAction,
    ]);
    applyStatusStyle(row.getCell(1), issue.severity);
  });

  [8, 9, 10].forEach((col) => {
    sheet.getColumn(col).numFmt = EURO_FORMAT;
  });
  configureColumns(sheet, [12, 14, 12, 30, 28, 40, 34, 18, 18, 20, 14, 60, 58, 42]);
  styleBodyRows(sheet);
}

function addDiferenciaSalarial(workbook: ExcelJS.Workbook, analysis: AnalysisResult): void {
  const sheet = workbook.addWorksheet("Diferencia_Salarial");
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addRow([
    "Estado",
    "NIF",
    "Matricula",
    "Trabajador",
    "Centro",
    "Grupo profesional",
    "GT",
    "Total deberia (Registro €)",
    "Total esta (nominas €)",
    "Diferencia (€)",
    "N nominas/PDF",
    "Periodos incluidos",
    "Observaciones",
  ]);
  styleHeaderRow(sheet.getRow(1));

  analysis.salaryDifferences.forEach((item) => {
    const row = sheet.addRow([
      item.status,
      item.workerNif,
      item.employeeNumber,
      item.workerName,
      item.workplace,
      item.professionalGroup,
      item.gt,
      item.totalShouldBe,
      item.totalActual,
      item.difference,
      item.payrollCount,
      asList(item.periodsIncluded),
      item.observations,
    ]);
    applyStatusStyle(row.getCell(1), item.status);
  });

  [8, 9, 10].forEach((col) => {
    sheet.getColumn(col).numFmt = EURO_FORMAT;
  });
  configureColumns(sheet, [18, 14, 12, 32, 24, 34, 10, 22, 22, 18, 14, 54, 62]);
  styleBodyRows(sheet);
}

function addCriterios(workbook: ExcelJS.Workbook, analysis: AnalysisResult): void {
  const sheet = workbook.addWorksheet("Criterios");
  sheet.mergeCells("A1:G1");
  sheet.getCell("A1").value = "Criterios aplicados";
  styleTitle(sheet.getCell("A1"));
  sheet.addRow([]);
  sheet.addRow(["Tema", "Detalle"]);
  styleHeaderRow(sheet.getRow(3));

  const criteria = [
    ["Cruce", "Cruce principal por NIF; fallback por matricula y nombre normalizado + centro."],
    ["Comparacion salarial", "Total deberia = suma de Salario + C. Salarial + Extrasalarial del bloque TOTAL RETRIBUCIONES NORMALIZADAS + VARIABLES."],
    ["Como esta", "Suma del campo TOTAL DEVENGADO de todos los PDF de nomina aportados para cada persona."],
    ["Tolerancia", `${analysis.summary.tolerance} EUR.`],
    ["Umbrales", "OK dentro de tolerancia; Revisar hasta 50 EUR; Incidencia por encima de 50 EUR."],
    ["IA", "Gemini solo se usa para observaciones y acciones recomendadas, nunca para calculos."],
    ["Privacidad", "Los datos bancarios se ignoran por privacidad."],
    ...analysis.criteria.map((criterion) => ["Criterio adicional", criterion]),
  ];
  criteria.forEach((row) => sheet.addRow(row));
  configureColumns(sheet, [28, 110]);
  styleBodyRows(sheet);
}

export async function exportAnalysisToWorkbook(analysis: AnalysisResult): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Comparativa Nominas Registro";
  workbook.created = new Date(analysis.summary.generatedAt);
  workbook.modified = new Date();

  addResumen(workbook, analysis);
  addCamposMal(workbook, analysis);
  addDiferenciaSalarial(workbook, analysis);
  addCriterios(workbook, analysis);

  return workbook;
}

export async function exportAnalysisToBuffer(analysis: AnalysisResult): Promise<Buffer> {
  const workbook = await exportAnalysisToWorkbook(analysis);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
