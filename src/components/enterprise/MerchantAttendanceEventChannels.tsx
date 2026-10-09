"use client";
import { lazy, Suspense, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
const Panel = lazy(() => import("./MerchantAttendanceEventChannelsPanel"));
export type EventChannelsProps = { siteId: string; actorId: string; access: "self" | "manager" | "owner"; workerId: string;
  locationId?: string | null; employeeId?: string; eventIds: string[]; readKey: string; apiFetch: AttendanceApiFetch };
export default function MerchantAttendanceEventChannels({ enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EVENT_CHANNELS_ENABLED === "1", ...props }: EventChannelsProps & { enabled?: boolean }) {
  if (!enabled || !props.eventIds.length) return null;
  const key = [props.siteId, props.actorId, props.access, props.workerId, props.locationId, props.employeeId, props.readKey, ...props.eventIds].join(":");
  return <Launcher key={key} {...props}/>;
}
function Launcher(props: EventChannelsProps) {
  const [open, setOpen] = useState(false);
  return open ? <Suspense fallback={<p role="status" className="text-sm">正在加载打卡通路核对…</p>}><Panel {...props} onClose={() => setOpen(false)}/></Suspense>
    : <button type="button" className="mt-2 rounded-xl border border-teal-300 bg-teal-50 px-3 py-2 text-sm" onClick={() => setOpen(true)}>核对详细打卡通路（{props.eventIds.length} 条）</button>;
}
