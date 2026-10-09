"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceOutagePrintClient } from "@/lib/merchantAttendanceOutagePrintClient";
import { deliverOutagePrint } from "@/lib/merchantAttendanceOutagePrintBrowser";

export type OutagePrintProps = { siteId: string; actorId: string; access: "owner" | "self"; declarationId: string | null;
  apiFetch: AttendanceApiFetch; available: () => boolean; contextKey: string; disabled?: boolean; enabled?: boolean };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";

export default function MerchantAttendanceOutagePrint(props: OutagePrintProps) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OUTAGE_PRINT_ENABLED === "1";
  const scope = `${props.siteId}:${props.actorId}:${props.access}:${props.declarationId ?? ""}:${props.contextKey}`;
  // Revoke an older async result even between a scope-changing render and its
  // layout cleanup. Availability also checks the parent's live pending/draft guard.
  /* eslint-disable react-hooks/refs -- synchronous lifetime guard, not display state */
  const live = useRef({ scope, props, enabled }); live.current = { scope, props, enabled };
  const current = useCallback(() => {
    const value = live.current;
    try { return value.scope === scope && value.props.apiFetch === props.apiFetch && value.enabled && !value.props.disabled
      && typeof document !== "undefined" && !document.hidden && value.props.available(); } catch { return false; }
  }, [scope, props.apiFetch]);
  /* eslint-enable react-hooks/refs */
  if (!enabled) return null;
  return <Print key={scope} {...props} available={current}/>;
}

function Print(props: OutagePrintProps) {
  const client = useMemo(() => new AttendanceOutagePrintClient({ siteId: props.siteId, actorId: props.actorId, access: props.access,
    declarationId: props.declarationId, apiFetch: props.apiFetch, available: props.available, deliver: deliverOutagePrint }),
  [props.siteId, props.actorId, props.access, props.declarationId, props.apiFetch, props.available]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [ack, setAck] = useState(false);
  useLayoutEffect(() => {
    const clear = () => { client.invalidate(); setAck(false); };
    const visibility = () => { if (document.hidden) clear(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", clear);
    return () => { client.invalidate(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", clear); };
  }, [client]);
  const busy = state.phase === "loading" || props.disabled;
  return <section aria-label="故障备用纸表与交接打印" className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <h3 className="font-semibold">备用纸表与资料交接</h3>
    <p className="text-xs leading-6">请在系统可用时提前打印或按浏览器支持另存空白表。完全停机时，未缓存的网页不保证能打开；纸表只是声明，恢复后仍须逐人登记、核验原号和明确关联。</p>
    <button type="button" className={button} disabled={busy} onClick={() => { void client.print("blank", true); }}>打印空白备用表</button>
    {props.access === "owner" && props.declarationId ? <div className="space-y-3 border-t border-slate-200 pt-3">
      <p className="text-sm leading-6">当前声明的交接单只由负责人打印。每次重新读取声明和核对结果，分别标明读取时间；不是封存报表、工资表或完整历史。打印不会登记故障、代替本人确认或完成结案。</p>
      <label className="flex items-start gap-2 text-sm"><input aria-label="确认保管故障交接资料" type="checkbox" className="mt-1" checked={ack}
        disabled={busy} onChange={event => setAck(event.target.checked)}/><span>我会妥善保管员工资料；进入浏览器打印流程后，平台不能保证收回已打印或另存的文件。</span></label>
      <button type="button" className={button} disabled={busy || !ack} onClick={() => { void client.print("handoff", ack).finally(() => setAck(false)); }}>重新核验并打印此声明交接单</button>
    </div> : <p className="text-xs text-slate-600">{props.access === "owner" ? "读取一份已保存声明后，可重新核验并打印单份交接单。" : "本人可提前准备空白表；含已保存资料的交接单由当前企业负责人核验后打印。"}</p>}
    <p className="text-xs text-slate-600">存在未提交输入或待确认操作时，请先核对处理，再打印；不会自动重试或清除待确认编号。</p>
    <p role="status" aria-live="polite" className="break-words text-sm leading-6">{state.message}</p>
  </section>;
}
