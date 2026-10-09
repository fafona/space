"use client";

import { lazy, Suspense, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendanceLeaveNotificationsPanel"));

export type AttendanceLeaveNotificationsPanelProps = {
  siteId: string;
  employeeId: string;
  apiFetch: AttendanceApiFetch;
};

const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";

export default function MerchantAttendanceLeaveNotificationsLauncher({
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED === "1",
  active = true,
  ...props
}: AttendanceLeaveNotificationsPanelProps & { enabled?: boolean; active?: boolean }) {
  if (!enabled || !active) return null;
  return <Launcher key={`${props.siteId}:${props.employeeId}`} {...props}/>;
}

function Launcher(props: AttendanceLeaveNotificationsPanelProps) {
  const [open, setOpen] = useState(false);
  return open
    ? <Suspense fallback={<p role="status">正在加载请假结果通知…</p>}>
        <Panel {...props} onClose={() => setOpen(false)}/>
      </Suspense>
    : <button type="button" className={button} onClick={() => setOpen(true)}>请假结果通知</button>;
}
