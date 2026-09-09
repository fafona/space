/**
 * Candidate-process startup control, not a global maintenance/write fence.
 * Only an unset value or the exact string "0" permits background jobs.
 * "1" and malformed explicit values pause new work (fail closed).
 * Operators must update the supervised environment and restart to resume;
 * this does not cancel an admitted tick/batch or guard manual HTTP writes.
 */
export function areBackgroundJobsPaused(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  const value = environment.FAOLLA_BACKGROUND_JOBS_PAUSED;
  return value !== undefined && value !== "0";
}
