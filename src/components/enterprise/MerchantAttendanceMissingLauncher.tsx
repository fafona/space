"use client";
import { lazy, Suspense, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { MissingInitialSelection } from "@/lib/merchantAttendanceMissingSelection";
export type { MissingInitialSelection } from "@/lib/merchantAttendanceMissingSelection";
const Panel = lazy(() => import("./MerchantAttendanceMissingPanel"));
export type MissingPanelProps = { siteId: string; actorId: string; access: "owner" | "self"; authUserId?: string | null; applicationWindowEnabled?: boolean; apiFetch: AttendanceApiFetch; initialSelection?: MissingInitialSelection | null; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
type LauncherProps = MissingPanelProps & { enabled?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; disabled?: boolean; showTrigger?: boolean };
export default function MerchantAttendanceMissingLauncher({ enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_MISSING_ENABLED === "1", ...props }: LauncherProps) {
  return enabled ? <Launcher key={`${props.siteId}:${props.actorId}:${props.access}:${props.authUserId ?? ""}`} {...props}/> : null;
}
function Launcher({ open: controlledOpen, onOpenChange, disabled = false, showTrigger = true, ...props }: Omit<LauncherProps, "enabled">) {
  const [localOpen, setLocalOpen] = useState(false), open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => { if (controlledOpen === undefined) setLocalOpen(next); onOpenChange?.(next); };
  return open ? <Suspense fallback={<p role="status">正在加载整段漏卡…</p>}><Panel {...props} onClose={() => setOpen(false)}/></Suspense>
    : showTrigger ? <button type="button" disabled={disabled} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40" onClick={() => { if (!disabled) setOpen(true); }}>{props.access === "owner" ? "整段漏卡审核" : "整段漏卡申请"}</button> : null;
}
