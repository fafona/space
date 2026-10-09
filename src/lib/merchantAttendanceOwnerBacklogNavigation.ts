import type { OwnerBacklogItem, OwnerBacklogKind } from "./merchantAttendanceOwnerBacklog";

// Navigation carries identity only. Approval evidence must be freshly read by the target.
export type OwnerBacklogTarget = Pick<OwnerBacklogItem, "kind" | "requestId" | "submittedAt">;
export type OwnerBacklogNavigation = Partial<Record<OwnerBacklogKind, boolean>>;
export function ownerBacklogTarget(
  state: { phase: string; result: { moduleEnabled: boolean; items: OwnerBacklogItem[] } | null },
  candidate: OwnerBacklogTarget, enabled: OwnerBacklogNavigation,
): OwnerBacklogTarget | null {
  if (state.phase !== "ready" || !state.result?.moduleEnabled || !enabled[candidate.kind]) return null;
  const row = state.result.items.find(item => item.kind === candidate.kind && item.requestId === candidate.requestId
    && item.submittedAt === candidate.submittedAt && item.status === "submitted");
  return row ? { kind: row.kind, requestId: row.requestId, submittedAt: row.submittedAt } : null;
}

export function ownerBacklogHostReady(
  state: { phase: string; pending: unknown; result: { moduleEnabled: boolean } | null },
  occupied: boolean, readPending: () => string | null,
): boolean {
  if (occupied || state.phase !== "ready" || state.pending || !state.result?.moduleEnabled) return false;
  try { return readPending() === null; } catch { return false; }
}
