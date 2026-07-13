import { GENERAL_RETRIBUTIVO_PROMPT } from "@/lib/assistant/providers/fakeAdapter";

export const CAPABILITY_PAYLOAD_VERSION = "assistant-capability-payload:v1";

const ANALYSIS_TOOLS = [{
  name: "getPersonProfile",
  description: "Obtiene los totales retributivos ya calculados de una persona por matrícula dentro del análisis activo.",
  parameters: {
    type: "object",
    properties: {
      analysisId: { type: "string", minLength: 1 },
      personId: { type: "string", minLength: 1 },
    },
    required: ["analysisId", "personId"],
    additionalProperties: false,
  },
}] as const;

export function buildCapabilityMeasurementText(): string {
  return JSON.stringify({
    version: CAPABILITY_PAYLOAD_VERSION,
    systemInstructions: GENERAL_RETRIBUTIVO_PROMPT,
    tools: ANALYSIS_TOOLS,
  });
}
