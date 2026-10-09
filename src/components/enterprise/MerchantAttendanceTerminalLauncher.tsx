"use client";
import { lazy, Suspense, useLayoutEffect, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
const Panel = lazy(() => import("./MerchantAttendanceTerminalPanel"));
type Props = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; onOpenChange?: (open: boolean) => void };
export default function MerchantAttendanceTerminalLauncher({ enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_TERMINALS_ENABLED === "1", ...props }: Props & { enabled?: boolean }) {
  return enabled ? <Launcher key={`${props.siteId}:${props.ownerId}`} {...props}/> : null;
}
function Launcher({ onOpenChange, ...props }: Props) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false); }, [onOpenChange, open]);
  return open ? <Suspense fallback={<p role="status">正在加载门店终端…</p>}><Panel {...props} onClose={() => setOpen(false)}/></Suspense>
    : <button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold" onClick={() => setOpen(true)}>门店终端配对</button>;
}
