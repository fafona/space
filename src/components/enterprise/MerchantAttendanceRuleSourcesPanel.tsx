"use client";
import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AttendanceRuleSourcesClient } from "@/lib/merchantAttendanceRuleSourcesClient";
import type { RuleSourcesResponse } from "@/lib/merchantAttendanceRuleSources";
import type { PersonalRulesItem } from "@/lib/merchantAttendancePersonalRules";
import type { RulesItem } from "@/lib/merchantAttendanceRules";
import type { SourcesRules } from "@/lib/merchantAttendanceSources";
import { RULE_DEFINITIONS, RULE_KEYS, type AttendanceRuleDraft } from "@/lib/merchantAttendanceRuleDraft";
import type { AttendanceRuleSourcesPanelProps } from "./MerchantAttendanceRuleSourcesLauncher";
import ThreeLayerRules from "./MerchantAttendanceThreeLayerRules";

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm";
const visibilitySnapshot = () => document.visibilityState !== "hidden";
const serverVisibility = () => false;
const subscribeVisibility = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};
const warningLabels: Record<string, string> = {
  candidate_rules_not_applied: "候选规则未应用，不改变打卡、工时、异常分类或工资。",
  historical_context_not_pinned: "当前来源未历史固定；查询过去日期也不是当时正式规则的重建。",
  identity_changed: "历史归组身份与当前员工不一致，不按姓名关联或自动回退下层。",
  assignment_utc_overlap: "归组在各自时区换算后存在 UTC 重叠，相关时间段不能任选一组。",
  inactive_worker: "当前考勤档案已停用，候选解析受阻。",
  inactive_employee: "当前员工已停用，候选解析受阻。",
  unbound_employee: "员工和登录身份未完整绑定，候选解析受阻。",
  assignments_truncated: "归组来源未完整取得，不能当作无归组。",
  rules_truncated: "企业／组候选来源未完整取得，不能当作未配置。",
  personal_truncated: "个人核准来源未完整取得，不能当作没有个人例外。",
};
const assignmentStatus = { assigned: "原归组", ended: "已登记结束日期", cancelled: "已取消（不参与解析）" };

export default function MerchantAttendanceRuleSourcesPanel(props: AttendanceRuleSourcesPanelProps & { onClose: () => void }) {
  // Reset the child BEFORE committing a changed authentication fetch binding;
  // clearing only its client would otherwise leave the previous date inputs.
  const [binding, setBinding] = useState({ apiFetch: props.apiFetch, revision: 0 });
  if (binding.apiFetch !== props.apiFetch) setBinding({ apiFetch: props.apiFetch, revision: binding.revision + 1 });
  return <Screen key={`${props.siteId}:${props.ownerId}:${props.workerId}:${binding.revision}`} {...props}/>;
}

function Screen({ siteId, ownerId, workerId, apiFetch, onClose }: AttendanceRuleSourcesPanelProps & { onClose: () => void }) {
  const client = useMemo(() => new AttendanceRuleSourcesClient({ siteId, ownerId, workerId, apiFetch }), [siteId, ownerId, workerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [fromDate, setFrom] = useState(""), [throughDate, setThrough] = useState("");
  const visible = useSyncExternalStore(subscribeVisibility, visibilitySnapshot, serverVisibility);
  useLayoutEffect(() => {
    const hide = () => { client.pause(); setFrom(""); setThrough(""); };
    const hidden = () => flushSync(hide);
    const visibility = () => { if (document.visibilityState === "hidden") hidden(); };
    if (document.visibilityState === "hidden") client.pause();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hidden);
    return () => { client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hidden); };
  }, [client]);
  const result = visible ? state.result : null;
  const close = () => { client.pause(); setFrom(""); setThrough(""); onClose(); };
  return <section aria-label="单员工三层规则只读预览" className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">三层规则只读预览（未应用）</h2>
      <p className="mt-1 text-sm text-slate-600">仅负责人 · 单员工 · 连续 1–7 个企业当地日期 · 只读</p></div><button type="button" className={button} onClick={close}>关闭三层规则预览</button></header>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6">只比较本次授权读取中的个人核准、原归组和企业／组候选来源。规则未应用、未历史固定；不是异常或工资结论。不保存、不发布、不核准或撤回任何记录，也不修改打卡和工时。</p>
    <p className="break-all text-xs text-slate-600">当前考勤档案编号：{workerId}。姓名只用于展示，不用于跨来源关联。</p>
    <form className="grid min-w-0 gap-3 sm:grid-cols-3" onSubmit={event => { event.preventDefault(); if (visible && document.visibilityState !== "hidden") void client.read(fromDate, throughDate); }}>
      <label className="min-w-0 text-sm">开始日期（企业当地）<input aria-label="规则预览开始日期" type="date" className={input} min="2000-01-01" max="2100-12-31" value={fromDate} disabled={!visible}
        onChange={event => { client.invalidate(); setFrom(event.target.value); }}/></label>
      <label className="min-w-0 text-sm">结束日期（含尾日）<input aria-label="规则预览结束日期" type="date" className={input} min="2000-01-01" max="2100-12-31" value={throughDate} disabled={!visible}
        onChange={event => { client.invalidate(); setThrough(event.target.value); }}/></label>
      <button type="submit" className={`${button} self-end`} disabled={!visible || !fromDate || !throughDate || state.phase === "loading"}>读取三层规则来源</button>
    </form>
    <p role="status" className="text-sm leading-6">{visible ? state.message : "资料已隐藏；返回后不会自动读取。"}</p>
    {state.phase === "blocked" && visible && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900">{state.message}</p>}
    {result && <AttendanceRuleSourcesEvidence key={`${result.siteId}:${result.actorId}:${result.worker.workerId}:${result.fromAt}:${result.toAt}:${result.readAt}`} result={result}/>}
    <p className="text-xs leading-6 text-slate-600">不轮询、不导出、不下载、不使用浏览器存储。改日期即清除旧结果；隐藏、关闭或切换身份后连同日期清空。再次查看需重新选择日期并明确读取。来源分页只切换本次已读资料，不再请求服务器。</p>
  </section>;
}

function PagedSources<T>({ title, limited, items, itemKey, renderItem, empty }: {
  title: string; limited: boolean; items: readonly T[]; itemKey: (item: T) => string; renderItem: (item: T) => ReactNode; empty: string;
}) {
  const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(items.length / 10)), current = Math.min(page, pages - 1);
  return <section aria-label={title} className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3">
    <h3 className="font-bold">{title}</h3>
    {limited ? <p className="rounded-lg bg-amber-50 p-3 text-sm">来源未完整取得，不能当作没有记录；不展示被截断的部分列表，也不据此回退其他规则。</p> : <>
      <p className="text-xs text-slate-600">本次范围返回 {items.length} 条展示记录；不是账本完整历史总数。每页最多 10 条。</p>
      {!items.length && <p className="text-sm">{empty}</p>}
      {items.slice(current * 10, current * 10 + 10).map(item => <div key={itemKey(item)} className="min-w-0">{renderItem(item)}</div>)}
      {pages > 1 && <nav aria-label={`${title}分页`} className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className={button} disabled={current === 0} onClick={() => setPage(current - 1)}>上一页来源</button>
        <span>第 {current + 1} / {pages} 页</span>
        <button type="button" className={button} disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页来源</button>
      </nav>}
    </>}
  </section>;
}

function RulesValues({ rules, layer }: { rules: AttendanceRuleDraft | null; layer: "personal" | "group" | "enterprise" }) {
  if (!rules) return <p className="text-sm">规则内容未知；不使用默认值。</p>;
  return <dl className="grid gap-2 text-xs sm:grid-cols-2">{RULE_KEYS.map(key => <div key={key}><dt className="font-semibold">{RULE_DEFINITIONS[key].label}</dt>
    <dd>{rules[key].mode === "value" ? `${rules[key].minutes} 分钟` : rules[key].mode === "disabled" ? "明确停用（不向下继承）" : layer === "enterprise" ? "本层未设值（没有更低层，不补默认值）" : "继承下一层（本层未设值）"}</dd></div>)}</dl>;
}

function PersonalRecord({ item, withdrawnBy }: { item: PersonalRulesItem; withdrawnBy: number | null }) {
  return <article data-personal-rule-source={item.action} className="min-w-0 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
    <h4 className="font-semibold">{item.action === "approve" ? "负责人个人核准候选" : "个人核准撤回记录"} · 版本 {item.revision}</h4>
    <p>{item.action === "withdraw" ? `撤回目标核准版本 ${item.approvedRevision}；保留原核准快照，不参与候选解析。`
      : withdrawnBy === null ? "本次读取未见撤回；是否在各字段采用仍由候选解析展示，并未应用。" : `已由版本 ${withdrawnBy} 撤回，不参与候选解析。`}</p>
    <p className="whitespace-pre-wrap break-words">原理由：{item.reason}</p>
    <dl className="grid min-w-0 gap-1 break-all text-xs leading-5 text-slate-600">
      <div><dt className="inline font-semibold">原操作：</dt><dd className="inline">{item.operationId} · 原操作人 {item.actorId}</dd></div>
      <div><dt className="inline font-semibold">原登记时间：</dt><dd className="inline">{item.recordedAt}</dd></div>
      <div><dt className="inline font-semibold">原身份：</dt><dd className="inline">员工 {item.employeeId} · 登录身份 {item.employeeAuthUserId}</dd></div>
      <div><dt className="inline font-semibold">保存上下文：</dt><dd className="inline">档案版本 {item.workerVersion} · 设置版本 {item.settingsVersion} · 时区 {item.timeZone}</dd></div>
      <div><dt className="inline font-semibold">原核准日期（含尾日）：</dt><dd className="inline">{item.startsOn} → {item.endsOn}</dd></div>
      <div><dt className="inline font-semibold">原 UTC 半开区间：</dt><dd className="inline">{item.fromAt} → {item.toAt}</dd></div>
    </dl>
    <details><summary className="cursor-pointer font-semibold">核对原规则快照</summary><div className="mt-2"><RulesValues rules={item.rules} layer="personal"/></div></details>
  </article>;
}

export function AttendanceRuleSourcesEvidence({ result: r }: { result: RuleSourcesResponse }) {
  const personalRecords = r.personal.items.flatMap<{ item: PersonalRulesItem; withdrawnBy: number | null }>(pair => [
    { item: pair.approval, withdrawnBy: pair.withdrawal?.revision ?? null },
    ...(pair.withdrawal ? [{ item: pair.withdrawal, withdrawnBy: null }] : []),
  ]);
  const publications = r.rules.items.flatMap<{ stream: SourcesRules; item: RulesItem | null }>(stream => stream.publications.length ? stream.publications.map(item => ({ stream, item })) : [{ stream, item: null }]);
  return <section aria-label="本次三层规则读取结果" data-rule-sources-result className="min-w-0 space-y-4">
    <h3 className="font-bold">本次三层规则读取结果</h3>
    <dl className="grid min-w-0 gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
      <div><dt className="font-semibold">当前档案</dt><dd className="break-words">{r.worker.workerName} · {r.worker.workerNo} · {r.worker.active ? "档案启用" : "档案停用"} · {r.worker.employeeActive ? "员工启用" : "员工停用"} · 档案版本 {r.worker.version}</dd></div>
      <div><dt className="font-semibold">查询日期与当前企业时区</dt><dd>{r.fromDate} → {r.throughDate} · {r.timeZone} · 设置版本 {r.settingsVersion}</dd></div>
      <div className="break-all"><dt className="font-semibold">当前关联身份</dt><dd>员工 {r.worker.employeeId ?? "未绑定"} · 登录身份 {r.worker.employeeAuthUserId ?? "未绑定"}</dd></div>
      <div className="break-all"><dt className="font-semibold">读取授权上下文</dt><dd>站点 {r.siteId} · 当前负责人 {r.actorId} · 档案 {r.worker.workerId}</dd></div>
      <div className="break-all"><dt className="font-semibold">UTC 半开区间</dt><dd>{r.fromAt} → {r.toAt}（不含终点）</dd></div>
      <div className="break-all"><dt className="font-semibold">本次服务器读取时间</dt><dd>{r.readAt} · 个人账本版本 {r.personal.revision}</dd></div>
    </dl>
    {!r.moduleEnabled && <p className="rounded-xl bg-amber-50 p-3 text-sm">新考勤模块已暂停；这里仍仅查看当前有权读取的候选来源，不恢复或应用任何规则。</p>}
    <section aria-label="三层规则资料边界" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <h3 className="font-bold">资料边界</h3><p className="mt-2">同一次授权读取只涵盖三层规则来源，不包含打卡、排班、请假或日历事实；不是全部业务数据的历史快照。</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">{r.warnings.map(code => <li key={code}>{warningLabels[code] ?? `来源仍需核对：${code}`}</li>)}</ul>
    </section>
    <ThreeLayerRules source={r}/>
    <PagedSources title="个人核准与撤回来源" limited={r.personal.limited} items={personalRecords} itemKey={entry => entry.item.operationId}
      empty="本次完整读取的范围内没有个人核准来源；不是个人来源未读取，也不代表其他日期没有核准。"
      renderItem={entry => <PersonalRecord {...entry}/>}/>
    <PagedSources title="原归组与当前组来源" limited={r.assignments.limited} items={r.assignments.items} itemKey={entry => entry.detail.assignmentId}
      empty="本次完整读取的范围内没有归组来源。" renderItem={({ detail, currentGroup, fromAt, toAt }) => <article data-rule-assignment-source className="min-w-0 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
        <h4 className="break-words font-semibold">原组 {detail.groupName} · {assignmentStatus[detail.status]} · 归组版本 {detail.revision}</h4>
        <p className="break-words">当前组 {currentGroup.name} · {currentGroup.active ? "启用" : "停用"} · 当前组版本 {currentGroup.revision}；当前资料不替代原快照。</p>
        <p className="break-all text-xs">归组 {detail.assignmentId} · 组 {detail.groupId} · 原员工 {detail.employeeId ?? "未关联员工"}</p>
        <p>{detail.startsOn} → {detail.endsOn ?? "未设结束日"} · 保存时区 {detail.timeZone}</p>
        <p className="break-all text-xs">当前投影 UTC：{fromAt} → {toAt ?? "未设结束"}；原归组曾与查询重叠，不代表结束／取消后仍参与解析。</p>
        <details><summary className="cursor-pointer font-semibold">核对归组生命周期来源</summary><ol className="mt-2 space-y-3">{detail.history.map(({ command, item }) => <li key={command.operationId} className="break-all text-xs leading-5">
          <p>{command.action === "assign" ? "原归组登记" : command.action === "end" ? "结束登记" : "取消登记"} · 版本 {item.revision} · 原操作 {command.operationId}</p>
          <p className="whitespace-pre-wrap">原理由：{command.reason}</p><p>原员工 {item.employeeId ?? "未关联"} · 档案 {item.workerId} · 原组 {item.groupName}</p>
          <p>{item.startsOn} → {item.endsOn ?? "未设结束日"} · {item.timeZone} · 原创建 {item.createdAt} · 此版本登记 {item.updatedAt}</p>
          {command.action === "assign" && <p>保存上下文：档案版本 {command.expectedWorkerVersion} · 设置版本 {command.expectedSettingsVersion} · 组版本 {command.expectedGroupRevision}</p>}
        </li>)}</ol></details>
      </article>}/>
    <PagedSources title="企业与组候选发布来源" limited={r.rules.limited} items={publications} itemKey={({ stream, item }) => `${stream.groupId ?? "enterprise"}:${item?.revision ?? "none"}`}
      empty="没有可完整展示的规则流；请核对来源边界，不推定为未配置。" renderItem={({ stream, item }) => <article data-rule-publication-source className="min-w-0 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
        <h4 className="break-all font-semibold">{stream.groupId === null ? "企业候选层" : `组候选层 ${stream.groupId}`} · 账本版本 {stream.revision}</h4>
        {!item ? <p>本次已读取该规则流，但该范围没有关联候选发布；不擅自采用默认值。</p> : <>
          <p>候选发布版本 {item.revision} · 原日期 {item.effectiveOn} · 保存时区 {item.timeZone}</p>
          <p className="break-all">原候选起点 {item.effectiveAt}</p>
          <details><summary className="cursor-pointer font-semibold">核对候选发布完整来源</summary><div className="mt-2 space-y-2 text-xs">
            <p className="break-all">原操作 {item.operationId} · 原操作人 {item.actorId} · 原登记 {item.recordedAt}</p>
            <p>保存上下文：设置版本 {item.settingsVersion} · 组版本 {item.groupRevision ?? "企业层不适用"}</p>
            <p className="whitespace-pre-wrap break-words">原理由：{item.reason}</p><RulesValues rules={item.rules} layer={stream.groupId === null ? "enterprise" : "group"}/>
          </div></details>
        </>}
      </article>}/>
  </section>;
}
