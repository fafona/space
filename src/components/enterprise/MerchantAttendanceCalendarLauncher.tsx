"use client";

import { lazy, Suspense, useLayoutEffect, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendanceCalendarPanel"));

export type AttendanceCalendarPanelProps = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch };
type LauncherProps = AttendanceCalendarPanelProps & { onOpenChange?: (open: boolean) => void };

const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";

export default function MerchantAttendanceCalendarLauncher({
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CALENDAR_ENABLED === "1",
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
    ? <Suspense fallback={<p role="status">正在加载节假日／停业日…</p>}>
        <Panel {...props} onClose={() => setOpen(false)}/>
      </Suspense>
    : <button type="button" className={button} onClick={() => setOpen(true)}>节假日／停业日（仅提示）</button>;
}
