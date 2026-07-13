import type { SanitizedDocumentChunk } from "@/lib/assistant/documents/chunker";
import { z } from "zod";
import { assertSafeForProvider } from "@/lib/assistant/privacy/assertions";
import type { DocumentScope, SourceAvailability } from "@/lib/assistant/domain";

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

export const SEARCH_FACET_NAMES = ["employeeId", "period", "concept", "position", "category", "family", "valuation", "grouping", "sheet", "row", "cell", "sourceType"] as const;
export type SearchFacetName = typeof SEARCH_FACET_NAMES[number];
export type SearchFacets = Partial<Record<SearchFacetName, readonly string[]>>;
export interface SearchIndexRecord {
  readonly id: string;
  readonly documentId?: string;
  readonly chunkId?: string;
  readonly scope: DocumentScope;
  readonly availability: SourceAvailability;
  readonly sanitizedHash: string;
  readonly sanitizedSourceLabel: string;
  readonly content: string;
  readonly facets: SearchFacets;
}
export interface SearchRequest { readonly scope: DocumentScope; readonly query: string; readonly facets?: SearchFacets; readonly limit: number }
export interface SearchMatch { readonly documentId: string; readonly chunkId: string; readonly sanitizedHash: string; readonly sanitizedSourceLabel: string; readonly excerpt: string; readonly score: number }
export interface SearchIndex { search(request: SearchRequest): Promise<readonly SearchMatch[]> }

const scopeSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("analysis"), analysisId: z.string().min(1).max(128) }).strict(), z.object({ type: z.literal("conversation"), conversationId: z.string().min(1).max(128) }).strict()]);
const facetValues = z.array(z.string().min(1).max(256)).max(50).optional();
const facetSchema = z.object({ employeeId: facetValues, period: facetValues, concept: facetValues, position: facetValues, category: facetValues, family: facetValues, valuation: facetValues, grouping: facetValues, sheet: facetValues, row: facetValues, cell: facetValues, sourceType: facetValues }).strict();
const searchSchema = z.object({ scope: scopeSchema, query: z.string().min(1).max(256), facets: facetSchema.optional(), limit: z.number().int().min(1).max(50) }).strict();

function normalizedWords(value: string): string[] {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
function sameScope(left: DocumentScope, right: DocumentScope): boolean {
  return left.type === right.type && (left.type === "analysis" ? right.type === "analysis" && left.analysisId === right.analysisId : right.type === "conversation" && left.conversationId === right.conversationId);
}

export class DirectSearchIndex implements SearchIndex {
  constructor(private readonly records: readonly SearchIndexRecord[]) {}

  async search(request: SearchRequest): Promise<readonly SearchMatch[]> {
    const parsed = searchSchema.parse(request);
    assertSafeForProvider(parsed);
    const terms = normalizedWords(parsed.query);
    return this.records.filter((record) => record.availability === "available" && sameScope(record.scope, parsed.scope)).map((record) => {
      const corpus = new Set(normalizedWords(`${record.sanitizedSourceLabel} ${record.content} ${Object.values(record.facets).flat().join(" ")}`));
      const lexicalScore = terms.reduce((score, term) => score + (corpus.has(term) ? 1 : 0), 0);
      return { record, score: lexicalScore } as const;
    }).filter(({ score, record }) => score === terms.length && Object.entries(parsed.facets ?? {}).every(([name, values]) => {
      const actual = new Set((record.facets[name as SearchFacetName] ?? []).flatMap(normalizedWords));
      return (values ?? []).every((value: string) => normalizedWords(value).every((term) => actual.has(term)));
    })).sort((a, b) => b.score - a.score).slice(0, parsed.limit).map(({ record, score }) => ({ documentId: record.documentId ?? record.id, chunkId: record.chunkId ?? record.id, sanitizedHash: record.sanitizedHash, sanitizedSourceLabel: record.sanitizedSourceLabel, excerpt: record.content, score }));
  }
}

function normalizeCharacter(character: string, cache: Map<string, string>): string {
  const cached = cache.get(character);
  if (cached !== undefined) return cached;
  const normalized = character.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
  cache.set(character, normalized);
  return normalized;
}

function hasIdentityWidthNormalization(input: string, cache: Map<string, string>): boolean {
  for (const character of input) if (normalizeCharacter(character, cache).length !== character.length) return false;
  return true;
}

function normalizeWithSourcePositions(input: string, cache: Map<string, string>): { readonly text: string; readonly sourcePositions: readonly number[] } {
  const normalizedWhole = input.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
  if (normalizedWhole.length === input.length && hasIdentityWidthNormalization(input, cache)) {
    return { text: normalizedWhole, sourcePositions: [] };
  }
  let text = "";
  const sourcePositions: number[] = [];
  let sourcePosition = 0;
  for (const character of input) {
    const normalized = normalizeCharacter(character, cache);
    text += normalized;
    for (let index = 0; index < normalized.length; index += 1) sourcePositions.push(sourcePosition);
    sourcePosition += character.length;
  }
  return { text, sourcePositions };
}

export class DirectIndexExecutor implements IndexExecutor {
  execute(chunks: readonly SanitizedDocumentChunk[]): DirectIndexResult {
    const terms: SearchTermRecord[] = [];
    const normalizationCache = new Map<string, string>();
    for (const chunk of chunks) {
      const normalizedContent = normalizeWithSourcePositions(chunk.content, normalizationCache);
      for (const term of chunk.terms) {
        const positions: number[] = [];
        let from = 0;
        while (from < normalizedContent.text.length) {
          const position = normalizedContent.text.indexOf(term, from);
          if (position < 0) break;
          positions.push(normalizedContent.sourcePositions.length ? (normalizedContent.sourcePositions[position] ?? position) : position);
          from = position + term.length;
        }
        terms.push({ id: `${chunk.id}-term-${term}`, documentId: chunk.documentId, chunkId: chunk.id, term, positions });
      }
    }
    return { terms, indexedChunkIds: chunks.map((chunk) => chunk.id) };
  }
}
