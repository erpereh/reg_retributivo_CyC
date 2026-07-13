export const ASSISTANT_DB_NAME = "retributivo-assistant-v1";
export const ASSISTANT_DB_VERSION = 4;
export const ASSISTANT_STORES = [
  "actions", "analysisVersions", "assistantSettings", "cache", "chunks", "cleanupJobs", "conversations", "documents",
  "events", "indexJobs", "messages", "modelProfiles", "searchTerms", "snapshots", "sources",
] as const;
export type AssistantStoreName = typeof ASSISTANT_STORES[number];

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string | string[]) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
}

function ensureStore(db: IDBDatabase, transaction: IDBTransaction, name: AssistantStoreName): IDBObjectStore {
  return db.objectStoreNames.contains(name) ? transaction.objectStore(name) : db.createObjectStore(name, { keyPath: "id" });
}

export function migrateAssistantDatabase(db: IDBDatabase, transaction: IDBTransaction): void {
  for (const name of ASSISTANT_STORES) {
    const store = ensureStore(db, transaction, name);
    ensureIndex(store, "conversationId", "conversationId");
    ensureIndex(store, "analysisId", "analysisId");
    ensureIndex(store, "documentId", "documentId");
    ensureIndex(store, "status", "status");
    ensureIndex(store, "createdAt", "createdAt");
    ensureIndex(store, "updatedAt", "updatedAt");
    if (name === "conversations") ensureIndex(store, "updatedAtId", ["updatedAt", "id"]);
    if (name === "messages") {
      ensureIndex(store, "conversationCreatedAt", ["conversationId", "createdAt"]);
      ensureIndex(store, "conversationCreatedAtId", ["conversationId", "createdAt", "id"]);
    }
    if (name === "documents") {
      ensureIndex(store, "scopeType", "scope.type");
      ensureIndex(store, "scopeAnalysisId", "scope.analysisId");
      ensureIndex(store, "scopeConversationId", "scope.conversationId");
    }
    if (name === "sources") ensureIndex(store, "availability", "availability");
    if (name === "searchTerms") ensureIndex(store, "term", "term");
    if (name === "cleanupJobs") {
      ensureIndex(store, "analysisId", "analysisId");
      ensureIndex(store, "statusUpdatedAt", ["status", "updatedAt"]);
    }
  }
}

export function openAssistantDatabase(factory: IDBFactory = indexedDB, dbName = ASSISTANT_DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, ASSISTANT_DB_VERSION);
    request.onupgradeneeded = () => migrateAssistantDatabase(request.result, request.transaction!);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir la base del Asistente."));
    request.onblocked = () => reject(new Error("La base del Asistente está bloqueada por otra pestaña."));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
