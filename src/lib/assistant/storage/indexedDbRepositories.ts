import { convertConversationToAnalysis as buildConversationAnalysisConversion, type AnalysisVersionSnapshot, type AssistantSettings, type ChatAction, type ChatEvent, type ChatMessage, type Conversation, type ModelProfile, type PersistedDocumentMetadata, type SourceReference } from "@/lib/assistant/domain";
import { openAssistantDatabase, type AssistantStoreName } from "@/lib/assistant/storage/database";
import { assertSafeForPersistence } from "@/lib/assistant/privacy/assertions";
import { DirectSearchIndex, type SearchFacets, type SearchIndexRecord } from "@/lib/assistant/search/directIndex";
import type { DocumentScope } from "@/lib/assistant/domain";
import { chatActionSchema, cleanupJobSchema, contextSnapshotSchema } from "@/lib/assistant/schemas";
import type { z } from "zod";
import type {
  AssistantCleanupRepository, AssistantDocumentRepository, AssistantRepositories, AssistantSettingsRepository, AssistantStoredRecord, BeginAnalysisIngestionInput, CleanupJob, ContextSnapshot,
  ContextSnapshotRepository, ContinueAnalysisPersonInput, ConversationRepository, ConversationWriteBlock, ConvertConversationInput, ConvertConversationResult, DeleteDocumentCorpusInput, DocumentCorpusSelection,
  ConversationCollectionRepository, DocumentIdMapping, DocumentIndexJob, EntityRepository, IngestionWriteBlock, MessageRepository,
  ModelConfigurationWrite, ModelProfileRepository, Page, PageOptions, ReplaceAnalysisCorpusInput, ResolveChatActionInput, ResolveChatActionResult, SourceRepository, SyncAnalysisVersionInput, SyncAnalysisVersionResult,
  CleanupPolicy,
} from "@/lib/assistant/storage/repositories";

export class AssistantStorageError extends Error {
  constructor(readonly code: "quota_exceeded" | "storage_error", message: string) {
    super(message);
    this.name = "AssistantStorageError";
  }
}

function safeStorageError(error: unknown): AssistantStorageError {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new AssistantStorageError("quota_exceeded", "No hay espacio suficiente para guardar el bloque del Asistente.");
  }
  return new AssistantStorageError("storage_error", "No se pudo guardar el bloque del Asistente.");
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

class IndexedEntityRepository<T extends { id: string }> implements EntityRepository<T> {
  constructor(protected readonly db: IDBDatabase, protected readonly storeName: AssistantStoreName) {}

  async get(id: string): Promise<T | undefined> {
    const transaction = this.db.transaction(this.storeName, "readonly");
    const value = await requestResult(transaction.objectStore(this.storeName).get(id));
    await transactionDone(transaction);
    return value as T | undefined;
  }

  async put(value: T): Promise<void> {
    assertSafeForPersistence(value);
    const transaction = this.db.transaction(this.storeName, "readwrite");
    transaction.objectStore(this.storeName).put(value);
    await transactionDone(transaction);
  }

  async delete(id: string): Promise<void> {
    const transaction = this.db.transaction(this.storeName, "readwrite");
    transaction.objectStore(this.storeName).delete(id);
    await transactionDone(transaction);
  }

  async listAll(): Promise<T[]> {
    const transaction = this.db.transaction(this.storeName, "readonly");
    const values = await requestResult(transaction.objectStore(this.storeName).getAll());
    await transactionDone(transaction);
    return values as T[];
  }
}

class ValidatedIndexedEntityRepository<T extends { id: string }> extends IndexedEntityRepository<T> {
  constructor(db: IDBDatabase, storeName: AssistantStoreName, private readonly schema: z.ZodType<T>) { super(db, storeName); }
  override async put(value: T): Promise<void> { await super.put(this.schema.parse(value)); }
}

class IndexedCleanupRepository extends ValidatedIndexedEntityRepository<CleanupJob> implements AssistantCleanupRepository {
  constructor(db: IDBDatabase) { super(db, "cleanupJobs", cleanupJobSchema); }
  async listByStatus(statuses: readonly CleanupJob["status"][]): Promise<CleanupJob[]> {
    const all = await this.listAll();
    const allowed = new Set(statuses);
    return all.filter((job) => allowed.has(job.status)).sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  }
}

class IndexedConversationCollectionRepository<T extends { id: string; conversationId: string; createdAt: string }>
  extends IndexedEntityRepository<T> implements ConversationCollectionRepository<T> {
  async listByConversation(conversationId: string): Promise<T[]> {
    const transaction = this.db.transaction(this.storeName, "readonly");
    const values = await requestResult(transaction.objectStore(this.storeName).index("conversationId").getAll(IDBKeyRange.only(conversationId)));
    await transactionDone(transaction);
    return (values as T[]).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
}

class ValidatedConversationCollectionRepository<T extends { id: string; conversationId: string; createdAt: string }>
  extends IndexedConversationCollectionRepository<T> {
  constructor(db: IDBDatabase, storeName: AssistantStoreName, private readonly schema: z.ZodType<T>) { super(db, storeName); }
  override async put(value: T): Promise<void> { await super.put(this.schema.parse(value)); }
}

interface CursorPosition { indexKey: string; primaryKey: string }

function encodeCursor(position: CursorPosition): string {
  return encodeURIComponent(JSON.stringify(position));
}

function decodeCursor(cursor: string): CursorPosition {
  return JSON.parse(decodeURIComponent(cursor)) as CursorPosition;
}

function cursorValues<T>(request: IDBRequest<IDBCursorWithValue | null>, limit: number): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const values: T[] = [];
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || values.length >= limit) { resolve(values); return; }
      values.push(cursor.value as T);
      if (values.length >= limit) { resolve(values); return; }
      cursor.continue();
    };
  });
}

function convertMessageCursor(request: IDBRequest<IDBCursorWithValue | null>): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      try {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const converted = { ...(cursor.value as ChatMessage), contextOrigin: "general" as const };
        assertSafeForPersistence(converted);
        cursor.update(converted);
        cursor.continue();
      } catch (error) {
        reject(error);
      }
    };
  });
}

class IndexedConversationRepository extends IndexedEntityRepository<Conversation> implements ConversationRepository {
  constructor(db: IDBDatabase) { super(db, "conversations"); }
  async list(options: PageOptions): Promise<Page<Conversation>> {
    const transaction = this.db.transaction(this.storeName, "readonly");
    const after = options.cursor ? decodeCursor(options.cursor) : undefined;
    const range = after ? IDBKeyRange.upperBound([after.indexKey, after.primaryKey], true) : undefined;
    const values = await cursorValues<Conversation>(transaction.objectStore(this.storeName).index("updatedAtId").openCursor(range, "prev"), options.limit + 1);
    await transactionDone(transaction);
    const items = values.slice(0, options.limit);
    const last = items.at(-1);
    return { items, nextCursor: values.length > items.length && last ? encodeCursor({ indexKey: last.updatedAt, primaryKey: last.id }) : undefined };
  }
}

class IndexedMessageRepository extends IndexedEntityRepository<ChatMessage> implements MessageRepository {
  constructor(db: IDBDatabase) { super(db, "messages"); }
  async listByConversation(conversationId: string, options: PageOptions): Promise<Page<ChatMessage>> {
    const transaction = this.db.transaction(this.storeName, "readonly");
    const after = options.cursor ? decodeCursor(options.cursor) : undefined;
    const lower: IDBValidKey = [conversationId];
    const upper: IDBValidKey = after ? [conversationId, after.indexKey, after.primaryKey] : [conversationId, []];
    const range = IDBKeyRange.bound(lower, upper, false, Boolean(after));
    const values = await cursorValues<ChatMessage>(transaction.objectStore(this.storeName).index("conversationCreatedAtId").openCursor(range, "prev"), options.limit + 1);
    await transactionDone(transaction);
    const selected = values.slice(0, options.limit);
    const last = selected.at(-1);
    const items = selected.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    return { items, nextCursor: values.length > selected.length && last ? encodeCursor({ indexKey: last.createdAt, primaryKey: last.id }) : undefined };
  }
}

export interface IndexedDbRepositoriesOptions { factory?: IDBFactory; dbName?: string }

interface StoredChunkRecord extends AssistantStoredRecord {
  documentId: string; sequence: number; content: string; snippet: string; sanitizedHash: string; terms: readonly string[]; scope?: DocumentScope; availability?: "available" | "historical_unavailable"; facets?: SearchFacets;
}
interface StoredSearchTermRecord extends AssistantStoredRecord {
  documentId: string; chunkId: string; term: string; positions: readonly number[]; scope?: DocumentScope; availability?: "available" | "historical_unavailable"; facets?: SearchFacets;
}
interface DocumentCorpusRecords {
  documents: PersistedDocumentMetadata[];
  chunks: StoredChunkRecord[];
  searchTerms: StoredSearchTermRecord[];
  indexJobs: DocumentIndexJob[];
}

interface AnalysisIngestionGeneration extends AssistantStoredRecord {
  readonly analysisId: string;
  readonly ingestionId: string;
}

function analysisIngestionGenerationId(analysisId: string): string {
  return `analysis-ingestion-${analysisId}`;
}
function analysisCleanupTombstoneId(analysisId: string): string { return `analysis-cleaned-${analysisId}`; }

async function readDocumentCorpus(transaction: IDBTransaction): Promise<DocumentCorpusRecords> {
  const [documents, chunks, searchTerms, indexJobs] = await Promise.all([
    requestResult(transaction.objectStore("documents").getAll()),
    requestResult(transaction.objectStore("chunks").getAll()),
    requestResult(transaction.objectStore("searchTerms").getAll()),
    requestResult(transaction.objectStore("indexJobs").getAll()),
  ]);
  return {
    documents: documents as PersistedDocumentMetadata[],
    chunks: chunks as StoredChunkRecord[],
    searchTerms: searchTerms as StoredSearchTermRecord[],
    indexJobs: indexJobs as DocumentIndexJob[],
  };
}

function selectedConversationDocuments(records: DocumentCorpusRecords, conversationId: string, documentIds: readonly string[]): PersistedDocumentMetadata[] {
  const selected = documentIds.map((id) => records.documents.find((document) => document.id === id));
  if (selected.some((document) => !document || document.scope.type !== "conversation" || document.scope.conversationId !== conversationId)) {
    throw new Error("Selección documental no válida.");
  }
  return selected as PersistedDocumentMetadata[];
}

function deleteCorpusRecords(transaction: IDBTransaction, records: DocumentCorpusRecords, documentIds: ReadonlySet<string>): void {
  records.documents.filter((record) => documentIds.has(record.id)).forEach((record) => transaction.objectStore("documents").delete(record.id));
  records.chunks.filter((record) => documentIds.has(record.documentId)).forEach((record) => transaction.objectStore("chunks").delete(record.id));
  records.searchTerms.filter((record) => documentIds.has(record.documentId)).forEach((record) => transaction.objectStore("searchTerms").delete(record.id));
  records.indexJobs.filter((record) => documentIds.has(record.documentId)).forEach((record) => transaction.objectStore("indexJobs").delete(record.id));
}

function samePersistedAction(left: ChatAction, right: ChatAction): boolean {
  return JSON.stringify(chatActionSchema.parse(left)) === JSON.stringify(chatActionSchema.parse(right));
}

export async function createIndexedDbRepositories(options: IndexedDbRepositoriesOptions = {}): Promise<AssistantRepositories> {
  const db = await openAssistantDatabase(options.factory, options.dbName);
  const conversations = new IndexedConversationRepository(db);
  const messages = new IndexedMessageRepository(db);
  const events = new IndexedConversationCollectionRepository<ChatEvent>(db, "events");
  const actions = new IndexedConversationCollectionRepository<ChatAction>(db, "actions");
  const documents = new IndexedEntityRepository<PersistedDocumentMetadata>(db, "documents") as AssistantDocumentRepository;
  const sources = new IndexedEntityRepository<SourceReference>(db, "sources") as SourceRepository;
  const chunks = new IndexedEntityRepository<AssistantStoredRecord>(db, "chunks");
  const searchTerms = new IndexedEntityRepository<AssistantStoredRecord>(db, "searchTerms");
  const snapshots = new ValidatedConversationCollectionRepository<ContextSnapshot>(db, "snapshots", contextSnapshotSchema) as ContextSnapshotRepository;
  const cache = new IndexedEntityRepository<AssistantStoredRecord>(db, "cache");
  const analysisVersions = new IndexedEntityRepository<AssistantStoredRecord | AnalysisVersionSnapshot>(db, "analysisVersions");
  const indexJobs = new IndexedEntityRepository<AssistantStoredRecord>(db, "indexJobs");
  const modelProfiles = new IndexedEntityRepository<ModelProfile>(db, "modelProfiles") as ModelProfileRepository;
  const assistantSettings = new IndexedEntityRepository<AssistantSettings>(db, "assistantSettings") as AssistantSettingsRepository;
  const cleanupJobs = new IndexedCleanupRepository(db);

  async function mutateDocumentCorpus(input: DocumentCorpusSelection, removeSource: boolean): Promise<readonly DocumentIdMapping[]> {
    const transaction = db.transaction(["documents", "chunks", "searchTerms", "indexJobs"], "readwrite");
    const done = transactionDone(transaction);
    try {
      if (!input.documentIds.length || input.sourceConversationId === input.targetConversationId) throw new Error("Selección documental no válida.");
      const records = await readDocumentCorpus(transaction);
      const selected = selectedConversationDocuments(records, input.sourceConversationId, input.documentIds);
      const mappings = selected.map((document) => ({ sourceDocumentId: document.id, targetDocumentId: `${document.id}-copy-${input.targetConversationId}` }));
      const targetDocumentIds = new Set(mappings.map((mapping) => mapping.targetDocumentId));
      const targetExists = records.documents.some((record) => targetDocumentIds.has(record.id))
        || records.chunks.some((record) => targetDocumentIds.has(record.documentId))
        || records.searchTerms.some((record) => targetDocumentIds.has(record.documentId))
        || records.indexJobs.some((record) => targetDocumentIds.has(record.documentId));
      if (targetExists) throw new Error("El corpus documental de destino ya existe.");
      const documentMap = new Map(mappings.map((mapping) => [mapping.sourceDocumentId, mapping.targetDocumentId]));
      const copiedDocuments = selected.map((document) => ({ ...document, id: documentMap.get(document.id)!, scope: { type: "conversation" as const, conversationId: input.targetConversationId } }));
      const copiedChunks = records.chunks.filter((chunk) => documentMap.has(chunk.documentId)).map((chunk) => ({
        ...chunk,
        id: `${documentMap.get(chunk.documentId)!}-chunk-${chunk.sequence}`,
        documentId: documentMap.get(chunk.documentId)!,
        scope: { type: "conversation" as const, conversationId: input.targetConversationId },
      }));
      const chunkMap = new Map(records.chunks.filter((chunk) => documentMap.has(chunk.documentId)).map((chunk) => [chunk.id, `${documentMap.get(chunk.documentId)!}-chunk-${chunk.sequence}`]));
      const copiedTerms = records.searchTerms.filter((term) => documentMap.has(term.documentId) && chunkMap.has(term.chunkId)).map((term) => ({
        ...term,
        id: `${chunkMap.get(term.chunkId)!}-term-${term.term}`,
        documentId: documentMap.get(term.documentId)!,
        chunkId: chunkMap.get(term.chunkId)!,
        scope: { type: "conversation" as const, conversationId: input.targetConversationId },
      }));
      const copiedJobs = records.indexJobs.filter((job) => documentMap.has(job.documentId)).map((job) => ({
        ...job,
        id: `${documentMap.get(job.documentId)!}-index`,
        documentId: documentMap.get(job.documentId)!,
        indexedChunkIds: job.indexedChunkIds.map((id) => chunkMap.get(id)).filter((id): id is string => Boolean(id)),
      }));
      assertSafeForPersistence({ copiedDocuments, copiedChunks, copiedTerms, copiedJobs });
      copiedDocuments.forEach((record) => transaction.objectStore("documents").put(record));
      copiedChunks.forEach((record) => transaction.objectStore("chunks").put(record));
      copiedTerms.forEach((record) => transaction.objectStore("searchTerms").put(record));
      copiedJobs.forEach((record) => transaction.objectStore("indexJobs").put(record));
      if (removeSource) deleteCorpusRecords(transaction, records, new Set(input.documentIds));
      await done;
      return mappings;
    } catch (error) {
      try { transaction.abort(); } catch { /* already completed or aborted */ }
      await done.catch(() => undefined);
      throw error instanceof Error && error.name === "PrivacyBoundaryError" ? error : safeStorageError(error);
    }
  }

  return {
    conversations, messages, events, actions, documents, sources, chunks, searchTerms, snapshots, cache, analysisVersions, indexJobs, modelProfiles, assistantSettings, cleanupJobs,
    async buildSearchIndex(scope) {
      const transaction = db.transaction(["documents", "chunks"], "readonly");
      const [storedDocuments, storedChunks] = await Promise.all([requestResult(transaction.objectStore("documents").getAll()), requestResult(transaction.objectStore("chunks").getAll())]); await transactionDone(transaction);
      const documentMap = new Map((storedDocuments as PersistedDocumentMetadata[]).map((document) => [document.id, document]));
      const records: SearchIndexRecord[] = (storedChunks as StoredChunkRecord[]).flatMap((chunk) => { const document = documentMap.get(chunk.documentId); if (!document) return []; const recordScope = document.scope; const same = recordScope.type === scope.type && (scope.type === "analysis" ? recordScope.type === "analysis" && recordScope.analysisId === scope.analysisId : recordScope.type === "conversation" && recordScope.conversationId === scope.conversationId); if (!same) return []; return [{ id: chunk.id, documentId: chunk.documentId, chunkId: chunk.id, scope: recordScope, availability: document.status === "ready" ? "available" : "historical_unavailable", sanitizedHash: chunk.sanitizedHash, sanitizedSourceLabel: document.sanitizedSourceLabel, content: chunk.content, facets: chunk.facets ?? { sourceType: [document.mediaType] } }]; });
      return new DirectSearchIndex(records);
    },
    async writeConversationBlock(block: ConversationWriteBlock): Promise<void> {
      assertSafeForPersistence(block);
      const transaction = db.transaction(["conversations", "messages", "sources", "events", "analysisVersions"], "readwrite");
      const done = transactionDone(transaction);
      try {
        const authoritative = await requestResult(transaction.objectStore("conversations").get(block.conversation.id)) as Conversation | undefined;
        if (authoritative?.status !== undefined && authoritative.status !== "active") throw new Error("La conversación no está activa.");
        if (!authoritative && block.conversation.type === "analysis") {
          const analysisId = block.conversation.analysisId;
          if (!analysisId) throw new Error("El análisis no está disponible.");
          const tombstone = await requestResult(transaction.objectStore("analysisVersions").get(analysisCleanupTombstoneId(analysisId)));
          if (tombstone) throw new Error("El análisis ya no está disponible.");
        }
        transaction.objectStore("conversations").put(authoritative ? { ...authoritative, updatedAt: block.conversation.updatedAt } : block.conversation);
        for (const message of block.messages) transaction.objectStore("messages").put(message);
        for (const source of block.sources) transaction.objectStore("sources").put(source);
        for (const event of block.events ?? []) transaction.objectStore("events").put(event);
        await done;
      } catch (error) {
        try { transaction.abort(); } catch { /* already completed or aborted */ }
        await done.catch(() => undefined);
        throw safeStorageError(error);
      }
    },
    async updateActiveConversation(conversationId: string, patch: Partial<Conversation>, updatedAt: string): Promise<Conversation | undefined> {
      const transaction = db.transaction("conversations", "readwrite");
      const done = transactionDone(transaction);
      try {
        const authoritative = await requestResult(transaction.objectStore("conversations").get(conversationId)) as Conversation | undefined;
        if (!authoritative || authoritative.status !== "active") { await done; return undefined; }
        const updated = { ...authoritative, ...patch, id: authoritative.id, status: patch.status ?? authoritative.status, updatedAt };
        assertSafeForPersistence(updated);
        transaction.objectStore("conversations").put(updated);
        await done;
        return updated;
      } catch (error) {
        try { transaction.abort(); } catch { /* completed */ }
        await done.catch(() => undefined);
        throw safeStorageError(error);
      }
    },
    async continueAnalysisPerson(input: ContinueAnalysisPersonInput): Promise<Conversation | undefined> {
      const transaction = db.transaction(["conversations", "analysisVersions"], "readwrite");
      const done = transactionDone(transaction);
      try {
        const tombstone = await requestResult(transaction.objectStore("analysisVersions").get(analysisCleanupTombstoneId(input.analysisId)));
        if (tombstone) { await done; return undefined; }
        const all = await requestResult(transaction.objectStore("conversations").getAll()) as Conversation[];
        const existing = all.find((item) => item.type === "analysis" && item.analysisId === input.analysisId && item.status === "active");
        const base: Conversation = existing ?? { id: `analysis-conversation-${input.analysisId}-${crypto.randomUUID()}`, type: "analysis", analysisId: input.analysisId, title: `Análisis ${input.analysisId}`, associatedPersonIds: [], modelProfileId: input.modelProfileId, responseMode: "strict", contextStrategy: "automatic", analysisVersion: input.analysisVersion, status: "active", createdAt: input.updatedAt, updatedAt: input.updatedAt };
        const selected = { ...base, analysisVersion: input.analysisVersion, associatedPersonIds: [...new Set([...base.associatedPersonIds, input.personId])], primaryPersonId: input.personId, updatedAt: input.updatedAt };
        assertSafeForPersistence(selected); transaction.objectStore("conversations").put(selected);
        await done; return selected;
      } catch (error) {
        try { transaction.abort(); } catch { /* completed */ }
        await done.catch(() => undefined); throw safeStorageError(error);
      }
    },
    async resolveChatAction(input: ResolveChatActionInput): Promise<ResolveChatActionResult> {
      const stores: AssistantStoreName[] = ["actions", "events", "conversations", "messages", "sources", "documents", "chunks", "searchTerms", "indexJobs"];
      const transaction = db.transaction(stores, "readwrite");
      const done = transactionDone(transaction);
      try {
        const expected = chatActionSchema.parse(input.expected);
        const stored = await requestResult(transaction.objectStore("actions").get(expected.id)) as ChatAction | undefined;
        if (!stored || stored.status !== "pending" || expected.status !== "pending" || !samePersistedAction(stored, expected)) throw new Error("La identidad de la propuesta no coincide.");
        const conversation = await requestResult(transaction.objectStore("conversations").get(stored.conversationId)) as Conversation | undefined;
        const message = await requestResult(transaction.objectStore("messages").get(stored.messageId)) as ChatMessage | undefined;

        let updatedConversation: Conversation | undefined;
        let createdConversation: Conversation | undefined;
        let documentMappings: readonly DocumentIdMapping[] | undefined;
        if (input.status === "accepted") {
          if (!conversation || conversation.status !== "active" || message?.conversationId !== conversation.id) throw new Error("La acción no está disponible.");
          const payload = stored.action;
          if (payload.type === "show_sources") {
            for (const sourceId of payload.sourceIds) {
              const source = await requestResult(transaction.objectStore("sources").get(sourceId)) as SourceReference | undefined;
              if (!source || source.conversationId !== conversation.id || source.availability !== "available") throw new Error("La fuente no está disponible.");
            }
          } else if (payload.type === "add_person" || payload.type === "set_primary_person") {
            const associatedPersonIds = [...new Set([...conversation.associatedPersonIds, payload.personId])];
            updatedConversation = { ...conversation, associatedPersonIds, primaryPersonId: payload.type === "set_primary_person" ? payload.personId : conversation.primaryPersonId ?? payload.personId, updatedAt: input.resolvedAt };
            transaction.objectStore("conversations").put(updatedConversation);
          } else if (payload.type === "remove_person") {
            const associatedPersonIds = conversation.associatedPersonIds.filter((id) => id !== payload.personId);
            updatedConversation = { ...conversation, associatedPersonIds, primaryPersonId: conversation.primaryPersonId === payload.personId ? associatedPersonIds[0] : conversation.primaryPersonId, updatedAt: input.resolvedAt };
            transaction.objectStore("conversations").put(updatedConversation);
          } else if (payload.type === "create_conversation") {
            if (payload.sourceConversationId !== conversation.id) throw new Error("La conversación de origen no es válida.");
            createdConversation = { ...conversation, id: `conversation-${crypto.randomUUID()}`, title: "Nueva conversación", associatedPersonIds: [], primaryPersonId: undefined, createdAt: input.resolvedAt, updatedAt: input.resolvedAt };
            transaction.objectStore("conversations").put(createdConversation);
          } else if (payload.type === "copy_document_context") {
            if (payload.sourceConversationId !== conversation.id || payload.sourceConversationId === payload.targetConversationId || !payload.documentIds.length) throw new Error("El scope documental de origen no es válido.");
            const target = await requestResult(transaction.objectStore("conversations").get(payload.targetConversationId)) as Conversation | undefined;
            if (!target || target.status !== "active") throw new Error("La conversación destino no está disponible.");
            const records = await readDocumentCorpus(transaction);
            const selected = selectedConversationDocuments(records, payload.sourceConversationId, payload.documentIds);
            const mappings = selected.map((document) => ({ sourceDocumentId: document.id, targetDocumentId: `${document.id}-copy-${payload.targetConversationId}` }));
            const documentMap = new Map(mappings.map((mapping) => [mapping.sourceDocumentId, mapping.targetDocumentId]));
            if (records.documents.some((record) => mappings.some((mapping) => mapping.targetDocumentId === record.id))) throw new Error("El corpus documental de destino ya existe.");
            const copiedDocuments = selected.map((document) => ({ ...document, id: documentMap.get(document.id)!, scope: { type: "conversation" as const, conversationId: payload.targetConversationId } }));
            const copiedChunks = records.chunks.filter((chunk) => documentMap.has(chunk.documentId)).map((chunk) => ({ ...chunk, id: `${documentMap.get(chunk.documentId)!}-chunk-${chunk.sequence}`, documentId: documentMap.get(chunk.documentId)!, scope: { type: "conversation" as const, conversationId: payload.targetConversationId } }));
            const chunkMap = new Map(records.chunks.filter((chunk) => documentMap.has(chunk.documentId)).map((chunk) => [chunk.id, `${documentMap.get(chunk.documentId)!}-chunk-${chunk.sequence}`]));
            const copiedTerms = records.searchTerms.filter((term) => documentMap.has(term.documentId) && chunkMap.has(term.chunkId)).map((term) => ({ ...term, id: `${chunkMap.get(term.chunkId)!}-term-${term.term}`, documentId: documentMap.get(term.documentId)!, chunkId: chunkMap.get(term.chunkId)!, scope: { type: "conversation" as const, conversationId: payload.targetConversationId } }));
            const copiedJobs = records.indexJobs.filter((job) => documentMap.has(job.documentId)).map((job) => ({ ...job, id: `${documentMap.get(job.documentId)!}-index`, documentId: documentMap.get(job.documentId)!, indexedChunkIds: job.indexedChunkIds.map((id) => chunkMap.get(id)).filter((id): id is string => Boolean(id)) }));
            assertSafeForPersistence({ copiedDocuments, copiedChunks, copiedTerms, copiedJobs });
            copiedDocuments.forEach((record) => transaction.objectStore("documents").put(record)); copiedChunks.forEach((record) => transaction.objectStore("chunks").put(record)); copiedTerms.forEach((record) => transaction.objectStore("searchTerms").put(record)); copiedJobs.forEach((record) => transaction.objectStore("indexJobs").put(record));
            documentMappings = mappings;
          }
        }
        const resolved = chatActionSchema.parse({ ...stored, status: input.status, resolvedAt: input.resolvedAt });
        const event: ChatEvent = { id: `event-${stored.id}-${input.status}`, conversationId: stored.conversationId, event: { type: `action_${input.status}`, actionId: stored.id } as ChatEvent["event"], createdAt: input.resolvedAt };
        assertSafeForPersistence({ resolved, event });
        transaction.objectStore("actions").put(resolved); transaction.objectStore("events").put(event);
        await done;
        return { action: resolved, conversation: updatedConversation, createdConversation, documentMappings };
      } catch (error) {
        try { transaction.abort(); } catch { /* completed */ }
        await done.catch(() => undefined);
        throw safeStorageError(error);
      }
    },
    async syncAnalysisVersion(input: SyncAnalysisVersionInput): Promise<SyncAnalysisVersionResult> {
      const transaction = db.transaction(["analysisVersions", "conversations", "events"], "readwrite");
      const done = transactionDone(transaction);
      try {
        assertSafeForPersistence(input.snapshot);
        const tombstone = await requestResult(transaction.objectStore("analysisVersions").get(analysisCleanupTombstoneId(input.analysisId)));
        if (tombstone) throw new Error("El análisis ya no está disponible.");
        transaction.objectStore("analysisVersions").put(input.snapshot);
        const all = await requestResult(transaction.objectStore("conversations").getAll()) as Conversation[];
        const candidates = all.filter((item) => item.analysisId === input.analysisId && item.status === "active" && item.analysisVersion !== input.snapshot.analysisVersion);
        for (const authoritative of candidates) {
          const updated = { ...authoritative, analysisVersion: input.snapshot.analysisVersion, updatedAt: input.updatedAt };
          const event: ChatEvent = { id: `analysis-updated-${authoritative.id}-${input.snapshot.analysisVersion}`, conversationId: authoritative.id, event: { type: "analysis_updated", previousVersion: authoritative.analysisVersion ?? "sin-version", analysisVersion: input.snapshot.analysisVersion }, createdAt: input.updatedAt };
          assertSafeForPersistence({ updated, event });
          transaction.objectStore("conversations").put(updated); transaction.objectStore("events").put(event);
        }
        await done;
        return { changed: candidates.length > 0, updatedConversationIds: candidates.map((item) => item.id) };
      } catch (error) {
        try { transaction.abort(); } catch { /* completed */ }
        await done.catch(() => undefined);
        throw safeStorageError(error);
      }
    },
    async convertConversationToAnalysis(input: ConvertConversationInput): Promise<ConvertConversationResult | undefined> {
      const transaction = db.transaction(["conversations", "messages", "events", "analysisVersions"], "readwrite");
      const done = transactionDone(transaction);
      try {
        const tombstone = await requestResult(transaction.objectStore("analysisVersions").get(analysisCleanupTombstoneId(input.analysisId)));
        if (tombstone) { await done; return undefined; }
        const authoritative = await requestResult(transaction.objectStore("conversations").get(input.conversationId)) as Conversation | undefined;
        if (!authoritative || authoritative.type !== "general") {
          await done;
          return undefined;
        }
        const converted = buildConversationAnalysisConversion(authoritative, [], input.analysisId, input.analysisVersion, input.convertedAt);
        assertSafeForPersistence(converted);
        await convertMessageCursor(transaction.objectStore("messages").index("conversationId").openCursor(IDBKeyRange.only(input.conversationId)));
        transaction.objectStore("conversations").put(converted.conversation);
        transaction.objectStore("events").put(converted.event);
        await done;
        return { conversation: converted.conversation, event: converted.event };
      } catch (error) {
        try { transaction.abort(); } catch { /* already completed or aborted */ }
        await done.catch(() => undefined);
        throw error instanceof Error && error.name === "PrivacyBoundaryError" ? error : safeStorageError(error);
      }
    },
    async writeIngestionBlock(block: IngestionWriteBlock): Promise<void> {
      assertSafeForPersistence(block);
      const transaction = db.transaction(["documents", "chunks", "searchTerms", "indexJobs", "analysisVersions"], "readwrite");
      const done = transactionDone(transaction);
      try {
        if (block.document.scope.type === "analysis") {
          const tombstone = await requestResult(transaction.objectStore("analysisVersions").get(analysisCleanupTombstoneId(block.document.scope.analysisId)));
          if (tombstone) throw new Error("El análisis ya no está disponible.");
        }
        transaction.objectStore("documents").put(block.document);
        const availability = block.document.status === "ready" ? "available" : "historical_unavailable";
        for (const chunk of block.chunks) transaction.objectStore("chunks").put({ ...chunk, scope: block.document.scope, availability, facets: chunk.facets ?? { sourceType: [block.document.mediaType] } });
        for (const term of block.searchTerms) transaction.objectStore("searchTerms").put({ ...term, scope: block.document.scope, availability, facets: term.facets ?? { sourceType: [block.document.mediaType] } });
        transaction.objectStore("indexJobs").put(block.indexJob);
        await done;
      } catch (error) {
        try { transaction.abort(); } catch { /* already completed or aborted */ }
        await done.catch(() => undefined);
        throw error instanceof Error && error.name === "PrivacyBoundaryError" ? error : safeStorageError(error);
      }
    },
    async beginAnalysisIngestion(input: BeginAnalysisIngestionInput): Promise<void> {
      const generation: AnalysisIngestionGeneration = {
        id: analysisIngestionGenerationId(input.analysisId), analysisId: input.analysisId, ingestionId: input.ingestionId,
      };
      assertSafeForPersistence(generation);
      const transaction = db.transaction("analysisVersions", "readwrite");
      const done = transactionDone(transaction);
      try {
        const tombstone = await requestResult(transaction.objectStore("analysisVersions").get(analysisCleanupTombstoneId(input.analysisId)));
        if (tombstone) throw new Error("El análisis ya no está disponible.");
        transaction.objectStore("analysisVersions").put(generation);
        await done;
      } catch (error) {
        try { transaction.abort(); } catch { /* already completed or aborted */ }
        await done.catch(() => undefined);
        throw safeStorageError(error);
      }
    },
    async replaceAnalysisCorpus(input: ReplaceAnalysisCorpusInput): Promise<boolean> {
      if (!input.blocks.length) throw new AssistantStorageError("storage_error", "No se pudo guardar el bloque del Asistente.");
      assertSafeForPersistence(input);
      const incomingDocumentIds = new Set<string>();
      for (const block of input.blocks) {
        const scope = block.document.scope;
        const chunkIds = new Set(block.chunks.map((chunk) => chunk.id));
        const structurallyComplete = scope.type === "analysis" && scope.analysisId === input.analysisId
          && !incomingDocumentIds.has(block.document.id)
          && block.chunks.every((chunk) => chunk.documentId === block.document.id)
          && block.searchTerms.every((term) => term.documentId === block.document.id && chunkIds.has(term.chunkId))
          && block.indexJob.documentId === block.document.id
          && block.indexJob.indexedChunkIds.every((chunkId) => chunkIds.has(chunkId));
        if (!structurallyComplete) throw new AssistantStorageError("storage_error", "No se pudo guardar el bloque del Asistente.");
        incomingDocumentIds.add(block.document.id);
      }

      const transaction = db.transaction(["analysisVersions", "documents", "chunks", "searchTerms", "indexJobs"], "readwrite");
      const done = transactionDone(transaction);
      try {
        const tombstone = await requestResult(transaction.objectStore("analysisVersions").get(analysisCleanupTombstoneId(input.analysisId)));
        if (tombstone) { await done; return false; }
        const generation = await requestResult(transaction.objectStore("analysisVersions").get(analysisIngestionGenerationId(input.analysisId))) as AnalysisIngestionGeneration | undefined;
        if (generation?.ingestionId !== input.ingestionId) {
          await done;
          return false;
        }
        const records = await readDocumentCorpus(transaction);
        const previousDocumentIds = new Set(records.documents
          .filter((document) => document.scope.type === "analysis" && document.scope.analysisId === input.analysisId)
          .map((document) => document.id));
        deleteCorpusRecords(transaction, records, previousDocumentIds);
        for (const block of input.blocks) {
          transaction.objectStore("documents").put(block.document);
          const availability = block.document.status === "ready" ? "available" : "historical_unavailable";
          for (const chunk of block.chunks) transaction.objectStore("chunks").put({ ...chunk, scope: block.document.scope, availability, facets: chunk.facets ?? { sourceType: [block.document.mediaType] } });
          for (const term of block.searchTerms) transaction.objectStore("searchTerms").put({ ...term, scope: block.document.scope, availability, facets: term.facets ?? { sourceType: [block.document.mediaType] } });
          transaction.objectStore("indexJobs").put(block.indexJob);
        }
        await done;
        return true;
      } catch (error) {
        try { transaction.abort(); } catch { /* already completed or aborted */ }
        await done.catch(() => undefined);
        throw error instanceof Error && error.name === "PrivacyBoundaryError" ? error : safeStorageError(error);
      }
    },
    copyDocumentCorpus: (input: DocumentCorpusSelection) => mutateDocumentCorpus(input, false),
    transferDocumentCorpus: (input: DocumentCorpusSelection) => mutateDocumentCorpus(input, true),
    async deleteDocumentCorpus(input: DeleteDocumentCorpusInput): Promise<void> {
      const transaction = db.transaction(["documents", "chunks", "searchTerms", "indexJobs"], "readwrite");
      const done = transactionDone(transaction);
      try {
        const records = await readDocumentCorpus(transaction);
        selectedConversationDocuments(records, input.conversationId, input.documentIds);
        deleteCorpusRecords(transaction, records, new Set(input.documentIds));
        await done;
      } catch (error) {
        try { transaction.abort(); } catch { /* already completed or aborted */ }
        await done.catch(() => undefined);
        throw safeStorageError(error);
      }
    },
    async deleteConversation(conversationId: string): Promise<void> {
      const stores: AssistantStoreName[] = ["actions", "cache", "chunks", "cleanupJobs", "conversations", "documents", "events", "indexJobs", "messages", "searchTerms", "snapshots", "sources"];
      const transaction = db.transaction(stores, "readwrite");
      const done = transactionDone(transaction);
      try {
        const records = new Map<AssistantStoreName, AssistantStoredRecord[]>();
        await Promise.all(stores.map(async (store) => {
          records.set(store, await requestResult(transaction.objectStore(store).getAll()) as AssistantStoredRecord[]);
        }));
        const conversationDocumentIds = new Set((records.get("documents") ?? [])
          .filter((record) => {
            const scope = record.scope as { type?: string; conversationId?: string } | undefined;
            return scope?.type === "conversation" && scope.conversationId === conversationId;
          })
          .map((record) => record.id));
        const belongsToConversation = (record: AssistantStoredRecord): boolean => {
          const scope = record.scope as { type?: string; conversationId?: string } | undefined;
          const documentIds = record.documentIds as readonly string[] | undefined;
          return record.conversationId === conversationId
            || (scope?.type === "conversation" && scope.conversationId === conversationId)
            || (typeof record.documentId === "string" && conversationDocumentIds.has(record.documentId))
            || Boolean(documentIds?.some((id) => conversationDocumentIds.has(id)));
        };
        for (const store of stores) {
          for (const record of records.get(store) ?? []) {
            if ((store === "conversations" && record.id === conversationId) || (store !== "conversations" && belongsToConversation(record))) transaction.objectStore(store).delete(record.id);
          }
        }
        await done;
      } catch (error) {
        try { transaction.abort(); } catch { /* already completed or aborted */ }
        await done.catch(() => undefined);
        throw safeStorageError(error);
      }
    },
    async clearAssistantContent(): Promise<void> {
      const stores: AssistantStoreName[] = ["actions", "analysisVersions", "cache", "chunks", "cleanupJobs", "conversations", "documents", "events", "indexJobs", "messages", "searchTerms", "snapshots", "sources"];
      const transaction = db.transaction(stores, "readwrite");
      const done = transactionDone(transaction);
      try {
        stores.forEach((store) => transaction.objectStore(store).clear());
        await done;
      } catch (error) {
        try { transaction.abort(); } catch { /* already completed */ }
        await done.catch(() => undefined);
        throw safeStorageError(error);
      }
    },
    async cleanupAnalysis(analysisId: string, policy: CleanupPolicy): Promise<void> {
      const stores: AssistantStoreName[] = ["actions", "analysisVersions", "cache", "chunks", "conversations", "documents", "events", "indexJobs", "messages", "searchTerms", "snapshots", "sources"];
      const transaction = db.transaction(stores, "readwrite");
      const done = transactionDone(transaction);
      try {
        const records = new Map<AssistantStoreName, AssistantStoredRecord[]>();
        await Promise.all(stores.map(async (store) => records.set(store, await requestResult(transaction.objectStore(store).getAll()) as AssistantStoredRecord[])));
        const conversations = (records.get("conversations") ?? []).filter((record) => record.analysisId === analysisId);
        const conversationIds = new Set(conversations.map((record) => record.id));
        const retainedMessages = (records.get("messages") ?? [])
          .filter((record) => typeof record.conversationId === "string" && conversationIds.has(record.conversationId));
        const retainedMessageIds = new Set(retainedMessages.map((record) => record.id));
        const referencedSourceIds = new Set(retainedMessages
          .flatMap((record) => Array.isArray(record.sourceRefIds) ? record.sourceRefIds.filter((id): id is string => typeof id === "string") : []));
        for (const source of records.get("sources") ?? []) {
          if (typeof source.messageId === "string" && retainedMessageIds.has(source.messageId)) referencedSourceIds.add(source.id);
        }
        const documents = (records.get("documents") ?? []).filter((record) => {
          const scope = record.scope as { type?: string; analysisId?: string; conversationId?: string } | undefined;
          return (scope?.type === "analysis" && scope.analysisId === analysisId)
            || (scope?.type === "conversation" && typeof scope.conversationId === "string" && conversationIds.has(scope.conversationId));
        });
        const documentIds = new Set(documents.map((record) => record.id));
        const belongs = (record: AssistantStoredRecord): boolean => {
          const scope = record.scope as { type?: string; analysisId?: string; conversationId?: string } | undefined;
          return record.analysisId === analysisId
            || (scope?.type === "analysis" && scope.analysisId === analysisId)
            || (typeof record.conversationId === "string" && conversationIds.has(record.conversationId))
            || (scope?.type === "conversation" && typeof scope.conversationId === "string" && conversationIds.has(scope.conversationId))
            || (typeof record.documentId === "string" && documentIds.has(record.documentId));
        };

        for (const store of stores) {
          for (const record of records.get(store) ?? []) {
            if (!belongs(record) && !(store === "conversations" && conversationIds.has(record.id)) && !(store === "documents" && documentIds.has(record.id))) continue;
            if (policy === "preserve_conversations" && conversationIds.has(String(record.conversationId ?? record.id))) {
              if (store === "conversations") transaction.objectStore(store).put({ ...record, status: "archived_analysis_deleted", updatedAt: new Date().toISOString() });
              else if (["messages", "events", "actions"].includes(store)) continue;
              else if (store === "sources" && referencedSourceIds.has(record.id)) transaction.objectStore(store).put({ ...record, availability: "historical_unavailable" });
              else transaction.objectStore(store).delete(record.id);
            } else {
              transaction.objectStore(store).delete(record.id);
            }
          }
        }
        transaction.objectStore("analysisVersions").put({ id: analysisCleanupTombstoneId(analysisId), analysisId, cleaned: true, createdAt: new Date().toISOString() });
        await done;
      } catch (error) {
        try { transaction.abort(); } catch { /* completed */ }
        await done.catch(() => undefined);
        throw safeStorageError(error);
      }
    },
    async writeModelConfiguration(input: ModelConfigurationWrite): Promise<void> {
      if (input.profile && input.deleteProfileId) throw new AssistantStorageError("storage_error", "No se pudo guardar la configuración de modelos.");
      assertSafeForPersistence(input.settings);
      if (input.profile) assertSafeForPersistence(input.profile);
      const transaction = db.transaction(["modelProfiles", "assistantSettings"], "readwrite");
      const done = transactionDone(transaction);
      try {
        if (input.profile) transaction.objectStore("modelProfiles").put(input.profile);
        if (input.deleteProfileId) transaction.objectStore("modelProfiles").delete(input.deleteProfileId);
        transaction.objectStore("assistantSettings").put(input.settings);
        await done;
      } catch (error) {
        try { transaction.abort(); } catch { /* already completed */ }
        await done.catch(() => undefined);
        throw safeStorageError(error);
      }
    },
    close: () => db.close(),
  };
}
