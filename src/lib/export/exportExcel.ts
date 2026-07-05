import ExcelJS from "exceljs";
import type { AnalysisResult } from "@/lib/types";
import { applyStatusStyle, styleBodyRows, styleHeaderRow, styleTitle } from "@/lib/export/styles";

const EURO_FORMAT = '#,##0.00 [$€-es-ES]';

function configureColumns(sheet: ExcelJS.Worksheet, widths: readonly number[]): void {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function moneyColumns(sheet: ExcelJS.Worksheet, columns: readonly number[]): void {
  columns.forEach((col) => {
    sheet.getColumn(col).numFmt = EURO_FORMAT;
  });
}

function addResumen(workbook: ExcelJS.Workbook, analysis: AnalysisResult): void {
  const sheet = workbook.addWorksheet("Resumen", { properties: { defaultRowHeight: 22 } });
  sheet.mergeCells("A1:H1");
  sheet.getCell("A1").value = "Comparativa Nominas vs Registro Retributivo";
  styleTitle(sheet.getCell("A1"));
  sheet.addRow([]);
  sheet.addRow(["Metrica", "Valor"]);
  styleHeaderRow(sheet.getRow(3));
  [
    ["Personas analizadas", analysis.summary.uniquePeople],
    ["Personas con diferencias", analysis.summary.peopleWithDifferences],
    ["Dif. total salario", analysis.summary.totalSalaryDifference],
    ["Dif. total C. salarial", analysis.summary.totalSalaryComplementDifference],
    ["Dif. total extrasalarial", analysis.summary.totalExtraSalaryDifference],
    ["Dif. total global", analysis.summary.totalGlobalDifference],
    ["Conceptos sin mapear", analysis.summary.conceptsUnmapped],
    ["Cuadres internos con diferencias", analysis.summary.internalExcelDifferences],
    ["Tolerancia", analysis.summary.tolerance],
  ].forEach((row) => sheet.addRow(row));
  moneyColumns(sheet, [2]);
  configureColumns(sheet, [34, 22, 20, 20, 20, 20, 20, 20]);
  styleBodyRows(sheet);
}

function addPersonas(workbook: ExcelJS.Workbook, analysis: AnalysisResult): void {
  const sheet = workbook.addWorksheet("Personas");
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addRow([
    "Matricula",
    "Persona",
    "Centro",
    "Puesto",
    "Categoria",
    "Salario Registro",
    "Salario PDF",
    "Dif. Salario",
    "C. Salarial Registro",
    "C. Salarial PDF",
    "Dif. C. Salarial",
    "Extrasalarial Registro",
    "Extrasalarial PDF",
    "Dif. Extrasalarial",
    "Total Registro",
    "Total PDF",
    "Dif. Total",
    "Estado",
  ]);
  styleHeaderRow(sheet.getRow(1));
  analysis.people.forEach((item) => {
    const row = sheet.addRow([
      item.employeeNumber,
      item.person,
      item.workplace,
      item.position,
      item.category,
      item.salaryRegistro,
      item.salaryPdf,
      item.salaryDifference,
      item.salaryComplementRegistro,
      item.salaryComplementPdf,
      item.salaryComplementDifference,
      item.extraSalaryRegistro,
      item.extraSalaryPdf,
      item.extraSalaryDifference,
      item.registroTotal,
      item.pdfTotal,
      item.totalDifference,
      item.status,
    ]);
    applyStatusStyle(row.getCell(18), item.status);
  });
  moneyColumns(sheet, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  configureColumns(sheet, [14, 32, 24, 34, 30, 18, 18, 16, 20, 18, 18, 22, 20, 20, 18, 18, 18, 16]);
  styleBodyRows(sheet);
}

function addNormalizado(workbook: ExcelJS.Workbook, analysis: AnalysisResult): void {
  const sheet = workbook.addWorksheet("Normalizado_vs_Real");
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addRow([
    "Matricula",
    "Persona",
    "Normalizado + variables",
    "Normalizado",
    "Periodo completo",
    "Real PDF",
    "Dif. PDF vs periodo completo",
    "Dif. PDF vs normalizado + variables",
    "Dif. PDF vs normalizado",
    "Justificacion",
    "Estado",
  ]);
  styleHeaderRow(sheet.getRow(1));
  analysis.normalizedVsReal.forEach((item) => {
    const row = sheet.addRow([
      item.employeeNumber,
      item.person,
      item.normalizedPlusVariables,
      item.normalized,
      item.periodComplete,
      item.realPdf,
      item.diffPdfVsPeriodComplete,
      item.diffPdfVsNormalizedPlusVariables,
      item.diffPdfVsNormalized,
      item.possibleJustification,
      item.status,
    ]);
    applyStatusStyle(row.getCell(11), item.status);
  });
  moneyColumns(sheet, [3, 4, 5, 6, 7, 8, 9]);
  configureColumns(sheet, [14, 32, 24, 18, 18, 18, 26, 32, 28, 58, 16]);
  styleBodyRows(sheet);
}

function addConceptos(workbook: ExcelJS.Workbook, analysis: AnalysisResult): void {
  const sheet = workbook.addWorksheet("Conceptos");
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addRow(["Matricula", "Persona", "Bloque", "Codigo Registro", "Concepto PDF", "Importe Registro", "Importe PDF", "Diferencia", "Estado"]);
  styleHeaderRow(sheet.getRow(1));
  analysis.concepts.forEach((item) => {
    const row = sheet.addRow([
      item.employeeNumber,
      item.person,
      item.block,
      item.registroCode,
      item.pdfConcept,
      item.registroAmount,
      item.pdfAmount,
      item.difference,
      item.status,
    ]);
    applyStatusStyle(row.getCell(9), item.status);
  });
  moneyColumns(sheet, [6, 7, 8]);
  configureColumns(sheet, [14, 32, 18, 34, 44, 18, 18, 18, 16]);
  styleBodyRows(sheet);
}

function addSinMapear(workbook: ExcelJS.Workbook, analysis: AnalysisResult): void {
  const sheet = workbook.addWorksheet("Conceptos_sin_mapear");
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addRow(["Concepto PDF", "Total detectado", "N personas", "N nominas", "Sugerencia bloque", "Sugerencia codigo Registro", "Accion"]);
  styleHeaderRow(sheet.getRow(1));
  analysis.unmappedConcepts.forEach((item) => {
    const row = sheet.addRow([
      item.pdfConcept,
      item.totalDetected,
      item.peopleCount,
      item.payrollCount,
      item.suggestedBlock,
      item.suggestedRegistroCode,
      item.action,
    ]);
    applyStatusStyle(row.getCell(7), item.action);
  });
  moneyColumns(sheet, [2]);
  configureColumns(sheet, [44, 18, 14, 14, 22, 32, 22]);
  styleBodyRows(sheet);
}

function addCuadreInterno(workbook: ExcelJS.Workbook, analysis: AnalysisResult): void {
  const sheet = workbook.addWorksheet("Cuadre_Interno_Excel");
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addRow([
    "Matricula",
    "Salario periodo completo",
    "Salario desglose",
    "Dif. Salario",
    "C. Salarial periodo completo",
    "C. Salarial desglose",
    "Dif. C. Salarial",
    "Extrasalarial periodo completo",
    "Extrasalarial desglose",
    "Dif. Extrasalarial",
    "Estado",
  ]);
  styleHeaderRow(sheet.getRow(1));
  analysis.internalExcelChecks.forEach((item) => {
    const row = sheet.addRow([
      item.employeeNumber,
      item.salaryPeriod,
      item.salaryBreakdown,
      item.salaryDifference,
      item.salaryComplementPeriod,
      item.salaryComplementBreakdown,
      item.salaryComplementDifference,
      item.extraSalaryPeriod,
      item.extraSalaryBreakdown,
      item.extraSalaryDifference,
      item.status,
    ]);
    applyStatusStyle(row.getCell(11), item.status);
  });
  moneyColumns(sheet, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  configureColumns(sheet, [14, 26, 20, 16, 28, 22, 18, 30, 24, 20, 16]);
  styleBodyRows(sheet);
}

function addCriterios(workbook: ExcelJS.Workbook, analysis: AnalysisResult): void {
  const sheet = workbook.addWorksheet("Criterios");
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = "Criterios aplicados";
  styleTitle(sheet.getCell("A1"));
  sheet.addRow([]);
  sheet.addRow(["Tema", "Detalle"]);
  styleHeaderRow(sheet.getRow(3));
  [
    ["Clave principal", "Matricula / ID RH."],
    ["Privacidad", "No se muestra ni exporta NIF, IBAN, cuentas ni datos bancarios."],
    ["Registro", "Importes de periodo completo y conceptos leidos de Empleados por cabeceras reales."],
    ["PDF", "Importe comparativo calculado como suma de conceptos incluidos por mapa editable."],
    ["Control auxiliar", "Total Devengado PDF solo se usa como control auxiliar en detalle, no como total comparativo."],
    ["Mapa de conceptos", "Las reglas por defecto solo incluyen codigos que existen en el Excel cargado."],
    ["IA", "Gemini no calcula importes; solo puede sugerir textos o mapeos si esta activado."],
    ...analysis.criteria.map((criterion) => ["Criterio adicional", criterion]),
  ].forEach((row) => sheet.addRow(row));
  configureColumns(sheet, [28, 120]);
  styleBodyRows(sheet);
}

export async function exportAnalysisToWorkbook(analysis: AnalysisResult): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Comparativa Nominas Registro";
  workbook.created = new Date(analysis.summary.generatedAt);
  workbook.modified = new Date();

  addResumen(workbook, analysis);
  addPersonas(workbook, analysis);
  addNormalizado(workbook, analysis);
  addConceptos(workbook, analysis);
  addSinMapear(workbook, analysis);
  addCuadreInterno(workbook, analysis);
  addCriterios(workbook, analysis);

  return workbook;
}

export async function exportAnalysisToBuffer(analysis: AnalysisResult): Promise<Buffer> {
  const workbook = await exportAnalysisToWorkbook(analysis);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
