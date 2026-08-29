import { api } from "./fetcher";

export interface RunStageResult {
  done?: boolean;
  stopped?: boolean;
  error?: string;
  position?: number;
  totalStages?: number;
  stageName?: string;
}

/**
 * Client-side job runner: starts the job, then executes stage after stage.
 * Each stage is a single API call, so the loop survives serverless timeouts
 * and stopping between stages is immediate.
 */
export async function runJob(
  jobId: string,
  onProgress?: (r: RunStageResult) => void
): Promise<"done" | "stopped" | "error"> {
  await api(`/api/jobs/${jobId}/control`, { method: "POST", json: { action: "start" } });
  for (;;) {
    let result: RunStageResult;
    try {
      result = await api<RunStageResult>(`/api/jobs/${jobId}/run-stage`, { method: "POST" });
    } catch (e) {
      onProgress?.({ error: e instanceof Error ? e.message : String(e) });
      return "error";
    }
    onProgress?.(result);
    if (result.stopped) return "stopped";
    if (result.done) return "done";
  }
}
