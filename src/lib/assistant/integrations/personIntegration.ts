import type { Conversation } from "@/lib/assistant/domain";
import type { AssistantRepositories } from "@/lib/assistant/storage/repositories";

interface ContinuePersonInput {
  repositories: AssistantRepositories;
  analysisId: string;
  analysisVersion: string;
  personId: string;
  modelProfileId: string;
  now: string;
  send?: (content: string) => unknown;
}

export async function continuePersonInAssistant(input: ContinuePersonInput): Promise<Conversation> {
  const selected = await input.repositories.continueAnalysisPerson({ analysisId: input.analysisId, analysisVersion: input.analysisVersion, personId: input.personId, modelProfileId: input.modelProfileId, updatedAt: input.now });
  if (!selected) throw new Error("El análisis ya no está disponible para continuar en el Asistente.");
  return selected;
}
