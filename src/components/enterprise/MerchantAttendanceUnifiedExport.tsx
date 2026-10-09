"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { UnifiedReport } from "@/lib/merchantAttendanceUnifiedTimesheet";
import { unifiedExportSelection } from "@/lib/merchantAttendanceUnifiedExport";
import { UnifiedExportClient } from "@/lib/merchantAttendanceUnifiedExportClient";
import MerchantAttendancePrint from "./MerchantAttendancePrint";
type Props = { report: UnifiedReport; actorId: string; apiFetch: AttendanceApiFetch; onDenied: () => void; onStale: () => void; enabled?: boolean; printEnabled?: boolean };
export default function MerchantAttendanceUnifiedExport(props: Props) {
  if (!(props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_UNIFIED_EXPORT_ENABLED === "1")) return null;
  const selection = JSON.stringify(unifiedExportSelection(props.report));
  return <><Export key={`${props.actorId}:${selection}:${props.report.base.asOf}`} {...props} selection={selection}/>
    <MerchantAttendancePrint kind="unified" selection={JSON.parse(selection)} actorId={props.actorId} apiFetch={props.apiFetch}
      onDenied={props.onDenied} onStale={props.onStale} contextKey={props.report.base.asOf} enabled={props.printEnabled}/></>;
}
function Export({ actorId, apiFetch, onDenied, onStale, selection }: Props & { selection: string }) {
  const client = useMemo(() => new UnifiedExportClient({ selection: JSON.parse(selection), actorId, apiFetch, onDenied, onStale,
    available: () => document.visibilityState !== "hidden", deliver: file => {
      const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv;charset=utf-8" })), anchor = document.createElement("a");
      try { anchor.href = url; anchor.download = file.filename; anchor.hidden = true; document.body.append(anchor); anchor.click(); }
      finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } }), [selection, actorId, apiFetch, onDenied, onStale]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [ack, setAck] = useState(false);
  useEffect(() => { const hide = () => { client.invalidate(); setAck(false); }, visibility = () => { if (document.visibilityState === "hidden") hide(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); client.invalidate(); }; }, [client]);
  return <section aria-label="含整段申报的受控导出" className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
    <h3 className="font-semibold">导出含整段申报的工时 CSV</h3>
    <p className="text-xs leading-6">包含原始、原记录／补正核定、整段申报和合并核定，以及按日、来源、休息、批准明细。查看权限不代表导出权限；每次重新核验。不是工资表，不保存服务器文件副本。</p>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ack} disabled={state.phase === "loading"} onChange={e => setAck(e.target.checked)}/>
      我了解文件包含员工工时；下载后撤销平台权限不能收回文件，会妥善保管。</label>
    <button type="button" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={!ack || state.phase === "loading"}
      onClick={() => { void client.download(ack).finally(() => setAck(false)); }}>{state.phase === "loading" ? "正在生成…" : state.operationId ? "再次生成含整段申报的新文件" : "生成并下载含整段申报 CSV"}</button>
    <p role="status" className="text-sm leading-6">{state.message}</p>{state.operationId && <p className="break-all text-xs">来源读取编号：{state.operationId}（不是文件保存证明）</p>}
  </section>;
}
