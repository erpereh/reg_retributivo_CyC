import type { SanitizedValue } from "@/lib/assistant/privacy/sanitize";

export interface SanitizedDocumentChunk {
  readonly id: string;
  readonly documentId: string;
  readonly sequence: number;
  readonly content: string;
  readonly snippet: string;
  readonly sanitizedHash: string;
  readonly terms: readonly string[];
}
function stableStringify(value: SanitizedValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`).join(",")}}`;
}

function hashSanitized(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function searchTerms(content: string): readonly string[] {
  return [...new Set(content.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])].sort();
}

export function chunkSanitizedUnits(documentId: string, units: SanitizedValue, maxCharacters = 2_000): readonly SanitizedDocumentChunk[] {
  const list = Array.isArray(units) ? units : [units];
  const chunks: SanitizedDocumentChunk[] = [];
  for (const unit of list) {
    const serialized = stableStringify(unit);
    for (let offset = 0; offset < serialized.length; offset += maxCharacters) {
      const content = serialized.slice(offset, offset + maxCharacters);
      const sequence = chunks.length;
      chunks.push({
        id: `${documentId}-chunk-${sequence + 1}`,
        documentId,
        sequence,
        content,
        snippet: content.slice(0, 240),
        sanitizedHash: hashSanitized(content),
        terms: searchTerms(content),
      });
    }
  }
  return chunks;
}
