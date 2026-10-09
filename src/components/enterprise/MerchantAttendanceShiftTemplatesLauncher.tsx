"use client";
import { lazy, Suspense, useState } from "react";
import type { ShiftTemplate } from "@/lib/merchantAttendanceShiftTemplates";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendanceShiftTemplatesPanel"));

export type ShiftTemplatesLauncherProps = {
  siteId: string;
  ownerId: string;
  apiFetch: AttendanceApiFetch;
  applyDisabled?: boolean;
  writeDisabled?: boolean;
  onDirty?: () => void;
  onApply: (template: ShiftTemplate) => void;
};

export default function MerchantAttendanceShiftTemplatesLauncher({
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SHIFT_TEMPLATES_ENABLED === "1",
  ...props
}: ShiftTemplatesLauncherProps & { enabled?: boolean }) {
  if (!enabled) return null;
  return <Launcher key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}

function Launcher(props: ShiftTemplatesLauncherProps) {
  const [open, setOpen] = useState(false);
  return open
    ? <Suspense fallback={<p role="status" className="text-sm">正在加载班次模板库…</p>}>
        <Panel {...props} onClose={() => setOpen(false)}/>
      </Suspense>
    : <button type="button" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40"
        onClick={() => setOpen(true)}>班次模板库</button>;
}
