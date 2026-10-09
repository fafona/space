"use client";
import { lazy, Suspense, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { OwnerBacklogNavigation, OwnerBacklogTarget } from "@/lib/merchantAttendanceOwnerBacklogNavigation";
const Panel = lazy(() => import("./MerchantAttendanceOwnerBacklogPanel"));
type Props = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; open?: boolean; onOpenChange?: (open: boolean) => void;
  disabled?: boolean; navigation?: OwnerBacklogNavigation; onSelect?: (target: OwnerBacklogTarget) => boolean };
export default function MerchantAttendanceOwnerBacklogLauncher({ enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OWNER_BACKLOG_ENABLED === "1", active = true, ...props }: Props & { enabled?: boolean; active?: boolean }) {
  if (!enabled || !active) return null;
  return <Launcher key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}
function Launcher({ open: controlledOpen, onOpenChange, ...props }: Props) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => { if (controlledOpen === undefined) setLocalOpen(next); onOpenChange?.(next); };
  return open ? <Suspense fallback={<p role="status">正在加载负责人只读待审列表…</p>}><Panel {...props} onClose={() => setOpen(false)}/></Suspense>
    : <button type="button" disabled={props.disabled} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40" onClick={() => setOpen(true)}>负责人待审积压（只读）</button>;
}
