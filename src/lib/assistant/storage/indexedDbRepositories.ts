import type { ChatAction, ChatEvent, ChatMessage, Conversation, ModelProfile, PersistedDocumentMetadata, SourceReference } from "@/lib/assistant/domain";
import { openAssistantDatabase, type AssistantStoreName } from "@/lib/assistant/storage/database";
import type {
  AssistantCleanupRepository, AssistantDocumentRepository, AssistantRepositories, AssistantStoredRecord, CleanupJob, ContextSnapshot,
  ContextSnapshotRepository, ConversationRepository, ConversationWriteBlock, EntityRepository, MessageRepository,
  ModelProfileRepository, Page, PageOptions, SourceRepository,
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
    const transaction = this.db.transaction(this.storeName, "readwrite");
    transaction.objectStore(this.storeName).put(value);
    await transactionDone(transaction);
  }

  async delete(id: string): Promise<void> {
    const transaction = this.db.transaction(this.storeName, "readwrite");
    transaction.objectStore(this.storeName).delete(id);
    await transactionDone(transaction);
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
  const assistantSettings = new IndexedEntityRepository<AssistantStoredRecord>(db, "assistantSettings");
  const cleanupJobs = new IndexedEntityRepository<CleanupJob>(db, "cleanupJobs") as AssistantCleanupRepository;

  return {
    conversations, messages, events, actions, documents, sources, chunks, searchTerms, snapshots, cache, analysisVersions, indexJobs, modelProfiles, assistantSettings, cleanupJobs,
    async writeConversationBlock(block: ConversationWriteBlock): Promise<void> {
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
    close: () => db.close(),
  };
}
