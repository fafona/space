"use client";
import { lazy, Suspense, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendanceScheduleOverviewPanel"));
type Props = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch };

export default function MerchantAttendanceScheduleOverviewLauncher({
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_OVERVIEW_ENABLED === "1",
  active = true,
  ...props
}: Props & { enabled?: boolean; active?: boolean }) {
  if (!enabled || !active) return null;
  return <Launcher key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}

function Launcher(props: Props) {
  const [open, setOpen] = useState(false);
  return open
    ? <Suspense fallback={<p role="status" className="text-sm">正在加载多人排班总览…</p>}>
        <Panel {...props} onClose={() => setOpen(false)}/>
      </Suspense>
    : <button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold"
        onClick={() => setOpen(true)}>多人排班总览（只读）</button>;
}
