/** Server-side opt-in only. Enabling it requires the candidate SQL and draining
 * every old writer first; a mode string is not proof that rollout is safe.
 * Keep disabled in deployment until the documented cutover checks are complete.
 */
export const PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID = "platform_snapshot_atomic_configuration_invalid";
export const PLATFORM_SNAPSHOT_ATOMIC_RESTORE_UNAVAILABLE = "platform_snapshot_atomic_restore_unavailable";

export function getPlatformSnapshotWriteMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): "off" | "atomic" {
  const mode = environment.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;
  if (mode === undefined || mode === "" || mode === "off") return "off";
  if (mode === "atomic") return "atomic";
  // Misspelling an intended opt-in must never silently re-enable legacy writers.
  throw new Error(PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID);
}
