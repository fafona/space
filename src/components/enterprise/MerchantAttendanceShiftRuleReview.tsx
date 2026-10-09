"use client";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { SourcesResponse } from "@/lib/merchantAttendanceSources";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceShiftRuleViewClient, type ShiftRuleAnchor } from "@/lib/merchantAttendanceShiftRuleViewClient";
import { SHIFT_RULE_VIEW_KEYS, type ShiftRuleViewResponse } from "@/lib/merchantAttendanceShiftRuleView";

export type ShiftRuleReviewProps = { source: SourcesResponse; ownerId: string; apiFetch: AttendanceApiFetch; enabled?: boolean };
const button = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const names = { lateGraceMinutes: "迟到宽限", earlyGraceMinutes: "早退宽限", openSpanWarningMinutes: "未结束班次提示", completedBreakMinimumMinutes: "完整休息最低时长" };
const layers: Record<string, string> = { personal: "个人", group: "考勤组", enterprise: "企业" };
const modes: Record<string, string> = { inherit: "继承下一层", disabled: "明确停用", value: "明确数值", missing_approval: "没有适用个人核准", no_assignment: "没有适用归组", missing_publication: "没有适用发布" };
export const SHIFT_RULE_REVIEW_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  source_unavailable: "当时来源不可用", source_invalid: "当时来源校验未通过", source_conflict: "当时来源上下文冲突",
  identity_unavailable: "当时身份资料不完整", identity_changed: "当时身份已变化", inactive_worker: "当时考勤档案已停用",
  inactive_employee: "当时员工成员已停用", invalid_date: "当时日期边界无法可靠确认", assignment_overlap: "当时存在重叠归组",
  inactive_group: "当时考勤组已停用", personal_overlap: "当时个人例外区间重叠", source_cap: "当时来源数量超过核验上限",
  source_quota: "当时依据保存容量已达上限", source_too_large: "当时依据内容超过大小上限",
});

export default function MerchantAttendanceShiftRuleReview(props: ShiftRuleReviewProps) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED === "1";
  return enabled ? <Lifetime {...props}/> : null;
}
function Lifetime(props: ShiftRuleReviewProps) {
  const [identity, setIdentity] = useState({ source: props.source, ownerId: props.ownerId, apiFetch: props.apiFetch, key: 0 });
  // React retries this render before committing children. A same-scope source or
  // transport replacement cannot commit one frame of the former detail/choice.
  if (identity.source !== props.source || identity.ownerId !== props.ownerId || identity.apiFetch !== props.apiFetch) {
    setIdentity({ source: props.source, ownerId: props.ownerId, apiFetch: props.apiFetch, key: identity.key + 1 }); return null;
  }
  return <Prepared key={identity.key} {...props}/>;
}
function Prepared({ source, ownerId, apiFetch }: ShiftRuleReviewProps) {
  const client = useMemo(() => { try { return new AttendanceShiftRuleViewClient({ source, ownerId, apiFetch }); } catch { return null; } }, [source, ownerId, apiFetch]);
  if (!client) return <section aria-label="原班次固定规则依据" data-shift-rule-review className="min-w-0 rounded-xl border border-amber-200 p-3">
    <h3 className="font-bold">原班次固定规则依据</h3><p role="alert">本次员工资料与负责人或原始记录不一致；请重新读取资料。未查询其它员工或补算规则。</p>
  </section>;
  return <Screen client={client} identityReady={source.worker.employeeId !== null}/>;
}
function Screen({ client, identityReady }: { client: AttendanceShiftRuleViewClient; identityReady: boolean }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [selected, setSelected] = useState(""), [shown, setShown] = useState(() => typeof document === "undefined" || !document.hidden);
  const generation = useRef(0);
  useLayoutEffect(() => {
    const invalidate = () => { generation.current++; client.pause(); };
    const hide = () => { invalidate(); setSelected(""); setShown(false); };
    const onHide = () => flushSync(hide);
    const visibility = () => { if (document.hidden) onHide(); else flushSync(() => setShown(true)); };
    const show = () => { if (!document.hidden) flushSync(() => setShown(true)); };
    if (document.hidden) hide();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", onHide); window.addEventListener("pageshow", show);
    return () => { invalidate(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", onHide); window.removeEventListener("pageshow", show); };
  }, [client]);
  const anchor = shown ? client.anchors.find(row => row.startEventId === selected) : undefined;
  const result = shown ? state.result : null;
  const read = async () => {
    if (!shown || document.hidden || !identityReady || !anchor || state.phase === "loading") return;
    const lease = generation.current; await client.read(anchor.startEventId);
    if (lease !== generation.current) return;
    if (document.hidden) client.pause();
  };
  return <section aria-label="原班次固定规则依据" data-shift-rule-review className="min-w-0 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/30 p-3">
    <h3 className="font-bold">原班次固定规则依据</h3>
    <p className="text-sm leading-6">仅核查原始开班时保存的规则选择。已核验不代表出勤正常，也不作迟到、早退、缺勤或工资判定；不关联排班、不改变工时报表。</p>
    <p className="text-xs leading-6">整段漏卡申报不是原始开班事件，不能在此选择。没有保存依据时，不采用今天的规则补算。</p>
    {!identityReady && <p role="alert">当前员工身份尚未就绪；请先重新核对员工资料，此处不发起读取。</p>}
    {identityReady && client.anchors.length === 0 && <p>本次资料没有可选择的原始班次；这不代表缺勤或零工时。</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-[1fr_auto]">
      <label className="min-w-0 text-sm">选择原始班次<select aria-label="选择原始班次" value={selected} disabled={!shown || !identityReady || client.anchors.length === 0}
        className="mt-1 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"
        onChange={event => { generation.current++; client.invalidate(); setSelected(event.target.value); }}>
        <option value="">请选择原始班次（最多 100 条）</option>
        {shown && identityReady && client.anchors.map((row, index) => <option key={row.startEventId} value={row.startEventId}>{index + 1}. {row.original.startAt} · {row.original.timeZone}</option>)}
      </select></label>
      <button type="button" className={`${button} self-end`} disabled={!shown || !identityReady || !anchor || state.phase === "loading"} onClick={() => { void read(); }}>读取原班次依据</button>
    </div>
    {anchor && <AttendanceShiftRuleAnchor anchor={anchor}/>}
    <p role="status" className="text-sm">{shown ? state.message : "依据已隐藏；返回后请重新选择并明确读取。"}</p>
    {shown && state.phase === "blocked" && <p role="alert" className="text-sm text-rose-900">{state.message}</p>}
    {result && <AttendanceShiftRuleReviewDetail result={result}/>}
    <p className="text-xs leading-6">本区块仅 GET 读取，不写浏览器存储、不轮询、不重试。更换资料、身份、选择或隐藏页面后旧结果清除。</p>
  </section>;
}
export function AttendanceShiftRuleAnchor({ anchor }: { anchor: ShiftRuleAnchor }) {
  return <div data-shift-rule-anchor className="min-w-0 space-y-1 rounded-lg bg-white p-3 text-sm">
    <p className="break-all">原始班次 UTC：{anchor.original.startAt} → {anchor.original.endAt ?? "未结束（不计作 0）"} · 原事件保存时区 {anchor.original.timeZone}</p>
    <p className="break-all text-xs">原始开班编号：{anchor.startEventId}</p>
    {anchor.corrected && <><p className="break-all">当前核定 UTC：{anchor.selected.startAt} → {anchor.selected.endAt ?? "未结束"} · {anchor.selected.timeZone}</p>
      <p className="text-amber-950">已批准补正改变了当前核定记录；这里的依据仍绑定原始开班，不会重新绑定补正后的起点。</p>
      <p className="break-all text-xs">核定操作：{anchor.correctionOperationId}</p></>}
  </div>;
}
export function AttendanceShiftRuleReviewDetail({ result: r }: { result: ShiftRuleViewResponse }) {
  const b = r.binding, e = r.evidence;
  return <div data-shift-rule-detail data-shift-rule-status={r.status} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
    <h4 className="font-bold">{r.status === "verified" ? "保存来源已由服务端核验" : r.status === "missing" ? "未找到保存的开班依据" : "当时未能核验并固定依据"}</h4>
    {r.status === "missing" && <p>仅确认原始事件锚点；没有已保存的规则或历史登录身份依据。不回填当前规则，不把缺失当作零宽限。</p>}
    {r.status === "unverified" && <p>{SHIFT_RULE_REVIEW_REASON_LABELS[r.reason ?? ""] ?? "当时依据未核验"}。保留原状态，不回填当前规则。</p>}
    {r.status === "verified" && <p>这里只核对保存来源。SHA-256 和原始字节由服务端核验；浏览器接收摘要，没有重新核验完整来源字节。已核验不等于规则均已配置或出勤正常。</p>}
    {!r.moduleEnabled && <p>新考勤已暂停；此处仍是有权限的只读核查。</p>}
    <p className="break-all">当前核查档案：{r.worker.workerName} · {r.worker.workerNo} · {r.worker.active ? "启用" : "停用"}</p>
    <details><summary className="cursor-pointer text-xs font-semibold">核对身份、事件与保存版本</summary>
    <dl className="mt-2 grid min-w-0 gap-2 break-all text-xs sm:grid-cols-2">
      <div><dt className="font-semibold">当前档案</dt><dd>{r.worker.workerName} · {r.worker.workerNo} · 版本 {r.worker.version} · {r.worker.active ? "启用" : "停用"}</dd></div>
      <div><dt className="font-semibold">当前双重身份</dt><dd>{r.worker.employeeId} / {r.worker.employeeAuthUserId} · 成员{r.worker.employeeActive ? "启用" : "停用"}</dd></div>
      <div><dt className="font-semibold">原始开班事件 / 操作</dt><dd>{r.event.startEventId} / {r.event.operationId} · 序号 {r.event.sequence}</dd></div>
      <div><dt className="font-semibold">原始地点 / 保存时区</dt><dd>{r.event.locationId} / {r.event.timeZone}</dd></div>
      <div><dt className="font-semibold">原始开班 UTC</dt><dd>{r.event.occurredAt}</dd></div>
      <div><dt className="font-semibold">本次服务端读取 UTC</dt><dd>{r.readAt}</dd></div>
      {b && <><div><dt className="font-semibold">开班渠道 / 请求身份</dt><dd>{({ self: "员工自助", location: "地点打卡", pin: "PIN 终端", onsite: "现场二维码" })[b.channel]} / {b.requestAuthUserId ?? "PIN 无员工登录请求身份（不等于成员身份为空）"}</dd></div>
        <div><dt className="font-semibold">保存上下文版本 / 时间</dt><dd>员工 {b.workerVersion ?? "未知"} · 设置 {b.settingsVersion ?? "未知"} / {b.recordedAt}</dd></div>
        <div><dt className="font-semibold">保存算法 / 绑定策略</dt><dd>{b.algorithmVersion} / {b.bindingPolicy}</dd></div></>}
    </dl></details>
    {e && <>
      <p className="break-all text-xs">保存的企业时区：{e.timeZone}（不必等于原始地点时区）。企业账本 {e.enterpriseRevision} · 考勤组账本 {e.groupRevision ?? "无归组"} · 个人账本 {e.personalRevision}。</p>
      <p className="break-all text-xs">{e.group ? `保存归组：${e.group.name} / ${e.group.groupId} · 组版本 ${e.group.revision} · 归组 ${e.group.assignmentId} / ${e.group.assignmentRevision}` : "当时没有适用归组；不假造默认组。"}</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">{SHIFT_RULE_VIEW_KEYS.map(key => {
        const field = e.fields[key]; return <div key={key} data-shift-rule-field={key} data-rule-state={field.state} className="min-w-0 space-y-2 rounded-lg bg-slate-50 p-3">
          <h5 className="font-semibold">{names[key]}</h5>
          <p>{field.state === "value" ? `${field.minutes} 分钟（明确数值）` : field.state === "disabled" ? "明确停用（不是 0）" : "未配置（不是 0 或正常）"}</p>
          {field.source && <p className="break-all text-xs">选取 {layers[field.source.layer]}层 · 操作 {field.source.operationId} · 发布/核准版本 {field.source.revision} · 原负责人 {field.source.actorId}</p>}
          <details><summary className="cursor-pointer text-xs font-semibold">核对完整三层来源</summary><ol className="mt-2 space-y-2 break-all text-xs">{field.trace.map(trace => <li key={trace.layer}>
            {layers[trace.layer]}层：{trace.layer === "enterprise" && trace.mode === "inherit" ? "本层未设值（没有更低层，不补默认值）" : modes[trace.mode] ?? trace.mode}{trace.minutes !== null ? ` ${trace.minutes} 分钟` : ""} · 账本 {trace.ledgerRevision ?? "无归组"}
            {trace.groupId && <> · 考勤组 {trace.groupId}</>}{trace.source && <> · 操作 {trace.source.operationId} · 版本 {trace.source.revision} · 原负责人 {trace.source.actorId}</>}
          </li>)}</ol></details>
        </div>;
      })}</div>
      <details className="text-xs"><summary className="cursor-pointer">核对服务端验证的来源摘要</summary><p className="mt-2 break-all">来源 {e.sourceId} · {e.sourceBytes} UTF-8 字节 · SHA-256 {e.sourceSha256}。来源可被多个原班次复用；不是本次事件编号。</p></details>
    </>}
  </div>;
}
