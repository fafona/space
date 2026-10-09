"use client";
import { lazy, Suspense, useCallback, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { periodClosurePendingKey } from "@/lib/merchantAttendancePeriodClosureClient";
const Workspace = lazy(() => import("./MerchantAttendancePeriodClosureWorkspace"));
const ContinuationWorkspace = lazy(() => import("./MerchantAttendancePeriodClosureV2Workspace"));
export type PeriodClosureNotificationTarget = { periodId: string; workerId: string; employeeId: string; employeeAuthUserId: string; fromDate: string; throughDate: string };
export type PeriodClosureLauncherProps = { siteId: string; access: "owner" | "self"; actorId: string; workerId: string; fromDate: string; throughDate: string;
  apiFetch: AttendanceApiFetch; enabled?: boolean; continuationEnabled?: boolean; registerLeaveGuard?: (guard: (() => boolean) | null) => void;
  expectedNotificationTarget?: PeriodClosureNotificationTarget; isCurrentAuth?: () => boolean };
export default function MerchantAttendancePeriodClosureLauncher(props: PeriodClosureLauncherProps) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED === "1";
  const pending = useCallback(() => { try { return sessionStorage.getItem(periodClosurePendingKey(props.siteId, props.access, props.actorId)) !== null; } catch { return true; } }, [props.siteId, props.access, props.actorId]);
  const subscribe = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const recoverable = useSyncExternalStore(subscribe, pending, () => false);
  const continuation = props.continuationEnabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED === "1";
  if (!enabled && !recoverable && !props.expectedNotificationTarget) return null;
  // Both formats share the original exact pending slot. Recovery must continue
  // to work after a v2 period exceeds v1 bounds or new creation is paused.
  // Migration183 must be installed before deploying this recovery-capable UI.
  return <Launcher key={`${props.siteId}:${props.access}:${props.actorId}:${props.workerId}:${props.fromDate}:${props.throughDate}`} {...props}
    enabled={continuation || recoverable || props.expectedNotificationTarget ? enabled && continuation : enabled} useContinuation={continuation || recoverable || !!props.expectedNotificationTarget}/>;
}
function Launcher(props: PeriodClosureLauncherProps & { enabled: boolean; useContinuation: boolean }) {
  const [open, setOpen] = useState(false);
  const CurrentWorkspace=props.useContinuation?ContinuationWorkspace:Workspace;
  return open ? <Suspense fallback={<p role="status">正在加载周期核对与封存…</p>}><CurrentWorkspace {...props} onClose={() => setOpen(false)}/></Suspense>
    : <button type="button" className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-sm font-semibold" onClick={() => setOpen(true)}>
      {props.enabled ? "周期核对、争议与封存" : "核对待确认周期原编号"}</button>;
}
