import type { PersistedDocumentMetadata } from "@/lib/assistant/domain";
import type { SanitizedDocumentChunk } from "@/lib/assistant/documents/chunker";
import type { SearchTermRecord } from "@/lib/assistant/search/directIndex";
import { assertSafeForPersistence } from "@/lib/assistant/privacy/assertions";

interface CopyDocumentContextInput {
  readonly sourceConversationId: string;
  readonly targetConversationId: string;
  readonly documentIds: readonly string[];
  readonly confirmed: boolean;
}

interface DeleteConversationDocumentsInput {
  readonly conversationId: string;
  readonly transferToConversationId?: string;
  readonly confirmed?: boolean;
}

export function selectConversationDocuments(documents: readonly PersistedDocumentMetadata[], conversationId: string): readonly PersistedDocumentMetadata[] {
  return documents.filter((document) => document.scope.type === "conversation" && document.scope.conversationId === conversationId);
}

export function copyDocumentContext(input: CopyDocumentContextInput, documents: readonly PersistedDocumentMetadata[]): readonly PersistedDocumentMetadata[] {
  if (!input.documentIds.length) throw new Error("Debe seleccionar al menos un documento.");
  if (!input.confirmed) throw new Error("Debe confirmar la copia explícita del contexto documental.");
  if (!input.targetConversationId || input.targetConversationId === input.sourceConversationId) throw new Error("Debe seleccionar una conversación destino diferente.");
  const selected = input.documentIds.map((id) => documents.find((document) => document.id === id));
  if (selected.some((document) => !document || document.scope.type !== "conversation" || document.scope.conversationId !== input.sourceConversationId)) {
    throw new Error("Un documento no pertenece a la conversación de origen.");
  }
  return (selected as PersistedDocumentMetadata[]).map((document) => ({
    ...document,
    id: `${document.id}-copy-${input.targetConversationId}`,
    scope: { type: "conversation", conversationId: input.targetConversationId },
    updatedAt: document.updatedAt,
  }));
}

export interface SanitizedDocumentCorpus {
  readonly documents: readonly PersistedDocumentMetadata[];
  readonly chunks: readonly SanitizedDocumentChunk[];
  readonly searchTerms: readonly SearchTermRecord[];
  readonly indexJobs: readonly { readonly id: string; readonly documentId: string; readonly status: "ready"; readonly indexedChunkIds: readonly string[] }[];
}

export function copySanitizedDocumentCorpus(input: CopyDocumentContextInput, corpus: SanitizedDocumentCorpus): SanitizedDocumentCorpus {
  const documents = copyDocumentContext(input, corpus.documents);
  const documentIds = new Map(input.documentIds.map((sourceDocumentId, index) => [sourceDocumentId, documents[index]!.id]));
  const sourceChunks = corpus.chunks.filter((chunk) => documentIds.has(chunk.documentId));
  const chunks = sourceChunks.map((chunk) => ({
    ...chunk,
    id: `${chunk.id}-copy-${input.targetConversationId}`,
    documentId: documentIds.get(chunk.documentId)!,
  }));
  const chunkIds = new Map(sourceChunks.map((sourceChunk, index) => [sourceChunk.id, chunks[index]!.id]));
  const searchTerms = corpus.searchTerms.filter((term) => chunkIds.has(term.chunkId)).map((term) => ({
    ...term,
    id: `${term.id}-copy-${input.targetConversationId}`,
    documentId: documentIds.get(term.documentId)!,
    chunkId: chunkIds.get(term.chunkId)!,
  }));
  const indexJobs = corpus.indexJobs.filter((job) => documentIds.has(job.documentId)).map((job) => ({
    ...job,
    id: `${job.id}-copy-${input.targetConversationId}`,
    documentId: documentIds.get(job.documentId)!,
    indexedChunkIds: job.indexedChunkIds.map((chunkId) => chunkIds.get(chunkId)).filter((chunkId): chunkId is string => Boolean(chunkId)),
  }));
  const copied = { documents, chunks, searchTerms, indexJobs };
  assertSafeForPersistence(copied);
  return copied;
}

export function planConversationDocumentDeletion(input: DeleteConversationDocumentsInput, documents: readonly PersistedDocumentMetadata[]): { readonly deleteDocumentIds: readonly string[]; readonly copies: readonly PersistedDocumentMetadata[] } {
  const owned = selectConversationDocuments(documents, input.conversationId);
  if (!input.transferToConversationId) return { deleteDocumentIds: owned.map((document) => document.id), copies: [] };
  const copies = copyDocumentContext({
    sourceConversationId: input.conversationId,
    targetConversationId: input.transferToConversationId,
    documentIds: owned.map((document) => document.id),
    confirmed: input.confirmed === true,
  }, documents);
  return { deleteDocumentIds: owned.map((document) => document.id), copies };
}
