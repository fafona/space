"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { AttendanceSelfScheduleClient, type SelfScheduleClientState } from "@/lib/merchantAttendanceSelfScheduleClient";
import type { AttendanceClientState } from "@/lib/merchantAttendanceSelfClient";
import type { SelfScheduleHttpResult, SelfScheduleSlot } from "@/lib/merchantAttendanceSelfSchedule";

const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
const reasons: Readonly<Record<string, string>> = Object.freeze({ publication_missing: "该本人排班没有发布时身份依据，未补造历史关联。",
  cancelled: "该本人排班已取消；本次打卡保留，但没有自动换班。", location_changed: "打卡地点与原选择不一致，关联待核验。",
  outside_window: "原选择不在本次可核验日期窗口，关联待核验。" });
function plan(slot: SelfScheduleSlot) {
  const format = new Intl.DateTimeFormat("zh-CN", { timeZone: slot.timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${slot.locationName} · ${format.format(new Date(slot.startAt))} — ${format.format(new Date(slot.endAt))}（${slot.timeZone}）`;
}
export function SelfScheduleAssociation({ result }: { result: SelfScheduleHttpResult }) {
  const association = result.association;
  if (!result.clock.receipt) return null;
  if (!association) return <div data-self-schedule-association="legacy" className="rounded-xl bg-amber-50 p-3 text-sm">
    此原上班编号没有已保存的排班关联；没有用当前排班补写历史。<p className="break-all">原上班事件：{result.clock.receipt.id}</p></div>;
  return <div data-self-schedule-association={association.status} className="min-w-0 space-y-2 rounded-xl bg-blue-50 p-3 text-sm">
    <p className="font-semibold">{association.status === "linked" ? "上班时明确选择已保存" : association.status === "unselected" ? "本次明确不关联排班" : "打卡已保存，排班关联待核验"}</p>
    {association.reason && <p>{reasons[association.reason]}</p>}
    {association.slot && <p className="break-words">当时计划：{plan(association.slot)}</p>}
    {association.currentCancelled === true && <p>该计划当前已取消；这不改写上班时的原选择，也不撤销打卡。</p>}
    <p>这是本次员工选择，不是自动时间匹配或现场证明；不代表整班完成、迟到、早退、缺勤或工资结论。</p>
    <details className="break-all"><summary>核对原始选择与编号</summary><p>原上班事件：{association.startEventId}</p><p>原操作：{association.operationId}</p>
      <p>选择：{association.selection ? `${association.selection.slotId} · 发布版本 ${association.selection.revision}` : "不关联排班"}</p>
      {association.slot && <p>计划 UTC：{association.slot.startAt} — {association.slot.endAt}</p>}
      <p>观察排班版本：{association.observedRevision} · 保存 UTC：{association.recordedAt}</p></details>
  </div>;
}

export type SelfScheduleClockProps = { client: AttendanceSelfScheduleClient; enabled: boolean; canClock: boolean;
  legacyState: AttendanceClientState; active?: boolean; onConfirmed: () => void };
export function selfScheduleConfirmationReady(state: SelfScheduleClientState, legacyBusy: boolean, visible: boolean, previousOperationId: string | null) {
  const operationId = state.result?.clock.receipt?.operationId;
  return visible && !legacyBusy && !state.pending && operationId && operationId !== previousOperationId ? operationId : null;
}
/** Mounted even with the feature off: only local pending discovery is automatic
 * then. New pending can still GET its original receipt, never POST/fallback. */
export default function MerchantAttendanceSelfScheduleClock({ client, enabled, canClock, legacyState, active = true, onConfirmed }: SelfScheduleClockProps) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [visible, setVisible] = useState(false);
  const [selectionState, setSelectionState] = useState<{ value: string; result: SelfScheduleHttpResult | null }>({ value: "", result: null });
  const selection = selectionState.result === state.result ? selectionState.value : "";
  const setSelection = useCallback((value: string) => setSelectionState({ value, result: client.getSnapshot().result }), [client]);
  const generation = useRef(0), autoRead = useRef(false), confirmed = useRef<string | null>(null);
  const legacyBusy = legacyState.phase === "loading" || legacyState.phase === "submitting";
  useLayoutEffect(() => {
    let alive = true;
    const hide = () => { generation.current++; autoRead.current = false; client.pause(); setVisible(false); setSelection(""); };
    const show = async () => {
      const lease = ++generation.current; autoRead.current = false; setSelection("");
      if (!active || document.hidden) { client.pause(); setVisible(false); return; }
      await client.initialize();
      if (!alive || lease !== generation.current || document.hidden) return;
      setVisible(true);
    };
    const onHidden = () => flushSync(hide), onVisible = () => { if (document.hidden) onHidden(); else void show(); };
    const unload = (event: BeforeUnloadEvent) => { if (client.getSnapshot().pending) { event.preventDefault(); event.returnValue = ""; } };
    void show(); document.addEventListener("visibilitychange", onVisible); window.addEventListener("pagehide", onHidden);
    window.addEventListener("pageshow", onVisible); window.addEventListener("beforeunload", unload);
    const stop = () => { alive = false; generation.current++; client.pause(); };
    return () => { stop(); document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onHidden); window.removeEventListener("pageshow", onVisible); window.removeEventListener("beforeunload", unload); };
  }, [client, active, setSelection]);
  useEffect(() => {
    if (!visible || !active || document.hidden || legacyBusy || autoRead.current || state.phase === "storage_error") return;
    // Give the original pending its own original GET first. If both intents
    // exist, manual read-only buttons remain available, but neither may POST.
    if (legacyState.pending) return;
    autoRead.current = true;
    if (enabled || state.pending) void client.refresh();
  }, [client, visible, active, enabled, legacyBusy, legacyState.pending, state.pending, state.phase]);
  useEffect(() => {
    const id = selfScheduleConfirmationReady(state, legacyBusy, visible, confirmed.current);
    if (id) { confirmed.current = id; onConfirmed(); }
  }, [state, legacyBusy, visible, onConfirmed]);
  if (!active || !visible) return null;
  return <SelfScheduleClockContent client={client} enabled={enabled} canClock={canClock} legacyState={legacyState} state={state}
    visible={visible} selection={selection} setSelection={setSelection}/>;
}
export function SelfScheduleClockContent({ client, enabled, canClock, legacyState, state, visible, selection, setSelection }: {
  client: Pick<AttendanceSelfScheduleClient, "refresh" | "initialize" | "retry" | "submit">; enabled: boolean; canClock: boolean;
  legacyState: AttendanceClientState; state: SelfScheduleClientState; visible: boolean; selection: string; setSelection: (selection: string) => void;
}) {
  const legacyBusy = legacyState.phase === "loading" || legacyState.phase === "submitting";
  const busy = state.phase === "loading" || state.phase === "submitting";
  if (!visible || !enabled && !state.pending && !state.result && state.phase !== "storage_error") return null;
  const result = state.result, ready = state.phase === "ready" && !!result;
  const canSubmit = ready && enabled && canClock && !legacyBusy && !legacyState.pending && legacyState.phase === "ready"
    && result.moduleEnabled && result.selectionEnabled && result.clock.state.status === "off" && !!result.clock.locationId;
  const chosen = result?.choices.entries.find(slot => slot.id === selection);
  const recentClockIn = legacyState.result?.state.lastEvent?.action === "clock_in" ? legacyState.result.state.lastEvent : null;
  return <section aria-label="本次排班与上班打卡" data-self-schedule-clock className="min-w-0 space-y-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
    <h3 className="font-bold">本次排班与上班打卡</h3>
    <p className="text-sm leading-6">请明确选择一个计划，或选择“不关联排班”。不会根据唯一时间候选自动选班；一个计划可以对应多个实际工作时段。</p>
    <p role="status" className="text-sm">{state.message}</p>
    {legacyState.pending && <p className="text-sm text-amber-900">原普通打卡还有待确认编号，请先核对原打卡。若两个恢复编号同时存在，只读核对，不重复提交。</p>}
    <button type="button" className={button} disabled={busy || legacyBusy} onClick={() => {
      if (!visible || document.hidden) return; setSelection(""); void (state.phase === "storage_error" ? client.initialize() : client.refresh());
    }}>核对选班与打卡结果</button>
    {!state.pending && recentClockIn && <button type="button" className={button} disabled={busy || legacyBusy || legacyState.phase !== "ready" || !!legacyState.pending}
      onClick={() => { if (visible && !document.hidden && legacyState.phase === "ready" && !legacyState.pending) { setSelection(""); void client.refresh(recentClockIn.operationId); } }}>
      读取最近上班选择</button>}
    {state.pending ? <div className="space-y-2 text-sm"><p className="break-all">原操作编号：{state.pending.command.operationId}</p>
      <p className="break-all">原选择：{state.pending.selection ? `排班 ${state.pending.selection.slotId} · 发布版本 ${state.pending.selection.revision}` : "不关联排班"}</p>
      <button type="button" className={button} disabled={busy || legacyBusy || !!legacyState.pending || !enabled || !canClock || !result?.selectionEnabled || !result.moduleEnabled}
        onClick={() => { if (visible && !document.hidden) void client.retry(); }}>用原编号重试选班上班</button>
      {(!enabled || result?.selectionEnabled === false) && <p>选班写入已关闭；保留原编号，只能读取核对，不会转用旧上班接口。</p>}</div>
      : enabled && result?.selectionEnabled !== false && <div className="space-y-3">
        {result?.choices.limited && <p className="text-sm text-amber-900">候选超过本次有界读取上限，不表示没有排班。可重新核对，或明确选择不关联排班。</p>}
        {result && !result.choices.entries.length && !result.choices.limited && <p className="text-sm">本次日期窗口没有可选计划，不代表缺勤或没有工作。</p>}
        <label className="block text-sm">本次排班<select aria-label="本次排班" value={selection} disabled={!canSubmit}
          className="mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-3" onChange={event => setSelection(event.target.value)}>
          <option value="">请明确选择</option><option value="none">不关联排班</option>
          {result?.choices.entries.map(slot => <option key={slot.id} value={slot.id}>{plan(slot)}{slot.cancelled ? "（已取消，待核验）" : !slot.hasPublicationEvidence ? "（缺发布依据，待核验）" : ""}</option>)}
        </select></label>
        {chosen && <p className="break-words text-sm">本次选择：{plan(chosen)}。时间不相交仍只代表明确选择，未作多段分配。</p>}
        <button type="button" className="min-h-14 w-full rounded-2xl bg-slate-950 px-5 py-4 font-bold text-white disabled:opacity-40"
          disabled={!canSubmit || selection !== "none" && !chosen} onClick={() => {
            if (!visible || document.hidden || !canSubmit) return;
            if (selection === "none") void client.submit(null); else if (chosen) void client.submit({ slotId: chosen.id, revision: chosen.revision });
          }}>上班打卡 · {selection === "none" ? "不关联排班" : chosen ? "已选排班" : "请先明确选择"}</button>
      </div>}
    {result?.selectionEnabled === false && !state.pending && <p className="text-sm">本企业未开放选班上班；没有自动提交选择，普通打卡保持原入口。</p>}
    {result && <SelfScheduleAssociation result={result}/>}
  </section>;
}
