interface AnalysisCleanupListener {
  before(analysisId: string): Promise<void> | void;
  after(analysisId: string): Promise<void> | void;
}

const listeners = new Set<AnalysisCleanupListener>();

export function registerAnalysisCleanupListener(listener: AnalysisCleanupListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function beforeAnalysisCleanup(analysisId: string): Promise<void> {
  await Promise.all([...listeners].map((listener) => listener.before(analysisId)));
}

export async function afterAnalysisCleanup(analysisId: string): Promise<void> {
  await Promise.all([...listeners].map((listener) => listener.after(analysisId)));
}
