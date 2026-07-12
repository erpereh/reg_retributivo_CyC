import { z } from "zod";
import type { SourceReference } from "@/lib/assistant/domain";
import type { AnalysisResult } from "@/lib/types";

const inputSchema = z.object({ analysisId: z.string().min(1), personId: z.string().min(1) }).strict();
export interface LocalAnalysis { id: string; result: Pick<AnalysisResult, "people"> }
export interface PersonProfileResult {
  personId: string;
  totals: { registro: number; payroll: number; difference: number };
  source: SourceReference;
}

export function getPersonProfile(input: z.input<typeof inputSchema>, analysis: LocalAnalysis, conversationId = "local-tool"): PersonProfileResult {
  const parsed = inputSchema.parse(input);
  if (parsed.analysisId !== analysis.id) throw new Error("El análisis solicitado no pertenece a la conversación.");
  const person = analysis.result.people.find((candidate) => candidate.employeeNumber === parsed.personId);
  if (!person) throw new Error("No existe una persona con esa matrícula en el análisis.");
  const totals = { registro: person.registroTotal, payroll: person.pdfTotal, difference: person.totalDifference };
  const source: SourceReference = {
    id: `person-profile-${analysis.id}-${parsed.personId}`,
    conversationId,
    analysisId: analysis.id,
    personId: parsed.personId,
    sourceType: "person_profile",
    sanitizedSourceLabel: `Persona matrícula ${parsed.personId}`,
    availability: "available",
    conceptIds: [],
    excerpt: `Totales locales: registro ${totals.registro}; recibos ${totals.payroll}; diferencia ${totals.difference}`,
    sanitizedHash: `person-profile-${analysis.id}-${parsed.personId}-${totals.registro}-${totals.payroll}-${totals.difference}`,
  };
  return { personId: parsed.personId, totals, source };
}

export function executeAssistantToolRequest(request: { tool: string; args: unknown }, analysis: LocalAnalysis, conversationId = "local-tool"): PersonProfileResult {
  if (request.tool !== "getPersonProfile") throw new Error("Herramienta no permitida en la Fase 1.");
  return getPersonProfile(inputSchema.parse(request.args), analysis, conversationId);
}
