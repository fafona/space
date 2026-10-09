"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AttendanceLocationCheckClient, attendanceBrowserLocationEnvironment, type AttendanceLocationEnvironment } from "@/lib/merchantAttendanceLocationCheckClient";
import type { AttendanceLocationTarget } from "@/lib/merchantAttendanceLocationCheck";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

// Deliberately not mounted in the enterprise shell before privacy/policy and
// atomic punch integration are ready. Synthetic fixture injects a fake device.
export default function MerchantAttendanceLocationCheckPanel(props: AttendanceLocationTarget & {
  employeeId: string; apiFetch: AttendanceApiFetch; environment?: AttendanceLocationEnvironment;
}) {
  const environment = props.environment ?? attendanceBrowserLocationEnvironment;
  const client = useMemo(() => new AttendanceLocationCheckClient({ siteId: props.siteId, expectedWorkerId: props.expectedWorkerId,
    expectedLocationId: props.expectedLocationId, employeeId: props.employeeId, apiFetch: props.apiFetch, environment }),
    [props.siteId, props.expectedWorkerId, props.expectedLocationId, props.employeeId, props.apiFetch, environment]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState !== "visible") client.invalidate(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", client.invalidate);
    return () => { client.invalidate(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", client.invalidate); };
  }, [client]);
  const busy = ["authorizing", "locating", "checking"].includes(state.phase);
  return <section aria-label="单次定位范围检查" className="mt-5 space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <header><h3 className="text-lg font-bold text-slate-950">单次定位范围检查 · 未接入正式打卡</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">点击后先校验权限，再请求一次位置。坐标仅用于本次范围计算，不写入考勤记录，不持续追踪。浏览器授权不代表已完成企业隐私告知。</p></header>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void client.run()} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? "正在检查…" : "获取一次位置并检查范围"}</button>
      <button type="button" onClick={client.invalidate} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">{busy ? "取消本次检查" : "清空检查结果"}</button>
    </div>
    <div role="status" aria-live="polite" className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700"><p>{state.message}</p>
      {state.result && <p className="mt-2">检查时间：{state.result.checkedAt} {state.result.distanceMeters !== null ? `· 距配置中心约 ${state.result.distanceMeters} 米` : ""}</p>}</div>
    <p className="text-xs leading-6 text-slate-500">这不是打卡收据或现场身份证明。取消后本页面会忽略迟到位置；系统的定位权限提示可能仍需手动关闭。定位失败时，请联系负责人登记实际工作情况。</p>
  </section>;
}
