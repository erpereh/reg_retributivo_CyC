const MIGRATION_ID = "assistant-conversation-coherence-v1";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("migration_read_failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("migration_aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("migration_failed"));
  });
}

function hasAnalysisId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asGeneral(raw: Record<string, unknown>): Record<string, unknown> {
  const { analysisId: _analysisId, analysisVersion: _analysisVersion, primaryPersonId: _primaryPersonId, ...preserved } = raw;
  return { ...preserved, type: "general", associatedPersonIds: [] };
}

export async function migrateAssistantConversationCoherence(db: IDBDatabase): Promise<void> {
  const transaction = db.transaction(["conversations", "migrations"], "readwrite");
  const done = transactionDone(transaction);
  try {
    const marker = await requestResult(transaction.objectStore("migrations").get(MIGRATION_ID));
    if (marker) { await done; return; }

    const conversations = await requestResult(transaction.objectStore("conversations").getAll()) as Array<Record<string, unknown>>;
    let repairedGeneralCount = 0;
    let downgradedAnalysisCount = 0;
    for (const raw of conversations) {
      if (raw.type === "general") {
        const associatedPersonIds = Array.isArray(raw.associatedPersonIds) ? raw.associatedPersonIds : [];
        if (hasAnalysisId(raw.analysisId) || raw.analysisVersion !== undefined || raw.primaryPersonId !== undefined || associatedPersonIds.length > 0) {
          transaction.objectStore("conversations").put(asGeneral(raw));
          repairedGeneralCount += 1;
        }
      } else if (raw.type === "analysis" && !hasAnalysisId(raw.analysisId)) {
        transaction.objectStore("conversations").put(asGeneral(raw));
        downgradedAnalysisCount += 1;
      }
    }

    transaction.objectStore("migrations").put({
      id: MIGRATION_ID,
      status: "completed",
      conversationCount: conversations.length,
      repairedGeneralCount,
      downgradedAnalysisCount,
      completedAt: new Date().toISOString(),
    });
    await done;
  } catch (error) {
    try { transaction.abort(); } catch { /* already inactive */ }
    await done.catch(() => undefined);
    throw error;
  }
}
