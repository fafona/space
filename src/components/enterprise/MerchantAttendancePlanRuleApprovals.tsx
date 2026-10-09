"use client";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { SourcesResponse } from "@/lib/merchantAttendanceSources";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendancePlanRuleApprovalsClient } from "@/lib/merchantAttendancePlanRuleApprovalsClient";
import { PLAN_RULE_APPROVALS_KEYS, type PlanRuleApprovalsResponse, type PlanRuleApprovalsSource } from "@/lib/merchantAttendancePlanRuleApprovals";

export type PlanRuleApprovalsProps = { source: SourcesResponse; ownerId: string; apiFetch: AttendanceApiFetch; enabled?: boolean };
const button = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white p-2 text-sm";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const layers = { personal: "个人核准层", group: "考勤组层", enterprise: "企业层" };
const labels = { lateGraceMinutes: "迟到宽限", earlyGraceMinutes: "早退宽限" };
const blockers: Record<string, string> = {
  module_paused: "考勤模块已暂停；不能新核准。", worker_inactive: "员工或考勤档案未启用。", publication_missing: "缺少可靠的排班发布身份依据。",
  cancelled: "排班已取消；不能新核准。", started: "已到计划开始时刻；不能新核准。", associated: "此排班已有明确关联开班；不能新核准。",
  source_incomplete: "来源未完整取得；不使用部分资料。", assignment_overlap: "归组的 UTC 区间重叠；不能任意选组。", group_inactive: "当前考勤组已停用。",
  source_switch: "计划进行期间存在已知、会改变所选迟到／早退依据的切换；同值不同来源版本也不能直接核准。", source_too_large: "完整来源超过单次安全上限。",
};
export function confirmPlanRuleApproval(confirm: () => boolean, current: () => boolean, submit: () => void): boolean {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export default function MerchantAttendancePlanRuleApprovals(props: PlanRuleApprovalsProps) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_RULE_APPROVALS_ENABLED === "1";
  return <Lifetime {...props} enabled={enabled}/>;
}
function Lifetime(props: PlanRuleApprovalsProps & { enabled: boolean }) {
  const [identity, setIdentity] = useState({ source: props.source, ownerId: props.ownerId, apiFetch: props.apiFetch, enabled: props.enabled, key: 0 });
  if (identity.source !== props.source || identity.ownerId !== props.ownerId || identity.apiFetch !== props.apiFetch || identity.enabled !== props.enabled) {
    setIdentity({ source: props.source, ownerId: props.ownerId, apiFetch: props.apiFetch, enabled: props.enabled, key: identity.key + 1 }); return null;
  }
  return <Prepared key={identity.key} {...props}/>;
}
function Prepared({ source, ownerId, apiFetch, enabled }: PlanRuleApprovalsProps & { enabled: boolean }) {
  const client = useMemo(() => { try { return new AttendancePlanRuleApprovalsClient({ source, ownerId, apiFetch, enabled, storage: () => sessionStorage }); } catch { return null; } }, [source, ownerId, apiFetch, enabled]);
  if (!client) return enabled ? <section aria-label="排班规则核准" className="min-w-0 rounded-xl border border-amber-200 p-3"><h3 className="font-bold">排班规则核准</h3><p role="alert">身份或排班锚点无法核对；请重新读取当前员工资料。</p></section> : null;
  return <Screen client={client} enabled={enabled}/>;
}
function Screen({ client, enabled }: { client: AttendancePlanRuleApprovalsClient; enabled: boolean }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [selected, setSelected] = useState(""), [reason, setReason] = useState(""), [operationId, setOperationId] = useState("");
  const [shown, setShown] = useState(() => typeof document === "undefined" || !document.hidden), generation = useRef(0);
  useLayoutEffect(() => {
    const invalidate = () => { generation.current++; client.pause(); };
    const clear = () => { invalidate(); setSelected(""); setReason(""); setOperationId(""); setShown(false); };
    const hide = () => flushSync(clear), show = () => { if (!document.hidden) { flushSync(() => setShown(true)); void client.initialize(); } };
    const visibility = () => { if (document.hidden) hide(); else show(); };
    if (document.hidden) clear(); else void client.initialize();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show);
    return () => { invalidate(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); };
  }, [client]);
  const pending = state.pending, result = shown ? state.result : null, busy = state.phase === "loading" || state.phase === "saving";
  const anchor = client.anchors.find(a => a.id === selected), editable = enabled && shown && !pending && !busy;
  const reasonValid = reason === reason.trim() && [...reason].length > 0 && [...reason].length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(reason);
  const canApprove = editable && state.phase === "ready" && reasonValid && !!result?.moduleEnabled && !!result.preview?.eligible && !!result.preview.source
    && !!result.preview.fingerprint && result.slot.id === selected && result.worker.active && result.worker.employeeActive;
  const edit = () => { generation.current++; client.invalidate(); };
  const approve = () => {
    const token = generation.current, snapshot = client.getSnapshot();
    confirmPlanRuleApproval(() => window.confirm(`核准此排班在计划开始时刻适用的迟到／早退规则？\n排班：${selected}\n理由：${reason}\n服务器会重新核对完整来源与变化；预览不是已核准。只保存此计划的规则依据，不改变原打卡、工时或工资。`),
      () => canApprove && shown && !document.hidden && generation.current === token && client.getSnapshot() === snapshot,
      () => { void client.approve(reason); });
  };
  // Even when disabled the inert child discovers only local pending commands;
  // it does not make a network request or expose a new approval control.
  if (!enabled && !pending && state.phase !== "blocked") return null;
  return <section aria-label="排班规则核准" data-plan-rule-approvals className="min-w-0 space-y-3 rounded-xl border border-violet-200 bg-violet-50/30 p-3">
    <h3 className="font-bold">排班规则核准</h3>
    <p className="text-sm leading-6">由负责人明确固定本排班在计划开始时刻适用的迟到／早退规则，仅这两项。不是批准“出勤正常”，不改原打卡、工时、工资，也不改写既有开班规则依据。</p>
    {!enabled && <p className="text-sm">新核准入口已关闭；本标签页待核验原号仍可明确查询。服务端未开放时可能暂不可读取，原号不会因此丢弃。</p>}
    {shown && pending ? <div data-plan-rule-pending className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p>有待核验操作，不能开始新核准。任何未知结果只查询原号，不自动或手动重发该 POST。</p>
      <p className="break-all">原核准编号：{pending.command.operationId}</p><p className="break-all">原排班：{pending.query.slotId}</p>
      <button type="button" className={button} disabled={busy} onClick={() => { if (!document.hidden) void client.recover(); }}>核对原核准编号</button>
    </div> : enabled && <>
      {client.limited && <p>排班列表不完整，未提供部分候选供核准。</p>}
      {!client.limited && !client.anchors.length && <p>本次资料没有可选择排班；不代表没有出勤。</p>}
      <label className="block min-w-0 text-sm">选择核准排班<select aria-label="选择核准排班" className={input} value={selected} disabled={!editable || !client.anchors.length}
        onChange={event => { edit(); setSelected(event.target.value); }}><option value="">请选择本次资料里的排班</option>
        {shown && client.anchors.map((a, i) => <option key={a.id} value={a.id}>{i + 1}. {a.workDate} · {a.locationName}{a.cancelled ? " · 已取消" : ""}</option>)}
      </select></label>
      {anchor && shown && <p className="break-all text-xs">保存的排班 UTC：{anchor.startAt} → {anchor.endAt} · {anchor.timeZone} · 发布版本 {anchor.revision}</p>}
      <label className="block text-sm">核准理由<input aria-label="核准理由" className={input} value={reason} maxLength={400} disabled={!editable}
        onChange={event => { edit(); setReason(event.target.value); }}/></label>
      <p className="text-xs">请先填写理由再预览；编辑理由会清除旧预览。理由为 1–200 个字符，不自动修剪。</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!editable || !anchor} onClick={() => { if (!document.hidden) void client.preview(selected); }}>预览排班规则</button>
        <button type="button" className={button} disabled={!editable || !anchor} onClick={() => { if (!document.hidden) void client.read(selected); }}>读取已核准规则</button>
        <button type="button" className={button} disabled={!canApprove} onClick={approve}>确认核准本排班规则</button></div>
      <details className="min-w-0 text-sm"><summary className="cursor-pointer">按本人已知原编号读取（不是全部历史检索）</summary>
        <label className="mt-2 block">核准操作编号<input aria-label="核准操作编号" className={input} value={operationId} disabled={!editable}
          onChange={event => { edit(); setOperationId(event.target.value); }}/></label>
        <button type="button" className={`${button} mt-2`} disabled={!editable || !anchor || !uuid.test(operationId)} onClick={() => { if (!document.hidden) void client.recover(operationId, selected); }}>读取指定核准</button>
      </details>
    </>}
    <p role="status" className="text-sm">{shown ? state.message : "资料已隐藏；返回后不会自动读取或核准。"}</p>
    {shown && state.phase === "blocked" && <p role="alert" className="text-sm text-rose-900">{state.message}</p>}
    {result && <AttendancePlanRuleApprovalsDetail result={result}/>}
    <p className="text-xs leading-6">仅本标签页 sessionStorage 保存未确认的小型原号命令，不保存来源或报表。隐藏、关闭、切换资料后清空输入与结果；已发送操作不撤销。无轮询、无自动提交，未结束时长与休息阈值仍使用原开班依据。</p>
  </section>;
}
function Source({ value: s }: { value: PlanRuleApprovalsSource }) {
  return <div className="min-w-0 space-y-3">
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{PLAN_RULE_APPROVALS_KEYS.map(key => { const field = s.fields[key]; return <article key={key} data-plan-rule-field={key} data-rule-state={field.state} className="min-w-0 space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <h5 className="font-semibold">{labels[key]}</h5><p>{field.state === "value" ? `${field.minutes} 分钟（明确数值）` : field.state === "disabled" ? "明确停用（不继承下一层）" : "未配置（未知，不补默认值或 0）"}</p>
      <p>采用：{field.source ? layers[field.source.layer] : "没有已配置来源"}</p>
      <details className="min-w-0 text-xs"><summary className="cursor-pointer">核对完整三层来源</summary><ol className="mt-2 space-y-2">{field.trace.map(trace => <li key={trace.layer} className="break-all rounded-lg bg-slate-50 p-2">
        <p>{layers[trace.layer]}：{trace.mode === "value" ? `${trace.minutes} 分钟` : trace.mode === "disabled" ? "明确停用" : trace.mode === "inherit" ? trace.layer === "enterprise" ? "本层未设值（没有更低层，不补默认值）" : "继承下一层（本层未设值）" : trace.mode === "missing_approval" ? "此时没有适用个人核准" : trace.mode === "no_assignment" ? "此时没有适用归组" : "此时没有适用候选发布"}</p>
        <p>账本版本：{trace.ledgerRevision ?? "无归组账本"}</p>{trace.source && <><p>原操作：{trace.source.operationId} · 发布／核准版本 {trace.source.revision}</p><p>原负责人：{trace.source.actorId}</p></>}
        {trace.groupId && <p>考勤组：{trace.groupId}</p>}
      </li>)}</ol></details>
    </article>; })}</div>
    <details className="min-w-0 break-all text-xs"><summary className="cursor-pointer">核对保存身份、日期和版本</summary>
      <div className="mt-2 space-y-2"><p>策略 {s.policy}；计划开始 UTC {s.slot.startAt}，计划结束 UTC {s.slot.endAt}。</p>
        <p>企业时区 {s.timeZone}；计划保存时区 {s.slot.timeZone}。按保存的 UTC 边界核对，不用今天的时区规则重算。</p>
        <p>员工 {s.employeeId} · 成员身份 {s.employeeAuthUserId} · 档案版本 {s.workerVersion} · 设置版本 {s.settingsVersion}</p>
        <p>排班 {s.slot.id} · 发布版本 {s.slot.revision} · 地点 {s.slot.locationId} · 地点版本 {s.slot.locationVersion}</p>
        {s.assignment ? <><p>原归组：{s.assignment.groupName} · {s.assignment.groupId} · 组版本 {s.assignment.groupRevision}</p><p>归组 {s.assignment.assignmentId} · 版本 {s.assignment.revision} · 时区 {s.assignment.timeZone} · UTC {s.assignment.fromAt} → {s.assignment.toAt ?? "未设结束"}</p></> : <p>计划开始时没有适用归组。</p>}
        {(["personal", "group", "enterprise"] as const).map(layer => { const item = layer === "personal" ? s.personal.approval : layer === "group" ? s.group?.publication : s.enterprise.publication;
          return item ? <p key={layer}>{layers[layer]} · 原操作 {item.operationId} · 版本 {item.revision} · 原负责人 {item.actorId} · 保存 UTC {item.recordedAt} · {"effectiveAt" in item ? `生效 UTC ${item.effectiveAt}` : `适用 UTC ${item.fromAt} → ${item.toAt}`}</p> : null; })}
      </div>
    </details>
  </div>;
}
export function AttendancePlanRuleApprovalsDetail({ result: r }: { result: PlanRuleApprovalsResponse }) {
  const source = r.preview?.source ?? r.approval?.source;
  return <div data-plan-rule-detail={r.preview ? "preview" : r.approval ? "approval" : "empty"} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-3">
    <h4 className="font-bold">{r.preview ? "预览（尚未核准）" : r.approval ? "已保存的排班规则核准" : "未找到核准记录"}</h4>
    <p className="break-words text-sm">{r.worker.workerName} · {r.worker.workerNo} · {r.slot.locationName}{r.slot.cancelled ? " · 当前排班已取消，保留原核准依据" : ""}</p>
    {!r.moduleEnabled && <p className="text-sm">模块已暂停；现有依据可在重新授权后只读核对，不能新核准。</p>}
    {r.preview && <><p className="text-sm">{r.preview.eligible ? "当前预览允许发起明确核准；服务器提交时仍重新核对完整来源。" : "当前不能核准，不采用部分或猜测的规则。"}</p>
      {!!r.preview.blockers.length && <ul aria-label="核准限制" className="list-disc space-y-1 pl-5 text-sm">{r.preview.blockers.map(code => <li key={code}>{blockers[code]}</li>)}</ul>}
      <p className="break-all text-xs">预览 UTC {r.preview.observedAt} · 当前核准版本 {r.revision}</p></>}
    {r.approval && <details open className="min-w-0 break-all text-xs"><summary className="cursor-pointer font-semibold">核准原号与来源摘要</summary><div className="mt-2 space-y-2">
      <p>核准操作编号：{r.approval.operationId} · 核准版本 {r.approval.revision} · 当前版本 {r.revision}</p><p>原核准负责人：{r.approval.actorId}</p><p>理由：{r.approval.command.reason}</p>
      <p>观察 UTC {r.approval.observedAt} · 保存 UTC {r.approval.recordedAt}</p><p>来源 {r.approval.sourceId} · {r.approval.sourceBytes} UTF-8 字节</p><p>SHA-256：{r.approval.sourceSha256}（服务端核验摘要，不是签名）</p>
    </div></details>}
    {source && <Source value={source}/>}
    <p className="break-all text-xs">本次读取 UTC {r.readAt}。之后规则或归组变化不改写这份已核准依据；它不是整期考勤结果或历史工资证明。</p>
  </div>;
}
