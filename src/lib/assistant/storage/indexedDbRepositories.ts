import type { AssistantSettings, ChatAction, ChatEvent, ChatMessage, Conversation, ModelProfile, PersistedDocumentMetadata, SourceReference } from "@/lib/assistant/domain";
import { openAssistantDatabase, type AssistantStoreName } from "@/lib/assistant/storage/database";
import { assertSafeForPersistence } from "@/lib/assistant/privacy/assertions";
import type {
  AssistantCleanupRepository, AssistantDocumentRepository, AssistantRepositories, AssistantSettingsRepository, AssistantStoredRecord, BeginAnalysisIngestionInput, CleanupJob, ContextSnapshot,
  ContextSnapshotRepository, ConversationRepository, ConversationWriteBlock, DeleteDocumentCorpusInput, DocumentCorpusSelection,
  DocumentIdMapping, DocumentIndexJob, EntityRepository, IngestionWriteBlock, MessageRepository,
  ModelConfigurationWrite, ModelProfileRepository, Page, PageOptions, ReplaceAnalysisCorpusInput, SourceRepository,
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

interface CursorPosition { indexKey: IDBValidKey; primaryKey: IDBValidKey }

function encodeCursor(position: CursorPosition): string {
  return encodeURIComponent(JSON.stringify(position));
}

function decodeCursor(cursor: string): CursorPosition {
  return JSON.parse(decodeURIComponent(cursor)) as CursorPosition;
}

function comparePrimaryKeys(left: IDBValidKey, right: IDBValidKey): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function cursorPage<T>(request: IDBRequest<IDBCursorWithValue | null>, limit: number, after?: CursorPosition): Promise<Page<T>> {
  return new Promise((resolve, reject) => {
    const items: T[] = [];
    let lastIncludedKey: IDBValidKey | undefined;
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve({ items });
      if (after && JSON.stringify(cursor.key) === JSON.stringify(after.indexKey) && comparePrimaryKeys(cursor.primaryKey, after.primaryKey) <= 0) {
        cursor.continue();
        return;
      }
      if (items.length >= limit) return resolve({ items, nextCursor: encodeCursor({ indexKey: lastIncludedKey!, primaryKey: (items.at(-1) as { id: IDBValidKey }).id }) });
      items.push(cursor.value as T);
      lastIncludedKey = cursor.key;
      cursor.continue();
    };
  });
}

class IndexedConversationRepository extends IndexedEntityRepository<Conversation> implements ConversationRepository {
  constructor(db: IDBDatabase) { super(db, "conversations"); }
  async list(options: PageOptions): Promise<Page<Conversation>> {
    const transaction = this.db.transaction(this.storeName, "readonly");
    const index = transaction.objectStore(this.storeName).index("updatedAt");
    const after = options.cursor ? decodeCursor(options.cursor) : undefined;
    const range = after ? IDBKeyRange.lowerBound(after.indexKey) : undefined;
    return cursorPage(index.openCursor(range), options.limit, after);
  }
}

class IndexedMessageRepository extends IndexedEntityRepository<ChatMessage> implements MessageRepository {
  constructor(db: IDBDatabase) { super(db, "messages"); }
  async listByConversation(conversationId: string, options: PageOptions): Promise<Page<ChatMessage>> {
    const transaction = this.db.transaction(this.storeName, "readonly");
    const index = transaction.objectStore(this.storeName).index("conversationCreatedAt");
    const after = options.cursor ? decodeCursor(options.cursor) : undefined;
    const lower = after?.indexKey ?? [conversationId, ""];
    const range = IDBKeyRange.bound(lower, [conversationId, "\uffff"], false, false);
    return cursorPage(index.openCursor(range), options.limit, after);
  }
}

export interface IndexedDbRepositoriesOptions { factory?: IDBFactory; dbName?: string }

interface StoredChunkRecord extends AssistantStoredRecord {
  documentId: string; sequence: number; content: string; snippet: string; sanitizedHash: string; terms: readonly string[];
}
interface StoredSearchTermRecord extends AssistantStoredRecord {
  documentId: string; chunkId: string; term: string; positions: readonly number[];
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

export async function createIndexedDbRepositories(options: IndexedDbRepositoriesOptions = {}): Promise<AssistantRepositories> {
  const db = await openAssistantDatabase(options.factory, options.dbName);
  const conversations = new IndexedConversationRepository(db);
  const messages = new IndexedMessageRepository(db);
  const events = new IndexedEntityRepository<ChatEvent>(db, "events");
  const actions = new IndexedEntityRepository<ChatAction>(db, "actions");
  const documents = new IndexedEntityRepository<PersistedDocumentMetadata>(db, "documents") as AssistantDocumentRepository;
  const sources = new IndexedEntityRepository<SourceReference>(db, "sources") as SourceRepository;
  const chunks = new IndexedEntityRepository<AssistantStoredRecord>(db, "chunks");
  const searchTerms = new IndexedEntityRepository<AssistantStoredRecord>(db, "searchTerms");
  const snapshots = new IndexedEntityRepository<ContextSnapshot>(db, "snapshots") as ContextSnapshotRepository;
  const cache = new IndexedEntityRepository<AssistantStoredRecord>(db, "cache");
  const analysisVersions = new IndexedEntityRepository<AssistantStoredRecord>(db, "analysisVersions");
  const indexJobs = new IndexedEntityRepository<AssistantStoredRecord>(db, "indexJobs");
  const modelProfiles = new IndexedEntityRepository<ModelProfile>(db, "modelProfiles") as ModelProfileRepository;
  const assistantSettings = new IndexedEntityRepository<AssistantSettings>(db, "assistantSettings") as AssistantSettingsRepository;
  const cleanupJobs = new IndexedEntityRepository<CleanupJob>(db, "cleanupJobs") as AssistantCleanupRepository;

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
      }));
      const chunkMap = new Map(records.chunks.filter((chunk) => documentMap.has(chunk.documentId)).map((chunk) => [chunk.id, `${documentMap.get(chunk.documentId)!}-chunk-${chunk.sequence}`]));
      const copiedTerms = records.searchTerms.filter((term) => documentMap.has(term.documentId) && chunkMap.has(term.chunkId)).map((term) => ({
        ...term,
        id: `${chunkMap.get(term.chunkId)!}-term-${term.term}`,
        documentId: documentMap.get(term.documentId)!,
        chunkId: chunkMap.get(term.chunkId)!,
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
    async writeConversationBlock(block: ConversationWriteBlock): Promise<void> {
      assertSafeForPersistence(block);
      const transaction = db.transaction(["conversations", "messages", "sources", "events"], "readwrite");
      const done = transactionDone(transaction);
      try {
        transaction.objectStore("conversations").put(block.conversation);
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
    async writeIngestionBlock(block: IngestionWriteBlock): Promise<void> {
      assertSafeForPersistence(block);
      const transaction = db.transaction(["documents", "chunks", "searchTerms", "indexJobs"], "readwrite");
      const done = transactionDone(transaction);
      try {
        transaction.objectStore("documents").put(block.document);
        for (const chunk of block.chunks) transaction.objectStore("chunks").put(chunk);
        for (const term of block.searchTerms) transaction.objectStore("searchTerms").put(term);
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
          for (const chunk of block.chunks) transaction.objectStore("chunks").put(chunk);
          for (const term of block.searchTerms) transaction.objectStore("searchTerms").put(term);
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
