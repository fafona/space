"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceRetentionDisposalExecutionClient } from "@/lib/merchantAttendanceRetentionDisposalExecutionClient";
import { DISPOSAL_LOCAL_SITE, type DisposalExecutionBlocker, type DisposalExecutionReceipt, type DisposalTrustedPreview } from "@/lib/merchantAttendanceRetentionDisposalExecution";
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
const field = "mt-1 block w-full min-w-0 max-w-full rounded-xl border p-3";
export type RetentionDisposalPanelProps = { siteId: string; authUserId: string; apiFetch: AttendanceApiFetch; enabled?: boolean;
  isCurrentAuth: () => boolean; onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
const blockers: Record<DisposalExecutionBlocker, string> = {
  policy_unconfigured: "尚未设置期限", not_due: "尚未到期", not_inside: "不是允许处置的 inside 定位", precision_not_present: "三字段不齐全", session_not_closed: "原班次尚未真实闭合",
  review_incomplete: "核查覆盖不完整", location_review: "存在核查记录", location_discussion: "存在沟通记录", snapshot_history_incomplete: "历史来源快照覆盖不完整", historical_location_snapshot: "存在历史定位来源快照",
  artifact_dependencies_incomplete: "归档依赖集合不完整", holds_incomplete: "关联保全核验不完整", location_held: "本条定位有保全", event_held: "原打卡有保全", artifact_held: "关联归档有保全",
  dependency_coverage_unknown: "原事件没有前向依赖覆盖证明", artifact_coverage_incomplete: "商户存在未完整覆盖的归档", artifact_dependency_limit: "关联归档超过单次安全上限", already_disposed: "已经处置",
};
export function RetentionDisposalPreviewView({ preview: p }: { preview: DisposalTrustedPreview }) {
  return <div className="min-w-0 space-y-3 rounded-xl border p-3 text-sm"><h3 className="font-bold">单条处置候选（提交时锁内复核）</h3>
    <dl className="space-y-1 break-all"><div>原打卡编号：{p.eventId}</div><div>人员编号：{p.workerId}</div><div>读取时刻：{p.asOf}</div><div>到期时刻：{p.dueAt ?? "未配置"}</div>
      <div>当前状态：{p.candidateState === "candidate" ? "满足本次候选条件；尚未批准或执行" : "不能处置"}</div><div>关联历史归档：{p.basis.dependencies.artifacts.items.length} 条</div></dl>
    {!!p.blockers.length && <ul className="space-y-1">{p.blockers.map(b => <li key={b}>{blockers[b]}</li>)}</ul>}
    <p>仅清除此笔定位的采集时刻、精度和距离三字段；保留原事件、位置分类、所有历史归档。候选预览不返回这三个原值。</p>
  </div>;
}
export function RetentionDisposalReceiptView({ receipt }: { receipt: DisposalExecutionReceipt | null }) {
  return <div className="min-w-0 space-y-1 rounded-xl bg-slate-50 p-3 text-sm">{receipt ? <>
    <p>{receipt.action === "approve" ? "原批准已保存，尚不表示已执行" : "原执行已保存"} · {receipt.recordedAt}</p><p className="break-all">原编号：{receipt.operationId}</p>
    <p className="break-all">批准编号：{receipt.approvalOperationId}</p><p>最小回执不恢复权限，也不授权下一操作。</p>
  </> : <p>尚未查到原号回执；不能据此认定失败或再次执行，原编号继续保留。</p>}</div>;
}
export default function MerchantAttendanceRetentionDisposalPanel({ siteId, authUserId, apiFetch, isCurrentAuth, onClose, registerLeaveGuard,
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RETENTION_DISPOSAL_ENABLED === "1" }: RetentionDisposalPanelProps) {
  const marker = useMemo(() => ({ siteId, authUserId, apiFetch, enabled: enabled && siteId === DISPOSAL_LOCAL_SITE, isCurrentAuth }), [siteId, authUserId, apiFetch, enabled, isCurrentAuth]);
  const liveMarker = useRef(marker), mounted = useRef(false); liveMarker.current = marker;
  const live = useCallback(() => mounted.current && liveMarker.current === marker && isCurrentAuth() === true, [marker, isCurrentAuth]);
  const client = useMemo(() => new AttendanceRetentionDisposalExecutionClient({ ...marker, isCurrentAuth: live,
    storage: () => { if (!live()) throw Error("scope_changed"); return sessionStorage; } }), [marker, live]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const empty = useCallback(() => ({ marker, eventId: "", reason: "", approvalId: "", ack: false }), [marker]);
  const [draft, setDraft] = useState(empty), [note, setNote] = useState({ marker, value: "" });
  const dirty = useRef(false), currentDraft = draft.marker === marker ? draft : empty();
  const clear = useCallback(() => { dirty.current = false; setDraft(empty()); setNote({ marker, value: "" }); }, [empty, marker]);
  const leave = useCallback(() => { if ((dirty.current || client.hasLeaveRisk()) && !window.confirm("离开将清除未提交输入；待确认处置原编号保留，不会自动重发。继续？")) return false;
    client.pause(); clear(); return true; }, [client, clear]);
  useEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [leave, registerLeaveGuard]);
  useEffect(() => { mounted.current = true; void client.initialize();
    const hide = () => { if (document.hidden) flushSync(() => { client.pause(); clear(); }); else void client.initialize(); };
    const pagehide = () => { client.pause(); clear(); }, pageshow = () => { if (!document.hidden) void client.initialize(); };
    const unload = (e: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", pagehide); window.addEventListener("pageshow", pageshow); window.addEventListener("beforeunload", unload);
    return () => { mounted.current = false; client.pause(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", pagehide); window.removeEventListener("pageshow", pageshow); window.removeEventListener("beforeunload", unload); };
  }, [client, clear]);
  const busy = state.phase === "loading" || state.phase === "saving", data = state.result?.data;
  const edit = (value: Partial<Omit<typeof draft, "marker">>) => { if (!live() || document.hidden || busy || state.pending) return; dirty.current = true; setDraft({ ...currentDraft, ...value, ack: value.ack ?? false }); };
  const read = async () => { if (!live() || document.hidden || busy || state.pending || dirty.current && !window.confirm("读取当前候选会清除未提交理由和批准编号，继续？")) return;
    const eventId = currentDraft.eventId; clear(); try { await client.preview(eventId); } catch { if (live()) setNote({ marker, value: "请输入完整有效的原打卡编号。" }); } };
  const candidate = data?.kind === "preview" && data.preview.candidateState === "candidate", canAct = marker.enabled && candidate && !busy && !state.pending && currentDraft.ack;
  const reasonValid = currentDraft.reason === currentDraft.reason.trim() && [...currentDraft.reason].length >= 1 && [...currentDraft.reason].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/u.test(currentDraft.reason);
  const submit = async (action: "approve" | "execute") => { if (!live() || document.hidden || !canAct || action === "approve" && !reasonValid
    || !window.confirm(action === "approve" ? "仅保存本条批准，不执行清除。确认批准？" : "确认按原批准实际清除此笔定位的三字段？原事件和历史归档不变，不能还原这三个值。")) return;
    try { if (action === "approve") await client.approve(currentDraft.reason); else await client.execute(currentDraft.approvalId);
      if (live() && (client.getSnapshot().pending || client.getSnapshot().result?.data.kind === "receipt")) clear();
    } catch { if (live()) setNote({ marker, value: "请检查批准编号、理由与当前候选；没有自动重试。" }); } };
  return <section aria-label="本地单条受控处置" className="min-w-0 max-w-full space-y-4 rounded-2xl border bg-white p-4 text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">单条定位受控处置</h2><button type="button" className={button} onClick={() => { if (leave()) onClose(); }}>关闭处置工作区</button></header>
    <p className="text-sm">仅本地合成商户验收，不处理真实用户资料。旧未覆盖事件、历史定位快照或任何关联保全均阻止处置。批准与执行为两个独立操作，不自动定时清除。</p>
    {!marker.enabled && <p className="text-sm">新的批准／执行未开放；仍可按 SQL 权限读取合成候选或核验本人原号。</p>}
    <p role="status" className="break-words text-sm">{note.marker === marker && note.value || state.message}</p>
    {state.pending ? <div className="space-y-2"><p className="break-all text-sm">待确认原编号：{state.pending.command.operationId}</p><button type="button" className={button} disabled={busy} onClick={() => { clear(); void client.recover(); }}>仅 GET 核验处置原编号</button></div>
      : <fieldset disabled={busy} className="min-w-0 space-y-3"><label className="block text-sm">原打卡编号<input className={field} value={currentDraft.eventId} maxLength={36} onChange={e => edit({ eventId: e.target.value })}/></label>
        <button type="button" className={button} disabled={!currentDraft.eventId} onClick={() => void read()}>读取单条处置预览</button></fieldset>}
    {data?.kind === "preview" && <RetentionDisposalPreviewView preview={data.preview}/>}
    {data?.kind === "receipt" && <RetentionDisposalReceiptView receipt={data.receipt}/>}
    {candidate && !state.pending && marker.enabled && <fieldset disabled={busy} className="min-w-0 space-y-3 rounded-xl border p-3"><legend>分别批准和执行</legend>
      <label className="block text-sm">批准理由<textarea className={field} rows={3} value={currentDraft.reason} onChange={e => edit({ reason: e.target.value })}/></label>
      <label className="block text-sm">执行时使用的原批准编号<input className={field} value={currentDraft.approvalId} maxLength={36} onChange={e => edit({ approvalId: e.target.value })}/></label>
      <label className="block text-sm"><input type="checkbox" checked={currentDraft.ack} onChange={e => edit({ ack: e.target.checked })}/> 我已核对本条范围，理解批准不执行、执行不可还原三字段。</label>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!canAct || !reasonValid} onClick={() => void submit("approve")}>仅保存批准</button>
        <button type="button" className={button} disabled={!canAct || !currentDraft.approvalId} onClick={() => void submit("execute")}>按原批准执行三字段处置</button></div>
    </fieldset>}
  </section>;
}
