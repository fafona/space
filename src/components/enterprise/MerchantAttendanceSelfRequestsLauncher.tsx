"use client";

import { lazy, Suspense, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendanceSelfRequestsPanel"));
type Props = { siteId: string; employeeId: string; apiFetch: AttendanceApiFetch };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";

export default function MerchantAttendanceSelfRequestsLauncher({
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_REQUESTS_ENABLED === "1",
  ...props
}: Props & { enabled?: boolean }) {
  if (!enabled) return null;
  return <Launcher key={`${props.siteId}:${props.employeeId}`} {...props}/>;
}

function Launcher(props: Props) {
  const [open, setOpen] = useState(false);
  return open
    ? <Suspense fallback={<p role="status">正在加载本人只读申请记录…</p>}><Panel {...props} onClose={() => setOpen(false)}/></Suspense>
    : <button type="button" className={button} onClick={() => setOpen(true)}>我的申请记录（只读）</button>;
}
