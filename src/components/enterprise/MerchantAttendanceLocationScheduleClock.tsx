"use client";
import { LOCATION_DISPOSAL_NOTICE } from "@/lib/merchantAttendanceLocationDisposal";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { AttendanceLocationScheduleClient, type LocationScheduleClientState } from "@/lib/merchantAttendanceLocationScheduleClient";
import type { AttendanceLocationClockClient } from "@/lib/merchantAttendanceLocationClockClient";
import type { AttendancePositionFailure } from "@/lib/merchantAttendanceLocationClock";
import type { LocationScheduleHttpResult } from "@/lib/merchantAttendanceLocationSchedule";
import type { SelfScheduleSlot } from "@/lib/merchantAttendanceSelfSchedule";

type LegacyState = ReturnType<AttendanceLocationClockClient["getSnapshot"]>;
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
const failures: Record<AttendancePositionFailure, string> = { denied: "定位权限未获准", timeout: "定位超时", unavailable: "设备无法确定位置", unsupported: "设备不支持定位", not_provided: "此次未提供定位" };
const reasons: Record<string, string> = { publication_missing: "缺少排班发布时身份依据", cancelled: "选择的排班已取消", location_changed: "地点已变化", outside_window: "选择在核对窗口之外", approval_missing: "上班时没有可引用的排班规则核准" };
const outcomes: Record<string, string> = { ...failures, inside: "报告位置在范围内", outside: "报告位置在范围外", uncertain: "定位误差覆盖边界", stale: "位置已过期", future: "设备定位时间超前" };
function plan(slot: SelfScheduleSlot) {
  const format = new Intl.DateTimeFormat("zh-CN", { timeZone: slot.timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${slot.locationName} · ${format.format(new Date(slot.startAt))} — ${format.format(new Date(slot.endAt))}（${slot.timeZone}）`;
}
export function locationScheduleConfirmationReady(state: LocationScheduleClientState, legacyBusy: boolean, visible: boolean, previous: string | null) {
  const id = state.confirmed?.clock.receipt?.operationId;
  return visible && !legacyBusy && !state.pending && id && id !== previous ? id : null;
}
export function locationScheduleWorkspaceActivity(legacy: LegacyState, schedule: LocationScheduleClientState) {
  const busy = ["loading", "locating", "submitting"].includes(legacy.phase) || ["loading", "locating", "submitting"].includes(schedule.phase);
  return { phase: busy ? "loading" : schedule.phase === "storage_error" ? "loading" : "paused",
    pendingId: legacy.pending?.intent.operationId ?? schedule.pending?.intent.operationId ?? null,
    receiptId: schedule.confirmed?.clock.receipt?.operationId ?? legacy.confirmed?.receipt?.operationId ?? null };
}
export function LocationScheduleReceipt({ result }: { result: LocationScheduleHttpResult }) {
  const { clock, association, adoption } = result;
  if (!clock.receipt) return null;
  return <div className="min-w-0 space-y-3 text-sm" data-location-schedule-receipt>
    <p className="font-semibold">定位上班已由服务器记录 · UTC {clock.receipt.occurredAt}</p>
    {clock.locationResult && <p>定位摘要：{outcomes[clock.locationResult.reason]}{clock.locationResult.needsReview ? " · 待核查" : ""}；不等于现场身份或出勤正常证明。</p>}
    {clock.locationResult?.disposal && <p data-location-disposed>{LOCATION_DISPOSAL_NOTICE}</p>}
    <div data-location-schedule-association={association?.status ?? "legacy"} className="space-y-2 rounded-xl bg-blue-50 p-3">
      <p>{!association ? "原编号没有已保存的选班关系；未用当前计划补写历史。" : association.status === "linked" ? "上班时明确选择已保存" : association.status === "unselected" ? "本次明确不关联排班" : "打卡已保存，排班关联待核验"}</p>
      {association?.reason && <p>{reasons[association.reason]}</p>}
      {association?.slot && <p className="break-words">当时计划：{plan(association.slot)}</p>}
      {association?.currentCancelled && <p>该计划当前已取消；原选择与原打卡不会因此撤销或改写。</p>}
    </div>
    <div data-location-schedule-adoption={adoption?.status ?? "legacy"} className="space-y-2 rounded-xl border border-slate-200 p-3">
      <p className="font-semibold">{adoption?.status === "adopted" ? "已保存上班时核准引用" : adoption?.status === "not_approved" ? "上班时无已核准引用" : adoption?.status === "unselected" ? "未选排班，不引用排班核准" : adoption?.status === "unverified" ? "排班关联待核验，未采用核准引用" : "原编号没有核准引用记录"}</p>
      {adoption?.reason && <p>{reasons[adoption.reason]}</p>}
      <p>核准引用固定本次开班依据，不代表迟到、早退、整班完成、缺勤或工资结论。</p>
      {adoption?.approval && <details className="break-all"><summary>核对保存的核准引用</summary><p>核准版本：{adoption.approval.revision}</p><p>核准操作：{adoption.approval.operationId}</p>
        <p>来源编号：{adoption.approval.sourceId}</p><p>来源 SHA-256：{adoption.approval.sourceSha256}</p><p>核准保存 UTC：{adoption.approval.recordedAt}</p></details>}
    </div>
    <details className="break-all"><summary>核对原始操作、选择与告知</summary><p>操作编号：{clock.receipt.operationId}</p><p>原上班事件：{clock.receipt.id}</p>
      <p>告知版本：{clock.receiptGate?.noticeRevision ?? "未知"}</p><p>选择：{association?.selection ? `${association.selection.slotId} · 发布版本 ${association.selection.revision}` : association ? "不关联排班" : "无保存关系"}</p>
      {association?.slot && <p>保存计划 UTC：{association.slot.startAt} — {association.slot.endAt} · {association.slot.timeZone}</p>}
      {association && <p>关系保存 UTC：{association.recordedAt}</p>}{adoption && <p>引用保存 UTC：{adoption.recordedAt}</p>}</details>
  </div>;
}
export default function MerchantAttendanceLocationScheduleClock({ client, enabled, canClock, legacyState, active = true, onConfirmed }: {
  client: AttendanceLocationScheduleClient; enabled: boolean; canClock: boolean; legacyState: LegacyState; active?: boolean; onConfirmed: () => void;
}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [visible, setVisible] = useState(false), [choice, setChoice] = useState<{ result: LocationScheduleHttpResult | null; value: string }>({ result: null, value: "" });
  const [failure, setFailure] = useState<AttendancePositionFailure>("not_provided"), [acknowledged, setAcknowledged] = useState(false);
  const generation = useRef(0), confirmed = useRef<string | null>(null);
  const setSelection = useCallback((value: string) => { setChoice({ result: client.getSnapshot().result, value }); setAcknowledged(false); }, [client]);
  const selection = choice.result === state.result ? choice.value : "";
  const legacyBusy = ["idle", "loading", "locating", "submitting"].includes(legacyState.phase);
  useLayoutEffect(() => {
    let alive = true;
    const hide = () => { generation.current++; client.pause(); setVisible(false); setSelection(""); setAcknowledged(false); setFailure("not_provided"); };
    const show = async () => {
      const lease = ++generation.current; setSelection(""); setAcknowledged(false);
      if (!active || document.hidden) { hide(); return; }
      await client.initialize();
      if (alive && lease === generation.current && !document.hidden) setVisible(true);
    };
    const onHidden = () => flushSync(hide), onVisibility = () => { if (document.hidden) onHidden(); else void show(); };
    const unload = (event: BeforeUnloadEvent) => { if (client.getSnapshot().pending) { event.preventDefault(); event.returnValue = ""; } };
    void show(); document.addEventListener("visibilitychange", onVisibility); window.addEventListener("pagehide", onHidden);
    window.addEventListener("pageshow", onVisibility); window.addEventListener("beforeunload", unload);
    const stop = () => { alive = false; generation.current++; client.pause(); };
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHidden); window.removeEventListener("pageshow", onVisibility); window.removeEventListener("beforeunload", unload); };
  }, [client, active, setSelection]);
  useEffect(() => {
    const id = locationScheduleConfirmationReady(state, legacyBusy, visible, confirmed.current);
    if (id) { confirmed.current = id; onConfirmed(); }
  }, [state, legacyBusy, visible, onConfirmed]);
  return <LocationScheduleClockContent client={client} state={state} legacyState={legacyState} enabled={enabled} canClock={canClock} visible={active && visible}
    selection={selection} setSelection={setSelection} failure={failure} setFailure={setFailure} acknowledged={acknowledged} setAcknowledged={setAcknowledged}/>;
}
export function LocationScheduleClockContent({ client, state, legacyState, enabled, canClock, visible, selection, setSelection, failure, setFailure, acknowledged, setAcknowledged }: {
  client: Pick<AttendanceLocationScheduleClient, "refresh" | "initialize" | "submit" | "retry" | "pause">; state: LocationScheduleClientState; legacyState: LegacyState;
  enabled: boolean; canClock: boolean; visible: boolean; selection: string; setSelection: (value: string) => void;
  failure: AttendancePositionFailure; setFailure: (value: AttendancePositionFailure) => void; acknowledged: boolean; setAcknowledged: (value: boolean) => void;
}) {
  if (!visible || !enabled && !state.pending && !state.result && state.phase !== "storage_error") return null;
  const busy = ["loading", "locating", "submitting"].includes(state.phase), legacyBusy = ["idle", "loading", "locating", "submitting"].includes(legacyState.phase);
  const result = state.result, chosen = result?.choices.entries.find(slot => slot.id === selection);
  const canSend = !busy && !legacyBusy && !legacyState.pending && legacyState.phase === "ready" && enabled && canClock
    && !!result?.moduleEnabled && result.selectionEnabled && result.clock.channelEnabled && result.clock.noticeGate.ready && result.clock.state.status === "off";
  const canSubmit = canSend && (state.pending ? state.phase === "unconfirmed" : state.phase === "ready" && (selection === "none" || !!chosen));
  const recent = legacyState.result?.state.lastEvent?.action === "clock_in" ? legacyState.result.state.lastEvent : null;
  const submit = (withoutPosition: boolean) => {
    if (!visible || document.hidden || !canSubmit || withoutPosition && !acknowledged) return;
    setAcknowledged(false); const reason = withoutPosition ? failure : null;
    if (state.pending) void client.retry(reason);
    else if (selection === "none") void client.submit(null, reason);
    else if (chosen) void client.submit({ slotId: chosen.id, revision: chosen.revision }, reason);
  };
  return <section aria-label="本次排班与定位上班" data-location-schedule-clock className="min-w-0 space-y-3 rounded-2xl border border-blue-200 bg-blue-50/30 p-4">
    <h3 className="font-bold">本次排班与定位上班</h3><p className="text-sm leading-6">先读取本人候选，明确选班或不关联，再请求一次定位。不会自动选班，不会以定位通过代替排班、核准或实际出勤结论。</p>
    <p role="status" className="text-sm">{state.message}</p>
    {legacyState.pending && <p className="text-sm text-amber-900">旧定位打卡尚有待确认编号，请在原入口核对。两个编号同时存在时，只读核对，不重复提交。</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || legacyBusy} onClick={() => {
      if (!visible || document.hidden) return; setSelection(""); void (state.phase === "storage_error" ? client.initialize() : client.refresh());
    }}>核对定位选班与原号</button>
      {!state.pending && recent && <button type="button" className={button} disabled={busy || legacyBusy || !!legacyState.pending} onClick={() => {
        if (!visible || document.hidden) return; setSelection(""); void client.refresh(recent.operationId);
      }}>读取最近定位上班选择</button>}
      {busy && <button type="button" className={button} onClick={client.pause}>停止选班等待</button>}</div>
    {state.pending ? <div className="space-y-2 text-sm"><p className="break-all">原操作编号：{state.pending.intent.operationId}</p>
      <p className="break-all">固定原选择：{state.pending.selection ? `${state.pending.selection.slotId} · 发布版本 ${state.pending.selection.revision}` : "不关联排班"}</p>
      <button type="button" className={button} disabled={!canSubmit} onClick={() => submit(false)}>原编号定位重试</button>
      <p>重试先读取原号；确需提交时重新采样一次定位，不更换原编号、原选择或原告知版本。</p>
      {(!enabled || result?.selectionEnabled === false) && <p>选班写入已关闭，仅可读取核对；不会降级为旧上班提交。</p>}</div>
      : enabled && result?.selectionEnabled !== false && <div className="space-y-3">
        {result?.choices.limited && <p className="text-sm text-amber-900">候选超过本次有界读取上限，不等于没有排班；可以明确选择不关联排班。</p>}
        {result && !result.choices.limited && !result.choices.entries.length && <p className="text-sm">当前窗口没有候选，不等于没有工作或缺勤。</p>}
        <label className="block text-sm">本次定位排班<select aria-label="本次定位排班" value={selection} disabled={!canSend}
          className="mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-3" onChange={event => setSelection(event.target.value)}>
          <option value="">请明确选择</option><option value="none">不关联排班</option>
          {result?.choices.entries.map(slot => <option key={slot.id} value={slot.id}>{plan(slot)}{slot.cancelled ? "（已取消，待核验）" : !slot.hasPublicationEvidence ? "（缺发布依据）" : ""}</option>)}
        </select></label>
        <button type="button" className="min-h-14 w-full rounded-xl bg-slate-950 px-4 py-3 font-bold text-white disabled:opacity-40" disabled={!canSubmit}
          onClick={() => submit(false)}>定位上班 · {selection === "none" ? "不关联排班" : chosen ? "已选排班" : "请先明确选择"}</button>
      </div>}
    {result && !result.clock.noticeGate.ready && <p className="text-sm text-amber-900">当前定位告知尚未就绪，请在原告知入口核对并明确确认；此时不会请求定位。</p>}
    {result?.selectionEnabled === false && !state.pending && <p className="text-sm">本企业未开放定位选班，新选择不提交；原定位入口保持原路径。</p>}
    {(enabled || state.pending) && <details className="rounded-xl border border-slate-200 p-3"><summary className="text-sm font-semibold">选班后无法提供位置？明确登记待核查</summary>
      <p className="mt-2 text-sm">不会自动改成无定位；按服务器当前时间上班，不补录过去时间，排班选择仍固定。</p>
      <label className="mt-3 block text-sm">选班无定位原因<select aria-label="选班无定位原因" value={failure} disabled={busy} onChange={event => { setFailure(event.target.value as AttendancePositionFailure); setAcknowledged(false); }} className="mt-1 w-full rounded-xl border p-3">
        {Object.entries(failures).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={!canSubmit} onChange={event => setAcknowledged(event.target.checked)}/>
        我明确登记现在上班，并知悉本次无定位情况需要核查。</label>
      <button type="button" className={`${button} mt-3`} disabled={!canSubmit || !acknowledged} onClick={() => submit(true)}>{state.pending ? "原编号无定位重试" : "无定位上班 · 待核查"}</button>
    </details>}
    {result && <LocationScheduleReceipt result={result}/>}
    <p className="text-xs leading-6 text-slate-600">关闭或隐藏会清除显示并停止后续采样，不撤销已发送操作。仅在本标签页保存恢复编号、原命令和选择，不保存坐标；返回后须明确读取。</p>
  </section>;
}
