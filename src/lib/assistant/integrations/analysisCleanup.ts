import type { AssistantRepositories, CleanupJob, CleanupPolicy } from "@/lib/assistant/storage/repositories";
import { afterAnalysisCleanup, beforeAnalysisCleanup } from "@/lib/assistant/integrations/analysisCleanupCoordinator";

export function createAnalysisCleanupJob(analysisId: string, policy: CleanupPolicy, createdAt: string): CleanupJob {
  return { id: `cleanup-${analysisId}-${policy}`, analysisId, scope: { type: "analysis", analysisId }, policy, stage: "pending", status: "pending", documentIds: [], attempts: 0, createdAt, updatedAt: createdAt };
}

function sanitizedError(): string { return "No se pudo completar la limpieza coordinada."; }

export async function runAnalysisCleanupJob(repositories: AssistantRepositories, jobId: string, deleteFunctionalAnalysis: (analysisId: string) => Promise<void> | void, updatedAt = new Date().toISOString()): Promise<CleanupJob> {
  const current = await repositories.cleanupJobs.get(jobId);
  if (!current) throw new Error("Job de limpieza no encontrado.");
  if (current.status === "completed") return current;
  const { lastError: _previousError, ...retryable } = current;
  void _previousError;
  let job: CleanupJob = { ...retryable, status: "running", attempts: current.attempts + 1, updatedAt };
  await repositories.cleanupJobs.put(job);
  try {
    if (job.stage === "pending") {
      await beforeAnalysisCleanup(job.analysisId);
      await repositories.cleanupAnalysis(job.analysisId, job.policy);
      job = { ...job, stage: "assistant_cleaned", updatedAt };
      await repositories.cleanupJobs.put(job);
    }
    if (job.stage === "assistant_cleaned") {
      await deleteFunctionalAnalysis(job.analysisId);
      job = { ...job, stage: "functional_deleted", updatedAt };
      await repositories.cleanupJobs.put(job);
    }
    job = { ...job, status: "completed", updatedAt };
    await repositories.cleanupJobs.put(job);
    await afterAnalysisCleanup(job.analysisId).catch(() => undefined);
    return job;
  } catch {
    job = { ...job, status: "failed", lastError: sanitizedError(), updatedAt };
    await repositories.cleanupJobs.put(job);
    await afterAnalysisCleanup(job.analysisId).catch(() => undefined);
    throw new Error(job.lastError);
  }
}

export async function resumeAnalysisCleanupJobs(repositories: AssistantRepositories, deleteFunctionalAnalysis: (analysisId: string) => Promise<void> | void): Promise<void> {
  const jobs = await repositories.cleanupJobs.listByStatus(["pending", "running", "failed"]);
  for (const job of jobs) {
    try { await runAnalysisCleanupJob(repositories, job.id, deleteFunctionalAnalysis); } catch { /* each failed job remains resumable */ }
  }
}

export async function runAnalysisCleanupBatch(
  repositories: AssistantRepositories,
  analysisIds: readonly string[],
  policy: CleanupPolicy,
  deleteFunctionalAnalysis: (analysisId: string) => Promise<void> | void,
  createdAt = new Date().toISOString(),
): Promise<void> {
  const jobs: CleanupJob[] = [];
  let failures = 0;
  for (const analysisId of analysisIds) {
    const fresh = createAnalysisCleanupJob(analysisId, policy, createdAt);
    const previous = await repositories.cleanupJobs.get(fresh.id);
    const job = previous?.status === "failed" ? { ...previous, status: "pending" as const, updatedAt: createdAt } : previous ?? fresh;
    await repositories.cleanupJobs.put(job);
    jobs.push(job);
  }
  for (const job of jobs) {
    try { await runAnalysisCleanupJob(repositories, job.id, deleteFunctionalAnalysis, createdAt); } catch { failures += 1; }
  }
  if (failures) throw new Error(`No se pudieron completar ${failures} limpiezas coordinadas.`);
}
