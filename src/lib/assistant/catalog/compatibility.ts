import type { ConversationType } from "@/lib/assistant/domain";
import type { ModelCatalogEntry } from "@/lib/assistant/catalog/domain";

export interface ModelCompatibility {
  readonly selectable: boolean;
  readonly reason?: string;
}

const compatible: ModelCompatibility = { selectable: true };

export function generalModelCompatibility(entry: ModelCatalogEntry): ModelCompatibility {
  if (entry.availability !== "available") return { selectable: false, reason: "Este modelo ya no está disponible." };
  if (entry.capabilities.chat === "unknown") return { selectable: false, reason: "La compatibilidad con chat no está confirmada." };
  if (entry.capabilities.chat !== true) return { selectable: false, reason: entry.incompatibleReason ?? "No es un modelo de conversación." };
  return compatible;
}

export function analysisModelCompatibility(entry: ModelCatalogEntry): ModelCompatibility {
  const general = generalModelCompatibility(entry);
  if (!general.selectable) return general;
  if (entry.capabilities.tools === "unknown") return { selectable: false, reason: "Es necesario comprobar la compatibilidad con herramientas." };
  if (entry.capabilities.tools !== true) return { selectable: false, reason: "Este modelo no admite las herramientas necesarias para consultar datos retributivos." };
  return compatible;
}

export function modelCompatibility(entry: ModelCatalogEntry, conversationType: ConversationType): ModelCompatibility {
  return conversationType === "analysis" ? analysisModelCompatibility(entry) : generalModelCompatibility(entry);
}
