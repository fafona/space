"use client";
import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendancePrintClient, type AttendancePrintKind } from "@/lib/merchantAttendancePrintClient";
import { deliverAttendancePrint } from "@/lib/merchantAttendancePrintBrowser";
import type { TimesheetExportCommand } from "@/lib/merchantAttendanceTimesheetExport";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

type Props = { kind: AttendancePrintKind; selection: Omit<TimesheetExportCommand, "operationId">; actorId: string;
  apiFetch: AttendanceApiFetch; onDenied: () => void; onStale?: () => void; contextKey: string; enabled?: boolean };
export default function MerchantAttendancePrint(props: Props) {
  if (!(props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PRINT_ENABLED === "1")) return null;
  const serialized = JSON.stringify(props.selection);
  return <Print key={`${props.kind}:${props.actorId}:${serialized}:${props.contextKey}`} {...props} serialized={serialized}/>;
}
function Print({ kind, actorId, apiFetch, onDenied, onStale, serialized }: Props & { serialized: string }) {
  const client = useMemo(() => new AttendancePrintClient({ kind, actorId, selection: JSON.parse(serialized), apiFetch, onDenied, onStale,
    available: () => document.visibilityState !== "hidden", deliver: deliverAttendancePrint }), [kind, actorId, serialized, apiFetch, onDenied, onStale]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [ack, setAck] = useState(false);
  // The iframe lives outside this React subtree. Invalidate during the commit,
  // not a later passive effect, before an old load can print after an identity swap.
  useLayoutEffect(() => {
    const hide = () => { client.invalidate(); setAck(false); }, visibility = () => { if (document.visibilityState === "hidden") hide(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); client.invalidate(); };
  }, [client]);
  const unified = kind === "unified";
  return <section aria-label={unified ? "打印含整段申报工时明细" : "打印工时明细"} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <h3 className="font-semibold">{unified ? "打印含整段申报的工时明细" : "打印工时明细"}</h3>
    <p className="text-xs leading-6 text-slate-600">仅打印本次授权范围的工时，不含后台导航。每次重新读取并核验导出权限，可能与上方较早的结果不同；服务器可能留下来源读取审计，不保存打印文件。不是已封账报表或工资表。</p>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ack} disabled={state.phase === "loading"}
      onChange={event => setAck(event.target.checked)}/>我了解打印内容包含员工工时，出纸或另存文件后无法通过撤销平台权限收回，会妥善保管。</label>
    <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-40" disabled={!ack || state.phase === "loading"}
      onClick={() => { void client.print(ack).finally(() => setAck(false)); }}>{state.phase === "loading" ? "正在核验打印…" : "核验并打印"}</button>
    <p role="status" className="text-sm leading-6">{state.message}</p>
    {state.operationId && <p className="break-all text-xs text-slate-500">来源读取编号：{state.operationId}（不是打印完成凭据）</p>}
  </section>;
}
