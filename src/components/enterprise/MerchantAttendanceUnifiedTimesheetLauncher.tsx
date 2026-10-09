"use client";
import { lazy, Suspense, useState } from "react";
import { unifiedQueryString, type UnifiedQuery } from "@/lib/merchantAttendanceUnifiedTimesheet";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
const Panel = lazy(() => import("./MerchantAttendanceUnifiedTimesheetPanel"));
export type UnifiedTimesheetProps = { query: UnifiedQuery; actorId: string; apiFetch: AttendanceApiFetch; onDenied?: () => void;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void };
export default function MerchantAttendanceUnifiedTimesheetLauncher({ enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_UNIFIED_REPORT_ENABLED === "1", ...props }: UnifiedTimesheetProps & { enabled?: boolean }) {
  return enabled ? <Launcher key={`${props.actorId}:${unifiedQueryString(props.query)}`} {...props}/> : null;
}
function Launcher(props: UnifiedTimesheetProps) {
  const [open, setOpen] = useState(false);
  return open ? <Suspense fallback={<p role="status">正在加载含整段漏卡的工时核对…</p>}><Panel {...props} onClose={() => setOpen(false)}/></Suspense>
    : <button type="button" className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-sm font-semibold" onClick={() => setOpen(true)}>含整段漏卡的工时核对</button>;
}
