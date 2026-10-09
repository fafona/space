"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { AttendanceSelfScheduleAdoptionClient, SelfScheduleAdoptionClientState } from "@/lib/merchantAttendanceSelfScheduleAdoptionClient";
import type { AttendanceSelfScheduleClient, SelfScheduleClientState } from "@/lib/merchantAttendanceSelfScheduleClient";
import type { AttendanceClientState } from "@/lib/merchantAttendanceSelfClient";
import type { SelfScheduleAdoptionHttpResult } from "@/lib/merchantAttendanceSelfScheduleAdoption";
import type { SelfScheduleSlot } from "@/lib/merchantAttendanceSelfSchedule";
import OldClock, { SelfScheduleClockContent } from "./MerchantAttendanceSelfScheduleClock";

const button = "min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm disabled:opacity-40";
const reasons: Record<string, string> = { publication_missing: "缺少原排班发布依据", cancelled: "原选择已取消", location_changed: "地点已变化", outside_window: "原选择不在核对窗口", approval_missing: "开班时没有可采用的排班核准" };
function plan(slot: SelfScheduleSlot) {
  const f = new Intl.DateTimeFormat("zh-CN", { timeZone: slot.timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${slot.locationName} · ${f.format(new Date(slot.startAt))}—${f.format(new Date(slot.endAt))}（${slot.timeZone}）`;
}
export type SelfAdoptionOwner = "old" | "new";
/** Presence only chooses the ORIGINAL protocol; it never authorizes a write. */
export function selfAdoptionOwner(enabled: boolean, oldPending: boolean, newPending: boolean, newStorageError = false): SelfAdoptionOwner {
  return oldPending ? "old" : newPending || enabled || newStorageError ? "new" : "old";
}
export function SelfScheduleAdoptionStorageErrors({ state, old }: { state: SelfScheduleAdoptionClientState; old: SelfScheduleClientState }) {
  return <>{state.phase === "storage_error" && <p role="alert" className="break-words text-sm text-amber-950">新核准选班恢复存储：{state.message}</p>}
    {old.phase === "storage_error" && <p role="alert" className="break-words text-sm text-amber-950">原选班恢复存储：{old.message}</p>}</>;
}
export function selfAdoptionConfirmation(state: SelfScheduleAdoptionClientState | SelfScheduleClientState, busy: boolean, visible: boolean, previous: string | null) {
  const id = state.result?.clock.receipt?.operationId;
  return visible && !busy && !state.pending && id && id !== previous ? id : null;
}
export function SelfScheduleAdoptionReceipt({ result }: { result: SelfScheduleAdoptionHttpResult }) {
  const { clock, association: a, adoption: d } = result; if (!clock.receipt) return null;
  return <div data-self-schedule-adoption-receipt className="min-w-0 space-y-3 text-sm">
    <p className="font-semibold">本人上班原号收据已核验 · UTC {clock.receipt.occurredAt}</p>
    <div data-self-schedule-adoption-association={a?.status ?? "legacy"} className="space-y-2 rounded-xl bg-teal-50 p-3">
      <p>{a?.status === "linked" ? "上班时明确选择已保存" : a?.status === "unselected" ? "本次明确不关联排班" : a ? "打卡已保存，选择待核验" : "原编号没有选班关系，未补写历史。"}</p>
      {a?.reason && <p>{reasons[a.reason]}</p>}{a?.slot && <p className="break-words">当时计划：{plan(a.slot)}</p>}{a?.currentCancelled && <p>计划当前已取消，不改写原选择与打卡。</p>}
    </div>
    <div data-self-schedule-adoption-status={d?.status ?? "legacy"} className="space-y-2 rounded-xl border p-3">
      <p className="font-semibold">{d?.status === "adopted" ? "已固定开班时核准引用" : d?.status === "not_approved" ? "开班时没有已核准引用" : d?.status === "unselected" ? "未选排班，不引用排班核准" : d ? "选择待核验，未采用核准引用" : "原编号未保存核准引用；没有用当前核准补写历史。"}</p>
      {d?.reason && <p>{reasons[d.reason]}</p>}<p>员工选择和负责人核准引用分别核对；不是现场证明，不代表迟到、早退、整班完成、缺勤或工资结论。</p>
      {d?.approval && <details className="break-all"><summary>核对固定核准引用</summary><p>核准版本：{d.approval.revision}</p><p>核准操作：{d.approval.operationId}</p><p>来源：{d.approval.sourceId}</p><p>SHA-256：{d.approval.sourceSha256}</p><p>核准保存 UTC：{d.approval.recordedAt}</p></details>}
    </div>
    <details className="break-all"><summary>核对原始编号与选择</summary><p>上班事件：{clock.receipt.id}</p><p>操作编号：{clock.receipt.operationId}</p>
      <p>原选择：{a?.selection ? `${a.selection.slotId} · 发布版本 ${a.selection.revision}` : a ? "不关联排班" : "无原关联"}</p>{a?.slot && <p>原计划 UTC：{a.slot.startAt}—{a.slot.endAt} · {a.slot.timeZone}</p>}{a && <p>保存 UTC：{a.recordedAt}</p>}</details>
  </div>;
}
type Props = { client: AttendanceSelfScheduleAdoptionClient; oldClient: AttendanceSelfScheduleClient; enabled: boolean; oldEnabled: boolean;
  canClock: boolean; legacyState: AttendanceClientState; active?: boolean; onConfirmed: () => void };
/** At most ONE schedule candidate source. The old component is unchanged in
 * the default-off path. The new path reuses only its effect-free old protocol
 * view, so mounting it cannot silently issue a second candidate GET. */
export default function MerchantAttendanceSelfScheduleAdoptionClock({ client, oldClient, enabled, oldEnabled, canClock, legacyState, active = true, onConfirmed }: Props) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const old = useSyncExternalStore(oldClient.subscribe, oldClient.getSnapshot, oldClient.getSnapshot);
  const [visible, setVisible] = useState(false), [coordinating, setCoordinating] = useState(false), [owner, setOwner] = useState<SelfAdoptionOwner>("new");
  const engaged = useRef(false), generation = useRef(0), confirmed = useRef<string | null>(null);
  const [choice, setChoice] = useState<{ result: unknown; value: string }>({ result: null, value: "" });
  const busy = legacyState.phase === "loading" || legacyState.phase === "submitting";
  const setSelection = useCallback((value: string) => setChoice({ result: owner === "new" ? client.getSnapshot().result : oldClient.getSnapshot().result, value }), [client, oldClient, owner]);
  useLayoutEffect(() => {
    let alive = true; engaged.current = false; confirmed.current = null;
    const hide = () => { generation.current++; client.pause(); oldClient.pause(); setVisible(false); setChoice({ result: null, value: "" }); };
    const show = async () => {
      const lease = ++generation.current; setChoice({ result: null, value: "" });
      if (!active || document.hidden) { hide(); return; }
      await client.initialize(); if (!alive || lease !== generation.current || document.hidden) return;
      const useNew = enabled || !!client.getSnapshot().pending || client.getSnapshot().phase === "storage_error" || engaged.current;
      if (useNew) {
        engaged.current = true; await oldClient.initialize(); if (!alive || lease !== generation.current || document.hidden) return;
        setOwner(selfAdoptionOwner(enabled, !!oldClient.getSnapshot().pending, !!client.getSnapshot().pending, client.getSnapshot().phase === "storage_error"));
      }
      setCoordinating(useNew); setVisible(true);
    };
    const onHidden = () => flushSync(hide), visibility = () => { if (document.hidden) onHidden(); else void show(); };
    const unload = (e: BeforeUnloadEvent) => { if (client.getSnapshot().pending || oldClient.getSnapshot().pending) { e.preventDefault(); e.returnValue = ""; } };
    void show(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", onHidden); window.addEventListener("pageshow", visibility); window.addEventListener("beforeunload", unload);
    const stop = () => { alive = false; generation.current++; client.pause(); oldClient.pause(); };
    return () => { stop(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", onHidden); window.removeEventListener("pageshow", visibility); window.removeEventListener("beforeunload", unload); };
  }, [client, oldClient, enabled, active]);
  const read = (requested?: SelfAdoptionOwner, operationId?: string) => {
    if (!visible || !active || document.hidden || busy || ["loading", "submitting"].includes(state.phase) || ["loading", "submitting"].includes(old.phase)) return;
    const target = requested ?? selfAdoptionOwner(enabled, !!oldClient.getSnapshot().pending, !!client.getSnapshot().pending, client.getSnapshot().phase === "storage_error");
    setChoice({ result: null, value: "" }); setOwner(target);
    if (target === "new") { oldClient.pause(); void client.refresh(operationId); } else { client.pause(); void oldClient.refresh(operationId); }
  };
  useEffect(() => {
    if (!coordinating) return; const id = selfAdoptionConfirmation(owner === "new" ? state : old, busy, visible && active, confirmed.current);
    if (id) { confirmed.current = id; onConfirmed(); }
  }, [state, old, owner, busy, visible, active, coordinating, onConfirmed]);
  if (!active || !visible) return null;
  if (!coordinating) return <OldClock client={oldClient} enabled={oldEnabled} canClock={canClock} legacyState={legacyState} active={active} onConfirmed={onConfirmed}/>;
  const both = !!state.pending && !!old.pending, selection = choice.result === (owner === "new" ? state.result : old.result) ? choice.value : "";
  const otherBlocked = state.phase === "storage_error" || old.phase === "storage_error";
  return <div data-self-schedule-adoption-coordinator className="min-w-0 space-y-3">
    <SelfScheduleAdoptionStorageErrors state={state} old={old}/>
    {(state.pending || old.pending) && <div className="space-y-2 text-sm">
      {both && <p>两个选班协议各有待确认编号。仅逐号读取，两个编号均核清前不提交；不会迁移编号或自动读取另一号。</p>}
      <div className="flex flex-wrap gap-2">{old.pending && <button type="button" className={button} disabled={busy || state.phase === "loading" || old.phase === "loading" || state.phase === "submitting" || old.phase === "submitting"} onClick={() => read("old")}>核对旧选班原号</button>}
        {state.pending && <button type="button" className={button} disabled={busy || state.phase === "loading" || old.phase === "loading" || state.phase === "submitting" || old.phase === "submitting"} onClick={() => read("new")}>核对新核准原号</button>}</div>
    </div>}
    {owner === "old" ? <><p className="text-sm">此编号继续使用原选班协议，未补采核准引用。核清后再次明确刷新才切换新流程。</p>
      <SelfScheduleClockContent client={{ refresh: op => { read(undefined, op); return Promise.resolve(); }, initialize: oldClient.initialize, retry: oldClient.retry, submit: oldClient.submit }}
        enabled={oldEnabled && !state.pending && !otherBlocked && (!!old.pending || !enabled)} canClock={canClock && !state.pending && !otherBlocked}
        legacyState={legacyState} state={old} visible={visible} selection={selection} setSelection={setSelection}/></>
      : <SelfScheduleAdoptionContent client={client} state={state} enabled={enabled} canClock={canClock} legacyState={legacyState} oldState={old}
        selected={selection} setSelection={setSelection} refresh={op => read(undefined, op)}/>}
  </div>;
}
export function SelfScheduleAdoptionContent({ client, state, oldState, enabled, canClock, legacyState, selected, setSelection, refresh }: {
  client: Pick<AttendanceSelfScheduleAdoptionClient, "submit" | "retry" | "initialize">; state: SelfScheduleAdoptionClientState; oldState: SelfScheduleClientState;
  enabled: boolean; canClock: boolean; legacyState: AttendanceClientState; selected: string; setSelection: (value: string) => void; refresh: (operationId?: string) => void;
}) {
  const busy = [state.phase, oldState.phase, legacyState.phase].some(p => p === "loading" || p === "submitting");
  const result = state.result, otherPending = !!oldState.pending || !!legacyState.pending, storageBad = state.phase === "storage_error" || oldState.phase === "storage_error";
  const chosen = result?.choices.entries.find(s => s.id === selected);
  const canChoose = !busy && !otherPending && !storageBad && enabled && canClock && legacyState.phase === "ready" && state.phase === "ready" && !state.pending
    && !!result?.moduleEnabled && result.selectionEnabled && result.clock.state.status === "off" && !!result.clock.locationId;
  const recent = legacyState.result?.state.lastEvent?.action === "clock_in" ? legacyState.result.state.lastEvent : null;
  return <section aria-label="本人选班与核准引用" data-self-schedule-adoption-clock className="min-w-0 space-y-3 rounded-2xl border border-teal-200 bg-teal-50/30 p-4">
    <h3 className="font-bold">本人选班与核准引用</h3><p className="text-sm leading-6">请明确选班或不关联；真实上班同时保存原选择及当时核准引用。没有核准不等于不能打卡，不用当前规则补造过去依据。</p>
    <p role="status" className="text-sm">{state.message}</p>
    {otherPending && <p className="text-sm">原普通／旧选班还有待确认编号，先各自读取核对，暂不新增或重试。</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => { if (!document.hidden) { setSelection(""); if (storageBad) void client.initialize(); else refresh(); } }}>核对选班与核准结果</button>
      {recent && !state.pending && <button type="button" className={button} disabled={busy || otherPending || storageBad} onClick={() => { if (!document.hidden) refresh(recent.operationId); }}>读取最近上班核准引用</button>}</div>
    {state.pending ? <div className="space-y-2 text-sm"><p className="break-all">原操作编号：{state.pending.command.operationId}</p><p className="break-all">固定原选择：{state.pending.selection ? `${state.pending.selection.slotId} · 发布版本 ${state.pending.selection.revision}` : "不关联排班"}</p>
      <button type="button" className={button} disabled={busy || otherPending || storageBad || !enabled || !canClock || !result?.selectionEnabled || !result.moduleEnabled} onClick={() => { if (!document.hidden) void client.retry(); }}>用原编号重试核准选班上班</button>
      <p>未查到不等于未提交；重试先读取原号，保留原命令与选择，不迁移到旧协议。</p></div>
      : <div className="space-y-3">
        {result?.choices.limited && <p className="text-sm">候选超过有界上限，不代表没有排班；仍可明确不关联。</p>}
        {result && !result.choices.limited && !result.choices.entries.length && <p className="text-sm">当前窗口没有候选，不代表缺勤。</p>}
        <label className="block text-sm">本次核准选班<select aria-label="本次核准选班" value={selected} disabled={!canChoose} className="mt-1 w-full min-w-0 rounded-xl border bg-white p-3" onChange={e => setSelection(e.target.value)}>
          <option value="">请明确选择</option><option value="none">不关联排班</option>{result?.choices.entries.map(s => <option key={s.id} value={s.id}>{plan(s)}{s.cancelled ? "（已取消）" : !s.hasPublicationEvidence ? "（缺发布依据）" : ""}</option>)}</select></label>
        <button type="button" className="min-h-14 w-full rounded-xl bg-teal-950 px-4 py-3 font-semibold text-white disabled:opacity-40" disabled={!canChoose || selected !== "none" && !chosen} onClick={() => {
          if (document.hidden || !canChoose) return; if (selected === "none") void client.submit(null); else if (chosen) void client.submit({ slotId: chosen.id, revision: chosen.revision });
        }}>上班并保存核准引用 · {selected === "none" ? "不关联排班" : chosen ? "已选排班" : "请先明确选择"}</button>
      </div>}
    {(!enabled || result?.selectionEnabled === false) && <p className="text-sm">新核准选班写入未开放；只核对原号，不自动改走旧上班。已在岗的原休息、下班入口保留。</p>}
    {result && <SelfScheduleAdoptionReceipt result={result}/>}
  </section>;
}
