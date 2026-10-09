"use client";

import { lazy, Suspense, useLayoutEffect, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { ReviewRoutingRequest } from "@/lib/merchantAttendanceReviewRouting";

const Panel = lazy(() => import("./MerchantAttendanceLeavePanel"));

export type AttendanceLeavePanelProps = { siteId: string; apiFetch: AttendanceApiFetch; initialSelection?: ReviewRoutingRequest | null; isCurrentAuth?: () => boolean } & (
  | { access: "self"; employeeId: string }
  | { access: "owner"; actorId: string }
);
type LauncherProps = AttendanceLeavePanelProps & { onOpenChange?: (open: boolean) => void; onTargetClose?: () => void };

const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";

export default function MerchantAttendanceLeaveLauncher({
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_ENABLED === "1",
  active = true,
  ...props
}: LauncherProps & { enabled?: boolean; active?: boolean }) {
  if (!enabled || !active) return null;
  const identityId = props.access === "self" ? props.employeeId : props.actorId;
  return <Launcher key={`${props.siteId}:${identityId}:${props.access}`} {...props}/>;
}

function Launcher({ onOpenChange, onTargetClose, ...props }: LauncherProps) {
  const [open, setOpen] = useState(!!props.initialSelection);
  useLayoutEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false); }, [onOpenChange, open]);
  return open
    ? <Suspense fallback={<p role="status">正在加载请假申请…</p>}>
        <Panel {...props} onClose={() => { setOpen(false); onTargetClose?.(); }}/>
      </Suspense>
    : <button type="button" className={button} onClick={() => setOpen(true)}>
        {props.access === "owner" ? "请假申请审批" : "我的请假申请"}
      </button>;
}
