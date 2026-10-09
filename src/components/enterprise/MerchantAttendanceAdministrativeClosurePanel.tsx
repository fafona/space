"use client";
// 195: explicit reads and administrative declarations; never a clock-out or pay calculation.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceAdministrativeClosureClient } from "@/lib/merchantAttendanceAdministrativeClosureClient";
import type { AdministrativeClosureAccess, AdministrativeClosureDetail, AdministrativeClosureEntry, AdministrativeClosureResult } from "@/lib/merchantAttendanceAdministrativeClosure";
import { correctionTimeOffsets, correctionTimeControlValue, parseCorrectionTimeInput } from "@/lib/merchantAttendanceCorrectionForm";
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
const field = "mt-1 block w-full min-w-0 max-w-full rounded-xl border p-3";
const currentAuth = () => true;
export type AdministrativeClosurePanelProps = { siteId: string; access: AdministrativeClosureAccess; authUserId: string; apiFetch: AttendanceApiFetch; enabled?: boolean;
  isCurrentAuth?: () => boolean; onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
const actionName = { record_unknown: "结束时刻不明记录", close: "行政结案", self_dispute: "本人异议", owner_respond: "负责人回复" };
const blockerName = { not_paused: "当前未暂停", identity_changed: "身份绑定已变化", employment_changed: "任职期已变化", suspension_changed: "暂停代际已变化", source_changed: "原始来源已变化",
  session_not_open: "当前没有可结案的未结束时段", already_closed: "已经行政结案", revision_limit: "版本已达安全边界", feature_disabled: "新的行政结案未开放", period_sealed: "相关周期已封存", source_too_large: "来源超过本次有界读取范围" };
export function AdministrativeClosureEntryView({ entry }: { entry: AdministrativeClosureEntry }) { return <div className="min-w-0 space-y-1 rounded-xl border p-3 text-sm">
  <p>{actionName[entry.action]} · 版本 {entry.revision} · {entry.recordedAt}</p><p className="whitespace-pre-wrap break-words">说明：{entry.reason}</p>
  <p className="break-all">操作人：{entry.actorId}（{entry.actorAccess === "self" ? "本人" : "当时负责人"}）</p><p className="break-all">原编号：{entry.operationId}</p>
  {entry.disputeOperationId && <p className="break-all">回复的异议编号：{entry.disputeOperationId}；回复不撤销异议。</p>}
</div>; }
export function AdministrativeClosureEvidence({ detail, mode }: { detail: AdministrativeClosureDetail; mode: "candidate" | "detail" }) {
  const f = detail.frame, s = detail.summary;
  return <div className="min-w-0 space-y-3 text-sm"><p>{mode === "candidate" ? "当前锁定来源的候选快照（提交时仍会再次核对）" : "当时保存的行政依据，不代表当前可继续结案"}</p>
    {f && <dl className="space-y-1 break-words rounded-xl bg-slate-50 p-3"><div className="break-all">原时段：{f.startEventId}</div>
      <div>企业时区：{f.timeZone}</div><div>原始开始：{f.startAt} · 原序号 {f.startSequence}</div>
      <div>最后真实事件：{f.tailAction} · {f.tailOccurredAt} · 原序号 {f.tailSequence}</div><div className="break-all">任职期：{f.employmentPeriodId}</div>
      <div>暂停代际：{f.generation}</div><div className="break-all">来源指纹：{detail.context?.sourceFingerprint}</div></dl>}
    <p>{s ? `状态：${s.state === "closed" ? "已行政结案" : "结束时刻仍不明"} · 版本 ${s.revision}` : "尚无该时段的行政记录。"}</p>
    {s?.hasDispute && <p className="rounded-xl bg-amber-50 p-3">本人曾提出异议；负责人回复不会抹去异议。</p>}
    {detail.closure && <p>核验结束时刻：{detail.closure.verifiedEndAt}。这是独立行政边界，不是补造的打卡，不计为已核实工时。</p>}
    {!!detail.blockers.length && <ul>{detail.blockers.map(b => <li key={b}>{blockerName[b]}</li>)}</ul>}
    {detail.currentEntry && <AdministrativeClosureEntryView entry={detail.currentEntry}/>}</div>;
}
export function AdministrativeClosureReceiptView({ result }: { result: AdministrativeClosureResult }) {
  if (result.data.kind !== "receipt") return null; const receipt = result.data.receipt;
  return <p className="break-all rounded-xl bg-slate-50 p-3 text-sm">{receipt ? `${actionName[receipt.action]}回执：${receipt.operationId} · 版本 ${receipt.revision} · ${receipt.recordedAt}。这不是新操作授权。` : "尚未找到原号回执；不能据此认定失败，也不会清除原编号。"}</p>;
}
export default function MerchantAttendanceAdministrativeClosurePanel({ siteId, access, authUserId, apiFetch,
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_ADMINISTRATIVE_CLOSURES_ENABLED === "1", isCurrentAuth = currentAuth, onClose, registerLeaveGuard }: AdministrativeClosurePanelProps) {
  const marker = useMemo(() => ({ siteId, access, authUserId, apiFetch, enabled, isCurrentAuth }), [siteId, access, authUserId, apiFetch, enabled, isCurrentAuth]);
  // Synchronous render fence: an obsolete client loses its lease before effect cleanup.
  const liveMarker = useRef(marker), mounted = useRef(false); liveMarker.current = marker;
  const live = useCallback(() => mounted.current && liveMarker.current === marker && isCurrentAuth() === true, [marker, isCurrentAuth]);
  const client = useMemo(() => new AttendanceAdministrativeClosureClient({ ...marker, isCurrentAuth: live, storage: () => { if (!live()) throw Error("scope_changed"); return sessionStorage; } }), [marker, live]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [draft, setDraft] = useState({ marker, reason: "", time: { local: "", offset: "" }, ack: false, disputeId: "" }), [note, setNote] = useState({ marker, value: "" });
  const dirty = useRef(false), currentDraft = draft.marker === marker ? draft : { marker, reason: "", time: { local: "", offset: "" }, ack: false, disputeId: "" };
  const clear = useCallback(() => { dirty.current = false; setDraft({ marker, reason: "", time: { local: "", offset: "" }, ack: false, disputeId: "" }); setNote({ marker, value: "" }); }, [marker]);
  const leave = useCallback(() => { if ((dirty.current || client.hasLeaveRisk()) && !window.confirm("离开会清除未提交的说明和时刻。已经保存的待确认原编号仍保留，不会重发或撤回。确定离开？")) return false; client.pause(); clear(); return true; }, [client, clear]);
  useEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [leave, registerLeaveGuard]);
  useEffect(() => { mounted.current = true; void client.initialize();
    const hide = () => { if (document.hidden) flushSync(() => { client.pause(); clear(); }); else void client.initialize(); };
    const pagehide = () => { client.pause(); clear(); }, pageshow = () => { if (!document.hidden) void client.initialize(); };
    const unload = (e: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", pagehide); window.addEventListener("pageshow", pageshow); window.addEventListener("beforeunload", unload);
    return () => { mounted.current = false; client.pause(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", pagehide); window.removeEventListener("pageshow", pageshow); window.removeEventListener("beforeunload", unload); };
  }, [client, clear]);
  const busy = state.phase === "loading" || state.phase === "saving", data = state.result?.data;
  const d = data?.kind === "candidate" || data?.kind === "detail" ? data.detail : null;
  const edit = (value: Partial<Omit<typeof draft, "marker">>) => { if (!live() || busy || state.pending) return; dirty.current = true; setDraft({ ...currentDraft, ...value, ack: value.ack ?? false }); };
  const read = async (request: () => Promise<void>, disputeId = "") => {
    if (!live() || document.hidden || busy || state.pending || dirty.current && !window.confirm("读取其他资料会清除尚未提交的说明和时刻，是否继续？")) return;
    clear(); await request(); if (live() && !document.hidden && disputeId) setDraft({ marker, reason: "", time: { local: "", offset: "" }, ack: false, disputeId });
  };
  const reasonValid = currentDraft.reason === currentDraft.reason.trim() && [...currentDraft.reason].length >= 1 && [...currentDraft.reason].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/u.test(currentDraft.reason);
  let verifiedEndAt: string | null = null;
  try { if (d?.frame) verifiedEndAt = parseCorrectionTimeInput(currentDraft.time, d.frame.timeZone); } catch { /* No guessed local/DST boundary. */ }
  const endValid = !!verifiedEndAt && !!d?.frame && verifiedEndAt >= d.frame.tailOccurredAt && !!state.result && verifiedEndAt <= state.result.readAt;
  const canAct = !busy && !state.pending && reasonValid && currentDraft.ack;
  const submit = async (action: "unknown" | "close" | "dispute" | "respond") => {
    if (!live() || document.hidden || !canAct || action === "close" && !endValid || !window.confirm("确认提交当前说明？行政结案不会补造原始打卡、恢复账号或计算工资；异议与回复也不会改写原记录。")) return;
    try { if (action === "unknown") await client.recordUnknown(currentDraft.reason); else if (action === "close" && verifiedEndAt) await client.close(verifiedEndAt, currentDraft.reason);
      else if (action === "dispute") await client.dispute(currentDraft.reason); else if (action === "respond") await client.respond(currentDraft.disputeId || (d?.currentEntry?.action === "self_dispute" ? d.currentEntry.operationId : ""), currentDraft.reason);
      if (live() && (client.getSnapshot().pending || client.getSnapshot().result?.data.kind === "receipt")) clear();
    } catch { if (live()) setNote({ marker, value: "请检查完整理由、核验时刻与当前资料；未自动重试。" }); }
  };
  const time = currentDraft.time, zone = d?.frame?.timeZone ?? "UTC", offsets = correctionTimeOffsets(time.local, zone);
  const next = data?.kind === "history" ? data.nextBeforeRevision !== null : data?.kind === "list" || data?.kind === "workers" ? data.nextAfterId !== null : false;
  return <section aria-label="行政结案记录" className="min-w-0 max-w-full space-y-4 rounded-2xl border bg-white p-4 text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{access === "owner" ? "行政结案与异议回复" : "本人行政结案记录与异议"}</h2><button type="button" className={button} onClick={() => { if (leave()) onClose(); }}>关闭行政记录</button></header>
    <p className="text-sm">仅保存核验说明与独立行政边界。原始打卡不改，不推算工时、工资或缺勤，也不会自动恢复账号或结束任职。</p>
    {!enabled && <p className="text-sm">新的行政结案入口未开放；本人历史、异议、负责人回复与最小原号回执仍可按当前权限核验。</p>}
    <p role="status" className="break-words text-sm">{note.marker === marker && note.value || state.message}</p>
    {state.pending ? <div className="space-y-2"><p className="break-all">待确认原编号：{state.pending.command.operationId}</p><button type="button" className={button} disabled={busy} onClick={() => { clear(); void client.recover(); }}>仅 GET 核验行政原编号</button></div>
      : <nav aria-label="行政记录读取" className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void read(client.list)}>读取已保存行政记录</button>
        {access === "owner" && enabled && <button type="button" className={button} disabled={busy} onClick={() => void read(client.workers)}>读取可核验人员</button>}</nav>}
    {data?.kind === "workers" && <div className="space-y-2"><p className="text-sm">本页最多 25 人；名单不是可结案授权。需读取当前原始尾部与暂停依据。</p>{data.items.map(w => <div key={w.workerId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border p-3"><span className="break-words">{w.workerNo} · {w.displayName} · {w.paused ? "已暂停" : "未暂停"}</span><button type="button" className={button} disabled={busy || !w.employeeId || !w.employeeAuthUserId} onClick={() => void read(() => client.candidate(w.workerId))}>读取此人结案候选</button></div>)}</div>}
    {data?.kind === "list" && <div className="space-y-2"><p className="text-sm">本页最多 25 条，不累计历史。</p>{!data.items.length && <p>当前身份在此商户没有可读取的行政记录。</p>}{data.items.map(s => <div key={s.startEventId} className="space-y-2 rounded-xl border p-3 text-sm"><p className="break-all">时段 {s.startEventId}</p><p>{s.state === "closed" ? "已行政结案" : "结束时刻仍不明"} · 版本 {s.revision}{s.hasDispute ? " · 保留本人异议" : ""}</p><button type="button" className={button} disabled={busy} onClick={() => void read(() => client.detail(s.startEventId))}>读取行政详情</button></div>)}</div>}
    {data?.kind === "history" && <div className="space-y-2"><p className="text-sm">本页最多 25 个连续版本，按倒序读取。</p>{data.items.map(e => <div key={e.operationId}><AdministrativeClosureEntryView entry={e}/>{access === "owner" && e.action === "self_dispute" && <button type="button" className={button} disabled={busy} onClick={() => void read(() => client.detail(e.startEventId), e.operationId)}>选此异议并重读当前详情</button>}</div>)}</div>}
    {next && <button type="button" className={button} disabled={busy} onClick={() => void read(client.nextPage)}>读取下一页</button>}
    {state.result && <AdministrativeClosureReceiptView result={state.result}/>}
    {d && (data?.kind === "candidate" || data?.kind === "detail") && <><AdministrativeClosureEvidence detail={d} mode={data.kind}/>
      {d.summary && <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void read(() => client.history(d.summary!.startEventId))}>读取此时段行政历史</button>
        {access === "owner" && enabled && d.summary.state === "pending" && <button type="button" className={button} disabled={busy} onClick={() => void read(() => client.candidate(d.summary!.identity.workerId))}>重新核验当前结案来源</button>}</div>}
      {!state.pending && (enabled && (d.capabilities.canClose || d.capabilities.canRecordUnknown) || d.capabilities.canDispute || d.capabilities.canRespond) && <fieldset disabled={busy} className="min-w-0 space-y-3 rounded-xl border p-3">
        <legend>明确核验后提交</legend>
        {enabled && data.kind === "candidate" && d.capabilities.canClose && <><p className="text-sm">输入已核验的实际结束时刻（{zone}）；须不早于最后真实事件、不晚于本次读取时刻 {state.result?.readAt}。不明时使用“结束时刻不明”，不要猜测。</p>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2"><label>核验结束时刻<input type="datetime-local" step="0.001" aria-label="核验结束时刻" className={field} value={correctionTimeControlValue(time.local)} onChange={e => { const local = e.target.value, choices = correctionTimeOffsets(local, zone); edit({ time: { local, offset: choices.length === 1 ? choices[0] : "" } }); }}/></label>
            <label>核验结束时刻的 UTC 偏移<select className={field} aria-label="核验结束时刻的 UTC 偏移" value={time.offset} onChange={e => edit({ time: { ...time, offset: e.target.value } })}><option value="">明确选择有效偏移</option>{offsets.map(o => <option key={o} value={o}>{o}</option>)}</select></label></div>
          {time.local && !endValid && <p className="text-sm text-red-700">时刻无效、超出范围或偏移尚未确认；不能提交结案。</p>}</>}
        {!!currentDraft.disputeId && <p className="break-all text-sm">回复已选异议：{currentDraft.disputeId}</p>}
        <label className="block">核验／异议／回复说明<textarea className={field} aria-label="行政说明" rows={4} value={currentDraft.reason} onChange={e => edit({ reason: e.target.value })}/></label>
        <label className="block text-sm"><input type="checkbox" checked={currentDraft.ack} onChange={e => edit({ ack: e.target.checked })}/> 我已核对以上依据与说明，理解这不会修改原打卡、推算工资或撤销异议。</label>
        <div className="flex flex-wrap gap-2">{enabled && d.capabilities.canRecordUnknown && <button type="button" className={button} disabled={!canAct} onClick={() => void submit("unknown")}>保存结束时刻不明记录</button>}
          {enabled && d.capabilities.canClose && <button type="button" className={button} disabled={!canAct || !endValid} onClick={() => void submit("close")}>确认行政结案</button>}
          {d.capabilities.canDispute && <button type="button" className={button} disabled={!canAct} onClick={() => void submit("dispute")}>提交本人异议</button>}
          {d.capabilities.canRespond && <button type="button" className={button} disabled={!canAct || !currentDraft.disputeId && d.currentEntry?.action !== "self_dispute"} onClick={() => void submit("respond")}>保存负责人回复</button>}</div>
      </fieldset>}
    </>}
  </section>;
}
