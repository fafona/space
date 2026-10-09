"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { AttendanceOnsiteScheduleClient, type OnsiteScheduleClientState } from "@/lib/merchantAttendanceOnsiteScheduleClient";
import type { OnsiteClockClientState } from "@/lib/merchantAttendanceOnsiteClockClient";
import type { OnsiteScheduleHttpResult } from "@/lib/merchantAttendanceOnsiteSchedule";
import type { SelfScheduleSlot } from "@/lib/merchantAttendanceSelfSchedule";

const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm disabled:opacity-40";
const reasons: Record<string, string> = { publication_missing: "缺少原排班发布依据", cancelled: "原选择已取消", location_changed: "地点已变化", outside_window: "原选择在核对窗口之外", approval_missing: "开班时没有可采用的排班核准" };
function plan(slot: SelfScheduleSlot) {
  const fmt = new Intl.DateTimeFormat("zh-CN", { timeZone: slot.timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${slot.locationName} · ${fmt.format(new Date(slot.startAt))} — ${fmt.format(new Date(slot.endAt))}（${slot.timeZone}）`;
}
/** A scanned capability has exactly one owner. Changing owner discards the old
 * capability; neither controller ever transfers a retained token to the other. */
export function onsiteScheduleCodeOwner(legacy: OnsiteClockClientState, current: OnsiteScheduleClientState, enabled: boolean): "old" | "schedule" | "none" {
  if (current.phase === "storage_error" || legacy.pending && current.pending) return "none";
  if (legacy.pending) return "old";
  if (current.pending) return enabled ? "schedule" : "none";
  if (!legacy.result) return "none";
  return enabled && legacy.result.state.status === "off" && current.result?.selectionEnabled !== false ? "schedule" : "old";
}
export function onsiteScheduleConfirmationReady(state: OnsiteScheduleClientState, legacyBusy: boolean, visible: boolean, previous: string | null) {
  const id = state.result?.clock.receipt?.operationId;
  return visible && !legacyBusy && !state.pending && id && id !== previous ? id : null;
}
export function OnsiteScheduleReceipt({ result }: { result: OnsiteScheduleHttpResult }) {
  const { clock, association: a, adoption: d } = result; if (!clock.receipt) return null;
  return <div className="min-w-0 space-y-3 text-sm" data-onsite-schedule-receipt>
    <p className="font-semibold">现场上班收据已核验 · UTC {clock.receipt.occurredAt}</p>
    <div data-onsite-schedule-association={a?.status ?? "legacy"} className="space-y-2 rounded-xl bg-teal-50 p-3">
      <p>{!a ? "原编号没有已保存的选班关系，未补写历史。" : a.status === "linked" ? "上班时明确选择已保存" : a.status === "unselected" ? "本次明确不关联排班" : "打卡已保存，选择待核验"}</p>
      {a?.reason && <p>{reasons[a.reason]}</p>}{a?.slot && <p className="break-words">当时计划：{plan(a.slot)}</p>}
      {a?.currentCancelled && <p>计划当前已取消，不改写原上班选择与打卡。</p>}</div>
    <div data-onsite-schedule-adoption={d?.status ?? "legacy"} className="space-y-2 rounded-xl border p-3">
      <p className="font-semibold">{d?.status === "adopted" ? "已固定开班时核准引用" : d?.status === "not_approved" ? "开班时没有已核准引用" : d?.status === "unselected" ? "未选排班，不引用排班核准" : d?.status === "unverified" ? "选择待核验，未采用核准引用" : "原编号没有核准引用"}</p>
      {d?.reason && <p>{reasons[d.reason]}</p>}<p>扫码、明确选班与核准引用分别核对；不是现场身份的绝对证明，不代表迟到、早退、整班完成、缺勤或工资结论。</p>
      {d?.approval && <details className="break-all"><summary>核对固定核准引用</summary><p>核准版本：{d.approval.revision}</p><p>核准操作：{d.approval.operationId}</p><p>来源：{d.approval.sourceId}</p>
        <p>SHA-256：{d.approval.sourceSha256}</p><p>核准保存 UTC：{d.approval.recordedAt}</p></details>}</div>
    <details className="break-all"><summary>核对原始编号与选择</summary><p>上班事件：{clock.receipt.id}</p><p>操作编号：{clock.receipt.operationId}</p>
      <p>原选择：{a?.selection ? `${a.selection.slotId} · 发布版本 ${a.selection.revision}` : a ? "不关联排班" : "无原关联"}</p>
      {a?.slot && <p>原计划 UTC：{a.slot.startAt} — {a.slot.endAt} · {a.slot.timeZone}</p>}{a && <p>保存 UTC：{a.recordedAt}</p>}</details>
  </div>;
}
export default function MerchantAttendanceOnsiteScheduleClock({ client, legacyState, enabled, active = true, onConfirmed }: {
  client: AttendanceOnsiteScheduleClient; legacyState: OnsiteClockClientState; enabled: boolean; active?: boolean; onConfirmed: () => void;
}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [visible, setVisible] = useState(false), [choice, setChoice] = useState<{ result: OnsiteScheduleHttpResult | null; value: string }>({ result: null, value: "" });
  const generation = useRef(0), confirmed = useRef<string | null>(null);
  const setSelection = useCallback((value: string) => setChoice({ result: client.getSnapshot().result, value }), [client]);
  const selected = choice.result === state.result ? choice.value : "";
  const legacyBusy = ["loading", "saving"].includes(legacyState.phase);
  useLayoutEffect(() => {
    let alive = true;
    const hide = () => { generation.current++; client.pause(); setVisible(false); setSelection(""); };
    const show = async () => { const lease = ++generation.current; setSelection(""); if (!active || document.hidden) { hide(); return; }
      await client.initialize(); if (alive && lease === generation.current && !document.hidden) setVisible(true); };
    const onHidden = () => flushSync(hide), visibility = () => { if (document.hidden) onHidden(); else void show(); };
    const unload = (e: BeforeUnloadEvent) => { if (client.getSnapshot().pending) { e.preventDefault(); e.returnValue = ""; } };
    void show(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", onHidden); window.addEventListener("pageshow", visibility); window.addEventListener("beforeunload", unload);
    const stop = () => { alive = false; generation.current++; client.pause(); };
    return () => { stop(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", onHidden); window.removeEventListener("pageshow", visibility); window.removeEventListener("beforeunload", unload); };
  }, [client, active, setSelection]);
  useEffect(() => { const id = onsiteScheduleConfirmationReady(state, legacyBusy, visible, confirmed.current); if (id) { confirmed.current = id; onConfirmed(); } }, [state, legacyBusy, visible, onConfirmed]);
  return <OnsiteScheduleClockContent client={client} legacyState={legacyState} state={state} enabled={enabled} visible={active && visible} selected={selected} setSelection={setSelection}/>;
}
export function OnsiteScheduleClockContent({ client, legacyState, state, enabled, visible, selected, setSelection }: {
  client: Pick<AttendanceOnsiteScheduleClient, "read" | "initialize" | "submit" | "retry" | "pause">; legacyState: OnsiteClockClientState; state: OnsiteScheduleClientState;
  enabled: boolean; visible: boolean; selected: string; setSelection: (value: string) => void;
}) {
  if (!visible || !enabled && !state.pending && !state.result && state.phase !== "storage_error") return null;
  const busy = ["loading", "saving"].includes(state.phase), legacyBusy = ["loading", "saving"].includes(legacyState.phase);
  const r = state.result, chosen = r?.choices.entries.find(s => s.id === selected);
  const canChoose = !busy && !legacyBusy && !legacyState.pending && ["ready", "confirmed"].includes(legacyState.phase) && enabled
    && !!r?.selectionEnabled && r.moduleEnabled && r.clock.state.status === "off";
  const canSend = canChoose && !!state.code && (state.pending ? state.phase === "unconfirmed" : state.phase === "ready" && (selected === "none" || !!chosen));
  return <section aria-label="本次排班与现场上班" data-onsite-schedule-clock className="min-w-0 space-y-3 rounded-xl border border-teal-200 bg-teal-50/30 p-4">
    <h3 className="font-semibold">本次排班与现场上班</h3><p className="text-sm leading-6">读取的是当前默认地点的本人候选，不验证现场码，也不证明在场。先明确选班或不关联；确认上班仍须扫描同地点的新鲜现场码。</p>
    <p role="status" className="text-sm">{state.message}</p><p className="text-sm">{state.code ? "已暂存短时现场码；服务端最终校验有效期、地点与一次使用记录。" : "未持有现场码；读取候选和原结果不需要扫码。"}</p>
    {legacyState.pending && <p className="text-sm text-amber-900">旧现场打卡有待确认编号，请先在原入口读取。两个编号并存时，只读核对，不提交。</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || legacyBusy} onClick={() => {
      if (!visible || document.hidden) return; setSelection(""); void (state.phase === "storage_error" ? client.initialize() : client.read());
    }}>读取现场选班／原编号</button>{busy && <button type="button" className={button} onClick={client.pause}>停止选班等待</button>}</div>
    {state.pending ? <div className="space-y-2 text-sm"><p className="break-all">原操作编号：{state.pending.command.operationId}</p><p className="break-all">固定原选择：{state.pending.selection ? `${state.pending.selection.slotId} · 发布版本 ${state.pending.selection.revision}` : "不关联排班"}</p>
      <button type="button" className={button} disabled={!canSend} onClick={() => { if (!document.hidden && canSend) void client.retry(); }}>新码核对后原编号重试</button>
      <p>先只读核对，未知结果不换号；明确重试需要新码，原命令与选择不变。</p>{!enabled && <p>选班写入已关闭，仅能原号读取，不会改走旧上班提交。</p>}</div>
      : enabled && r?.selectionEnabled !== false && <div className="space-y-3">
        {r?.choices.limited && <p className="text-sm">候选超过有界上限，不代表没有排班；可明确不关联。</p>}
        {r && !r.choices.limited && !r.choices.entries.length && <p className="text-sm">本次窗口没有候选，不代表缺勤或没有工作。</p>}
        <label className="block text-sm">本次现场排班<select aria-label="本次现场排班" value={selected} disabled={!canChoose} onChange={e => setSelection(e.target.value)} className="mt-1 w-full min-w-0 rounded-xl border bg-white p-3">
          <option value="">请明确选择</option><option value="none">不关联排班</option>{r?.choices.entries.map(s => <option key={s.id} value={s.id}>{plan(s)}{s.cancelled ? "（已取消）" : !s.hasPublicationEvidence ? "（缺发布依据）" : ""}</option>)}</select></label>
        <button type="button" disabled={!canSend} className="min-h-14 w-full rounded-xl bg-teal-950 px-4 py-3 font-semibold text-white disabled:opacity-40" onClick={() => {
          if (document.hidden || !canSend) return; if (selected === "none") void client.submit(null); else if (chosen) void client.submit({ slotId: chosen.id, revision: chosen.revision });
        }}>现场上班 · {selected === "none" ? "不关联排班" : chosen ? "已选排班" : "请先明确选择"}</button></div>}
    {r?.selectionEnabled === false && !state.pending && <p className="text-sm">当前未开放现场选班，新选择不会提交；原入口保留。</p>}
    {r && <OnsiteScheduleReceipt result={r}/>}
    <p className="text-xs leading-6 text-slate-600">仅本标签页保存原命令和选择，不保存现场码、签名或 nonce。隐藏／关闭会清除短时码与可见资料，不撤销已发送的打卡。</p>
  </section>;
}
