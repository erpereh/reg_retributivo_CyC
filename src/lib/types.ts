export type PayrollConceptType = "devengo" | "deduccion" | "informativo" | "unknown";
export type Severity = "Alta" | "Media" | "Baja";
export type SalaryStatus = "OK" | "Revisar" | "Incidencia" | "Falta en Registro";
export type AppView = "dashboard" | "tablas" | "historial" | "ajustes";

export interface AnalysisThresholds {
  readonly reviewThreshold: number;
  readonly incidentThreshold: number;
}

export interface AnalysisConfig {
  readonly tolerance: number;
  readonly enableAI: boolean;
  readonly aiModel: string;
  readonly thresholds: AnalysisThresholds;
}

export interface PayrollConcept {
  readonly name: string;
  readonly amount: number;
  readonly type: PayrollConceptType;
}

export interface PayrollRecord {
  readonly sourceFile: string;
  readonly pageNumber?: number;
  readonly periodLabel: string;
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly companyName?: string;
  readonly cif?: string;
  readonly workerNif: string;
  readonly workerName: string;
  readonly socialSecurityNumber?: string;
  readonly employeeNumber?: string;
  readonly workplace?: string;
  readonly professionalGroup?: string;
  readonly gt?: string;
  readonly seniorityDate?: string;
  readonly concepts: readonly PayrollConcept[];
  readonly totalDevengado?: number;
  readonly totalDeducir?: number;
  readonly netPay?: number;
  readonly irpfBaseAccumulated?: number;
  readonly irpfFeeAccumulated?: number;
  readonly ssFeeAccumulated?: number;
}

export interface RegistroRecord {
  readonly sourceRow: number;
  readonly workerNif: string;
  readonly workerName?: string;
  readonly employeeNumber?: string;
  readonly workplace?: string;
  readonly professionalGroup?: string;
  readonly gt?: string;
  readonly seniorityDate?: string;
  readonly expectedSalary?: number;
  readonly expectedNormalizedSalary?: number;
  readonly expectedVariableSalary?: number;
  readonly expectedSalaryCriterion?: string;
  readonly raw: Record<string, unknown>;
}

export interface FieldIssue {
  readonly workerNif: string;
  readonly workerName: string;
  readonly employeeNumber?: string;
  readonly field: string;
  readonly shouldBe: string;
  readonly actual: string;
  readonly affectedPeriods: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly salaryShouldBe?: number;
  readonly salaryActual?: number;
  readonly salaryDifference?: number;
  readonly severity: Severity;
  readonly observations: string;
  readonly recommendedAction: string;
}

export interface SalaryDifference {
  readonly workerNif: string;
  readonly workerName: string;
  readonly employeeNumber?: string;
  readonly workplace?: string;
  readonly professionalGroup?: string;
  readonly gt?: string;
  readonly totalShouldBe: number;
  readonly totalActual: number;
  readonly difference: number;
  readonly payrollCount: number;
  readonly periodsIncluded: readonly string[];
  readonly status: SalaryStatus;
  readonly observations: string;
}

export interface AnalysisSummary {
  readonly generatedAt: string;
  readonly pdfsAnalyzed: number;
  readonly pdfsFailed: number;
  readonly uniquePeople: number;
  readonly peopleWithIssues: number;
  readonly fieldIssuesCount: number;
  readonly salaryIssuesCount: number;
  readonly salaryDifferenceTotal: number;
  readonly salaryDifferenceAbsTotal: number;
  readonly tolerance: number;
  readonly aiEnabled?: boolean;
  readonly aiModel?: string;
  readonly reviewThreshold?: number;
  readonly incidentThreshold?: number;
}

export interface AnalysisError {
  readonly file: string;
  readonly type: "validation" | "pdf" | "excel" | "comparison" | "export";
  readonly message: string;
  readonly recommendedAction: string;
}

export interface AnalysisResult {
  readonly summary: AnalysisSummary;
  readonly payrollRecords: readonly PayrollRecord[];
  readonly registroRecords: readonly RegistroRecord[];
  readonly fieldIssues: readonly FieldIssue[];
  readonly salaryDifferences: readonly SalaryDifference[];
  readonly errors: readonly AnalysisError[];
  readonly criteria: readonly string[];
}

export interface StoredAnalysis {
  readonly id: string;
  readonly createdAt: string;
  readonly registroFileName: string;
  readonly pdfCount: number;
  readonly result: AnalysisResult;
  readonly config: AnalysisConfig;
}
