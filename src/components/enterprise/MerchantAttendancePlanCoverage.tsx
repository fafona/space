"use client";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { SourcesResponse } from "@/lib/merchantAttendanceSources";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendancePlanCoverageClient } from "@/lib/merchantAttendancePlanCoverageClient";
import { AttendancePlanCoverageAdoptionsClient } from "@/lib/merchantAttendancePlanAdoptionViewClient";
import type { PlanCoverageClientState } from "@/lib/merchantAttendancePlanCoverageClient";
import type { PlanCoverageAdoptionsClientState } from "@/lib/merchantAttendancePlanAdoptionViewClient";
import PlanAdoptionReceipt from "./MerchantAttendancePlanAdoptionReceipt";
import type { PlanCoverageResponse, PlanCoverageView, PlanCoverageInterval } from "@/lib/merchantAttendancePlanCoverage";
import { formatShiftCheckDuration } from "@/lib/merchantAttendanceShiftCheck";

export type PlanCoverageProps = { source: SourcesResponse; ownerId: string; apiFetch: AttendanceApiFetch; enabled?: boolean; adoptionEnabled?: boolean;
  onOpenException?: (target: { workerId: string; slotId: string }) => void };
const button = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const reasons: Readonly<Record<string, string>> = {
  no_explicit_relations: "未保存明确关联：不代表没有出勤。", publication_missing: "缺少可靠的排班发布身份依据。",
  cancelled: "排班当前已取消；保留原关联，但不生成最终空档结论。", plan_not_ended: "读取开始时排班尚未结束。",
  unverified_relations: "集合中有待核验关联，未把它们并入可信覆盖。", open_sessions: "集合中有未结束班次，不能假设下班时间。",
};
const relationReasons: Readonly<Record<string, string>> = { publication_missing: "缺少发布依据", cancelled: "当时排班已取消", location_changed: "原打卡地点与排班不一致", outside_window: "当时选择超出核验窗口" };
function time(value: string, zone: string) {
  try { return new Intl.DateTimeFormat("zh-CN", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
  catch { return value; }
}
export default function MerchantAttendancePlanCoverage(props: PlanCoverageProps) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED === "1";
  const adoptionEnabled = props.adoptionEnabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_ENABLED === "1";
  return enabled ? <Lifetime {...props} adoptionEnabled={adoptionEnabled}/> : null;
}
function Lifetime(props: PlanCoverageProps) {
  const [identity, setIdentity] = useState({ source: props.source, ownerId: props.ownerId, apiFetch: props.apiFetch, adoptionEnabled: props.adoptionEnabled, key: 0 });
  if (identity.source !== props.source || identity.ownerId !== props.ownerId || identity.apiFetch !== props.apiFetch || identity.adoptionEnabled !== props.adoptionEnabled) {
    setIdentity({ source: props.source, ownerId: props.ownerId, apiFetch: props.apiFetch, adoptionEnabled: props.adoptionEnabled, key: identity.key + 1 }); return null;
  }
  return <Prepared key={identity.key} {...props}/>;
}
function Prepared({ source, ownerId, apiFetch, adoptionEnabled, onOpenException }: PlanCoverageProps) {
  const client = useMemo(() => { try { return adoptionEnabled ? new AttendancePlanCoverageAdoptionsClient({ source, ownerId, apiFetch }) : new AttendancePlanCoverageClient({ source, ownerId, apiFetch }); } catch { return null; } }, [source, ownerId, apiFetch, adoptionEnabled]);
  if (!client) return <section aria-label="计划关联核对" className="min-w-0 rounded-xl border border-amber-200 p-3">
    <h3 className="font-bold">计划关联核对</h3><p role="alert">员工资料或排班锚点无法核对，请重新读取资料；未发起其它排班请求。</p>
  </section>;
  return <Screen client={client} identityReady={source.worker.employeeId !== null} onOpenException={onOpenException}/>;
}
function Screen({ client, identityReady, onOpenException }: { client: AttendancePlanCoverageClient | AttendancePlanCoverageAdoptionsClient; identityReady: boolean; onOpenException?: PlanCoverageProps["onOpenException"] }) {
  const state = useSyncExternalStore<PlanCoverageClientState | PlanCoverageAdoptionsClientState>(client.subscribe, client.getSnapshot, client.getSnapshot);
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
  const anchor = shown ? client.anchors.find(row => row.id === selected) : undefined, result = shown ? state.result : null;
  const read = async () => {
    if (!shown || document.hidden || !identityReady || !anchor || state.phase === "loading") return;
    const lease = generation.current; await client.read(anchor.id);
    if (lease !== generation.current) return; if (document.hidden) client.pause();
  };
  return <section aria-label="计划关联核对" data-plan-coverage className="min-w-0 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/30 p-3">
    <h3 className="font-bold">计划关联核对</h3>
    <p className="text-sm leading-6">把同一排班已明确关联的多个上下班时段放在一起核对。包含休息，不是净工时、完整出勤率或迟到／早退／缺勤判定。</p>
    {!identityReady && <p role="alert">当前员工身份尚未就绪；此处不发起读取。</p>}
    {client.limited ? <p>排班列表不完整，请重新核查来源；没有使用部分列表推断完整覆盖。</p>
      : identityReady && !client.anchors.length && <p>本次资料没有可选择的排班；不代表没有出勤。</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-[1fr_auto]">
      <label className="min-w-0 text-sm">核对排班选择<select aria-label="核对排班选择" value={selected} disabled={!shown || !identityReady || !client.anchors.length}
        className="mt-1 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"
        onChange={event => { generation.current++; client.invalidate(); setSelected(event.target.value); }}>
        <option value="">请选择本次资料里的排班</option>
        {shown && identityReady && client.anchors.map((row, i) => <option key={row.id} value={row.id}>{i + 1}. {time(row.startAt, row.timeZone)} · {row.locationName}{row.cancelled ? " · 已取消" : ""}</option>)}
      </select></label>
      <button type="button" className={`${button} self-end`} disabled={!shown || !identityReady || !anchor || state.phase === "loading"} onClick={() => { void read(); }}>读取计划关联核对</button>
    </div>
    <p role="status" className="text-sm">{shown ? state.message : "核对已隐藏；返回后请重新选择并读取。"}</p>
    {shown && state.phase === "blocked" && <p role="alert" className="text-sm text-rose-900">{state.message}</p>}
    {result && <AttendancePlanCoverageDetail result={result}/>}
    {result && onOpenException && process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_ENABLED === "1" && <button type="button" className={button}
      onClick={() => { if (shown && !document.hidden && client.getSnapshot().result === result) onOpenException({ workerId: result.worker.workerId, slotId: result.slot.id }); }}>处理本排班异常</button>}
    {result && "fixedReference" in state && state.fixedReference && <section aria-label="关联班次的固定核准引用" className="min-w-0 space-y-2">
      <h4 className="font-semibold">关联班次的固定核准引用（最多 10 条）</h4>
      {state.fixedReference.length ? state.fixedReference.map(entry => <PlanAdoptionReceipt key={entry.startEventId} {...entry}/>) : <p className="text-sm">本次没有明确关联班次，不能推断没有出勤或核准。</p>}
    </section>}
    <p className="text-xs leading-6">只按需读取，不轮询、不自动重试、不导出或写浏览器存储；改变选择、资料或身份、隐藏页面后旧结果清除。</p>
  </section>;
}
function Intervals({ title, items }: { title: string; items: PlanCoverageInterval[] }) {
  return <details className="min-w-0 text-xs"><summary className="cursor-pointer font-semibold">{title}（{items.length} 段）</summary>
    <ol className="mt-2 list-inside list-decimal space-y-2">{items.map((item, i) => <li key={i} className="break-all rounded-lg bg-slate-50 p-2">
      UTC {item.startAt} → {item.endAt} · {formatShiftCheckDuration(item.durationUs)}
    </li>)}</ol>
  </details>;
}
function View({ value: v, kind }: { value: PlanCoverageView; kind: "original" | "selected" }) {
  return <section data-plan-coverage-view={kind} className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3">
    <h5 className="font-semibold">{kind === "original" ? "原始打卡跨度" : "最新批准核定跨度"}</h5>
    <p className="text-sm">{v.closedCount} 个可信已闭合时段；排班内合并覆盖 {formatShiftCheckDuration(v.coveredUs)}。</p>
    <p className="text-xs">这是已取得的闭合上下班跨度，包含休息；没有重复累加重叠部分。</p>
    <Intervals title="合并覆盖区间" items={v.coverage}/>
    {v.overlaps.length > 0 && <div className="space-y-2 rounded-lg bg-amber-50 p-2 text-xs"><p>存在重复相交：{formatShiftCheckDuration(v.overlapUs)}；保留各自来源，不自动删除或重复计时。</p>
      <Intervals title="重叠区间" items={v.overlaps}/>
      <details><summary className="cursor-pointer">核对重叠来源编号</summary>{v.overlaps.map((part, i) => <p key={i} className="break-all">{part.startAt} → {part.endAt}：{part.startEventIds.join(" · ")}</p>)}</details>
    </div>}
    {v.gaps === null ? <p data-plan-coverage-gaps="unknown" className="text-sm text-amber-900">当前不能给出整段空档清单；未知不记为 0 或缺勤。</p>
      : <div data-plan-coverage-gaps="available" className="space-y-2"><p className="text-xs">空档仅指本次明确关联集合没有覆盖的区间，不等于缺勤；没有合并其他通路、请假或漏卡申报。</p>
        <Intervals title="集合内未覆盖区间" items={v.gaps}/>{!v.gaps.length && <p className="text-xs">本集合覆盖完整计划跨度；不代表出勤正常或工时核定完成。</p>}</div>}
    {!!v.zeroIds.length && <p className="text-xs">零时长记录 {v.zeroIds.length} 条，保留原记录但不增加区间覆盖。</p>}
    {!!v.outsideIds.length && <p className="text-xs">{v.outsideIds.length} 个闭合时段在本计划之外；保留原关联，不自动换绑相邻排班。</p>}
    {!!v.openIds.length && <p className="text-xs">未结束关联 {v.openIds.length} 条，未知终点，不以读取时间替代。</p>}
    {!!v.unverifiedIds.length && <p className="text-xs">待核验关联 {v.unverifiedIds.length} 条，未并入可信覆盖。</p>}
  </section>;
}
export function AttendancePlanCoverageDetail({ result: r }: { result: PlanCoverageResponse }) {
  return <div data-plan-coverage-detail className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-3">
    <h4 className="font-bold">本次计划关联核对</h4>
    <p className="break-words text-sm">{r.worker.workerName} · {r.worker.workerNo} · {r.slot.locationName} · {r.slot.cancelled ? "当前已取消" : r.phase === "ended" ? "已过计划结束时刻" : r.phase === "future" ? "尚未开始" : "计划进行中"}</p>
    <p className="break-words text-sm">{time(r.slot.startAt, r.slot.timeZone)} → {time(r.slot.endAt, r.slot.timeZone)} · {r.slot.timeZone}</p>
    <details className="break-all text-xs"><summary className="cursor-pointer">核对排班与读取版本</summary><p>排班 {r.slot.id} · 发布版本 {r.slot.revision}</p>
      <p>UTC {r.slot.startAt} → {r.slot.endAt}</p><p>本次读取 UTC {r.readStartedAt} → {r.readCompletedAt}</p><p>算法 {r.algorithmVersion}；各子资料保留自己的截止时间，不冒充历史封账快照。</p>
    </details>
    {!r.moduleEnabled && <p className="text-sm">新考勤已暂停；当前仅作有权限的只读核对。</p>}
    <p className="text-xs leading-6">共 {r.sessions.length} 条已保存明确关联，非全渠道完整出勤集合；请假、节假日／停业提示、整段漏卡申报未纳入，不自动减免。不刷新父工时合计或修改原记录。</p>
    {!!r.gapBlockers.length && <ul aria-label="覆盖核对限制" className="list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-7 text-sm">{r.gapBlockers.map(reason => <li key={reason}>{reasons[reason]}</li>)}</ul>}
    <div className={`grid min-w-0 gap-3 ${r.hasApprovedChanges ? "lg:grid-cols-2" : ""}`}>
      <View value={r.original} kind="original"/>{r.hasApprovedChanges && <View value={r.selected} kind="selected"/>}
    </div>
    {!r.hasApprovedChanges && <p data-plan-coverage-no-correction className="text-sm">没有已批准替换，当前核定沿用原始；不重复计算同一集合。</p>}
    <section aria-label="关联班次来源" className="min-w-0 space-y-2"><h5 className="font-semibold">逐段核对来源（最多 10 条）</h5>
      {r.sessions.map(s => <details key={s.rule.event.startEventId} data-plan-coverage-session className="min-w-0 rounded-lg border border-slate-200 p-3 text-xs">
        <summary className="cursor-pointer break-words">{time(s.original.startAt, s.original.timeZone)} · {s.original.endAt === null ? "未结束" : "已结束"} · {s.relation!.status === "linked" ? "明确关联" : `待核验：${relationReasons[s.relation!.reason ?? ""] ?? "依据不足"}`}{s.effect ? " · 有批准补正" : ""}</summary>
        <div className="mt-2 space-y-2 break-all"><p>原始起点 {s.rule.event.startEventId} · 末事件 {s.events.at(-1)!.id} · {s.events.length} 个完整事件</p>
          <p>原始 UTC：{s.original.startAt} → {s.original.endAt ?? "未知终点"}；休息包含在跨度内。</p>
          {s.effect && <><p>核定 UTC：{s.effect.proposal.startAt} → {s.effect.proposal.endAt}；修订 {s.effect.revision}</p><p>批准申请 {s.effect.requestId} · 操作 {s.effect.operationId} · 批准时间 {s.effect.recordedAt}</p></>}
          <p>原关联保存 {s.relation!.recordedAt}；{s.relation!.slot!.cancelled ? "选择时排班已取消" : r.slot.cancelled ? "选择后排班被取消" : "当前未取消"}，不重写原选择。</p>
          <p>原开班规则：{s.rule.status === "verified" ? "服务端已核验" : s.rule.status === "missing" ? "缺失" : "待核验"}；本页未用它判计划迟到／早退。</p>
          <p>该子资料截止 UTC：{s.asOf}</p>
        </div>
      </details>)}
    </section>
  </div>;
}
