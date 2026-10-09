"use client";

import { lazy, Suspense, useLayoutEffect, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendanceGroupsPanel"));

export type AttendanceGroupsPanelProps = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; rulesAuthorizationEpoch?: number };
type LauncherProps = AttendanceGroupsPanelProps & { onOpenChange?: (open: boolean) => void };

const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";

export default function MerchantAttendanceGroupsLauncher({
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_GROUPS_ENABLED === "1",
  active = true,
  ...props
}: LauncherProps & { enabled?: boolean; active?: boolean }) {
  if (!enabled || !active) return null;
  return <Launcher key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}

function Launcher({ onOpenChange, ...props }: LauncherProps) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false); }, [onOpenChange, open]);
  return open
    ? <Suspense fallback={<p role="status">正在加载考勤组与人员归组…</p>}>
        <Panel {...props} onClose={() => setOpen(false)}/>
      </Suspense>
    : <button type="button" className={button} onClick={() => setOpen(true)}>考勤组与人员归组</button>;
}
