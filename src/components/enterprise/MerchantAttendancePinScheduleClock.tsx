"use client";
import { useState, useSyncExternalStore } from "react";
import type { AttendancePinScheduleClient, PinScheduleState } from "@/lib/merchantAttendancePinScheduleClient";
import type { PinScheduleHttpResult } from "@/lib/merchantAttendancePinSchedule";
import type { SelfScheduleSlot } from "@/lib/merchantAttendanceSelfSchedule";
import { pinClockMessage } from "@/lib/merchantAttendancePinClock";

const button = "min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm disabled:opacity-40";
const reasons: Record<string, string> = { publication_missing: "缺少原排班发布依据", cancelled: "原选择已取消", location_changed: "地点已变化", outside_window: "原选择不在核对窗口", approval_missing: "开班时没有可采用的排班核准" };
function plan(s: SelfScheduleSlot) {
  const f = new Intl.DateTimeFormat("zh-CN", { timeZone: s.timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${s.locationName} · ${f.format(new Date(s.startAt))}—${f.format(new Date(s.endAt))}（${s.timeZone}）`;
}
export function PinScheduleReceipt({ result }: { result: PinScheduleHttpResult }) {
  const { clock, association: a, adoption: d } = result; if (!clock.receipt) return null;
  return <div data-pin-schedule-receipt className="min-w-0 space-y-3 text-sm">
    <p className="font-semibold">PIN 上班原号收据已核验 · UTC {clock.receipt.occurredAt}</p>
    <div data-pin-schedule-association={a?.status ?? "legacy"} className="space-y-2 rounded-xl bg-teal-50 p-3">
      <p>{a?.status === "linked" ? "上班时明确选择已保存" : a?.status === "unselected" ? "本次明确不关联排班" : a ? "打卡已保存，选择待核验" : "原编号没有选班关系，未补写历史。"}</p>
      {a?.reason && <p>{reasons[a.reason]}</p>}{a?.slot && <p className="break-words">当时计划：{plan(a.slot)}</p>}{a?.currentCancelled && <p>计划当前已取消，不改写原选择与打卡。</p>}
    </div>
    <div data-pin-schedule-adoption={d?.status ?? "legacy"} className="space-y-2 rounded-xl border p-3">
      <p className="font-semibold">{d?.status === "adopted" ? "已固定开班时核准引用" : d?.status === "not_approved" ? "开班时没有已核准引用" : d?.status === "unselected" ? "未选排班，不引用排班核准" : d ? "选择待核验，未采用核准引用" : "原编号没有核准引用"}</p>
      {d?.reason && <p>{reasons[d.reason]}</p>}<p>PIN 验证、选班和核准引用分别核对；配对不证明真实到场，不代表迟到、早退、整班完成、缺勤或工资结论。</p>
      {d?.approval && <details className="break-all"><summary>核对固定核准引用</summary><p>核准版本：{d.approval.revision}</p><p>核准操作：{d.approval.operationId}</p><p>来源：{d.approval.sourceId}</p><p>SHA-256：{d.approval.sourceSha256}</p><p>核准保存 UTC：{d.approval.recordedAt}</p></details>}
    </div>
    <details className="break-all"><summary>核对原始编号与选择</summary><p>上班事件：{clock.receipt.id}</p><p>操作编号：{clock.receipt.operationId}</p>
      <p>原选择：{a?.selection ? `${a.selection.slotId} · 发布版本 ${a.selection.revision}` : a ? "不关联排班" : "无原关联"}</p>{a?.slot && <p>原计划 UTC：{a.slot.startAt}—{a.slot.endAt} · {a.slot.timeZone}</p>}{a && <p>保存 UTC：{a.recordedAt}</p>}</details>
  </div>;
}
export default function MerchantAttendancePinScheduleClock({ client, enabled, onClear }: { client: AttendancePinScheduleClient; enabled: boolean; onClear: () => void }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [choice, setChoice] = useState<{ result: PinScheduleHttpResult | null; value: string }>({ result: null, value: "" });
  return <PinScheduleClockContent client={client} state={state} enabled={enabled} selected={choice.result === state.result ? choice.value : ""}
    setSelection={value => setChoice({ result: client.getSnapshot().result, value })} onClear={onClear}/>;
}
export function PinScheduleClockContent({ client, state, enabled, selected, setSelection, onClear }: {
  client: Pick<AttendancePinScheduleClient, "submit" | "punch" | "retry">; state: PinScheduleState; enabled: boolean; selected: string; setSelection: (value: string) => void; onClear: () => void;
}) {
  const busy = state.phase === "loading" || state.phase === "saving", r = state.result, c = state.clock;
  const pending = state.pending ?? state.legacyPending, both = !!state.pending && !!state.legacyPending;
  const chosen = r?.choices.entries.find(s => s.id === selected), canAct = !busy && state.canConfirm && !both;
  const canChoose = canAct && enabled && state.phase === "ready" && !pending && !!r?.selectionEnabled && r.moduleEnabled && c?.state.status === "off" && c.canStart;
  const canSend = canChoose && (selected === "none" || !!chosen);
  return <section aria-label="本次排班与 PIN 上班" data-pin-schedule-clock className="min-w-0 space-y-4 rounded-2xl border border-teal-200 bg-teal-50/30 p-4">
    <h2 className="font-bold">本次排班与 PIN 上班</h2><p role="status" className="break-words text-sm">{state.message}</p>
    <p className="text-sm leading-6">只有本人 PIN 验证后才读取本人候选。选班不替代 PIN 验证，不延长 30 秒确认窗口；终端配对不证明真实到场。</p>
    {c && <div className="space-y-2 text-sm"><h3 className="break-words font-bold">{c.workerName} · {c.workerNo}</h3><p>当前：{{ off: "未上班", working: "工作中", break: "休息中" }[c.state.status]} · 顺序 {c.state.sequence}</p>{c.blockReason && <p>{pinClockMessage(c.blockReason)}</p>}</div>}
    {pending && !c && <p className="text-sm">待确认编号仍保留在本标签页；请本人重新输入工号和 PIN 验证后核对原选择。</p>}
    {pending && c && <div className="space-y-2 text-sm"><p className="break-all">原操作编号：{pending.command.operationId}</p>
      {state.pending && <p className="break-all">固定原选择：{state.pending.selection ? `${state.pending.selection.slotId} · 发布版本 ${state.pending.selection.revision}` : "不关联排班"}</p>}
      {both && <p>另有旧原号 {state.legacyPending!.command.operationId}。每次只认证读取一个原号，均核清前不提交。</p>}
      <button type="button" className={button} disabled={!canAct || state.phase !== "unconfirmed" || !!state.pending && (!enabled || !r?.selectionEnabled || !r.moduleEnabled)} onClick={() => { if (!document.hidden) void client.retry(); }}>PIN 核对后原编号重试</button>
      <p>重新输入本人 PIN 只读核对原号；未查到不证明未提交。原选择固定，不换号或改走旧上班。</p>
    </div>}
    {!enabled && <p className="text-sm">选班写入已关闭，仅核对新原号；不会改走旧上班提交。</p>}
    {c?.state.status === "off" && !pending && r && enabled && <div className="space-y-3">
      {r.choices.limited && <p className="text-sm">候选超过有界上限，不代表没有排班；可明确不关联。</p>}
      {!r.choices.limited && !r.choices.entries.length && <p className="text-sm">本次窗口没有候选，不代表缺勤。</p>}
      <label className="block text-sm">本次 PIN 排班<select aria-label="本次 PIN 排班" value={selected} disabled={!canChoose} className="mt-1 w-full min-w-0 rounded-xl border bg-white p-3" onChange={e => setSelection(e.target.value)}>
        <option value="">请明确选择</option><option value="none">不关联排班</option>{r.choices.entries.map(s => <option value={s.id} key={s.id}>{plan(s)}{s.cancelled ? "（已取消）" : !s.hasPublicationEvidence ? "（缺发布依据）" : ""}</option>)}</select></label>
      <button type="button" className="min-h-14 w-full rounded-xl bg-teal-950 px-4 py-3 font-semibold text-white disabled:opacity-40" disabled={!canSend} onClick={() => { if (document.hidden || !canSend) return; void client.submit(selected === "none" ? null : { slotId: chosen!.id, revision: chosen!.revision }); }}>PIN 上班 · {selected === "none" ? "不关联排班" : chosen ? "已选排班" : "请先明确选择"}</button>
    </div>}
    {c && !pending && state.phase === "ready" && <div className="flex flex-wrap gap-2">
      {c.state.status === "working" && <><button type="button" className={button} disabled={!canAct || !c.canStart} onClick={() => { if (!document.hidden) void client.punch("break_start"); }}>确认开始休息</button><button type="button" className={button} disabled={!canAct || !c.canFinish} onClick={() => { if (!document.hidden) void client.punch("clock_out"); }}>确认下班</button></>}
      {c.state.status === "break" && <button type="button" className={button} disabled={!canAct || !c.canFinish} onClick={() => { if (!document.hidden) void client.punch("break_end"); }}>确认结束休息</button>}
    </div>}
    {r && <PinScheduleReceipt result={r}/>} {!r && c?.receipt && <p className="break-all text-sm">原通路打卡收据：{c.receipt.operationId} · UTC {c.receipt.occurredAt}</p>}
    <button type="button" className={button} onClick={onClear}>清除资料／下一位</button>
    <p className="text-xs leading-6 text-slate-600">PIN 只在内存暂存一次确认，不保存 PIN、验证租约或候选名单。隐藏、离开或换人会清屏，待确认编号留在本标签页；回来需本人重新验证，不自动请求。</p>
  </section>;
}
