"use client";
import { lazy, Suspense, useLayoutEffect, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
const Panel = lazy(() => import("./MerchantAttendanceSchedulePanel"));
export type SchedulePanelProps = { siteId: string; actorId: string; access: "owner" | "self"; apiFetch: AttendanceApiFetch };
type LauncherProps = SchedulePanelProps & { onOpenChange?: (open: boolean) => void };
export default function MerchantAttendanceScheduleLauncher({ enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_ENABLED === "1", ...props }: LauncherProps & { enabled?: boolean }) {
  return enabled ? <Launcher key={`${props.siteId}:${props.actorId}:${props.access}`} {...props}/> : null;
}
function Launcher({ onOpenChange, ...props }: LauncherProps) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false); }, [onOpenChange, open]);
  return open ? <Suspense fallback={<p role="status">正在加载排班…</p>}><Panel {...props} onClose={() => setOpen(false)}/></Suspense>
    : <button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold" onClick={() => setOpen(true)}>{props.access === "owner" ? "员工排班" : "我的排班"}</button>;
}
