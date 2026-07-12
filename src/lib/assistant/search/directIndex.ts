import type { SanitizedDocumentChunk } from "@/lib/assistant/documents/chunker";

export interface SearchTermRecord {
  readonly id: string;
  readonly documentId: string;
  readonly chunkId: string;
  readonly term: string;
  readonly positions: readonly number[];
}
export interface DirectIndexResult {
  readonly terms: readonly SearchTermRecord[];
  readonly indexedChunkIds: readonly string[];
}

export interface IndexExecutor {
  execute(chunks: readonly SanitizedDocumentChunk[]): DirectIndexResult;
}

function normalizeWithSourcePositions(input: string): { readonly text: string; readonly sourcePositions: readonly number[] } {
  let text = "";
  const sourcePositions: number[] = [];
  let sourcePosition = 0;
  for (const character of input) {
    const normalized = character.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
    text += normalized;
    for (let index = 0; index < normalized.length; index += 1) sourcePositions.push(sourcePosition);
    sourcePosition += character.length;
  }
  return { text, sourcePositions };
}

export class DirectIndexExecutor implements IndexExecutor {
  execute(chunks: readonly SanitizedDocumentChunk[]): DirectIndexResult {
    const terms: SearchTermRecord[] = [];
    for (const chunk of chunks) {
      const normalizedContent = normalizeWithSourcePositions(chunk.content);
      for (const term of chunk.terms) {
        const positions: number[] = [];
        let from = 0;
        while (from < normalizedContent.text.length) {
          const position = normalizedContent.text.indexOf(term, from);
          if (position < 0) break;
          positions.push(normalizedContent.sourcePositions[position] ?? position);
          from = position + term.length;
        }
        terms.push({ id: `${chunk.id}-term-${term}`, documentId: chunk.documentId, chunkId: chunk.id, term, positions });
      }
    }
    return { terms, indexedChunkIds: chunks.map((chunk) => chunk.id) };
  }
}
