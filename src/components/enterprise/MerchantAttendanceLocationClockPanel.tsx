"use client";
import { LOCATION_DISPOSAL_NOTICE } from "@/lib/merchantAttendanceLocationDisposal";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AttendanceAction } from "@/lib/merchantAttendance";
import { attendanceActionAllowed } from "@/lib/merchantAttendanceEntitlement";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceLocationClockClient } from "@/lib/merchantAttendanceLocationClockClient";
import { AttendanceLocationScheduleClient } from "@/lib/merchantAttendanceLocationScheduleClient";
import MerchantAttendanceLocationScheduleClock, { locationScheduleWorkspaceActivity } from "./MerchantAttendanceLocationScheduleClock";
import { attendanceBrowserLocationEnvironment, type AttendanceLocationEnvironment } from "@/lib/merchantAttendanceLocationCheckClient";
import type { AttendanceLocationClockResult, AttendancePositionFailure } from "@/lib/merchantAttendanceLocationClock";
import { useAttendanceLocationWorkspaceActivity, type AttendanceWorkspaceReporter } from "./useAttendanceLocationWorkspaceActivity";
import OperationalPunchHost from "./MerchantAttendanceOperationalPunchHost";

const actions: Record<AttendanceAction, string> = { clock_in: "上班", break_start: "开始休息", break_end: "结束休息", clock_out: "下班" };
const reasons: Record<AttendancePositionFailure, string> = { denied: "定位权限未获准", timeout: "定位超时", unavailable: "设备无法确定位置", unsupported: "设备不支持定位", not_provided: "此次未提供定位" };
const outcomes: Record<string, string> = { ...reasons, inside: "报告位置在范围内", outside: "报告位置在范围外", uncertain: "误差覆盖边界", stale: "位置已过期", future: "设备定位时间超前" };
const noticeReasons: Record<AttendanceLocationClockResult["noticeGate"]["reason"], string> = {
  ready: "当前告知版本已确认。", unpublished: "负责人尚未发布地点的定位告知。", withdrawn: "当前定位告知已撤回，请联系负责人。",
  acknowledgement_required: "请先查看并主动确认收到当前版本的定位告知。", configuration_changed: "配置已变化或地点已停用，请负责人检查并重新发布有效告知。",
  fence_mismatch: "运行围栏与告知内容不一致，请负责人检查；重复确认不能解决。", shift_location_changed: "工作地点已变化，请先用原地点无定位收尾结束已有班次。",
};

// Candidate behind the default-off employee workspace; real-device acceptance remains pending.
export default function MerchantAttendanceLocationClockPanel(props: Parameters<typeof LegacyLocationClockPanel>[0] & { authUserId?: string | null }) {
  if (!props.authUserId) return <LegacyLocationClockPanel {...props}/>;
  return <OperationalPunchHost key={`${props.siteId}:${props.employeeId}:${props.workerId}:${props.authUserId}`} scope={{ siteId: props.siteId, channel: "location", authUserId: props.authUserId, terminalId: null, workerNo: null }}
    employeeId={props.employeeId} workerId={props.workerId} canClock={props.canClock} apiFetch={props.apiFetch} environment={props.environment} onWorkspaceActivity={props.onWorkspaceActivity}>
    <LegacyLocationClockPanel {...props}/>
  </OperationalPunchHost>;
}
function LegacyLocationClockPanel({ siteId, employeeId, workerId, canClock, apiFetch, environment = attendanceBrowserLocationEnvironment, onWorkspaceActivity,
  locationScheduleEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LOCATION_SCHEDULE_ENABLED === "1" }: {
  siteId: string; employeeId: string; workerId: string; canClock: boolean; apiFetch: AttendanceApiFetch; environment?: AttendanceLocationEnvironment; onWorkspaceActivity?: AttendanceWorkspaceReporter; locationScheduleEnabled?: boolean;
}) {
  const client = useMemo(() => new AttendanceLocationClockClient({ siteId, employeeId, workerId, canClock, apiFetch, environment, storage: () => window.sessionStorage }),
    [siteId, employeeId, workerId, canClock, apiFetch, environment]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const scheduleClient = useMemo(() => new AttendanceLocationScheduleClient({ siteId, employeeId, workerId, canClock, enabled: locationScheduleEnabled, apiFetch, environment,
    storage: () => window.sessionStorage, canStart: () => { const current = client.getSnapshot(); return current.phase === "ready" && !current.pending; } }),
    [siteId, employeeId, workerId, canClock, locationScheduleEnabled, apiFetch, environment, client]);
  const scheduleState = useSyncExternalStore(scheduleClient.subscribe, scheduleClient.getSnapshot, scheduleClient.getSnapshot);
  const activity = locationScheduleWorkspaceActivity(state, scheduleState);
  useAttendanceLocationWorkspaceActivity(onWorkspaceActivity, activity.phase, activity.pendingId, activity.receiptId);
  const scheduleConfirmed = useCallback(() => { void client.refresh(); }, [client]);
  const [selected, setSelected] = useState<AttendanceAction>("clock_in"), [failure, setFailure] = useState<AttendancePositionFailure>("not_provided"), [acknowledged, setAcknowledged] = useState(false), [finishConfirmation, setFinishConfirmation] = useState<string | null>(null);
  useEffect(() => {
    void client.initialize();
    const hidden = () => { if (document.visibilityState !== "visible") client.pause(); };
    const unload = (event: BeforeUnloadEvent) => { if (client.getSnapshot().pending) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", client.pause); window.addEventListener("beforeunload", unload);
    return () => { client.pause(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", client.pause); window.removeEventListener("beforeunload", unload); };
  }, [client]);
  const busy = ["loading", "locating", "submitting"].includes(state.phase), result = state.result;
  const finishKey = `${siteId}:${employeeId}:${workerId}:${result?.state.sequence}:${result?.state.status}:${result?.finish?.locationId}`;
  const finishConfirmed = finishConfirmation === finishKey;
  const available: AttendanceAction[] = !result ? [] : result.state.status === "off" ? ["clock_in"] : result.state.status === "break" ? ["break_end"] : ["clock_out", "break_start"];
  const action = state.pending?.intent.action ?? (available.includes(selected) ? selected : available[0] ?? "clock_in");
  const scheduleBlocked = !!scheduleState.pending || ["loading", "locating", "submitting", "storage_error"].includes(scheduleState.phase);
  const selectedClockIn = !state.pending && action === "clock_in" && locationScheduleEnabled && scheduleState.result?.selectionEnabled !== false;
  const ready = canClock && !busy && !scheduleBlocked && !selectedClockIn && (state.pending ? state.phase === "unconfirmed" : state.phase === "ready" && !!result?.channelEnabled && result.noticeGate.ready && attendanceActionAllowed(result.moduleEnabled, action));
  const confirmed = state.confirmed, summary = confirmed?.locationResult;
  const button = "rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 disabled:opacity-40";
  return <section aria-label="定位打卡隔离原型" className="mt-5 space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950">定位打卡 · 隔离原型</h2>
      <p className="mt-2 text-sm text-slate-600">记录实际动作，定位异常待核查；不是工资结算或现场身份证明。</p></div>
      <button type="button" disabled={busy} onClick={() => void client.initialize()} className={button}>重新读取／核对收据</button></header>
    <div role="status" aria-live="polite" className={`rounded-2xl border p-4 text-sm leading-6 ${state.pending || summary?.needsReview ? "border-amber-200 bg-amber-50 text-amber-950" : "border-blue-100 bg-blue-50 text-blue-950"}`}>
      <p>{state.message}</p>{state.pending && <p className="mt-2 break-all text-xs">原操作编号：{state.pending.intent.operationId} · {actions[state.pending.intent.action]}</p>}</div>
    {result && !result.noticeGate.ready && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{noticeReasons[result.noticeGate.reason]} 此时不会请求定位；发布告知本身不会启用定位。</p>}
    {result?.finish && !state.pending && <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
      <p>已有班次可无定位收尾，即使告知撤回、功能暂停或工作地点改变。仅登记服务器当前时间，不补写过去时间；原班次地点与时区保留，定位情况待核查。</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={finishConfirmed} disabled={busy} onChange={e => setFinishConfirmation(e.target.checked ? finishKey : null)} />
        确认现在{result.state.status === "break" ? "结束休息；之后仍需登记下班" : "下班"}，并登记为无定位、待核查。</label>
      <button type="button" className={button} disabled={busy || scheduleBlocked || !canClock || !finishConfirmed || state.phase !== "ready"}
        onClick={() => { if (scheduleClient.blocksOtherActions()) return; setFinishConfirmation(null); void client.finish(); }}>无定位{result.state.status === "break" ? "结束休息" : "下班"} · 待核查</button>
    </div>}
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm font-semibold text-slate-700">登记动作 <select aria-label="登记动作" disabled={busy || !!state.pending || !result} value={action} onChange={event => setSelected(event.target.value as AttendanceAction)} className="ml-2 rounded-xl border border-slate-200 bg-white p-3">
        {(state.pending ? [state.pending.intent.action] : available.length ? available : [action]).map(item => <option key={item} value={item}>{actions[item]}</option>)}
      </select></label>
      {!selectedClockIn && <button type="button" disabled={!ready} onClick={() => { if (scheduleClient.blocksOtherActions()) return; setAcknowledged(false); void (state.pending ? client.retry() : client.submit(action)); }} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">
        {busy ? "正在处理…" : state.pending ? "原编号重试（先核对收据）" : `定位并登记${actions[action]}`}</button>}
      {busy && <button type="button" onClick={client.pause} className={button}>停止等待</button>}
    </div>
    <MerchantAttendanceLocationScheduleClock client={scheduleClient} enabled={locationScheduleEnabled} canClock={canClock} legacyState={state} active={state.phase !== "blocked"} onConfirmed={scheduleConfirmed}/>
    {!selectedClockIn && <details className="rounded-2xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-800">无法提供位置？明确选择无定位登记</summary>
      <p className="mt-3 text-sm leading-6 text-slate-600">不会自动补录过去时间。此操作按服务器当前时间记录所选动作，并标记定位情况待核查；漏卡时间需后续补正流程处理。</p>
      <label className="mt-3 block text-sm">此次原因 <select value={failure} disabled={busy} onChange={event => setFailure(event.target.value as AttendancePositionFailure)} className="ml-2 rounded-xl border border-slate-200 bg-white p-3">
        {Object.entries(reasons).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      <label className="mt-3 flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} className="mt-1"/>我确认按所选动作登记实际工作情况，并知晓该笔定位情况需要核查。</label>
      <button type="button" disabled={!ready || !acknowledged} onClick={() => { if (scheduleClient.blocksOtherActions()) return; setAcknowledged(false); void (state.pending ? client.retry(failure) : client.submit(action, failure)); }} className={`${button} mt-3`}>
        {state.pending ? "用原编号无定位重试" : `无定位登记${actions[action]} · 待核查`}</button>
    </details>}
    {confirmed?.receipt && summary && <dl className="space-y-2 rounded-2xl border border-slate-200 p-4 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><dt>服务器确认动作</dt><dd className="font-semibold">{actions[confirmed.receipt.action]}</dd></div>
      <div className="flex flex-wrap justify-between gap-2"><dt>记录时间（UTC）</dt><dd>{confirmed.receipt.occurredAt}</dd></div>
      <div className="flex flex-wrap justify-between gap-2"><dt>定位摘要</dt><dd>{outcomes[summary.reason]}{summary.needsReview ? " · 待核查" : ""}</dd></div>
      {summary.disposal && <div data-location-disposed><dt>精度资料</dt><dd>{LOCATION_DISPOSAL_NOTICE}</dd></div>}
      <div className="flex flex-wrap justify-between gap-2"><dt>告知关联</dt><dd>{confirmed.receiptGate?.safeFinish ? "无定位收尾（不是定位通过）" : confirmed.receiptGate ? `已确认版本 ${confirmed.receiptGate.noticeRevision}` : "历史原型记录，无版本关联"}</dd></div>
      <div className="flex flex-wrap justify-between gap-2"><dt>收据编号</dt><dd className="break-all text-xs">{confirmed.receipt.id}</dd></div>
    </dl>}
    <p className="text-xs leading-6 text-slate-500">关闭／隐藏页面会停止后续定位，不会撤销已送达的打卡。网络失败需核对收据；本标签页仅保存原操作编号和动作，不保存坐标。正式企业入口尚未开放此原型。</p>
  </section>;
}
