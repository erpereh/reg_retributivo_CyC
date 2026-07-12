import type { DocumentScope, KnownPersonReference, PersistedDocumentMetadata } from "@/lib/assistant/domain";
import { chunkSanitizedUnits, type SanitizedDocumentChunk } from "@/lib/assistant/documents/chunker";
import { parseClientDocument, type AssistantMediaType, type ExtractedDocument } from "@/lib/assistant/documents/clientParsers";
import { assertSafeForPersistence, assertSafeForProvider } from "@/lib/assistant/privacy/assertions";
import { redactKnownPersonValues, sanitizeForAI, type SanitizedValue } from "@/lib/assistant/privacy/sanitize";
import { DirectIndexExecutor, type DirectIndexResult, type IndexExecutor } from "@/lib/assistant/search/directIndex";
import { createIndexedDbRepositories } from "@/lib/assistant/storage/indexedDbRepositories";
import type { AnalysisResult } from "@/lib/types";
import type { AssistantRepositories, DocumentIndexJob } from "@/lib/assistant/storage/repositories";

export interface IngestionDocumentInput {
  readonly id: string;
  readonly file: File;
  readonly mediaType: AssistantMediaType;
  readonly scope: DocumentScope;
  readonly localDisplayName: string;
  readonly sanitizedSourceLabel: string;
  readonly knownPeople?: readonly KnownPersonReference[];
}

export interface IngestionBlock {
  readonly document: PersistedDocumentMetadata;
  readonly chunks: readonly SanitizedDocumentChunk[];
  readonly searchTerms: DirectIndexResult["terms"];
  readonly indexJob: DocumentIndexJob;
}

export interface IngestionResult {
  readonly documentId: string;
  readonly status: "ready" | "partial" | "error";
  readonly chunkCount: number;
  readonly nonIndexableReason?: ExtractedDocument["nonIndexableReason"];
  readonly error?: { readonly code: "ingestion_failed"; readonly message: string };
}

interface IngestionDependencies {
  readonly extract?: (file: File, mediaType: AssistantMediaType, sanitizedSourceLabel: string) => Promise<ExtractedDocument>;
  readonly redact?: (value: unknown, knownPeople: readonly KnownPersonReference[]) => SanitizedValue;
  readonly sanitize?: (value: unknown, knownPeople: readonly KnownPersonReference[]) => SanitizedValue;
  readonly assertSafe?: (value: unknown) => void;
  readonly chunk?: (documentId: string, units: SanitizedValue) => readonly SanitizedDocumentChunk[];
  readonly index?: IndexExecutor;
  readonly persist?: (block: IngestionBlock) => Promise<void>;
  readonly now?: () => string;
  readonly onStatus?: (documentId: string, status: PersistedDocumentMetadata["status"]) => void;
}

export class AssistantIngestionService {
  private readonly extract: NonNullable<IngestionDependencies["extract"]>;
  private readonly redact: NonNullable<IngestionDependencies["redact"]>;
  private readonly sanitize: NonNullable<IngestionDependencies["sanitize"]>;
  private readonly assertSafe: NonNullable<IngestionDependencies["assertSafe"]>;
  private readonly chunk: NonNullable<IngestionDependencies["chunk"]>;
  private readonly index: IndexExecutor;
  private readonly persist: NonNullable<IngestionDependencies["persist"]>;
  private readonly now: () => string;
  private readonly onStatus: NonNullable<IngestionDependencies["onStatus"]>;

  constructor(dependencies: IngestionDependencies = {}) {
    this.extract = dependencies.extract ?? parseClientDocument;
    this.redact = dependencies.redact ?? redactKnownPersonValues;
    this.sanitize = dependencies.sanitize ?? sanitizeForAI;
    this.assertSafe = dependencies.assertSafe ?? ((value) => { assertSafeForProvider(value); assertSafeForPersistence(value); });
    this.chunk = dependencies.chunk ?? chunkSanitizedUnits;
    this.index = dependencies.index ?? new DirectIndexExecutor();
    this.persist = dependencies.persist ?? (async () => undefined);
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.onStatus = dependencies.onStatus ?? (() => undefined);
  }

  async ingestDocument(input: IngestionDocumentInput): Promise<IngestionResult> {
    try {
      this.onStatus(input.id, "extracting");
      const extracted = await this.extract(input.file, input.mediaType, input.sanitizedSourceLabel);
      if (!extracted.units.length) {
        const nonIndexableReason = extracted.nonIndexableReason ?? "empty_document";
        const timestamp = this.now();
        const block: IngestionBlock = {
          document: { id: input.id, sanitizedSourceLabel: input.sanitizedSourceLabel, scope: input.scope, mediaType: input.mediaType, status: "error", createdAt: timestamp, updatedAt: timestamp },
          chunks: [],
          searchTerms: [],
          indexJob: { id: `${input.id}-index`, documentId: input.id, status: "error", indexedChunkIds: [], nonIndexableReason },
        };
        assertSafeForPersistence(block);
        await this.persist(block);
        this.onStatus(input.id, "error");
        return { documentId: input.id, status: "error", chunkCount: 0, nonIndexableReason };
      }
      this.onStatus(input.id, "anonymizing");
      const identified = this.redact(extracted.units, input.knownPeople ?? []);
      const sanitized = this.sanitize(identified, input.knownPeople ?? []);
      this.assertSafe(sanitized);
      this.onStatus(input.id, "fragmenting");
      const chunks = this.chunk(input.id, sanitized);
      chunks.forEach((chunk) => assertSafeForPersistence(chunk));
      this.onStatus(input.id, "indexing");
      const indexed = this.index.execute(chunks);
      indexed.terms.forEach((term) => assertSafeForPersistence(term));
      const timestamp = this.now();
      const block: IngestionBlock = {
        document: { id: input.id, sanitizedSourceLabel: input.sanitizedSourceLabel, scope: input.scope, mediaType: input.mediaType, status: "ready", createdAt: timestamp, updatedAt: timestamp },
        chunks,
        searchTerms: indexed.terms,
        indexJob: { id: `${input.id}-index`, documentId: input.id, status: "ready", indexedChunkIds: indexed.indexedChunkIds },
      };
      assertSafeForPersistence(block);
      await this.persist(block);
      this.onStatus(input.id, "ready");
      return { documentId: input.id, status: "ready", chunkCount: chunks.length };
    } catch {
      this.onStatus(input.id, "error");
      return { documentId: input.id, status: "error", chunkCount: 0, error: { code: "ingestion_failed", message: "No se pudo indexar el documento sanitizado." } };
    }
  }

  async ingestDocuments(inputs: readonly IngestionDocumentInput[]): Promise<{ readonly status: "ready" | "partial" | "error"; readonly results: readonly IngestionResult[] }> {
    const results = await Promise.all(inputs.map((input) => this.ingestDocument(input)));
    const ready = results.filter((result) => result.status === "ready").length;
    return { status: ready === results.length && ready > 0 ? "ready" : ready > 0 ? "partial" : "error", results };
  }
}

export async function preserveAnalysisResultWhenIngestionFails<T>(analysisPromise: Promise<T>, ingest: (analysis: T) => Promise<unknown>): Promise<T> {
  const analysis = await analysisPromise;
  void ingest(analysis).catch(() => undefined);
  return analysis;
}

export interface AnalysisIngestionInput {
  readonly analysisId: string;
  readonly result: AnalysisResult;
  readonly registroFile: File;
  readonly pdfFiles: readonly File[];
}

export interface AnalysisIngestionDependencies {
  readonly createRepositories?: () => Promise<AssistantRepositories>;
  readonly createIngestionId?: () => string;
  readonly createService?: (persist: (block: IngestionBlock) => Promise<void>) => AssistantIngestionService;
}

export async function startAnalysisDocumentIngestion(input: AnalysisIngestionInput, dependencies: AnalysisIngestionDependencies = {}): Promise<void> {
  const repositories = await (dependencies.createRepositories ?? createIndexedDbRepositories)();
  try {
    const ingestionId = (dependencies.createIngestionId ?? (() => crypto.randomUUID()))();
    await repositories.beginAnalysisIngestion({ analysisId: input.analysisId, ingestionId });
    const blocks: IngestionBlock[] = [];
    const persist = async (block: IngestionBlock): Promise<void> => { blocks.push(block); };
    const service = dependencies.createService?.(persist) ?? new AssistantIngestionService({ persist });
    const knownPeople = input.result.people.map((person) => ({ employeeNumber: person.employeeNumber, person: person.person }));
    const documents: IngestionDocumentInput[] = [
      {
        id: `${input.analysisId}-registro`, file: input.registroFile, mediaType: "xlsx",
        scope: { type: "analysis", analysisId: input.analysisId }, localDisplayName: input.registroFile.name,
        sanitizedSourceLabel: "Registro Retributivo", knownPeople,
      },
      ...input.pdfFiles.map((file, index) => ({
        id: `${input.analysisId}-recibo-${index + 1}`, file, mediaType: "pdf" as const,
        scope: { type: "analysis" as const, analysisId: input.analysisId }, localDisplayName: file.name,
        sanitizedSourceLabel: `Recibo ${index + 1}`, knownPeople,
      })),
    ];
    await service.ingestDocuments(documents);
    if (blocks.length === documents.length) {
      await repositories.replaceAnalysisCorpus({ analysisId: input.analysisId, ingestionId, blocks });
    }
  } finally {
    repositories.close();
  }
}
