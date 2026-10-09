"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceManagementClient, type AttendanceManagementClientState, type ManagementStorage } from "@/lib/merchantAttendanceManagementDelegatedClient";
import * as m from "@/lib/merchantAttendanceManagementDelegation";
import * as a from "@/lib/merchantAttendanceDelegatedAudit";
import * as g from "@/lib/merchantAttendanceDelegatedGroups";
import * as cfg from "@/lib/merchantAttendanceDelegatedConfiguration";
import { buildManagementConfigurationGrant, buildManagementConfigurationCommand, type ManagementConfigurationCommandDraft } from "@/lib/merchantAttendanceDelegatedConfigurationUi";
import type { GroupsCommand } from "@/lib/merchantAttendanceGroups";
import * as rules from "@/lib/merchantAttendanceDelegatedRules";
import * as credentials from "@/lib/merchantAttendanceDelegatedCredentials";
import * as revisions from "@/lib/merchantAttendanceDelegatedRevisions";
import { buildManagementRevisionsGrant, buildManagementRevisionsCommand, managementRevisionsContextQuery, delegatedRevisionActionLabels,
  type ManagementRevisionsGrantForm, type ManagementRevisionsDraft } from "@/lib/merchantAttendanceDelegatedRevisionsUi";
import { previewCorrection } from "@/lib/merchantAttendanceCorrection";
import { formatAttendanceTimesheetDuration as duration } from "@/lib/merchantAttendanceTimesheetDisplay";
import { CORRECTION_CHECK_LABELS } from "@/lib/merchantAttendanceCorrectionReview";
import { CORRECTION_RULE_LABELS } from "@/lib/merchantAttendanceCorrectionRules";
import RulesNotice from "./MerchantAttendanceCorrectionRulesNotice";
import { buildManagementCredentialsGrant, buildManagementTerminalBody, buildManagementPinBody, managementCredentialsQuery,
  newManagementPairSecret, managementPairDisplay, managementPairDisplayCurrent, MANAGEMENT_CREDENTIAL_SECRET_MS, delegatedCredentialActionLabels,
  type ManagementCredentialDraft, type ManagementPairDisplay } from "@/lib/merchantAttendanceDelegatedCredentialsUi";
import { buildManagementRulesGrant, buildManagementRulesCommand, managementRulesContextQuery, managementRulesDraftFromContext,
  managementRulesFamily, managementRulesPreviewQuery, managementRulesRevision, managementRulesFutureStart, managementRulesKnownRoutes, delegatedRuleActionLabels,
  type ManagementRulesContext, type ManagementRulesCommandDraft, type ManagementRulesEvidence } from "@/lib/merchantAttendanceDelegatedRulesUi";
import { RULE_KEYS, RULE_DEFINITIONS, type AttendanceRuleDraft, type AttendanceRuleKey } from "@/lib/merchantAttendanceRuleDraft";
import { OPERATIONAL_RULE_KEYS, OPERATIONAL_RULE_CHANNELS, OPERATIONAL_RULE_REVIEW_CATEGORIES, OPERATIONAL_RULE_REMINDER_KINDS,
  type OperationalRules, type OperationalRuleKey, type OperationalRuleValues } from "@/lib/merchantAttendanceOperationalRules";
import { operationalRuleNames, operationalRuleDefault, operationalReviewNames, operationalReminderNames } from "./MerchantAttendanceOperationalRulesFields";

export type ManagementDelegatedPanelProps = Readonly<{ siteId: string; actorId: string; apiFetch: AttendanceApiFetch;
  isCurrentAuth: () => boolean; ownerMode?: boolean; grantEnabled?: boolean; auditEnabled?: boolean; groupsEnabled?: boolean; configurationEnabled?: boolean; rulesEnabled?: boolean; terminalsEnabled?: boolean; pinEnabled?: boolean; revisionsEnabled?: boolean; requesterKey?: string; onClose: () => void;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void; storage?: () => ManagementStorage }>;
export type ManagementAuditGrantDraft = Readonly<{ delegateEmployeeId: string; delegateAuthUserId: string;
  delegatedAction: "audit_view" | "audit_export"; scopeKind: "audit_company" | "audit_worker";
  workerId: string; employeeId: string; employeeAuthUserId: string; locationIds: string;
  sources: readonly a.DelegatedAuditSource[]; validFrom: string; validUntil: string; reason: string; acknowledged: boolean }>;
type AuditDraft = Readonly<{ grantId: string; source: a.DelegatedAuditSource; fromAt: string; toAt: string }>;
export type ManagementGroupsGrantDraft = Readonly<{ delegateEmployeeId: string; delegateAuthUserId: string; delegatedAction: g.DelegatedGroupsAction;
  groupId: string; create: boolean; assignmentId: string; workerId: string; employeeId: string; employeeAuthUserId: string; locationIds: string;
  validFrom: string; validUntil: string; reason: string; acknowledged: boolean }>;
export type ManagementGroupsDraft = Readonly<{ name: string; description: string; active: boolean; startsOn: string; endsOn: string; reason: string; acknowledged: boolean }>;
export type ManagementConfigurationGrantForm = Readonly<{ delegateEmployeeId: string; delegateAuthUserId: string; delegatedAction: cfg.DelegatedConfigurationAction;
  workerId: string; employeeId: string; employeeAuthUserId: string; locationId: string; locationIds: string; create: boolean;
  validFrom: string; validUntil: string; reason: string; acknowledged: boolean }>;
type ManagementRulesGrantForm = Readonly<{ delegateEmployeeId: string; delegateAuthUserId: string; delegatedAction: rules.DelegatedRulesAction;
  subjectKind: "enterprise" | "group" | "personal"; groupId: string; workerId: string; employeeId: string; employeeAuthUserId: string;
  allowedRuleKeys: readonly string[]; locationIds: string; validFrom: string; validUntil: string; reason: string; acknowledged: boolean }>;
type ManagementCredentialsGrantForm = Readonly<{ delegateEmployeeId: string; delegateAuthUserId: string; delegatedAction: credentials.DelegatedCredentialsAction;
  pinKind: "member_pin" | "independent_pin"; terminalId: string; locationId: string; workerId: string; employeeId: string; employeeAuthUserId: string; subjectId: string; generation: string; locationIds: string;
  validFrom: string; validUntil: string; reason: string; acknowledged: boolean }>;
export type ManagementDelegatedWriteKind = "grant" | "groups-grant" | "configuration-grant" | "rules-grant" | "terminals-grant" | "pin-grant" | "revisions-grant" | "revoke" | "export" | "groups" | "configuration" | "rules" | "terminals" | "pin" | "revisions" | null;
const emptyGrant = (): ManagementAuditGrantDraft => ({ delegateEmployeeId: "", delegateAuthUserId: "", delegatedAction: "audit_view",
  scopeKind: "audit_company", workerId: "", employeeId: "", employeeAuthUserId: "", locationIds: "", sources: [], validFrom: "", validUntil: "", reason: "", acknowledged: false });
const emptyAudit = (): AuditDraft => ({ grantId: "", source: "config", fromAt: "", toAt: "" });
const emptyGroupsGrant = (): ManagementGroupsGrantDraft => ({ delegateEmployeeId: "", delegateAuthUserId: "", delegatedAction: "group_save", groupId: "", create: false,
  assignmentId: "", workerId: "", employeeId: "", employeeAuthUserId: "", locationIds: "", validFrom: "", validUntil: "", reason: "", acknowledged: false });
const emptyGroups = (): ManagementGroupsDraft => ({ name: "", description: "", active: true, startsOn: "", endsOn: "", reason: "", acknowledged: false });
const emptyConfigurationGrant = (): ManagementConfigurationGrantForm => ({ delegateEmployeeId: "", delegateAuthUserId: "", delegatedAction: "worker_save",
  workerId: "", employeeId: "", employeeAuthUserId: "", locationId: "", locationIds: "", create: false, validFrom: "", validUntil: "", reason: "", acknowledged: false });
const emptyRulesGrant = (): ManagementRulesGrantForm => ({ delegateEmployeeId: "", delegateAuthUserId: "", delegatedAction: "rule_draft", subjectKind: "enterprise",
  groupId: "", workerId: "", employeeId: "", employeeAuthUserId: "", allowedRuleKeys: [], locationIds: "", validFrom: "", validUntil: "", reason: "", acknowledged: false });
const emptyCredentialsGrant = (): ManagementCredentialsGrantForm => ({ delegateEmployeeId: "", delegateAuthUserId: "", delegatedAction: "terminal_prepare", pinKind: "member_pin",
  terminalId: "", locationId: "", workerId: "", employeeId: "", employeeAuthUserId: "", subjectId: "", generation: "1", locationIds: "", validFrom: "", validUntil: "", reason: "", acknowledged: false });
const emptyCredentials = (): ManagementCredentialDraft => ({ label: "", reason: "", acknowledged: false });
const emptyRevisionsGrant = (): ManagementRevisionsGrantForm => ({ delegateEmployeeId: "", delegateAuthUserId: "", delegatedAction: "revision_approve",
  workerId: "", employeeId: "", employeeAuthUserId: "", locationIds: "", includePending: false, validFrom: "", validUntil: "", reason: "", acknowledged: false });
const emptyRevisions = (): ManagementRevisionsDraft => ({ reason: "", acknowledged: false });
const initialState: AttendanceManagementClientState = { phase: "idle", pending: null, result: null, message: "尚未读取；初始化不联网。" };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const field = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm";
const sourceLabels = { config: "档案／地点配置", scope: "原访问范围", management: "管理委托记录" };
const actionLabels = { audit_view: "只读审计", audit_export: "审计 CSV 导出" };
const groupActionLabels = { group_save: "保存指定组", group_assign: "分配指定员工", group_end: "结束指定分配", group_cancel: "取消指定分配" };
const configurationActionLabels = { worker_save: "保存指定员工档案", location_save: "保存指定工作地点" };
const same = (value: unknown) => JSON.stringify(value);
const revisionCheckLabels: Readonly<Record<string, string>> = { ...CORRECTION_CHECK_LABELS, ...Object.fromEntries(Object.entries(CORRECTION_RULE_LABELS).map(([key, label]) => [`rule_${key}`, label])),
  effective_overlap: "与其他最新有效班次重叠，不能批准。", missing_overlap: "与已批准漏卡时段重叠，不能批准。", already_decided: "此申请已有决定。", base_changed: "有效核定已变更，不能覆盖较新结果。" };
export function DelegatedRevisionReview({ context }: { context: revisions.DelegatedRevisionsContextResult }) {
  const r = context.context.review, app = r.review.review.application, base = r.review.base,
    comparison = previewCorrection(app.basis, app.proposal), prior = previewCorrection(app.basis, base.proposal).proposed;
  return <div className="min-w-0 space-y-3 text-sm" data-delegated-revisions-review>
    <h4 className="font-bold">{r.review.review.item.workerName} · {r.review.review.item.workerNo} · 待审批修订</h4>
    <p className="break-all">申请 {r.requestId} · 提交版本 {r.review.submittedRevision} · 时区 {base.timeZone} · 提交 UTC {app.item.submittedAt}</p>
    <p className="break-words">员工申请理由：{app.reason}</p><RulesNotice rules={app.rules}/>
    <div className="grid min-w-0 gap-3 md:grid-cols-3">{([
      ["原始打卡（保留不变）", comparison.original], [`提交时核定（修订 ${base.revision}）`, prior], ["本次员工声明（尚未生效）", comparison.proposed],
    ] as const).map(([title, statement]) => <section key={title} aria-label={title} className="min-w-0 space-y-1 rounded-xl border p-3">
      <h5 className="font-bold">{title}</h5><p>{duration(statement.totals!.workedUs)}</p><p className="break-all">UTC {statement.startAt} → {statement.endAt}</p><p>全部休息 {duration(statement.totals!.breakUs)}</p>
    </section>)}</div>
    <details className="min-w-0 rounded-xl border p-3"><summary>声明休息与原始依据、相邻班次、在职日期</summary>
      {app.proposal.breaks.map((rest, index) => <p className="break-all" key={index}>声明休息 {rest.startAt} → {rest.endAt} · {rest.paid ? "带薪标记" : "非带薪标记"}</p>)}
      {([['提交时原始记录', app.basis], ['当前原始记录', r.review.review.evidence.currentBasis]] as const).map(([label, basis]) => <div key={label}><h5 className="font-bold">{label}</h5>
        {basis ? <ol className="max-h-56 space-y-1 overflow-auto">{basis.events.map(event => <li className="break-all" key={event.id}>{event.sequence}. {event.action} · {event.occurredAt}</li>)}</ol> : <p>当前依据无法完整读取，不能据此批准。</p>}</div>)}
      <p className="break-all">前一班次结束 {r.review.review.evidence.previous?.occurredAt ?? "无可核对记录"}；后一班次开始 {r.review.review.evidence.next?.occurredAt ?? "无可核对记录"}</p>
      {r.review.review.evidence.employmentPeriods.map(period => <p key={period.startsOn}>{period.startsOn} → {period.endsOn ?? "未设置结束"}</p>)}
    </details>
    <p className="break-all">当前有效核定：{duration(r.current.workedUs)} · 修订 {r.current.revision} · 操作 {r.current.operationId}。提交时核定前驱 {base.operationId}。</p>
    {r.blockers.length ? <ul className="list-disc pl-5">{r.blockers.map(check => <li key={check}>{revisionCheckLabels[check] ?? "需进一步核查，不能据此假定通过。"}</li>)}</ul> : <p>已接入检查暂未发现阻断，提交事务仍会重验；不代表已批准。</p>}
    <p>以上为全班次而非周期合计或工资。批准新增下一版核定，不覆盖原始打卡；驳回不改变工时。本入口不支持撤销决定。</p>
  </div>;
}
export function managementCurrentAuth(check: () => boolean): boolean { try { return check() === true; } catch { return false; } }
// The controls are explicitly UTC; never interpret a datetime-local value in the browser's local zone.
export function managementUtcInput(value: string): string {
  if (value !== value.trim()) throw Error("invalid UTC input");
  if (/^20\d\d-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?$/.test(value)) {
    const [base, fraction = ""] = value.split("."); value = (base.length === 16 ? base + ":00" : base) + "." + fraction.padEnd(6, "0") + "Z";
  }
  return a.delegatedAuditStamp(value);
}
function ruleValueLabel(value: unknown): string {
  if (value === null) return "无";
  if (Array.isArray(value)) return value.map(ruleValueLabel).join("、");
  if (value && typeof value === "object") return Object.entries(value).map(([k, v]) => `${k}：${ruleValueLabel(v)}`).join("；");
  return value === "inherit" ? "继承" : value === "disabled" ? "明确停用" : String(value);
}
function RuleChoiceSummary({ value }: { value: AttendanceRuleDraft | OperationalRules }) {
  return <dl className="min-w-0 space-y-1">{Object.entries(value).map(([key, choice]) => <div className="min-w-0" key={key}>
    <dt className="font-medium">{key in RULE_DEFINITIONS ? RULE_DEFINITIONS[key as AttendanceRuleKey].label : operationalRuleNames[key as OperationalRuleKey]}</dt>
    <dd className="break-all">{ruleValueLabel(choice)}</dd></div>)}</dl>;
}
export function DelegatedRuleChoices({ context, value, onChange }: { context: ManagementRulesContext; value: AttendanceRuleDraft | OperationalRules;
  onChange: (value: AttendanceRuleDraft | OperationalRules) => void }) {
  const operational = context.scope.family === "operational", keys = operational ? OPERATIONAL_RULE_KEYS : RULE_KEYS;
  const number = (label: string, v: number, min: number, max: number, change: (n: number) => void) => <label className="block min-w-0">{label}<input aria-label={label} className={field} type="number" min={min} max={max} step={1}
    value={Number.isNaN(v) ? "" : v} onChange={e => change(e.target.value === "" ? NaN : Number(e.target.value))}/></label>;
  const op = value as OperationalRules;
  const setOp = <K extends OperationalRuleKey,>(key: K, next: OperationalRuleValues[K]) => onChange({ ...op, [key]: { mode: "value", value: next } });
  const controls: Partial<Record<OperationalRuleKey, ReactNode>> = {};
  if (operational) {
    if (op.allowedChannels.mode === "value") { const current = op.allowedChannels.value; controls.allowedChannels = <div className="flex flex-wrap gap-3">{OPERATIONAL_RULE_CHANNELS.map(channel => <label className="flex gap-2" key={channel}>
      <input type="checkbox" checked={current.includes(channel)} onChange={e => setOp("allowedChannels", OPERATIONAL_RULE_CHANNELS.filter(k => k === channel ? e.target.checked : current.includes(k)))}/>{channel}</label>)}</div>; }
    if (op.locationScope.mode === "value") { const current = op.locationScope.value; controls.locationScope = <div className="space-y-2"><p>仅从此授权的精确地点名单选择（1—25个）；编号不是当前启用或访问权限证明，提交与预览会重验。</p>
      {context.scope.locationIds.map(id => <label className="flex min-w-0 gap-2 break-all" key={id}><input type="checkbox" checked={current.includes(id)} disabled={!current.includes(id) && current.length >= 25}
        onChange={e => setOp("locationScope", (e.target.checked ? [...current, id] : current.filter(v => v !== id)).sort())}/>{id}</label>)}
      {current.filter(id => !context.scope.locationIds.includes(id)).map(id => <p className="break-all text-amber-800" key={id}>保存地点 {id} 不在此授权名单；不能据此发送。</p>)}</div>; }
    if (op.shiftSource.mode === "value") controls.shiftSource = <label>班次来源值<select className={field} value={op.shiftSource.value} onChange={e => setOp("shiftSource", e.target.value as "published_selection" | "unplanned")}><option value="published_selection">已发布班次选择</option><option value="unplanned">无计划班次</option></select></label>;
    if (op.breakTypes.mode === "value") { const current = op.breakTypes.value; controls.breakTypes = <div className="space-y-2"><label>休息选择方式<select className={field} value={current.selection} onChange={e => setOp("breakTypes", { ...current, selection: e.target.value as "fixed" | "explicit" })}><option value="fixed">固定一种（仅选一项）</option><option value="explicit">明确选择</option></select></label>
      <div className="flex gap-3">{(["paid", "unpaid"] as const).map(k => <label className="flex gap-2" key={k}><input type="checkbox" checked={current.allowed.includes(k)} onChange={e => setOp("breakTypes", { ...current, allowed: (["paid", "unpaid"] as const).filter(v => v === k ? e.target.checked : current.allowed.includes(v)) })}/>{k === "paid" ? "带薪" : "无薪"}</label>)}</div></div>; }
    if (op.correctionWindow.mode === "value") controls.correctionWindow = number("补正窗口天数", op.correctionWindow.value.days, 0, 365, days => setOp("correctionWindow", { days }));
    if (op.reviewRouting.mode === "value") { const current = op.reviewRouting.value, known = managementRulesKnownRoutes(context), key = (pair: typeof known[number]) => `${pair.delegateEmployeeId}/${pair.delegateAuthUserId}`;
      controls.reviewRouting = <div className="space-y-3"><p>只复用刚读取的同层基线中已有的完整员工／账户引用，或业务当时负责人；不输入新身份、不枚举全商户成员。路由不是审批授权，未来审批另验委托。</p>
        {OPERATIONAL_RULE_REVIEW_CATEGORIES.map(category => { const target = current[category], selected = target === "owner" ? "owner" : key(target); return <fieldset className="space-y-2 rounded-xl border p-2" key={category}><legend>{operationalReviewNames[category]}</legend><label>路由目标<select className={field} value={selected}
          onChange={e => { const next = e.target.value === "owner" ? "owner" : known.find(pair => key(pair) === e.target.value); if (next) setOp("reviewRouting", { ...current, [category]: next }); }}><option value="owner">业务当时负责人</option>
          {target !== "owner" && !known.some(pair => key(pair) === selected) && <option value={selected} disabled>非当前基线引用，禁止发送</option>}
          {known.map(pair => <option key={key(pair)} value={key(pair)}>保存员工 {pair.delegateEmployeeId}／Auth {pair.delegateAuthUserId}</option>)}</select></label>
          {target !== "owner" && <p className="break-all">保存员工 {target.delegateEmployeeId}／账户 {target.delegateAuthUserId}</p>}</fieldset>; })}</div>; }
    if (op.timesheetCycle.mode === "value") { const current = op.timesheetCycle.value; controls.timesheetCycle = <div className="space-y-2"><label>周期方式值<select className={field} value={current.kind} onChange={e => { const kind = e.target.value;
      setOp("timesheetCycle", kind === "weekly" ? { kind, weekStartsOn: 1 } : kind === "fortnightly" ? { kind, anchorDate: "" } : { kind: kind as "manual" | "monthly" }); }}><option value="manual">手动</option><option value="weekly">每周</option><option value="fortnightly">每两周</option><option value="monthly">每月</option></select></label>
      {current.kind === "weekly" && number("每周起始日（1=周一，7=周日）", current.weekStartsOn, 1, 7, weekStartsOn => setOp("timesheetCycle", { ...current, weekStartsOn }))}
      {current.kind === "fortnightly" && <label>两周周期锚点日期<input className={field} type="date" value={current.anchorDate} onChange={e => setOp("timesheetCycle", { ...current, anchorDate: e.target.value })}/></label>}<p>只登记周期方式，不自动创建、送审或封存工时。</p></div>; }
    if (op.reminders.mode === "value") { const current = op.reminders.value; controls.reminders = <div className="space-y-3">{OPERATIONAL_RULE_REMINDER_KINDS.map(kind => { const reminder = current[kind]; return <section className="space-y-2 rounded-xl border p-2" key={kind}>
      <label>{operationalReminderNames[kind]}提醒<select className={field} value={reminder.mode} onChange={e => setOp("reminders", { ...current, [kind]: e.target.value === "disabled" ? { mode: "disabled" } : { mode: "enabled", afterMinutes: 60, repeatMinutes: 60, maxOccurrences: 1 } })}><option value="disabled">停用</option><option value="enabled">登记配置</option></select></label>
      {reminder.mode === "enabled" && <div className="grid min-w-0 gap-2 sm:grid-cols-3">{number(`${operationalReminderNames[kind]}首次等待分钟`, reminder.afterMinutes, 1, 44640, afterMinutes => setOp("reminders", { ...current, [kind]: { ...reminder, afterMinutes } }))}
        {number(`${operationalReminderNames[kind]}重复间隔分钟`, reminder.repeatMinutes, 60, 44640, repeatMinutes => setOp("reminders", { ...current, [kind]: { ...reminder, repeatMinutes } }))}
        {number(`${operationalReminderNames[kind]}最多次数`, reminder.maxOccurrences, 1, 10, maxOccurrences => setOp("reminders", { ...current, [kind]: { ...reminder, maxOccurrences } }))}</div>}</section>; })}<p>登记配置不代表提醒已启用；不补发历史提醒。</p></div>; }
  }
  return <div className="min-w-0 space-y-3">{keys.map(key => { const choice = Reflect.get(value, key), allowed = context.scope.allowedRuleKeys.includes(key), name = operational ? operationalRuleNames[key as OperationalRuleKey] : RULE_DEFINITIONS[key as AttendanceRuleKey].label;
    return <fieldset key={key} className="min-w-0 space-y-2 rounded-xl border p-3"><legend className="px-1 font-semibold">{name}{!allowed ? "（未授权，原值保留）" : ""}</legend>
      {!allowed ? <p className="break-all">{ruleValueLabel(choice)}</p> : <><label>{name}处理方式<select className={field} aria-label={`${name}处理方式`} value={choice.mode} onChange={e => onChange({ ...value, [key]: e.target.value === "value"
        ? operational ? { mode: "value", value: operationalRuleDefault(key as OperationalRuleKey) } : { mode: "value", minutes: RULE_DEFINITIONS[key as AttendanceRuleKey].min }
        : { mode: e.target.value as "inherit" | "disabled" } } as AttendanceRuleDraft | OperationalRules)}><option value="inherit">继承（本层不覆盖）</option><option value="disabled">明确停用</option><option value="value">具体值</option></select></label>
        {operational ? controls[key as OperationalRuleKey] : choice.mode === "value" && number(`${name}分钟`, choice.minutes, RULE_DEFINITIONS[key as AttendanceRuleKey].min, RULE_DEFINITIONS[key as AttendanceRuleKey].max,
          minutes => onChange({ ...value, [key]: { mode: "value", minutes } } as AttendanceRuleDraft))}</>}
    </fieldset>; })}</div>;
}
export function buildManagementAuditGrant(draft: ManagementAuditGrantDraft, operationId: string): m.ManagementDelegationGrantCommand {
  if (!draft.acknowledged || !["audit_view", "audit_export"].includes(draft.delegatedAction)
    || !["audit_company", "audit_worker"].includes(draft.scopeKind)) throw Error("请明确核验授权内容");
  const sources = [...draft.sources].sort();
  const scope = draft.scopeKind === "audit_company" ? { kind: "audit_company", sources }
    : { kind: "audit_worker", workerId: draft.workerId, employeeId: draft.employeeId, employeeAuthUserId: draft.employeeAuthUserId,
      locationIds: draft.locationIds.trim().split(/[\s,]+/).sort(), sources };
  const parsed = m.parseManagementDelegationCommand({ action: "grant", operationId, delegateEmployeeId: draft.delegateEmployeeId,
    delegateAuthUserId: draft.delegateAuthUserId, delegatedAction: draft.delegatedAction, scope,
    validFrom: managementUtcInput(draft.validFrom), validUntil: managementUtcInput(draft.validUntil), reason: draft.reason.trim() });
  if (parsed.action !== "grant") throw Error("invalid grant"); return parsed;
}
export function buildManagementGroupsGrant(draft: ManagementGroupsGrantDraft, operationId: string): m.ManagementDelegationGrantCommand {
  if (!draft.acknowledged || !g.DELEGATED_GROUPS_ACTIONS.includes(draft.delegatedAction)) throw Error("请明确核验组授权");
  const scope = draft.delegatedAction === "group_save" ? { kind: "group", groupId: draft.groupId, create: draft.create }
    : { kind: "group_worker", groupId: draft.groupId, assignmentId: draft.delegatedAction === "group_assign" ? null : draft.assignmentId,
      workerId: draft.workerId, employeeId: draft.employeeId, employeeAuthUserId: draft.employeeAuthUserId, locationIds: draft.locationIds.trim().split(/[\s,]+/).sort() };
  const command = m.parseManagementDelegationCommand({ action: "grant", operationId, delegateEmployeeId: draft.delegateEmployeeId,
    delegateAuthUserId: draft.delegateAuthUserId, delegatedAction: draft.delegatedAction, scope,
    validFrom: managementUtcInput(draft.validFrom), validUntil: managementUtcInput(draft.validUntil), reason: draft.reason.trim() });
  if (command.action !== "grant") throw Error("invalid group grant"); return command;
}
export function managementGroupsContextQuery(siteId: string, grantId: string): Extract<g.DelegatedGroupsQuery, { mode: "context" }> {
  const query = g.parseDelegatedGroupsQuery({ siteId, grantId, mode: "context", operationId: null });
  if (query.mode !== "context") throw Error("invalid context"); return query;
}
export function buildManagementGroupsCommand(result: Extract<g.DelegatedGroupsResult, { kind: "context" }>, draft: ManagementGroupsDraft, operationId: string): GroupsCommand {
  if (!draft.acknowledged) throw Error("请明确确认组操作");
  const scope = m.parseManagementDelegationScope(result.scope, result.action), context = result.context, reason = draft.reason.trim();
  let command: GroupsCommand;
  if (result.action === "group_save" && scope.kind === "group") {
    if (scope.create ? context.group !== null : context.group?.groupId !== scope.groupId) throw Error("组上下文已变化");
    command = { action: "save_group", operationId: scope.create ? scope.groupId : operationId, groupId: scope.groupId,
      expectedRevision: scope.create ? 0 : context.group!.revision, name: draft.name.trim(), description: draft.description.trim(), active: draft.active, reason };
  } else if (scope.kind === "group_worker" && context.group?.groupId === scope.groupId && context.worker?.workerId === scope.workerId
    && context.worker.employeeId === scope.employeeId) {
    if (result.action === "group_assign" && context.group.active && context.worker.active) {
      command = { action: "assign", operationId, groupId: scope.groupId, workerId: scope.workerId, expectedGroupRevision: context.group.revision,
        expectedWorkerVersion: context.worker.version, expectedSettingsVersion: context.settingsVersion, timeZone: context.timeZone,
        startsOn: draft.startsOn, endsOn: draft.endsOn === "" ? null : draft.endsOn, reason };
    } else if (context.detail?.assignmentId === scope.assignmentId && result.action === "group_end" && context.detail.canEnd && context.detail.revision === 1
      && draft.endsOn >= context.detail.startsOn) {
      command = { action: "end", operationId, assignmentId: context.detail.assignmentId, expectedRevision: 1, endsOn: draft.endsOn, reason };
    } else if (context.detail?.assignmentId === scope.assignmentId && result.action === "group_cancel" && context.detail.canCancel
      && (context.detail.revision === 1 || context.detail.revision === 2)) {
      command = { action: "cancel", operationId, assignmentId: context.detail.assignmentId, expectedRevision: context.detail.revision, reason };
    } else throw Error("当前分配不可执行此动作");
  } else throw Error("组授权与当前双身份不一致");
  return g.delegatedGroupsCommandForContext(result, command);
}
export function confirmManagementDelegatedAction(confirm: () => boolean, current: () => boolean, submit: () => void): boolean {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export function managementDelegatedWriteAllowed(kind: ManagementDelegatedWriteKind, ownerMode: boolean, grantEnabled: boolean, auditEnabled: boolean, groupsEnabled = false, configurationEnabled = false, rulesEnabled = false, terminalsEnabled = false, pinEnabled = false, revisionsEnabled = false): boolean {
  return kind === "grant" ? ownerMode && grantEnabled : kind === "groups-grant" ? ownerMode && grantEnabled && groupsEnabled
    : kind === "configuration-grant" ? ownerMode && grantEnabled && configurationEnabled : kind === "configuration" ? configurationEnabled
      : kind === "rules-grant" ? ownerMode && grantEnabled && rulesEnabled : kind === "rules" ? rulesEnabled
        : kind === "terminals-grant" ? ownerMode && grantEnabled && terminalsEnabled : kind === "pin-grant" ? ownerMode && grantEnabled && pinEnabled
          : kind === "terminals" ? terminalsEnabled : kind === "pin" ? pinEnabled
            : kind === "revisions-grant" ? ownerMode && grantEnabled && revisionsEnabled : kind === "revisions" ? revisionsEnabled
        : kind === "revoke" ? ownerMode : kind === "export" ? auditEnabled : kind === "groups" && groupsEnabled;
}
function credentialsGrantFromForm(form: ManagementCredentialsGrantForm, operationId: string) {
  const scope = form.delegatedAction.startsWith("terminal_") ? { kind: "terminal", terminalId: form.terminalId, locationId: form.locationId, create: form.delegatedAction === "terminal_prepare" }
    : form.pinKind === "member_pin" ? { kind: "member_pin", workerId: form.workerId, employeeId: form.employeeId, employeeAuthUserId: form.employeeAuthUserId, locationIds: form.locationIds.trim().split(/[\s,]+/).sort() }
      : { kind: "independent_pin", workerId: form.workerId, subjectId: form.subjectId, generation: Number(form.generation), locationIds: form.locationIds.trim().split(/[\s,]+/).sort() };
  return buildManagementCredentialsGrant({ delegateEmployeeId: form.delegateEmployeeId, delegateAuthUserId: form.delegateAuthUserId, delegatedAction: form.delegatedAction, scope,
    validFrom: form.validFrom, validUntil: form.validUntil, reason: form.reason, acknowledged: form.acknowledged }, operationId);
}
function rulesGrantFromForm(form: ManagementRulesGrantForm, operationId: string) {
  return buildManagementRulesGrant({ delegateEmployeeId: form.delegateEmployeeId, delegateAuthUserId: form.delegateAuthUserId, delegatedAction: form.delegatedAction,
    subject: form.subjectKind === "enterprise" ? { kind: "enterprise" } : form.subjectKind === "group" ? { kind: "group", groupId: form.groupId }
      : { kind: "personal", workerId: form.workerId, employeeId: form.employeeId, employeeAuthUserId: form.employeeAuthUserId },
    allowedRuleKeys: form.allowedRuleKeys, locationIds: form.locationIds.trim() === "" ? [] : form.locationIds.trim().split(/[\s,]+/),
    validFrom: form.validFrom, validUntil: form.validUntil, reason: form.reason, acknowledged: form.acknowledged }, operationId);
}
export function managementConfigurationContextQuery(siteId: string, grantId: string): Extract<cfg.DelegatedConfigurationQuery, { mode: "context" }> {
  const query = cfg.parseDelegatedConfigurationQuery({ siteId, grantId, mode: "context", operationId: null });
  if (query.mode !== "context") throw Error("invalid configuration context"); return query;
}
export function managementConfigurationGrantFromForm(form: ManagementConfigurationGrantForm, operationId: string): m.ManagementDelegationGrantCommand {
  const common = { delegateEmployeeId: form.delegateEmployeeId, delegateAuthUserId: form.delegateAuthUserId, create: form.create,
    validFrom: form.validFrom, validUntil: form.validUntil, reason: form.reason, acknowledged: form.acknowledged };
  return buildManagementConfigurationGrant(form.delegatedAction === "worker_save"
    ? { ...common, delegatedAction: form.delegatedAction, workerId: form.workerId, employeeId: form.employeeId, employeeAuthUserId: form.employeeAuthUserId,
      locationIds: form.locationIds.trim().split(/[\s,]+/) }
    : { ...common, delegatedAction: form.delegatedAction, locationId: form.locationId }, operationId);
}
export function managementConfigurationDraftFromContext(result: Extract<cfg.DelegatedConfigurationResult, { kind: "context" }>): ManagementConfigurationCommandDraft {
  if (result.action === "worker_save" && result.scope.kind === "worker") {
    const worker = result.context.worker;
    return { kind: "worker", workerNo: worker?.workerNo ?? "", displayName: worker?.displayName ?? result.context.employee?.displayName ?? "",
      locationId: worker?.locationId ?? "", startsOn: worker?.startsOn ?? "", active: worker?.active ?? true, acknowledged: false };
  }
  if (result.action !== "location_save" || result.scope.kind !== "location") throw Error("invalid configuration context");
  const location = result.context.locations[0];
  return { kind: "location", name: location?.name ?? "", timeZone: location?.timeZone ?? "", active: location?.active ?? true, acknowledged: false };
}
export function suspendManagementDelegatedWorkspace(refs: Readonly<{ mounted: { current: boolean }; working: { current: boolean }; epoch: { current: number } }>, client: Pick<AttendanceManagementClient, "pause">) {
  refs.mounted.current = false; refs.working.current = false; refs.epoch.current++; client.pause();
}
export function managementAuditListQuery(siteId: string, draft: AuditDraft): Extract<a.DelegatedAuditQuery, { mode: "list" }> {
  const query = a.parseDelegatedAuditQuery({ siteId, grantId: draft.grantId, mode: "list", source: draft.source,
    fromAt: managementUtcInput(draft.fromAt), toAt: managementUtcInput(draft.toAt), asOf: null, cursorAt: null, cursorId: null });
  if (query.mode !== "list") throw Error("invalid query"); return query;
}
export default function MerchantAttendanceManagementDelegatedPanel(props: ManagementDelegatedPanelProps) {
  const [scope, setScope] = useState({ siteId: props.siteId, actorId: props.actorId, apiFetch: props.apiFetch,
    auth: props.isCurrentAuth, storage: props.storage, ownerMode: props.ownerMode, grantEnabled: props.grantEnabled, auditEnabled: props.auditEnabled, groupsEnabled: props.groupsEnabled, configurationEnabled: props.configurationEnabled, rulesEnabled: props.rulesEnabled, terminalsEnabled: props.terminalsEnabled, pinEnabled: props.pinEnabled, revisionsEnabled: props.revisionsEnabled, requesterKey: props.requesterKey, revision: 0 });
  if (scope.siteId !== props.siteId || scope.actorId !== props.actorId || scope.apiFetch !== props.apiFetch || scope.auth !== props.isCurrentAuth
    || scope.storage !== props.storage || scope.ownerMode !== props.ownerMode || scope.grantEnabled !== props.grantEnabled || scope.auditEnabled !== props.auditEnabled || scope.groupsEnabled !== props.groupsEnabled || scope.configurationEnabled !== props.configurationEnabled || scope.rulesEnabled !== props.rulesEnabled || scope.terminalsEnabled !== props.terminalsEnabled || scope.pinEnabled !== props.pinEnabled || scope.revisionsEnabled !== props.revisionsEnabled || scope.requesterKey !== props.requesterKey) {
    setScope({ siteId: props.siteId, actorId: props.actorId, apiFetch: props.apiFetch, auth: props.isCurrentAuth, storage: props.storage,
      ownerMode: props.ownerMode, grantEnabled: props.grantEnabled, auditEnabled: props.auditEnabled, groupsEnabled: props.groupsEnabled, configurationEnabled: props.configurationEnabled, rulesEnabled: props.rulesEnabled, terminalsEnabled: props.terminalsEnabled, pinEnabled: props.pinEnabled, revisionsEnabled: props.revisionsEnabled, requesterKey: props.requesterKey, revision: scope.revision + 1 }); return null;
  }
  if (!managementCurrentAuth(props.isCurrentAuth)) return null;
  return <Workspace key={scope.revision} {...props}/>;
}
function Workspace({ siteId, actorId, apiFetch, isCurrentAuth, storage, onClose, registerLeaveGuard, ownerMode = false,
  grantEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_MANAGEMENT_DELEGATIONS_ENABLED === "1",
  auditEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_AUDIT_ENABLED === "1",
  groupsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_GROUPS_ENABLED === "1",
  configurationEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_CONFIGURATION_ENABLED === "1",
  rulesEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_RULES_ENABLED === "1",
  terminalsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_TERMINALS_ENABLED === "1",
  pinEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_PIN_ENABLED === "1",
  revisionsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_ENABLED === "1" }: ManagementDelegatedPanelProps) {
  const mounted = useRef(false), visible = useRef(true), epoch = useRef(0), working = useRef(false), dirty = useRef(false), writeKind = useRef<ManagementDelegatedWriteKind>(null);
  const current = useCallback(() => mounted.current && visible.current && !document.hidden && managementCurrentAuth(isCurrentAuth), [isCurrentAuth]);
  const [state, setState] = useState<AttendanceManagementClientState>(initialState), [initialized, setInitialized] = useState(false), [notice, setNotice] = useState("");
  const client = useMemo(() => new AttendanceManagementClient({ siteId, actorId, apiFetch, storage: storage ?? (() => sessionStorage),
    isCurrentAuth: current, canWrite: () => managementDelegatedWriteAllowed(writeKind.current, ownerMode, grantEnabled, auditEnabled, groupsEnabled, configurationEnabled, rulesEnabled, terminalsEnabled, pinEnabled, revisionsEnabled), timeoutMs: 12000,
    onState: next => { if (mounted.current) setState(next); } }), [siteId, actorId, apiFetch, storage, current, ownerMode, grantEnabled, auditEnabled, groupsEnabled, configurationEnabled, rulesEnabled, terminalsEnabled, pinEnabled, revisionsEnabled]);
  const [grantDraft, setGrantDraft] = useState<ManagementAuditGrantDraft>(emptyGrant), [auditDraft, setAuditDraft] = useState<AuditDraft>(emptyAudit);
  const [groupsGrantDraft, setGroupsGrantDraft] = useState<ManagementGroupsGrantDraft>(emptyGroupsGrant), [groupsDraft, setGroupsDraft] = useState<ManagementGroupsDraft>(emptyGroups);
  const [groupsGrantId, setGroupsGrantId] = useState("");
  const [configurationGrantDraft, setConfigurationGrantDraft] = useState<ManagementConfigurationGrantForm>(emptyConfigurationGrant),
    [configurationDraft, setConfigurationDraft] = useState<ManagementConfigurationCommandDraft | null>(null), [configurationGrantId, setConfigurationGrantId] = useState("");
  const [rulesGrantDraft, setRulesGrantDraft] = useState<ManagementRulesGrantForm>(emptyRulesGrant), [rulesGrantId, setRulesGrantId] = useState("");
  const [rulesContext, setRulesContext] = useState<ManagementRulesContext | null>(null), [rulesDraft, setRulesDraft] = useState<ManagementRulesCommandDraft | null>(null),
    [rulesEvidence, setRulesEvidence] = useState<ManagementRulesEvidence | null>(null);
  const [credentialsGrantDraft, setCredentialsGrantDraft] = useState<ManagementCredentialsGrantForm>(emptyCredentialsGrant),
    [credentialsDraft, setCredentialsDraft] = useState<ManagementCredentialDraft>(emptyCredentials), [credentialsGrantId, setCredentialsGrantId] = useState(""),
    [credentialsDomain, setCredentialsDomain] = useState<"terminals" | "pin">("terminals"), [pinValue, setPinValue] = useState(""), [pairDisplay, setPairDisplay] = useState<ManagementPairDisplay | null>(null);
  const [revisionsGrantDraft, setRevisionsGrantDraft] = useState<ManagementRevisionsGrantForm>(emptyRevisionsGrant),
    [revisionsDraft, setRevisionsDraft] = useState<ManagementRevisionsDraft>(emptyRevisions), [revisionsGrantId, setRevisionsGrantId] = useState(""), [revisionsRequestId, setRevisionsRequestId] = useState("");
  const pinRef = useRef(""), pairCandidate = useRef<ManagementPairDisplay | null>(null), secretEpoch = useRef(0), secretTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSecrets = useCallback((render = true) => { secretEpoch.current++; pinRef.current = ""; pairCandidate.current = null;
    if (secretTimer.current) clearTimeout(secretTimer.current); secretTimer.current = null;
    if (render) { setPinValue(""); setPairDisplay(null); } }, []);
  const armSecretTimer = useCallback((ms = MANAGEMENT_CREDENTIAL_SECRET_MS) => { if (secretTimer.current) clearTimeout(secretTimer.current);
    secretTimer.current = setTimeout(() => { if (mounted.current) flushSync(() => clearSecrets()); else clearSecrets(false); }, Math.max(0, ms)); }, [clearSecrets]);
  const [revokeReason, setRevokeReason] = useState(""), [revokeAck, setRevokeAck] = useState(false);
  const [grantLookup, setGrantLookup] = useState(""), [filter, setFilter] = useState<"all" | "granted" | "revoked">("all");
  const [readQuery, setReadQuery] = useState<m.ManagementDelegationQuery | a.DelegatedAuditQuery | g.DelegatedGroupsQuery | cfg.DelegatedConfigurationQuery | rules.DelegatedRulesQuery | credentials.DelegatedCredentialsQuery | revisions.DelegatedRevisionsQuery | null>(null);
  const [downloadContext, setDownloadContext] = useState<Readonly<{ result: a.DelegatedAuditExport; query: a.DelegatedAuditExportQuery; command: a.DelegatedAuditCommand }> | null>(null);
  const latest = useRef({ state, grantDraft, auditDraft, groupsGrantDraft, groupsDraft, groupsGrantId, configurationGrantDraft, configurationDraft, configurationGrantId, rulesGrantDraft, rulesGrantId, rulesContext, rulesDraft, rulesEvidence, credentialsGrantDraft, credentialsDraft, credentialsGrantId, credentialsDomain, revisionsGrantDraft, revisionsDraft, revisionsGrantId, revisionsRequestId, readQuery, revokeReason, revokeAck, downloadContext });
  latest.current = { state, grantDraft, auditDraft, groupsGrantDraft, groupsDraft, groupsGrantId, configurationGrantDraft, configurationDraft, configurationGrantId, rulesGrantDraft, rulesGrantId, rulesContext, rulesDraft, rulesEvidence, credentialsGrantDraft, credentialsDraft, credentialsGrantId, credentialsDomain, revisionsGrantDraft, revisionsDraft, revisionsGrantId, revisionsRequestId, readQuery, revokeReason, revokeAck, downloadContext };
  const occupied = useCallback(() => { try { return (storage ?? (() => sessionStorage))().getItem(client.storageKey) !== null; } catch { return true; } }, [client, storage]);
  const clearBody = useCallback((keepRules = false) => { setReadQuery(null); setDownloadContext(null); setNotice(""); clearSecrets(); setCredentialsDraft(emptyCredentials());
    setRevisionsDraft(emptyRevisions());
    if (!keepRules) { setRulesContext(null); setRulesDraft(null); setRulesEvidence(null); } }, [clearSecrets]);
  const clearAll = useCallback(() => { clearBody(); setGrantDraft(emptyGrant()); setAuditDraft(emptyAudit()); setRevokeReason(""); setRevokeAck(false);
    setGroupsGrantDraft(emptyGroupsGrant()); setGroupsDraft(emptyGroups()); setGroupsGrantId("");
    setConfigurationGrantDraft(emptyConfigurationGrant()); setConfigurationDraft(null); setConfigurationGrantId("");
    setRulesGrantDraft(emptyRulesGrant()); setRulesGrantId(""); setRulesContext(null); setRulesDraft(null); setRulesEvidence(null);
    setCredentialsGrantDraft(emptyCredentialsGrant()); setCredentialsDraft(emptyCredentials()); setCredentialsGrantId(""); setCredentialsDomain("terminals");
    setRevisionsGrantDraft(emptyRevisionsGrant()); setRevisionsDraft(emptyRevisions()); setRevisionsGrantId(""); setRevisionsRequestId(""); setGrantLookup(""); setFilter("all"); dirty.current = false; }, [clearBody]);
  const pause = useCallback(() => { epoch.current++; working.current = false; writeKind.current = null; client.pause(); clearAll(); setInitialized(false); }, [client, clearAll]);
  // React may replay layout setup/cleanup with this same memoized client.
  // Pause invalidates every lease without permanently disabling the next setup.
  const suspend = useCallback(() => { clearSecrets(false); writeKind.current = null; suspendManagementDelegatedWorkspace({ mounted, working, epoch }, client); }, [client, clearSecrets]);
  const leave = useCallback(() => {
    if ((working.current || dirty.current || client.hasLeaveRisk()) && !window.confirm("仍有草稿或待确认原编号。离开会清除正文和草稿，保留原编号，不重发。确定离开？")) return false;
    pause(); return true;
  }, [client, pause]);
  const initialize = useCallback(async () => {
    if (!current() || working.current) return; const token = epoch.current; working.current = true;
    try { await client.initialize(); if (current() && token === epoch.current) setInitialized(true); }
    catch { if (current() && token === epoch.current) { setInitialized(false); setNotice("本地原编号无法核实，保留原内容，禁止新操作。"); } }
    finally { if (token === epoch.current) working.current = false; }
  }, [client, current]);
  useLayoutEffect(() => {
    // Cleanup drops refs even when React is replaying this same instance;
    // layout setup also clears the mounted inputs/display before paint.
    clearSecrets();
    mounted.current = true; visible.current = !document.hidden; void initialize(); registerLeaveGuard?.(leave);
    const hide = () => { if (document.hidden) { visible.current = false; flushSync(pause); } else visible.current = true; };
    const pagehide = () => { visible.current = false; flushSync(pause); };
    const unload = (event: BeforeUnloadEvent) => { if (working.current || dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", pagehide); window.addEventListener("beforeunload", unload);
    return () => { suspend(); registerLeaveGuard?.(null);
      document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", pagehide); window.removeEventListener("beforeunload", unload); };
  }, [client, initialize, leave, pause, registerLeaveGuard, suspend, clearSecrets]);
  const ready = () => current() && initialized && !working.current && !occupied() && !["blocked", "unconfirmed", "saving", "loading"].includes(latest.current.state.phase);
  const read = async (domain: "management" | "audit" | "groups" | "configuration" | "rules" | "terminals" | "pin" | "revisions", query: m.ManagementDelegationQuery | a.DelegatedAuditQuery | g.DelegatedGroupsQuery | cfg.DelegatedConfigurationQuery | rules.DelegatedRulesQuery | credentials.DelegatedCredentialsQuery | revisions.DelegatedRevisionsQuery) => {
    if (!ready()) return; const token = epoch.current; working.current = true; clearBody(domain === "rules" && query.mode !== "context");
    if (domain !== "rules" || query.mode === "context") { setRulesContext(null); setRulesDraft(null); } setRulesEvidence(null);
    try { if (domain === "management") await client.readManagement(query as m.ManagementDelegationQuery);
      else if (domain === "audit") await client.readAudit(query as a.DelegatedAuditQuery);
      else if (domain === "groups") { const value = await client.readGroups(query as g.DelegatedGroupsQuery);
        if (current() && token === epoch.current && value.protocol === g.DELEGATED_GROUPS_PROTOCOL && value.kind === "context")
          setGroupsDraft({ ...emptyGroups(), name: value.context.group?.name ?? "", description: value.context.group?.description ?? "", active: value.context.group?.active ?? true }); }
      else if (domain === "configuration") { const value = await client.readConfiguration(query as cfg.DelegatedConfigurationQuery);
        if (current() && token === epoch.current && value.protocol === cfg.DELEGATED_CONFIGURATION_PROTOCOL && value.kind === "context")
          setConfigurationDraft(managementConfigurationDraftFromContext(value)); }
      else if (domain === "terminals" || domain === "pin") { const value = domain === "terminals" ? await client.readTerminals(query as credentials.DelegatedCredentialsQuery) : await client.readPin(query as credentials.DelegatedCredentialsQuery);
        if (current() && token === epoch.current && value.protocol === credentials.DELEGATED_TERMINALS_PROTOCOL && value.kind === "context") setCredentialsDraft({ ...emptyCredentials(), label: value.context.terminal?.label ?? "" }); }
      else if (domain === "revisions") await client.readRevisions(revisions.parseDelegatedRevisionsQuery(query));
      else { const value = await client.readRules(query as rules.DelegatedRulesQuery);
        if (current() && token === epoch.current && value.protocol === rules.DELEGATED_RULES_PROTOCOL) {
          if (value.kind === "context") { setRulesContext(value); setRulesDraft(managementRulesDraftFromContext(value)); setRulesEvidence(null); dirty.current = false; }
          else if (value.kind === "preview" || value.kind === "history") { setRulesEvidence({ query: query as rules.DelegatedRulesQuery, result: value });
            setRulesDraft(draft => draft ? { ...draft, acknowledged: false, targetRevision: null } : null); }
        } }
      if (current() && token === epoch.current) setReadQuery(query);
    } catch { if (current() && token === epoch.current) setNotice("读取失败不代表没有记录；请核实当前授权后明确重读。"); }
    finally { if (token === epoch.current) working.current = false; }
  };
  const recover = async () => {
    if (!current() || working.current) return; const token = epoch.current; working.current = true; clearBody();
    setRulesContext(null); setRulesDraft(null); setRulesEvidence(null);
    try { await client.recover(); if (current() && token === epoch.current) setInitialized(true); }
    catch { if (current() && token === epoch.current) setNotice("原操作仍未确认。保留完整原编号，只读核验，不重新发送。"); }
    finally { if (token === epoch.current) working.current = false; }
  };
  const send = (kind: Exclude<ManagementDelegatedWriteKind, null | "configuration" | "rules" | "terminals" | "pin" | "revisions">) => {
    if (!ready() || !managementDelegatedWriteAllowed(kind, ownerMode, grantEnabled, auditEnabled, groupsEnabled, configurationEnabled, rulesEnabled, terminalsEnabled, pinEnabled, revisionsEnabled)) return;
    const snapshot = latest.current, token = epoch.current;
    const draftSnapshot = (value: typeof snapshot) => same([value.grantDraft, value.auditDraft, value.groupsGrantDraft, value.groupsDraft, value.groupsGrantId, value.configurationGrantDraft, value.configurationDraft, value.configurationGrantId, value.rulesGrantDraft, value.rulesGrantId, value.rulesContext, value.rulesDraft, value.rulesEvidence, value.credentialsGrantDraft, value.credentialsDraft, value.credentialsGrantId, value.credentialsDomain, value.revisionsGrantDraft, value.revisionsDraft, value.revisionsGrantId, value.revisionsRequestId, value.readQuery, value.revokeReason, value.revokeAck]);
    const frozen = draftSnapshot(snapshot);
    const result = snapshot.state.result; let command: m.ManagementDelegationCommand | a.DelegatedAuditCommand | GroupsCommand;
    let exportQuery: a.DelegatedAuditExportQuery | null = null, groupsQuery: g.DelegatedGroupsQuery | null = null;
    try {
      if (kind === "grant" || kind === "groups-grant" || kind === "configuration-grant" || kind === "rules-grant" || kind === "terminals-grant" || kind === "pin-grant" || kind === "revisions-grant") {
        if (result?.protocol !== m.MANAGEMENT_DELEGATION_PROTOCOL || result.kind === "receipt" || !result.canGrant) return;
        command = kind === "grant" ? buildManagementAuditGrant(snapshot.grantDraft, crypto.randomUUID()) : kind === "groups-grant"
          ? buildManagementGroupsGrant(snapshot.groupsGrantDraft, crypto.randomUUID()) : kind === "rules-grant"
            ? rulesGrantFromForm(snapshot.rulesGrantDraft, crypto.randomUUID()) : kind === "terminals-grant" || kind === "pin-grant"
              ? credentialsGrantFromForm(snapshot.credentialsGrantDraft, crypto.randomUUID()) : kind === "revisions-grant"
                ? buildManagementRevisionsGrant(snapshot.revisionsGrantDraft, crypto.randomUUID()) : managementConfigurationGrantFromForm(snapshot.configurationGrantDraft, crypto.randomUUID());
        if ((kind === "terminals-grant" || kind === "pin-grant") && command.action === "grant"
          && command.delegatedAction.startsWith("terminal_") !== (kind === "terminals-grant")) return;
      } else if (kind === "revoke") {
        if (result?.protocol !== m.MANAGEMENT_DELEGATION_PROTOCOL || result.kind !== "detail" || result.item.status !== "granted" || !snapshot.revokeAck) return;
        command = m.parseManagementDelegationCommand({ action: "revoke", operationId: crypto.randomUUID(), grantId: result.item.grantId, expectedRevision: 1, reason: snapshot.revokeReason.trim() });
      } else if (kind === "groups") {
        if (result?.protocol !== g.DELEGATED_GROUPS_PROTOCOL || result.kind !== "context" || result.grantId !== snapshot.groupsGrantId
          || snapshot.readQuery?.mode !== "context" || snapshot.readQuery.grantId !== result.grantId || snapshot.readQuery.siteId !== siteId) return;
        groupsQuery = managementGroupsContextQuery(siteId, result.grantId);
        command = buildManagementGroupsCommand(result, snapshot.groupsDraft, crypto.randomUUID());
      } else {
        const q = managementAuditListQuery(siteId, snapshot.auditDraft); exportQuery = { siteId, grantId: q.grantId, mode: "export", source: q.source, fromAt: q.fromAt, toAt: q.toAt };
        command = a.parseDelegatedAuditCommand({ action: "export", operationId: crypto.randomUUID() });
      }
    } catch { setNotice("请核对真实双身份、地点、明确来源、UTC时间范围、理由和确认勾选；尚未发送。"); return; }
    const unchanged = () => ready() && epoch.current === token && latest.current.state.result === result
      && draftSnapshot(latest.current) === frozen;
    confirmManagementDelegatedAction(() => window.confirm(kind === "grant" ? "授予已核实真实员工的明确审计范围。此操作不授其他管理执行权。确认只提交一次？"
      : kind === "groups-grant" ? "只授予已核验的指定组动作与精确资源范围，不授其他员工或组的管理权。确认只提交一次？"
        : kind === "configuration-grant" ? "只授予已核验的指定员工档案或工作地点保存权，范围和双身份固定，不授其他配置权。确认只提交一次？"
        : kind === "rules-grant" ? "只授予显示的一个规则动作、固定层级与允许规则键；不授审批、打卡或自动消费权限。确认只提交一次？"
        : kind === "terminals-grant" || kind === "pin-grant" ? "仅授此终端／人员身份的一个明确动作。编号必须已核验，不授目录、其他身份或打卡权限。确认只提交一次？"
        : kind === "revisions-grant" ? "只授予此员工双身份与地点范围内的一个连续修订批准或驳回动作，待办口径按明确勾选保存。不授撤销决定或其他审批权。确认只提交一次？"
        : kind === "revoke" ? "撤销此明确授权，保留历史与原号回执。确认只提交一次？"
          : kind === "groups" ? "按当前授权、双身份、日期与版本执行此一个组动作。结果未知时仅 GET 原号核验，不重发。确认只提交一次？"
            : "生成最多250条的审计导出并保存导出回执。确认只提交一次？"), unchanged, () => {
      working.current = true; writeKind.current = kind === "revoke" ? null : kind; clearBody(); dirty.current = false;
      setGrantDraft(emptyGrant()); setGroupsGrantDraft(emptyGroupsGrant()); setGroupsDraft(emptyGroups());
      setConfigurationGrantDraft(emptyConfigurationGrant()); setConfigurationDraft(null); setRevokeReason(""); setRevokeAck(false);
      setRulesGrantDraft(emptyRulesGrant()); setRulesDraft(null); setRulesContext(null); setRulesEvidence(null);
      setCredentialsGrantDraft(emptyCredentialsGrant()); setCredentialsDraft(emptyCredentials());
      setRevisionsGrantDraft(emptyRevisionsGrant()); setRevisionsDraft(emptyRevisions());
      void (async () => { try {
        if (kind === "export" && exportQuery) { const c = command as a.DelegatedAuditCommand, value = await client.submitAudit(exportQuery, c);
          if (current() && token === epoch.current && value.protocol === a.DELEGATED_AUDIT_PROTOCOL && value.kind === "export") setDownloadContext({ result: value, query: exportQuery, command: c });
        } else if (kind === "groups" && groupsQuery) await client.submitGroups(groupsQuery, command as GroupsCommand);
        else await client.submitManagement(command as m.ManagementDelegationCommand);
      } catch { if (current() && token === epoch.current) setNotice("结果未确认；原编号若已保存则继续保留，请仅 GET 核验，不重发。"); }
      finally { if (token === epoch.current) { working.current = false; writeKind.current = null; } } })();
    });
  };
  const sendConfiguration = async () => {
    if (!ready() || !configurationEnabled) return;
    const snapshot = latest.current, token = epoch.current, result = snapshot.state.result;
    if (result?.protocol !== cfg.DELEGATED_CONFIGURATION_PROTOCOL || result.kind !== "context" || !snapshot.configurationDraft
      || result.grantId !== snapshot.configurationGrantId || snapshot.readQuery?.mode !== "context"
      || snapshot.readQuery.siteId !== siteId || snapshot.readQuery.grantId !== result.grantId) return;
    const draftSnapshot = (value: typeof snapshot) => same([value.grantDraft, value.auditDraft, value.groupsGrantDraft, value.groupsDraft, value.groupsGrantId,
      value.configurationGrantDraft, value.configurationDraft, value.configurationGrantId, value.rulesGrantDraft, value.rulesGrantId, value.rulesContext, value.rulesDraft, value.rulesEvidence, value.credentialsGrantDraft, value.credentialsDraft, value.credentialsGrantId, value.credentialsDomain, value.revisionsGrantDraft, value.revisionsDraft, value.revisionsGrantId, value.revisionsRequestId, value.readQuery, value.revokeReason, value.revokeAck]);
    const query = managementConfigurationContextQuery(siteId, result.grantId), frozen = draftSnapshot(snapshot);
    const unchanged = () => ready() && configurationEnabled && epoch.current === token && latest.current.state.result === result
      && draftSnapshot(latest.current) === frozen;
    working.current = true;
    try {
      const command = await buildManagementConfigurationCommand(result, query, actorId, snapshot.configurationDraft, crypto.randomUUID());
      if (!current() || token !== epoch.current) return; working.current = false;
      if (!confirmManagementDelegatedAction(() => window.confirm("只保存当前授权的指定资源，目标与员工身份及全局配置版本来自刚读取的上下文。结果未知时仅 GET 原号核验，不重发。确认只提交一次？"), unchanged, () => {
        working.current = true; writeKind.current = "configuration"; clearBody(); dirty.current = false;
        setGrantDraft(emptyGrant()); setGroupsGrantDraft(emptyGroupsGrant()); setGroupsDraft(emptyGroups());
        setConfigurationGrantDraft(emptyConfigurationGrant()); setConfigurationDraft(null); setRevokeReason(""); setRevokeAck(false);
        setRulesGrantDraft(emptyRulesGrant()); setRulesDraft(null); setRulesContext(null); setRulesEvidence(null);
      })) return;
      await client.submitConfiguration(query, command);
    } catch { if (current() && token === epoch.current) setNotice("配置结果尚未确认；请核对刚读取的范围、必填内容和确认勾选。原编号若已保存则继续保留，仅 GET 核验，不重发。"); }
    finally { if (token === epoch.current) { working.current = false; writeKind.current = null; } }
  };
  const sendRules = async () => {
    if (!ready() || !rulesEnabled) return;
    const snapshot = latest.current, token = epoch.current, context = snapshot.rulesContext;
    if (!context || !snapshot.rulesDraft || context.grantId !== snapshot.rulesGrantId || context.siteId !== siteId
      || snapshot.state.result !== (snapshot.rulesEvidence?.result ?? context)) return;
    const query = managementRulesContextQuery(siteId, context.grantId);
    const draftSnapshot = (value: typeof snapshot) => same([value.grantDraft, value.auditDraft, value.groupsGrantDraft, value.groupsDraft,
      value.configurationGrantDraft, value.configurationDraft, value.rulesGrantDraft, value.rulesGrantId, value.rulesDraft, value.rulesEvidence, value.credentialsGrantDraft, value.credentialsDraft, value.credentialsGrantId, value.credentialsDomain, value.revisionsGrantDraft, value.revisionsDraft, value.revisionsGrantId, value.revisionsRequestId, value.readQuery, value.revokeReason, value.revokeAck]);
    const frozen = draftSnapshot(snapshot), result = snapshot.state.result;
    const unchanged = () => ready() && rulesEnabled && token === epoch.current && latest.current.rulesContext === context
      && latest.current.state.result === result && draftSnapshot(latest.current) === frozen;
    working.current = true;
    try {
      const command = await buildManagementRulesCommand(context, query, actorId, snapshot.rulesDraft, crypto.randomUUID(), snapshot.rulesEvidence);
      if (!current() || token !== epoch.current) return; working.current = false;
      if (!confirmManagementDelegatedAction(() => window.confirm(`${delegatedRuleActionLabels[context.action]}：仅执行此授权的一个动作。未授权规则值保持原样，登记不代表业务已消费。结果未知时只 GET 原号，不重发。确认只提交一次？`), unchanged, () => {
        working.current = true; writeKind.current = "rules"; clearBody(); dirty.current = false;
        setRulesDraft(null); setRulesContext(null); setRulesEvidence(null); setRulesGrantDraft(emptyRulesGrant());
        setGrantDraft(emptyGrant()); setGroupsGrantDraft(emptyGroupsGrant()); setGroupsDraft(emptyGroups()); setConfigurationGrantDraft(emptyConfigurationGrant()); setConfigurationDraft(null);
      })) return;
      await client.submitRules(query, command);
    } catch { if (current() && token === epoch.current) setNotice("规则操作未确认；请核对当前授权、允许键、刚读取的版本与预览／历史。未发送的不保存；已保存原编号仅 GET 核验，不重发。"); }
    finally { if (token === epoch.current) { working.current = false; writeKind.current = null; } }
  };
  const sendRevisions = async () => {
    if (!ready() || !revisionsEnabled) return;
    const snapshot = latest.current, token = epoch.current, context = snapshot.state.result;
    if (context?.protocol !== revisions.DELEGATED_REVISIONS_PROTOCOL || context.kind !== "context"
      || context.grantId !== snapshot.revisionsGrantId || context.context.review.requestId !== snapshot.revisionsRequestId
      || snapshot.readQuery?.mode !== "context" || !("requestId" in snapshot.readQuery)
      || snapshot.readQuery.siteId !== siteId || snapshot.readQuery.grantId !== context.grantId || snapshot.readQuery.requestId !== snapshot.revisionsRequestId) return;
    const query = managementRevisionsContextQuery(siteId, context.grantId, snapshot.revisionsRequestId);
    const frozen = (value: typeof snapshot) => same([value.grantDraft, value.auditDraft, value.groupsGrantDraft, value.groupsDraft, value.groupsGrantId,
      value.configurationGrantDraft, value.configurationDraft, value.configurationGrantId, value.rulesGrantDraft, value.rulesGrantId, value.rulesContext, value.rulesDraft, value.rulesEvidence,
      value.credentialsGrantDraft, value.credentialsDraft, value.credentialsGrantId, value.credentialsDomain, value.revisionsGrantDraft, value.revisionsDraft, value.revisionsGrantId, value.revisionsRequestId, value.readQuery, value.revokeReason, value.revokeAck]);
    const original = frozen(snapshot), unchanged = () => ready() && revisionsEnabled && token === epoch.current
      && latest.current.state.result === context && frozen(latest.current) === original;
    working.current = true;
    try {
      const command = await buildManagementRevisionsCommand(context, query, actorId, snapshot.revisionsDraft, crypto.randomUUID());
      if (!current() || token !== epoch.current) return; working.current = false;
      if (!confirmManagementDelegatedAction(() => window.confirm(`${delegatedRevisionActionLabels[context.action]}：已核对原始记录、提交时核定前驱和员工声明。只执行此授权动作，不撤销决定。结果未知时仅 GET 原编号，不重发。确认只提交一次？`), unchanged, () => {
        working.current = true; writeKind.current = "revisions"; clearAll();
      })) return;
      await client.submitRevisions(query, command);
    } catch { if (current() && token === epoch.current) setNotice("修订决定未确认；请核对当前精确授权、原始记录、基准与理由。已保存原编号仅 GET 核验，不重新发送。"); }
    finally { if (token === epoch.current) { working.current = false; writeKind.current = null; } }
  };
  const sendCredentials = async () => {
    if (!ready()) return; const snapshot = latest.current, token = epoch.current, context = snapshot.state.result, domain = snapshot.credentialsDomain;
    if (context?.kind !== "context" || (domain === "terminals" ? context.protocol !== credentials.DELEGATED_TERMINALS_PROTOCOL : context.protocol !== credentials.DELEGATED_PIN_PROTOCOL)
      || context.grantId !== snapshot.credentialsGrantId || snapshot.readQuery?.mode !== "context" || snapshot.readQuery.siteId !== siteId || snapshot.readQuery.grantId !== context.grantId
      || !managementDelegatedWriteAllowed(domain, ownerMode, grantEnabled, auditEnabled, groupsEnabled, configurationEnabled, rulesEnabled, terminalsEnabled, pinEnabled)
      || !snapshot.credentialsDraft.acknowledged || !snapshot.credentialsDraft.reason.trim()) return;
    if (context.protocol !== credentials.DELEGATED_TERMINALS_PROTOCOL && context.protocol !== credentials.DELEGATED_PIN_PROTOCOL) return;
    const query = managementCredentialsQuery(siteId, context.grantId), operationId = crypto.randomUUID(),
      frozen = (value: typeof snapshot) => same([value.grantDraft, value.auditDraft, value.groupsGrantDraft, value.groupsDraft, value.configurationGrantDraft, value.configurationDraft,
        value.rulesGrantDraft, value.rulesDraft, value.rulesEvidence, value.credentialsGrantDraft, value.credentialsDraft, value.credentialsGrantId, value.credentialsDomain, value.revisionsGrantDraft, value.revisionsDraft, value.revisionsGrantId, value.revisionsRequestId, value.readQuery, value.revokeReason, value.revokeAck]),
      original = frozen(snapshot), initialSecretEpoch = secretEpoch.current;
    let pin = pinRef.current, pairSecret = "";
    if (context.action === "pin_issue" && !/^[0-9]{8,12}$/.test(pin) || context.action === "terminal_prepare" && !snapshot.credentialsDraft.label.trim()) return;
    const unchanged = () => ready() && current() && token === epoch.current && latest.current.state.result === context && frozen(latest.current) === original && secretEpoch.current === initialSecretEpoch;
    if (!confirmManagementDelegatedAction(() => window.confirm(`${delegatedCredentialActionLabels[context.action]}：仅使用刚读取的精确身份和当前版本，秘密只发送一次且不保存在原号槽。结果未知时只 GET 核验，不重发。确认只提交一次？`), unchanged, () => { working.current = true; writeKind.current = domain; })) return;
    //Clear visible PIN immediately on confirmation. JS drops references; it
    //cannot promise physical zeroization of strings or the browser transport.
    flushSync(() => clearSecrets()); let candidate: ManagementPairDisplay | null = null;
    const dispatchSecretEpoch = secretEpoch.current;
    const dispatchCurrent = () => current() && token === epoch.current && latest.current.state.result === context && frozen(latest.current) === original
      && secretEpoch.current === dispatchSecretEpoch && managementDelegatedWriteAllowed(domain, ownerMode, grantEnabled, auditEnabled, groupsEnabled, configurationEnabled, rulesEnabled, terminalsEnabled, pinEnabled);
    try {
      if (context.action === "terminal_prepare" && context.protocol === credentials.DELEGATED_TERMINALS_PROTOCOL) {
        pairSecret = newManagementPairSecret(); candidate = managementPairDisplay(siteId, context.scope.terminalId, operationId, pairSecret, Date.now());
        pairCandidate.current = candidate; armSecretTimer();
      }
      const body = context.protocol === credentials.DELEGATED_TERMINALS_PROTOCOL
        ? await buildManagementTerminalBody(context, query, actorId, snapshot.credentialsDraft, operationId, context.action === "terminal_prepare" ? pairSecret : undefined)
        : await buildManagementPinBody(context, query, actorId, snapshot.credentialsDraft, operationId, context.action === "pin_issue" ? pin : undefined);
      pin = ""; pairSecret = ""; if (!dispatchCurrent()) { clearSecrets(); return; }
      if (candidate && !managementPairDisplayCurrent(pairCandidate.current, operationId, Date.now())) { clearSecrets(); return; }
      setReadQuery(null); setDownloadContext(null); setNotice(""); setRulesContext(null); setRulesDraft(null); setRulesEvidence(null); setCredentialsDraft(emptyCredentials()); dirty.current = false;
      const result = "pairSecret" in body ? await client.submitTerminalPrepare(credentials.parseDelegatedTerminalPrepareEphemeralBody(body)) : "pin" in body ? await client.submitPinIssue(credentials.parseDelegatedPinIssueEphemeralBody(body))
        : body.command.action === "terminal_revoke" ? await client.submitTerminalRevoke(credentials.parseDelegatedTerminalBody(body))
          : await client.submitPinRevoke(credentials.parseDelegatedPinBody(body));
      if (candidate && current() && token === epoch.current && pairCandidate.current === candidate && managementPairDisplayCurrent(candidate, operationId, Date.now())
        && result.protocol === credentials.DELEGATED_TERMINALS_PROTOCOL && result.kind === "receipt" && result.receipt?.operationId === operationId) setPairDisplay(candidate);
    } catch { clearSecrets(); if (current() && token === epoch.current) setNotice("结果未确认；秘密不会保存或重新发送。保留非秘密原编号，仅 GET 核验；配对码丢失时须有权者明确撤销后重新授权准备。"); }
    finally { pin = ""; pairSecret = ""; if (token === epoch.current) { working.current = false; writeKind.current = null; } }
  };
  const download = async () => {
    const context = latest.current.downloadContext, token = epoch.current;
    if (!context || !current() || working.current || latest.current.state.result !== context.result) return;
    working.current = true;
    try {
      const exported = await a.buildDelegatedAuditCsv(context.result, context.query, actorId, context.command);
      if (!current() || token !== epoch.current || latest.current.downloadContext !== context || latest.current.state.result !== context.result) return;
      const url = URL.createObjectURL(new Blob([exported.csv], { type: "text/csv;charset=utf-8" }));
      try { if (!current() || token !== epoch.current || latest.current.downloadContext !== context) return;
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = exported.filename; anchor.click(); anchor.remove();
      } finally { URL.revokeObjectURL(url); }
    } catch { if (current() && token === epoch.current) setNotice("导出正文未能完整核验，未下载；原编号仍保留。"); }
    finally { if (token === epoch.current) working.current = false; }
  };
  const changeAudit = (next: AuditDraft) => { dirty.current = true; epoch.current++; client.pause(); clearBody(); setAuditDraft(next); };
  const changeGroupsGrantId = (next: string) => { dirty.current = true; epoch.current++; client.pause(); clearBody(); setGroupsGrantId(next); setGroupsDraft(emptyGroups()); };
  const changeConfigurationGrantId = (next: string) => { dirty.current = true; epoch.current++; client.pause(); clearBody(); setConfigurationGrantId(next); setConfigurationDraft(null); };
  const changeRulesGrantId = (next: string) => { dirty.current = true; epoch.current++; client.pause(); clearBody(); setRulesGrantId(next); setRulesContext(null); setRulesDraft(null); setRulesEvidence(null); };
  const changeCredentialsSelection = (domain: "terminals" | "pin", grantId: string) => { dirty.current = true; epoch.current++; client.pause(); clearBody(); setCredentialsDomain(domain); setCredentialsGrantId(grantId); };
  const changeRevisionsSelection = (grantId: string, requestId: string) => { dirty.current = true; epoch.current++; client.pause(); clearBody(); setRevisionsGrantId(grantId); setRevisionsRequestId(requestId); };
  const lock = !initialized || state.pending !== null || ["loading", "saving", "blocked", "unconfirmed"].includes(state.phase);
  const management = state.result?.protocol === m.MANAGEMENT_DELEGATION_PROTOCOL ? state.result : null;
  const audit = state.result?.protocol === a.DELEGATED_AUDIT_PROTOCOL ? state.result : null;
  const groups = state.result?.protocol === g.DELEGATED_GROUPS_PROTOCOL && state.result.kind === "context" ? state.result : null;
  const configuration = state.result?.protocol === cfg.DELEGATED_CONFIGURATION_PROTOCOL && state.result.kind === "context" ? state.result : null;
  const rulesHistory = rulesEvidence?.result.kind === "history" ? rulesEvidence.result : null;
  const rulesPreview = rulesEvidence?.result.kind === "preview" ? rulesEvidence.result : null;
  const credentialContext = (state.result?.protocol === credentials.DELEGATED_TERMINALS_PROTOCOL || state.result?.protocol === credentials.DELEGATED_PIN_PROTOCOL) && state.result.kind === "context" ? state.result : null;
  const revisionContext = state.result?.protocol === revisions.DELEGATED_REVISIONS_PROTOCOL && state.result.kind === "context" ? state.result : null;
  const updateGrant = (patch: Partial<ManagementAuditGrantDraft>) => { dirty.current = true; setGrantDraft(value => ({ ...value, ...patch })); };
  const updateGroupsGrant = (patch: Partial<ManagementGroupsGrantDraft>) => { dirty.current = true; setGroupsGrantDraft(value => ({ ...value, ...patch })); };
  const updateGroups = (patch: Partial<ManagementGroupsDraft>) => { dirty.current = true; setGroupsDraft(value => ({ ...value, ...patch })); };
  const updateConfigurationGrant = (patch: Partial<ManagementConfigurationGrantForm>) => { dirty.current = true; setConfigurationGrantDraft(value => ({ ...value, ...patch })); };
  const updateRulesGrant = (patch: Partial<ManagementRulesGrantForm>) => { dirty.current = true; setRulesGrantDraft(value => ({ ...value, ...patch })); };
  const updateRules = (patch: Partial<ManagementRulesCommandDraft>) => { dirty.current = true; setRulesDraft(value => value ? { ...value, ...patch } : value); };
  const updateCredentialsGrant = (patch: Partial<ManagementCredentialsGrantForm>) => { clearSecrets(); dirty.current = true; setCredentialsGrantDraft(value => ({ ...value, ...patch })); };
  const updateCredentials = (patch: Partial<ManagementCredentialDraft>) => { dirty.current = true; setCredentialsDraft(value => ({ ...value, ...patch })); };
  const updateRevisionsGrant = (patch: Partial<ManagementRevisionsGrantForm>) => { dirty.current = true; setRevisionsGrantDraft(value => ({ ...value, acknowledged: false, ...patch })); };
  const updateRevisions = (patch: Partial<ManagementRevisionsDraft>) => { dirty.current = true; setRevisionsDraft(value => ({ ...value, acknowledged: false, ...patch })); };
  const changePin = (value: string) => { clearSecrets(); pinRef.current = value; setPinValue(value); dirty.current = true; setCredentialsDraft(value => ({ ...value, acknowledged: false })); if (value) armSecretTimer(); };
  const updateConfigurationWorker = (patch: Partial<Extract<ManagementConfigurationCommandDraft, { kind: "worker" }>>) => {
    dirty.current = true; setConfigurationDraft(value => value?.kind === "worker" ? { ...value, ...patch } : value); };
  const updateConfigurationLocation = (patch: Partial<Extract<ManagementConfigurationCommandDraft, { kind: "location" }>>) => {
    dirty.current = true; setConfigurationDraft(value => value?.kind === "location" ? { ...value, ...patch } : value); };
  const readGroupsContext = () => { try { void read("groups", managementGroupsContextQuery(siteId, groupsGrantId)); } catch { setNotice("请填写真实组管理授权编号；不提供全商户组或人员枚举。"); } };
  const readConfigurationContext = () => { try { void read("configuration", managementConfigurationContextQuery(siteId, configurationGrantId)); }
    catch { setNotice("请填写真实档案／地点授权编号；只读取此授权的指定目标，不提供全商户目录。"); } };
  const readRulesContext = () => { try { void read("rules", managementRulesContextQuery(siteId, rulesGrantId)); }
    catch { setNotice("请填写真实规则授权编号；不提供跨授权目录或负责人代理路径。"); } };
  const readRulesHistory = () => { try { void read("rules", rules.parseDelegatedRulesQuery({ siteId, grantId: rulesGrantId, mode: "history", cursor: null })); }
    catch { setNotice("请核对真实规则授权编号。"); } };
  const previewRules = () => { try { if (rulesContext && rulesDraft) void read("rules", managementRulesPreviewQuery(rulesContext, rulesDraft.effectiveOn, rulesDraft.endsOn)); }
    catch { setNotice("请先读取运营发布授权和已保存草稿，再明确填写未来日期；个人层必须有截止日。"); } };
  const listAudit = () => { try { void read("audit", managementAuditListQuery(siteId, auditDraft)); } catch { setNotice("请填写真实授权编号及不超过31天的UTC时间范围。"); } };
  const readCredentialsContext = () => { try { void read(credentialsDomain, managementCredentialsQuery(siteId, credentialsGrantId)); }
    catch { setNotice("请填写此一个终端或 PIN 的真实授权编号；只读取该精确范围，不提供全商户目录。"); } };
  const readRevisionsContext = () => { try { void read("revisions", managementRevisionsContextQuery(siteId, revisionsGrantId, revisionsRequestId)); }
    catch { setNotice("请填写真实连续修订授权与申请编号；只读取该授权范围内的此一个待审批申请，不提供全商户目录。"); } };
  return <section className="min-w-0 space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">管理委托／资源审计与指定资源</h2><p className="mt-2 text-sm text-slate-600">提供审计、指定组四动作、档案／地点保存、规则八动作、指定终端／PIN四动作及指定连续修订批准／驳回。规则登记不代表业务已采用，也不授审批或打卡权限；修订审批需独立精确授权。其他管理能力尚未接执行器。服务端每次重新核验真实权限。</p></div><button className={button} onClick={() => { if (leave()) onClose(); }}>关闭</button></header>
    {(!grantEnabled || !auditEnabled || !groupsEnabled || !configurationEnabled) && <p className="rounded-xl bg-amber-50 p-3 text-sm">新增授权和导出按各自开关独立开放（授权：{grantEnabled ? "已开放" : "未开放"}，导出：{auditEnabled ? "已开放" : "未开放"}，组执行：{groupsEnabled ? "已开放" : "未开放"}，档案／地点执行：{configurationEnabled ? "已开放" : "未开放"}）；新增组授权还须授权与组两个开关同时开放，新增档案／地点授权还须授权与配置两个开关同时开放。当前负责人可明确撤销，原号仍可 GET 核验。开关不授予任何权限。</p>}
    <p className="text-sm">规则执行：{rulesEnabled ? "已开放" : "未开放"}。新增规则授权须授权与规则两个开关同时开放；原编号 GET 核验不受新写开关影响。</p>
    <p className="text-sm">终端委托执行：{terminalsEnabled ? "已开放" : "未开放"}；PIN委托执行：{pinEnabled ? "已开放" : "未开放"}。新授权须授权开关与对应执行开关同时开放，委托撤销设备／PIN也需对应开关和当前授权；原号 GET 不受开关影响。紧急停用仍可使用原负责人入口。</p>
    <p className="text-sm">连续修订委托执行：{revisionsEnabled ? "已开放" : "未开放"}。新增修订授权须授权与修订两个开关同时开放；只有批准／驳回，无撤销决定。原号 GET 核验独立于新写开关。</p>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={state.phase === "loading" || state.phase === "saving"} onClick={() => void initialize()}>读取本地状态（不联网）</button><button className={button} disabled={state.phase === "loading" || state.phase === "saving"} onClick={() => void recover()}>仅 GET 核验原编号</button></div>
    {state.pending && <p className="break-all rounded-xl bg-amber-50 p-3 text-sm">待核验：{state.pending.domain} · {state.pending.domain === "rules" ? state.pending.command.decision.operationId : state.pending.command.operationId}。恢复仅返回最小回执，不重新下载正文。</p>}
    <p role="status" className="break-words rounded-xl bg-slate-100 p-3 text-sm">{notice || state.message}</p>
    {ownerMode && <section className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="font-bold">负责人：授权管理</h3>
      <fieldset disabled={lock} className="flex min-w-0 flex-wrap items-end gap-2"><label className="text-sm">状态<select className={field} value={filter} onChange={event => { setFilter(event.target.value as typeof filter); client.pause(); clearBody(); }}><option value="all">全部</option><option value="granted">已授予</option><option value="revoked">已撤销</option></select></label><button className={button} onClick={() => void read("management", { siteId, mode: "list", afterId: null, state: filter, delegatedAction: null })}>读取授权（每页25条）</button><label className="min-w-0 flex-1 text-sm">真实授权编号<input className={field} value={grantLookup} maxLength={36} onChange={event => { setGrantLookup(event.target.value); client.pause(); clearBody(); }}/></label><button className={button} onClick={() => { try { void read("management", m.parseManagementDelegationQuery({ siteId, mode: "detail", grantId: grantLookup })); } catch { setNotice("请填写真实授权编号。"); } }}>读取授权详情</button></fieldset>
      {management?.kind === "list" && <div className="space-y-2"><p className="text-sm">本页 {management.items.length} 条。</p>{management.items.map(item => <button className={`${button} block w-full break-all text-left`} key={item.grantId} disabled={lock} onClick={() => void read("management", { siteId, mode: "detail", grantId: item.grantId })}>{item.delegatedAction} · {item.status} · {item.grantId}</button>)}{management.nextId && readQuery?.mode === "list" && "afterId" in readQuery && <button className={button} disabled={lock} onClick={() => void read("management", { ...readQuery, afterId: management.nextId })}>下一页授权</button>}</div>}
      {management?.kind === "detail" && <article className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm"><p className="break-all">{management.item.delegatedAction} · {management.item.status} · {management.item.grantId}</p><p className="break-all">员工 {management.item.delegate.employeeId}／账户 {management.item.delegate.authUserId}</p><p className="break-all">{management.item.scope.kind} · {management.item.validFrom} 至 {management.item.validUntil}</p><p>当前资格观察：{management.item.authorityCurrent ? "有效（执行时仍重验）" : "当前不可用"}</p><p className="break-words">授权理由：{management.item.reason}</p>
        {(management.item.scope.kind === "audit_worker" || management.item.scope.kind === "audit_company") && <p className="break-words">明确来源：{management.item.scope.sources.map(source => sourceLabels[source]).join("、")}</p>}
        {management.item.scope.kind === "audit_worker" && <><p className="break-all">目标档案 {management.item.scope.workerId}／员工 {management.item.scope.employeeId}／账户 {management.item.scope.employeeAuthUserId}</p><p className="break-all">限定地点：{management.item.scope.locationIds.join("、")}</p></>}
        {(management.item.scope.kind === "group" || management.item.scope.kind === "group_worker") && <p className="break-all">指定组：{management.item.scope.groupId}{management.item.scope.kind === "group" && management.item.scope.create ? "（拟新建，不表示已经存在）" : ""}</p>}
        {management.item.scope.kind === "group_worker" && <><p className="break-all">指定档案 {management.item.scope.workerId}／员工 {management.item.scope.employeeId}／账户 {management.item.scope.employeeAuthUserId}</p><p className="break-all">分配：{management.item.scope.assignmentId ?? "只允许新分配"} · 限定地点：{management.item.scope.locationIds.join("、")}</p></>}
        {management.item.scope.kind === "worker" && <><p className="break-all">指定档案 {management.item.scope.workerId}（{management.item.scope.create ? "拟新建" : "已有"}）／员工 {management.item.scope.employeeId}／账户 {management.item.scope.employeeAuthUserId}</p><p className="break-all">仅允许地点：{management.item.scope.locationIds.join("、")}</p></>}
        {management.item.scope.kind === "location" && <p className="break-all">指定地点 {management.item.scope.locationId}（{management.item.scope.create ? "拟新建，不代表已经存在" : "已有"}）</p>}
        {management.item.status === "granted" && <fieldset disabled={lock} className="space-y-2"><label className="block">撤销理由<input className={field} maxLength={200} value={revokeReason} onChange={event => { dirty.current = true; setRevokeReason(event.target.value); }}/></label><label className="flex items-center gap-2"><input type="checkbox" checked={revokeAck} onChange={event => { dirty.current = true; setRevokeAck(event.target.checked); }}/>已核验此真实授权，明确撤销</label><button className={button} disabled={!revokeAck || !revokeReason.trim()} onClick={() => send("revoke")}>撤销此授权（一次提交）</button></fieldset>}
      </article>}
      <details><summary className="cursor-pointer font-semibold">授予审计权限（结构化表单）</summary><p className="my-3 text-sm text-amber-800">员工／账户标识须由负责人核验为真实双身份；这里不伪造候选，不接受手填 JSON。员工审计还须核验目标双身份和地点。授予查看不等于授予导出。</p>
        <fieldset disabled={lock || !grantEnabled || !management || management.kind === "receipt" || !management.canGrant} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="text-sm">被委托员工 ID<input className={field} maxLength={36} value={grantDraft.delegateEmployeeId} onChange={event => updateGrant({ delegateEmployeeId: event.target.value })}/></label><label className="text-sm">被委托账户 Auth ID<input className={field} maxLength={36} value={grantDraft.delegateAuthUserId} onChange={event => updateGrant({ delegateAuthUserId: event.target.value })}/></label>
          <label className="text-sm">明确动作<select className={field} value={grantDraft.delegatedAction} onChange={event => updateGrant({ delegatedAction: event.target.value as ManagementAuditGrantDraft["delegatedAction"] })}>{Object.entries(actionLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label className="text-sm">资源范围<select className={field} value={grantDraft.scopeKind} onChange={event => updateGrant({ scopeKind: event.target.value as ManagementAuditGrantDraft["scopeKind"], sources: grantDraft.sources.filter(source => event.target.value === "audit_worker" || source !== "scope") })}><option value="audit_company">企业审计</option><option value="audit_worker">指定员工审计</option></select></label>
          {grantDraft.scopeKind === "audit_worker" && <><label className="text-sm">目标打卡档案 Worker ID<input className={field} maxLength={36} value={grantDraft.workerId} onChange={event => updateGrant({ workerId: event.target.value })}/></label><label className="text-sm">目标员工 Employee ID<input className={field} maxLength={36} value={grantDraft.employeeId} onChange={event => updateGrant({ employeeId: event.target.value })}/></label><label className="text-sm">目标账户 Auth ID<input className={field} maxLength={36} value={grantDraft.employeeAuthUserId} onChange={event => updateGrant({ employeeAuthUserId: event.target.value })}/></label><label className="text-sm">真实地点 ID（1—25个，逗号或换行分隔）<textarea className={field} maxLength={1000} value={grantDraft.locationIds} onChange={event => updateGrant({ locationIds: event.target.value })}/></label></>}
          <div className="space-y-2 text-sm sm:col-span-2"><p>明确来源（不自动选中）</p>{(["config", "scope", "management"] as const).filter(source => grantDraft.scopeKind === "audit_worker" || source !== "scope").map(source => <label className="mr-4 inline-flex items-center gap-2" key={source}><input type="checkbox" checked={grantDraft.sources.includes(source)} onChange={event => updateGrant({ sources: event.target.checked ? [...grantDraft.sources, source] : grantDraft.sources.filter(value => value !== source) })}/>{sourceLabels[source]}</label>)}</div>
          <label className="text-sm">生效时间（UTC）<input type="datetime-local" step="1" className={field} value={grantDraft.validFrom} onChange={event => updateGrant({ validFrom: event.target.value })}/></label><label className="text-sm">失效时间（UTC，不含端点）<input type="datetime-local" step="1" className={field} value={grantDraft.validUntil} onChange={event => updateGrant({ validUntil: event.target.value })}/></label><label className="text-sm sm:col-span-2">授权理由<input className={field} maxLength={200} value={grantDraft.reason} onChange={event => updateGrant({ reason: event.target.value })}/></label><label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={grantDraft.acknowledged} onChange={event => updateGrant({ acknowledged: event.target.checked })}/>已核验真实双身份、地点、来源及期限，只授此明确审计动作</label><button className={button} disabled={!grantDraft.acknowledged} onClick={() => send("grant")}>授予明确审计权限（一次提交）</button>
        </fieldset>
      </details>
      <details><summary className="cursor-pointer font-semibold">授予指定组动作（四项结构化授权）</summary><p className="my-3 text-sm text-amber-800">所有现有组、分配、员工及账户编号须由负责人核验；不伪造候选，不接受手填 JSON。每份授权只有一个动作，不能列举或管理其他组与员工。分配时的日期和版本在受托人明确读取当前上下文后核验。</p>
        <fieldset disabled={lock || !grantEnabled || !groupsEnabled || !management || management.kind === "receipt" || !management.canGrant} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="text-sm">被委托员工 ID<input className={field} maxLength={36} value={groupsGrantDraft.delegateEmployeeId} onChange={event => updateGroupsGrant({ delegateEmployeeId: event.target.value })}/></label>
          <label className="text-sm">被委托账户 Auth ID<input className={field} maxLength={36} value={groupsGrantDraft.delegateAuthUserId} onChange={event => updateGroupsGrant({ delegateAuthUserId: event.target.value })}/></label>
          <label className="text-sm">唯一组动作<select className={field} value={groupsGrantDraft.delegatedAction} onChange={event => updateGroupsGrant({ delegatedAction: event.target.value as g.DelegatedGroupsAction, assignmentId: "", create: false, acknowledged: false })}>{Object.entries(groupActionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="text-sm">指定组 ID<input className={field} maxLength={36} value={groupsGrantDraft.groupId} onChange={event => updateGroupsGrant({ groupId: event.target.value })}/></label>
          {groupsGrantDraft.delegatedAction === "group_save" ? <div className="space-y-2 text-sm sm:col-span-2"><label className="flex items-center gap-2"><input type="checkbox" checked={groupsGrantDraft.create} onChange={event => updateGroupsGrant({ create: event.target.checked, groupId: "", acknowledged: false })}/>仅新建此拟定编号的组（不是已有组）</label>{groupsGrantDraft.create && <button className={button} onClick={() => updateGroupsGrant({ groupId: crypto.randomUUID(), acknowledged: false })}>生成拟新建组编号（仅本地，不保存）</button>}</div>
            : <><label className="text-sm">目标打卡档案 Worker ID<input className={field} maxLength={36} value={groupsGrantDraft.workerId} onChange={event => updateGroupsGrant({ workerId: event.target.value })}/></label>
              <label className="text-sm">目标员工 Employee ID<input className={field} maxLength={36} value={groupsGrantDraft.employeeId} onChange={event => updateGroupsGrant({ employeeId: event.target.value })}/></label>
              <label className="text-sm">目标账户 Auth ID<input className={field} maxLength={36} value={groupsGrantDraft.employeeAuthUserId} onChange={event => updateGroupsGrant({ employeeAuthUserId: event.target.value })}/></label>
              {groupsGrantDraft.delegatedAction !== "group_assign" && <label className="text-sm">唯一现有分配 Assignment ID<input className={field} maxLength={36} value={groupsGrantDraft.assignmentId} onChange={event => updateGroupsGrant({ assignmentId: event.target.value })}/></label>}
              <label className="text-sm sm:col-span-2">真实地点 ID（1—25个，逗号或换行分隔）<textarea className={field} maxLength={1000} value={groupsGrantDraft.locationIds} onChange={event => updateGroupsGrant({ locationIds: event.target.value })}/></label></>}
          <label className="text-sm">授权生效时间（UTC）<input type="datetime-local" step="1" className={field} value={groupsGrantDraft.validFrom} onChange={event => updateGroupsGrant({ validFrom: event.target.value })}/></label>
          <label className="text-sm">授权失效时间（UTC，不含端点）<input type="datetime-local" step="1" className={field} value={groupsGrantDraft.validUntil} onChange={event => updateGroupsGrant({ validUntil: event.target.value })}/></label>
          <label className="text-sm sm:col-span-2">组授权理由<input className={field} maxLength={200} value={groupsGrantDraft.reason} onChange={event => updateGroupsGrant({ reason: event.target.value })}/></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={groupsGrantDraft.acknowledged} onChange={event => updateGroupsGrant({ acknowledged: event.target.checked })}/>已核验真实双身份、组／分配、地点与期限，只授此一个组动作</label>
          <button className={button} disabled={!groupsGrantDraft.acknowledged} onClick={() => send("groups-grant")}>授予此组动作（一次提交）</button>
        </fieldset>
      </details>
      <details><summary className="cursor-pointer font-semibold">授予指定档案／地点保存权（结构化授权）</summary>
        <p className="my-3 text-sm text-amber-800">负责人须核验真实被委托人双身份，以及唯一目标和允许地点。UUID 格式不代表权限；拟新建编号不代表已有资源。此处不提供全商户人员／地点目录，不接受手填 JSON。受托人不能更换目标身份或版本。</p>
        <fieldset disabled={lock || !grantEnabled || !configurationEnabled || !management || management.kind === "receipt" || !management.canGrant} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="text-sm">配置受托员工 ID<input className={field} maxLength={36} value={configurationGrantDraft.delegateEmployeeId} onChange={event => updateConfigurationGrant({ delegateEmployeeId: event.target.value })}/></label>
          <label className="text-sm">配置受托账户 Auth ID<input className={field} maxLength={36} value={configurationGrantDraft.delegateAuthUserId} onChange={event => updateConfigurationGrant({ delegateAuthUserId: event.target.value })}/></label>
          <label className="text-sm">唯一配置动作<select aria-label="唯一配置动作" className={field} value={configurationGrantDraft.delegatedAction} onChange={event => updateConfigurationGrant({ delegatedAction: event.target.value as cfg.DelegatedConfigurationAction,
            workerId: "", employeeId: "", employeeAuthUserId: "", locationId: "", locationIds: "", create: false, acknowledged: false })}>
            {Object.entries(configurationActionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <div className="space-y-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={configurationGrantDraft.create} onChange={event => updateConfigurationGrant({ create: event.target.checked, workerId: "", locationId: "", acknowledged: false })}/>仅新建此拟定资源编号（不是已有资源）</label>
            {configurationGrantDraft.create && <button className={button} onClick={() => updateConfigurationGrant(configurationGrantDraft.delegatedAction === "worker_save"
              ? { workerId: crypto.randomUUID(), acknowledged: false } : { locationId: crypto.randomUUID(), acknowledged: false })}>生成拟新建资源编号（仅本地，不保存）</button>}</div>
          {configurationGrantDraft.delegatedAction === "worker_save" ? <><label className="text-sm">配置目标 Worker ID<input className={field} maxLength={36} value={configurationGrantDraft.workerId} onChange={event => updateConfigurationGrant({ workerId: event.target.value })}/></label>
            <label className="text-sm">配置目标 Employee ID<input className={field} maxLength={36} value={configurationGrantDraft.employeeId} onChange={event => updateConfigurationGrant({ employeeId: event.target.value })}/></label>
            <label className="text-sm">配置目标账户 Auth ID<input className={field} maxLength={36} value={configurationGrantDraft.employeeAuthUserId} onChange={event => updateConfigurationGrant({ employeeAuthUserId: event.target.value })}/></label>
            <label className="text-sm">配置允许地点 ID（1—25个，逗号或换行分隔）<textarea className={field} maxLength={1000} value={configurationGrantDraft.locationIds} onChange={event => updateConfigurationGrant({ locationIds: event.target.value })}/></label></>
            : <label className="text-sm">配置目标 Location ID<input className={field} maxLength={36} value={configurationGrantDraft.locationId} onChange={event => updateConfigurationGrant({ locationId: event.target.value })}/></label>}
          <label className="text-sm">配置授权生效时间（UTC）<input type="datetime-local" step="1" className={field} value={configurationGrantDraft.validFrom} onChange={event => updateConfigurationGrant({ validFrom: event.target.value })}/></label>
          <label className="text-sm">配置授权失效时间（UTC，不含端点）<input type="datetime-local" step="1" className={field} value={configurationGrantDraft.validUntil} onChange={event => updateConfigurationGrant({ validUntil: event.target.value })}/></label>
          <label className="text-sm sm:col-span-2">配置授权理由<input className={field} maxLength={200} value={configurationGrantDraft.reason} onChange={event => updateConfigurationGrant({ reason: event.target.value })}/></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={configurationGrantDraft.acknowledged} onChange={event => updateConfigurationGrant({ acknowledged: event.target.checked })}/>已核验真实双身份、唯一目标、允许地点与期限，只授此一个配置保存动作</label>
          <button className={button} disabled={!configurationGrantDraft.acknowledged} onClick={() => send("configuration-grant")}>授予此配置保存权（一次提交）</button>
        </fieldset>
      </details>
      <details><summary className="cursor-pointer font-semibold">授予规则权限（八个明确动作）</summary>
        <p className="my-3 text-sm text-amber-800">核验真实员工／账户双身份和已知范围编号；这里不提供全商户目录或手填 JSON。每份授权只含一个动作。允许键限制实际变化；发布／撤回若影响其他键，服务端会拒绝，不自动扩大授权。</p>
        <fieldset disabled={lock || !grantEnabled || !rulesEnabled || !management || management.kind === "receipt" || !management.canGrant} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="text-sm">规则被委托员工 ID<input className={field} maxLength={36} value={rulesGrantDraft.delegateEmployeeId} onChange={e => updateRulesGrant({ delegateEmployeeId: e.target.value })}/></label>
          <label className="text-sm">规则被委托账户 Auth ID<input className={field} maxLength={36} value={rulesGrantDraft.delegateAuthUserId} onChange={e => updateRulesGrant({ delegateAuthUserId: e.target.value })}/></label>
          <label className="text-sm">规则明确动作<select className={field} value={rulesGrantDraft.delegatedAction} onChange={e => { const action = e.target.value as rules.DelegatedRulesAction, family = managementRulesFamily(action);
            updateRulesGrant({ delegatedAction: action, subjectKind: family === "personal" ? "personal" : "enterprise", allowedRuleKeys: [], acknowledged: false }); }}>
            {rules.DELEGATED_RULES_ACTIONS.map(action => <option key={action} value={action}>{delegatedRuleActionLabels[action]}</option>)}</select></label>
          <label className="text-sm">规则固定层级<select className={field} value={rulesGrantDraft.subjectKind} onChange={e => updateRulesGrant({ subjectKind: e.target.value as ManagementRulesGrantForm["subjectKind"], acknowledged: false })}>
            {managementRulesFamily(rulesGrantDraft.delegatedAction) !== "personal" && <><option value="enterprise">企业层</option><option value="group">指定组层</option></>}
            {managementRulesFamily(rulesGrantDraft.delegatedAction) !== "base" && <option value="personal">指定个人层（完整双身份）</option>}</select></label>
          {rulesGrantDraft.subjectKind === "group" && <label className="text-sm">规则目标 Group ID<input className={field} maxLength={36} value={rulesGrantDraft.groupId} onChange={e => updateRulesGrant({ groupId: e.target.value })}/></label>}
          {rulesGrantDraft.subjectKind === "personal" && <>{([['workerId', '规则目标 Worker ID'], ['employeeId', '规则目标 Employee ID'], ['employeeAuthUserId', '规则目标 Auth ID']] as const).map(([key, label]) =>
            <label className="text-sm" key={key}>{label}<input className={field} maxLength={36} value={rulesGrantDraft[key]} onChange={e => updateRulesGrant({ [key]: e.target.value })}/></label>)}</>}
          <fieldset className="space-y-2 sm:col-span-2"><legend className="font-semibold text-sm">明确允许变化的规则键（至少一项）</legend>
            {(managementRulesFamily(rulesGrantDraft.delegatedAction) === "operational" ? OPERATIONAL_RULE_KEYS : RULE_KEYS).map(key => <label className="flex gap-2 text-sm" key={key}>
              <input type="checkbox" checked={rulesGrantDraft.allowedRuleKeys.includes(key)} onChange={e => updateRulesGrant({ allowedRuleKeys: e.target.checked ? [...rulesGrantDraft.allowedRuleKeys, key] : rulesGrantDraft.allowedRuleKeys.filter(k => k !== key), acknowledged: false })}/>
              {key in RULE_DEFINITIONS ? RULE_DEFINITIONS[key as AttendanceRuleKey].label : operationalRuleNames[key as OperationalRuleKey]}</label>)}</fieldset>
          <label className="text-sm sm:col-span-2">规则限定地点 ID（0—25个，逗号或换行分隔；运营地点值只能使用此名单）<textarea className={field} maxLength={1000} value={rulesGrantDraft.locationIds} onChange={e => updateRulesGrant({ locationIds: e.target.value })}/></label>
          <label className="text-sm">规则授权生效时间（UTC）<input className={field} type="datetime-local" step="1" value={rulesGrantDraft.validFrom} onChange={e => updateRulesGrant({ validFrom: e.target.value })}/></label>
          <label className="text-sm">规则授权失效时间（UTC，不含端点）<input className={field} type="datetime-local" step="1" value={rulesGrantDraft.validUntil} onChange={e => updateRulesGrant({ validUntil: e.target.value })}/></label>
          <label className="text-sm sm:col-span-2">规则授权理由<input className={field} maxLength={200} value={rulesGrantDraft.reason} onChange={e => updateRulesGrant({ reason: e.target.value })}/></label>
          <label className="flex gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={rulesGrantDraft.acknowledged} onChange={e => updateRulesGrant({ acknowledged: e.target.checked })}/>已核验真实身份、固定层级、允许键、地点与期限，只授上述一个规则动作</label>
          <button className={button} disabled={!rulesGrantDraft.acknowledged} onClick={() => send("rules-grant")}>授予此规则动作（一次提交）</button>
        </fieldset>
      </details>
      <details><summary className="cursor-pointer font-semibold">授予终端／PIN权限（四项精确授权）</summary>
        <p className="my-3 text-sm text-amber-800">核验真实员工与账户、终端／地点或人员身份编号；不枚举全商户目录，不手填 JSON。准备终端必须授权一个新的明确终端编号。PIN允许地点为1—25个已核验编号；独立人员仅用保存主体与代际，不虚构员工账户。</p>
        <fieldset disabled={lock || !grantEnabled || !management || management.kind === "receipt" || !management.canGrant} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label>凭据被委托员工 ID<input className={field} maxLength={36} value={credentialsGrantDraft.delegateEmployeeId} onChange={e => updateCredentialsGrant({ delegateEmployeeId: e.target.value })}/></label>
          <label>凭据被委托账户 Auth ID<input className={field} maxLength={36} value={credentialsGrantDraft.delegateAuthUserId} onChange={e => updateCredentialsGrant({ delegateAuthUserId: e.target.value })}/></label>
          <label>凭据明确授权动作<select aria-label="凭据明确授权动作" className={field} value={credentialsGrantDraft.delegatedAction} onChange={e => updateCredentialsGrant({ delegatedAction: e.target.value as credentials.DelegatedCredentialsAction, acknowledged: false })}>
            {credentials.DELEGATED_CREDENTIALS_ACTIONS.map(action => <option key={action} value={action}>{delegatedCredentialActionLabels[action]}</option>)}</select></label>
          <fieldset disabled={credentialsGrantDraft.delegatedAction.startsWith("terminal_") ? !terminalsEnabled : !pinEnabled} className="grid min-w-0 gap-3 sm:col-span-2 sm:grid-cols-2">
            {credentialsGrantDraft.delegatedAction.startsWith("terminal_") ? <>
              <label>授权终端 ID<input className={field} maxLength={36} value={credentialsGrantDraft.terminalId} onChange={e => updateCredentialsGrant({ terminalId: e.target.value, acknowledged: false })}/></label>
              <label>授权终端地点 ID<input className={field} maxLength={36} value={credentialsGrantDraft.locationId} onChange={e => updateCredentialsGrant({ locationId: e.target.value, acknowledged: false })}/></label>
              <p className="break-words text-sm sm:col-span-2">固定动作：{credentialsGrantDraft.delegatedAction === "terminal_prepare" ? "创建前必须不存在；完成配对仍走原设备入口" : "只撤销此已存在终端"}。UUID格式不代表权限。</p>
            </> : <>
              <label>授权 PIN 身份类型<select aria-label="授权 PIN 身份类型" className={field} value={credentialsGrantDraft.pinKind} onChange={e => updateCredentialsGrant({ pinKind: e.target.value as "member_pin" | "independent_pin", acknowledged: false })}><option value="member_pin">已绑定员工</option><option value="independent_pin">独立人员</option></select></label>
              <label>PIN目标 Worker ID<input className={field} maxLength={36} value={credentialsGrantDraft.workerId} onChange={e => updateCredentialsGrant({ workerId: e.target.value, acknowledged: false })}/></label>
              {credentialsGrantDraft.pinKind === "member_pin" ? <>
                <label>PIN目标 Employee ID<input className={field} maxLength={36} value={credentialsGrantDraft.employeeId} onChange={e => updateCredentialsGrant({ employeeId: e.target.value, acknowledged: false })}/></label>
                <label>PIN目标 Auth ID<input className={field} maxLength={36} value={credentialsGrantDraft.employeeAuthUserId} onChange={e => updateCredentialsGrant({ employeeAuthUserId: e.target.value, acknowledged: false })}/></label>
              </> : <>
                <label>PIN目标独立 Subject ID<input className={field} maxLength={36} value={credentialsGrantDraft.subjectId} onChange={e => updateCredentialsGrant({ subjectId: e.target.value, acknowledged: false })}/></label>
                <label>已核验独立主体代际<input className={field} type="number" min="1" step="1" value={credentialsGrantDraft.generation} onChange={e => updateCredentialsGrant({ generation: e.target.value, acknowledged: false })}/></label>
              </>}
              <label className="sm:col-span-2">PIN授权地点 ID（1—25个，逗号或换行分隔）<textarea className={field} maxLength={1000} value={credentialsGrantDraft.locationIds} onChange={e => updateCredentialsGrant({ locationIds: e.target.value, acknowledged: false })}/></label>
            </>}
            <label>凭据授权生效时间（UTC）<input className={field} type="datetime-local" step="1" value={credentialsGrantDraft.validFrom} onChange={e => updateCredentialsGrant({ validFrom: e.target.value, acknowledged: false })}/></label>
            <label>凭据授权失效时间（UTC，不含端点）<input className={field} type="datetime-local" step="1" value={credentialsGrantDraft.validUntil} onChange={e => updateCredentialsGrant({ validUntil: e.target.value, acknowledged: false })}/></label>
            <label className="sm:col-span-2">凭据授权理由<input className={field} maxLength={200} value={credentialsGrantDraft.reason} onChange={e => updateCredentialsGrant({ reason: e.target.value, acknowledged: false })}/></label>
            <label className="flex gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={credentialsGrantDraft.acknowledged} onChange={e => updateCredentialsGrant({ acknowledged: e.target.checked })}/>已核验精确身份、地点、动作和期限；不授其他设备或人员权限</label>
            <button className={button} disabled={!credentialsGrantDraft.acknowledged} onClick={() => send(credentialsGrantDraft.delegatedAction.startsWith("terminal_") ? "terminals-grant" : "pin-grant")}>授予此凭据动作（一次提交）</button>
          </fieldset>
        </fieldset>
      </details>
      <details><summary className="cursor-pointer font-semibold">授予连续修订审批（批准／驳回精确授权）</summary>
        <p className="my-3 text-sm text-amber-800">负责人须核验真实受托人与目标员工双身份、档案和地点；不枚举全商户目录，不手填 JSON。每份授权只有批准或驳回一个动作，不含撤销决定。未勾选纳入已有待办时，只允许实际提交记录时间不早于授权记录的申请；勾选也只纳入仍待审批的申请。</p>
        <fieldset disabled={lock || !grantEnabled || !revisionsEnabled || !management || management.kind === "receipt" || !management.canGrant} className="grid min-w-0 gap-3 sm:grid-cols-2">
          {([['delegateEmployeeId', '修订受托员工 ID'], ['delegateAuthUserId', '修订受托账户 Auth ID'], ['workerId', '修订目标 Worker ID'], ['employeeId', '修订目标 Employee ID'], ['employeeAuthUserId', '修订目标 Auth ID']] as const).map(([key, label]) =>
            <label key={key}>{label}<input aria-label={label} className={field} maxLength={36} value={revisionsGrantDraft[key]} onChange={e => updateRevisionsGrant({ [key]: e.target.value })}/></label>)}
          <label>唯一修订授权动作<select aria-label="唯一修订授权动作" className={field} value={revisionsGrantDraft.delegatedAction} onChange={e => {
            if (e.target.value === "revision_approve" || e.target.value === "revision_reject") updateRevisionsGrant({ delegatedAction: e.target.value }); }}>
            <option value="revision_approve">批准指定连续修订</option><option value="revision_reject">驳回指定连续修订</option></select></label>
          <label className="sm:col-span-2">修订授权地点 ID（1—25个，逗号或换行分隔）<textarea aria-label="修订授权地点 ID（1—25个，逗号或换行分隔）" className={field} maxLength={1000} value={revisionsGrantDraft.locationIds} onChange={e => updateRevisionsGrant({ locationIds: e.target.value })}/></label>
          <label className="flex gap-2 sm:col-span-2"><input type="checkbox" checked={revisionsGrantDraft.includePending} onChange={e => updateRevisionsGrant({ includePending: e.target.checked })}/>明确纳入授权前已提交、目前仍待审批的修订申请</label>
          <label>修订授权生效时间（UTC）<input aria-label="修订授权生效时间（UTC）" className={field} type="datetime-local" step="1" value={revisionsGrantDraft.validFrom} onChange={e => updateRevisionsGrant({ validFrom: e.target.value })}/></label>
          <label>修订授权失效时间（UTC，不含端点）<input aria-label="修订授权失效时间（UTC，不含端点）" className={field} type="datetime-local" step="1" value={revisionsGrantDraft.validUntil} onChange={e => updateRevisionsGrant({ validUntil: e.target.value })}/></label>
          <label className="sm:col-span-2">修订授权理由<input aria-label="修订授权理由" className={field} maxLength={200} value={revisionsGrantDraft.reason} onChange={e => updateRevisionsGrant({ reason: e.target.value })}/></label>
          <label className="flex gap-2 sm:col-span-2"><input type="checkbox" checked={revisionsGrantDraft.acknowledged} onChange={e => updateRevisionsGrant({ acknowledged: e.target.checked })}/>已核验真实双身份、地点、待办口径和期限，只授此一个修订动作</label>
          <button className={button} disabled={!revisionsGrantDraft.acknowledged} onClick={() => send("revisions-grant")}>授予此修订动作（一次提交）</button>
        </fieldset>
      </details>
    </section>}
    <section className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="font-bold">被委托人：读取资源审计</h3><p className="text-sm text-slate-600">填写真实授权编号。列表每页25条，导出上限250条；超限缩小时间范围，不截断为成功。恢复仅为最小回执，不再返回或下载旧正文。</p>
      <fieldset disabled={lock} className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="text-sm">真实审计授权编号<input className={field} maxLength={36} value={auditDraft.grantId} onChange={event => changeAudit({ ...auditDraft, grantId: event.target.value })}/></label><label className="text-sm">明确来源<select className={field} value={auditDraft.source} onChange={event => changeAudit({ ...auditDraft, source: event.target.value as a.DelegatedAuditSource })}>{Object.entries(sourceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-sm">开始时间（UTC，含端点）<input type="datetime-local" step="1" className={field} value={auditDraft.fromAt} onChange={event => changeAudit({ ...auditDraft, fromAt: event.target.value })}/></label><label className="text-sm">结束时间（UTC，不含端点，范围≤31天）<input type="datetime-local" step="1" className={field} value={auditDraft.toAt} onChange={event => changeAudit({ ...auditDraft, toAt: event.target.value })}/></label><div className="flex flex-wrap gap-2 sm:col-span-2"><button className={button} onClick={listAudit}>读取审计首页（GET）</button><button className={button} disabled={!auditEnabled} onClick={() => send("export")}>生成审计 CSV（一次提交）</button></div></fieldset>
      {audit?.kind === "list" && <div className="space-y-2"><p className="text-sm">本页 {audit.items.length} 条 · 固定快照 {audit.asOf}</p>{audit.items.map(item => <button className={`${button} block w-full break-all text-left`} key={item.operationId} disabled={lock} onClick={() => void read("audit", { siteId, grantId: audit.grantId, mode: "detail", source: audit.source, sourceOperationId: item.operationId })}>{item.recordedAt} · {item.kind} · {item.operationId}</button>)}{audit.nextCursor && readQuery?.mode === "list" && "cursorAt" in readQuery && <button className={button} disabled={lock} onClick={() => void read("audit", { ...readQuery, asOf: audit.asOf, cursorAt: audit.nextCursor!.recordedAt, cursorId: audit.nextCursor!.operationId })}>下一页审计（同一快照）</button>}</div>}
      {audit?.kind === "detail" && <article className="min-w-0 space-y-3 rounded-xl bg-slate-50 p-3 text-sm"><h4 className="break-all font-semibold">{audit.row.item.kind} · {audit.row.item.operationId}</h4><p>记录时间 {audit.row.item.recordedAt} · 版本 {audit.row.item.version}</p>{(["before", "after"] as const).map(side => <div key={side}><h5 className="font-semibold">{side === "before" ? "变更前" : "变更后"}</h5>{audit.row[side] === null ? <p>无</p> : <dl className="grid min-w-0 gap-1 sm:grid-cols-2">{Object.entries(audit.row[side]!).map(([key, value]) => <div className="min-w-0" key={key}><dt className="font-medium">{key}</dt><dd className="break-all">{Array.isArray(value) ? value.join("、") : value === null ? "无" : String(value)}</dd></div>)}</dl>}</div>)}</article>}
      {downloadContext && audit?.kind === "export" && <div className="rounded-xl bg-emerald-50 p-3 text-sm"><p>已核验 {audit.payload.count} 条完整导出正文；原编号仍保留，下载后请 GET 核验回执。</p><button className={button} onClick={() => void download()}>下载已核验 CSV</button></div>}
    </section>
    <section className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="font-bold">被委托人：指定组管理</h3><p className="text-sm text-slate-600">只读取真实授权对应的组、指定员工及分配；不提供全商户人员／组枚举。一次保存／分配／结束／取消均单独确认，版本来自刚读取的上下文，不手填版本或 JSON。未知结果只能通过上方 GET 原号核验。</p>
      <fieldset disabled={lock} className="flex min-w-0 flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">真实组管理授权编号<input className={field} maxLength={36} value={groupsGrantId} onChange={event => changeGroupsGrantId(event.target.value)}/></label><button className={button} onClick={readGroupsContext}>读取此授权上下文（GET）</button></fieldset>
      {groups && <article className="min-w-0 space-y-3 rounded-xl bg-slate-50 p-3 text-sm"><h4 className="font-semibold">{groupActionLabels[groups.action]}</h4>
        <p className="break-all">授权 {groups.grantId} · 指定组 {groups.scope.groupId} · 读取时刻 {groups.readAt}</p>
        <p className="break-all">组：{groups.context.group?.name ?? "拟新建，当前不存在"} · 组版本 {groups.context.group?.revision ?? 0} · 配置版本 {groups.context.settingsVersion} · 时区 {groups.context.timeZone}</p>
        {groups.scope.kind === "group_worker" && <><p className="break-all">目标档案 {groups.scope.workerId}／员工 {groups.scope.employeeId}／账户 {groups.scope.employeeAuthUserId}</p><p className="break-all">当前员工 {groups.context.worker?.workerName}（{groups.context.worker?.workerNo}）· 档案版本 {groups.context.worker?.version} · 限定地点 {groups.scope.locationIds.join("、")}</p></>}
        {groups.context.detail && <p className="break-all">分配 {groups.context.detail.assignmentId} · 版本 {groups.context.detail.revision} · 状态 {groups.context.detail.status} · {groups.context.detail.startsOn} 至 {groups.context.detail.endsOn ?? "尚未设结束日期"}</p>}
        <fieldset disabled={lock || !groupsEnabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
          {groups.action === "group_save" && <><label>组名称<input className={field} maxLength={80} value={groupsDraft.name} onChange={event => updateGroups({ name: event.target.value })}/></label><label>组说明<input className={field} maxLength={200} value={groupsDraft.description} onChange={event => updateGroups({ description: event.target.value })}/></label><label className="flex items-center gap-2"><input type="checkbox" checked={groupsDraft.active} onChange={event => updateGroups({ active: event.target.checked })}/>组启用</label></>}
          {groups.action === "group_assign" && <label>开始日期（以上时区）<input type="date" className={field} value={groupsDraft.startsOn} onChange={event => updateGroups({ startsOn: event.target.value })}/></label>}
          {(groups.action === "group_assign" || groups.action === "group_end") && <label>结束日期（{groups.action === "group_assign" ? "可留空" : "必填"}）<input type="date" className={field} value={groupsDraft.endsOn} onChange={event => updateGroups({ endsOn: event.target.value })}/></label>}
          <label className="sm:col-span-2">本次组操作理由<input className={field} maxLength={200} value={groupsDraft.reason} onChange={event => updateGroups({ reason: event.target.value })}/></label>
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={groupsDraft.acknowledged} onChange={event => updateGroups({ acknowledged: event.target.checked })}/>已核验本授权、目标双身份、日期和上述版本，只执行显示的这一个动作</label>
          <button className={button} disabled={!groupsDraft.acknowledged || !groupsDraft.reason.trim()} onClick={() => send("groups")}>{groupActionLabels[groups.action]}（一次提交）</button>
        </fieldset>
      </article>}
      {state.result?.protocol === g.DELEGATED_GROUPS_PROTOCOL && state.result.kind === "receipt" && state.result.receipt && <p className="break-all rounded-xl bg-emerald-50 p-3 text-sm">组操作最小回执：{state.result.receipt.action} · 原编号 {state.result.receipt.operationId} · 目标 {state.result.receipt.referenceId} · 版本 {state.result.receipt.revision}。{state.pending ? "请明确 GET 核验后继续，不重发。" : "原号已核验；继续操作请重新读取当前上下文。"}</p>}
    </section>
    <section className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="font-bold">被委托人：指定档案／地点配置</h3>
      <p className="text-sm text-slate-600">只读取真实授权的唯一目标。目标 ID、员工身份和全局配置版本来自刚读取的上下文，不手填版本，不列举全商户资源。每次保存单独确认；结果未知时只 GET 原编号，不重发。配置开关不影响原号核验。</p>
      <fieldset disabled={lock} className="flex min-w-0 flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">真实档案／地点配置授权编号<input className={field} maxLength={36} value={configurationGrantId} onChange={event => changeConfigurationGrantId(event.target.value)}/></label>
        <button className={button} onClick={readConfigurationContext}>读取配置授权上下文（GET）</button></fieldset>
      {configuration && configurationDraft && <article className="min-w-0 space-y-3 rounded-xl bg-slate-50 p-3 text-sm" data-delegated-configuration-context>
        <h4 className="font-semibold">{configurationActionLabels[configuration.action]}</h4>
        <p className="break-all">授权 {configuration.grantId} · 读取时刻 {configuration.readAt} · 全局配置版本 {configuration.context.settingsVersion} · 目标版本 {configuration.context.targetVersion ?? "拟新建，当前不存在"}</p>
        {configuration.scope.kind === "worker" ? <><p className="break-all">固定目标档案 {configuration.scope.workerId}／员工 {configuration.scope.employeeId}／账户 {configuration.scope.employeeAuthUserId}</p>
          <p className="break-all">当前员工 {configuration.context.employee?.displayName} · 身份 {configuration.context.employee?.id} · 仅允许地点 {configuration.scope.locationIds.join("、")}</p></>
          : <p className="break-all">固定目标地点 {configuration.scope.locationId}（{configuration.scope.create ? "拟新建，不代表已经存在" : "已有资源"}）</p>}
        <fieldset disabled={lock || !configurationEnabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
          {configurationDraft.kind === "worker" ? <><label>员工工号<input className={field} maxLength={40} value={configurationDraft.workerNo} onChange={event => updateConfigurationWorker({ workerNo: event.target.value })}/></label>
            <label>档案显示名称<input className={field} maxLength={120} value={configurationDraft.displayName} onChange={event => updateConfigurationWorker({ displayName: event.target.value })}/></label>
            <label>限定工作地点<select aria-label="限定工作地点" className={field} value={configurationDraft.locationId} onChange={event => updateConfigurationWorker({ locationId: event.target.value })}>
              <option value="">明确选择此授权允许的地点</option>{configuration.context.locations.map(location => <option key={location.id} value={location.id}>{location.name} · {location.id}（{location.active ? "启用" : "停用，执行时重验"}）</option>)}</select></label>
            <label>档案开始日期<input type="date" min="2000-01-01" max="2100-12-31" className={field} value={configurationDraft.startsOn} onChange={event => updateConfigurationWorker({ startsOn: event.target.value })}/></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={configurationDraft.active} onChange={event => updateConfigurationWorker({ active: event.target.checked })}/>员工档案启用</label></>
            : <><label>工作地点名称<input className={field} maxLength={120} value={configurationDraft.name} onChange={event => updateConfigurationLocation({ name: event.target.value })}/></label>
              <label>工作地点时区（IANA／UTC）<input className={field} maxLength={100} value={configurationDraft.timeZone} onChange={event => updateConfigurationLocation({ timeZone: event.target.value })}/></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={configurationDraft.active} onChange={event => updateConfigurationLocation({ active: event.target.checked })}/>工作地点启用</label></>}
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={configurationDraft.acknowledged} onChange={event => configurationDraft.kind === "worker"
            ? updateConfigurationWorker({ acknowledged: event.target.checked }) : updateConfigurationLocation({ acknowledged: event.target.checked })}/>已核验此授权、固定目标身份、允许地点和上述全局配置版本，只保存此一个资源</label>
          <button className={button} disabled={!configurationDraft.acknowledged} onClick={() => void sendConfiguration()}>保存此指定配置（一次提交）</button>
        </fieldset>
      </article>}
      {state.result?.protocol === cfg.DELEGATED_CONFIGURATION_PROTOCOL && state.result.kind === "receipt" && state.result.receipt && <p className="break-all rounded-xl bg-emerald-50 p-3 text-sm">配置操作最小回执：{state.result.receipt.action} · 原编号 {state.result.receipt.operationId} · 目标 {state.result.receipt.referenceId} · 全局配置版本 {state.result.receipt.revision}。{state.pending ? "请明确 GET 核验后继续，不重发。" : "原号已核验；如需继续编辑请重新读取当前上下文。"}</p>}
    </section>
    <section className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="font-bold">被委托人：指定终端与 PIN</h3>
      <p className="text-sm text-slate-600">只读取此一个真实授权的精确范围；不提供目录、负责人代理或自动配对。PIN只在本次明确提交使用，不写入原号槽；最后输入后15秒、隐藏页面或切换目标会清除。真实设备与手机仍需试点验收。</p>
      <fieldset disabled={lock} className="flex min-w-0 flex-wrap items-end gap-3">
        <label>终端／PIN授权类型<select aria-label="终端／PIN授权类型" className={field} value={credentialsDomain} onChange={e => changeCredentialsSelection(e.target.value as "terminals" | "pin", "")}><option value="terminals">指定终端</option><option value="pin">指定人员 PIN</option></select></label>
        <label className="min-w-0 flex-1">真实终端／PIN授权编号<input className={field} maxLength={36} value={credentialsGrantId} onChange={e => changeCredentialsSelection(credentialsDomain, e.target.value)}/></label>
        <button className={button} onClick={readCredentialsContext}>读取凭据授权上下文（GET）</button>
      </fieldset>
      {credentialContext && <article data-delegated-credentials-context className="min-w-0 space-y-3 rounded-xl bg-slate-50 p-3 text-sm">
        <h4 className="font-semibold">{delegatedCredentialActionLabels[credentialContext.action]}</h4><p className="break-all">授权 {credentialContext.grantId} · 读取UTC {credentialContext.readAt}</p>
        {credentialContext.protocol === credentials.DELEGATED_TERMINALS_PROTOCOL ? <div className="space-y-1"><p className="break-all">固定终端 {credentialContext.scope.terminalId}／地点 {credentialContext.scope.locationId}</p>
          <p className="break-words">地点 {credentialContext.context.location.name} · {credentialContext.context.location.timeZone} · 地点版本 {credentialContext.context.location.version}</p>
          <p>终端状态：{credentialContext.context.terminal?.state ?? "尚未创建"}。没有虚构终端版本或自动绑定设备。</p></div>
          : "status" in credentialContext.context ? <div className="space-y-1"><p className="break-all">员工档案 {credentialContext.scope.workerId}／员工 {credentialContext.context.status.employeeId}／Auth {credentialContext.context.employeeAuthUserId}</p>
            <p className="break-words">工号 {credentialContext.context.status.workerNo} · {credentialContext.context.status.workerName} · PIN版本 {credentialContext.context.status.revision} · 当前绑定 {credentialContext.context.status.bindingCurrent ? "匹配" : "不匹配"}</p></div>
            : <div className="space-y-1"><p className="break-all">独立主体 {credentialContext.context.detail.subject.subjectId}／档案 {credentialContext.context.detail.subject.workerId}</p>
              <p className="break-words">工号 {credentialContext.context.detail.subject.workerNo} · 主体版本 {credentialContext.context.detail.subject.revision}／代际 {credentialContext.context.detail.subject.generation}／档案版本 {credentialContext.context.detail.subject.workerVersion}／配置版本 {credentialContext.context.settingsVersion}／凭据版本 {credentialContext.context.detail.credential.revision}</p></div>}
        <fieldset disabled={lock || (credentialContext.protocol === credentials.DELEGATED_TERMINALS_PROTOCOL ? !terminalsEnabled : !pinEnabled)} className="min-w-0 space-y-3">
          {credentialContext.action === "terminal_prepare" && <label className="block">本次终端显示名称<input className={field} maxLength={80} value={credentialsDraft.label} onChange={e => updateCredentials({ label: e.target.value, acknowledged: false })}/></label>}
          {credentialContext.action === "pin_issue" && <label className="block">本次 PIN（8—12位数字，仅一次发送）<input className={field} type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={pinValue} onChange={e => changePin(e.target.value)}/></label>}
          <label className="block">凭据本次操作理由<input className={field} maxLength={500} value={credentialsDraft.reason} onChange={e => updateCredentials({ reason: e.target.value, acknowledged: false })}/></label>
          <label className="flex gap-2"><input type="checkbox" checked={credentialsDraft.acknowledged} onChange={e => updateCredentials({ acknowledged: e.target.checked })}/>已核验此一个凭据动作、精确身份及当前版本；秘密丢失只核验原编号不重发</label>
          <button className={button} disabled={!credentialsDraft.acknowledged || !credentialsDraft.reason.trim() || credentialContext.action === "pin_issue" && !/^[0-9]{8,12}$/.test(pinValue)} onClick={() => void sendCredentials()}>{delegatedCredentialActionLabels[credentialContext.action]}（一次提交）</button>
        </fieldset>
      </article>}
      {pairDisplay && <div className="min-w-0 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><label className="block">本次临时配对码（生成后15秒清除）<textarea className={`${field} break-all`} rows={3} readOnly autoComplete="off" value={pairDisplay.token}/></label>
        <p>仅本次成功响应短暂显示，不会保存、写入网址或导出二维码。请在原终端配对入口使用；设备是否真正可用仍需另行核验。GET恢复不恢复配对码。</p></div>}
      {(state.result?.protocol === credentials.DELEGATED_TERMINALS_PROTOCOL || state.result?.protocol === credentials.DELEGATED_PIN_PROTOCOL) && state.result.kind === "receipt" && state.result.receipt && <p className="break-all rounded-xl bg-emerald-50 p-3 text-sm">凭据最小回执：{delegatedCredentialActionLabels[state.result.receipt.action]} · 原编号 {state.result.receipt.operationId}。只确认原动作，不恢复秘密或当前执行资格。准备配对码丢失时须有权者显式撤销，再新授权、新编号准备；禁止自动重试。</p>}
    </section>
    <section className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="font-bold">被委托人：固定范围规则</h3>
      <p className="text-sm text-slate-600">只读此真实授权的固定范围，不获取全商户目录。未授权规则键只展示且完整保留；继承不表示已经解析其他层。草稿、未来发布、个人候选与实际业务采用相互独立；预览不授审批权、不创建周期或提醒。</p>
      <fieldset disabled={lock} className="flex min-w-0 flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">真实规则授权编号<input className={field} maxLength={36} value={rulesGrantId} onChange={e => changeRulesGrantId(e.target.value)}/></label>
        <button className={button} onClick={readRulesContext}>读取规则授权上下文（GET）</button><button className={button} onClick={readRulesHistory}>读取规则历史（每页25条）</button></fieldset>
      {rulesContext && rulesDraft && <article className="min-w-0 space-y-3 rounded-xl bg-slate-50 p-3 text-sm" data-delegated-rules-context>
        <h4 className="font-semibold">{delegatedRuleActionLabels[rulesContext.action]}</h4>
        <p className="break-all">授权 {rulesContext.grantId} · {rulesContext.scope.family}／{rulesContext.scope.subject.kind} · 当前规则流版本 {managementRulesRevision(rulesContext)} · 读取 UTC {rulesContext.readAt}</p>
        {rulesContext.scope.subject.kind === "group" && <p className="break-all">固定组 {rulesContext.scope.subject.groupId}</p>}
        {rulesContext.scope.subject.kind === "personal" && <p className="break-all">固定档案 {rulesContext.scope.subject.workerId}／员工 {rulesContext.scope.subject.employeeId}／账户 {rulesContext.scope.subject.employeeAuthUserId}</p>}
        <p className="break-words">允许变化：{rulesContext.scope.allowedRuleKeys.join("、")}。{rulesContext.context.family === "personal" ? "新个人候选以四键继承为基线；不复制其他候选。" : `基线：${rulesContext.context.baselineKind}／${rulesContext.context.baselineRevision ?? "默认继承"}；未授权键不重置。`}</p>
        <fieldset disabled={lock || !rulesEnabled} className="min-w-0 space-y-3">
          {(rulesContext.action === "rule_draft" || rulesContext.action === "personal_rule_approve" || rulesContext.action === "operational_rule_draft") &&
            <DelegatedRuleChoices context={rulesContext} value={rulesDraft.rules} onChange={value => updateRules({ rules: value, acknowledged: false })}/>}
          {(rulesContext.action === "rule_publish" || rulesContext.action === "personal_rule_approve" || rulesContext.action === "operational_rule_publish") && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label>规则未来开始日期（企业时区）<input className={field} type="date" min="2000-01-01" max="2100-12-31" value={rulesDraft.effectiveOn} onChange={e => { updateRules({ effectiveOn: e.target.value, acknowledged: false }); setRulesEvidence(null); }}/></label>
            {(rulesContext.action === "personal_rule_approve" || rulesContext.scope.subject.kind === "personal") && <label>规则个人截止日期（含）<input className={field} type="date" min={rulesDraft.effectiveOn || "2000-01-01"} max="2100-12-31" value={rulesDraft.endsOn} onChange={e => { updateRules({ endsOn: e.target.value, acknowledged: false }); setRulesEvidence(null); }}/></label>}
          </div>}
          {rulesContext.action === "rule_publish" && <p>使用服务器当前保存草稿版本 {rulesContext.context.family === "base" ? rulesContext.context.draft?.revision ?? "不存在，请先由有权者另存草稿" : "不可用"}；不提交本地规则替代它。</p>}
          {rulesContext.action === "operational_rule_publish" && <button className={button} onClick={previewRules}>核验已保存运营草稿与明确引用（GET）</button>}
          {rulesContext.action.endsWith("withdraw") && <label className="block">明确选择尚未开始的原版本（不手填版本号）<select className={field} value={rulesDraft.targetRevision ?? ""} onChange={e => updateRules({ targetRevision: e.target.value === "" ? null : Number(e.target.value), acknowledged: false })}>
            <option value="">明确选择原发布／候选</option>
            {rulesContext.context.family === "operational" ? rulesContext.context.detail.canWithdraw && rulesContext.context.detail.nextPublication
              && <option value={rulesContext.context.detail.nextPublication.revision}>未来发布 {rulesContext.context.detail.nextPublication.revision} · {rulesContext.context.detail.nextPublication.effectiveOn}</option>
              : rulesHistory?.items.filter(row => { const start = "fromAt" in row.item ? row.item.fromAt : "effectiveAt" in row.item ? row.item.effectiveAt : null;
                return row.withdrawnByRevision === null && (row.item.action === "publish" || row.item.action === "approve") && start !== null && managementRulesFutureStart(start, rulesHistory.readAt); })
                .map(row => <option key={row.item.revision} value={row.item.revision}>原版本 {row.item.revision} · {row.item.action}</option>)}
          </select></label>}
          {rulesPreview && <div className="space-y-1 rounded-xl border p-3"><p>已核验草稿 {rulesPreview.preview.sourceDraftRevision} · 规则流版本 {rulesPreview.preview.revision} · {rulesPreview.preview.context.timeZone}</p>
            <p className="break-all">UTC {rulesPreview.preview.effectiveAt} → {rulesPreview.preview.endsAt ?? "不设截止"}</p>
            <p className="break-all">地点引用 {rulesPreview.preview.references.locations.map(v => v.locationId).join("、") || "无"}；路由引用 {rulesPreview.preview.references.routes.map(v => `${v.category}：${v.employeeId}／${v.employeeAuthUserId}`).join("、") || "无"}</p><p>applied=false；只核对保存引用，不证明全员最终权限或业务已使用。</p></div>}
          <label className="block">规则本次操作理由<input className={field} maxLength={200} value={rulesDraft.reason} onChange={e => updateRules({ reason: e.target.value })}/></label>
          <label className="flex gap-2"><input type="checkbox" checked={rulesDraft.acknowledged} onChange={e => updateRules({ acknowledged: e.target.checked })}/>已核验此一个授权动作、固定身份、允许键和当前版本；未知结果仅 GET 原号</label>
          <button className={button} disabled={!rulesDraft.acknowledged || !rulesDraft.reason.trim()} onClick={() => void sendRules()}>{delegatedRuleActionLabels[rulesContext.action]}（一次提交）</button>
        </fieldset>
      </article>}
      {rulesHistory && <article className="space-y-2 text-sm"><p>固定历史快照版本 {rulesHistory.atRevision} · 本页 {rulesHistory.items.length} 条；不是全部数量，翻页不授当前写入资格。</p>
        {rulesHistory.items.map(row => <details className="min-w-0 rounded-xl border p-3" key={row.item.revision}><summary className="break-words">版本 {row.item.revision} · {row.item.action} · {row.item.recordedAt}</summary>
          <p className="break-all">原编号 {row.item.operationId} · 原操作者 {row.item.actorId}</p><p className="break-words">理由 {row.item.reason}</p>
          {row.withdrawnByRevision !== null && <p>此快照内已由版本 {row.withdrawnByRevision} 撤回</p>}
          {"rules" in row.item && row.item.rules && <RuleChoiceSummary value={row.item.rules}/>}
        </details>)}
        {rulesHistory.nextCursor && <button className={button} disabled={lock} onClick={() => void read("rules", { siteId, grantId: rulesHistory.grantId, mode: "history", cursor: rulesHistory.nextCursor })}>下一页规则历史（同一快照）</button>}
      </article>}
      {state.result?.protocol === rules.DELEGATED_RULES_PROTOCOL && state.result.kind === "receipt" && state.result.receipt && <p className="break-all rounded-xl bg-emerald-50 p-3 text-sm">规则最小回执：{delegatedRuleActionLabels[state.result.receipt.action]} · 原编号 {state.result.receipt.operationId} · 保存版本 {state.result.receipt.revision}。只确认保存，不恢复编辑或规则采用资格；继续须重新读上下文。</p>}
    </section>
    <section className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="font-bold">被委托人：指定连续修订审批</h3>
      <p className="text-sm text-slate-600">明确填写真实授权与修订申请编号；只读取此一个范围内的待审批申请，不提供全商户目录或负责人代理。先比较原始记录、提交时核定和员工声明，再明确批准或驳回；不支持撤销决定。切换目标、隐藏或身份变化清除正文与理由，原号保留。</p>
      <fieldset disabled={lock} className="flex min-w-0 flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">真实连续修订授权编号<input aria-label="真实连续修订授权编号" className={field} maxLength={36} value={revisionsGrantId} onChange={e => changeRevisionsSelection(e.target.value, revisionsRequestId)}/></label>
        <label className="min-w-0 flex-1">连续修订申请编号<input aria-label="连续修订申请编号" className={field} maxLength={36} value={revisionsRequestId} onChange={e => changeRevisionsSelection(revisionsGrantId, e.target.value)}/></label>
        <button className={button} onClick={readRevisionsContext}>读取修订授权上下文（GET）</button>
      </fieldset>
      {revisionContext && <article className="min-w-0 space-y-3 rounded-xl bg-slate-50 p-3" data-delegated-revisions-context>
        <p className="break-all text-sm">授权 {revisionContext.grantId} · 允许动作 {delegatedRevisionActionLabels[revisionContext.action]} · 读取 UTC {revisionContext.readAt}</p>
        <DelegatedRevisionReview context={revisionContext}/>
        <fieldset disabled={lock || !revisionsEnabled || !(revisionContext.action === "revision_approve" ? revisionContext.context.canApprove : revisionContext.context.canReject)} className="min-w-0 space-y-3">
          <label className="block">修订决定理由（单行1—500字，员工可见）<input aria-label="修订决定理由（单行1—500字，员工可见）" className={field} maxLength={1000} value={revisionsDraft.reason} onChange={e => updateRevisions({ reason: e.target.value })}/></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={revisionsDraft.acknowledged} onChange={e => updateRevisions({ acknowledged: e.target.checked })}/>已核对目标员工、原始记录、提交时基准、声明差异和理由，只执行显示动作且了解决定不能撤销</label>
          <button className={button} disabled={!revisionsDraft.acknowledged || !revisionsDraft.reason.trim()} onClick={() => void sendRevisions()}>{delegatedRevisionActionLabels[revisionContext.action]}（一次提交）</button>
        </fieldset>
      </article>}
      {state.result?.protocol === revisions.DELEGATED_REVISIONS_PROTOCOL && state.result.kind === "receipt" && state.result.receipt && <p className="break-all rounded-xl bg-emerald-50 p-3 text-sm">修订决定最小回执：{delegatedRevisionActionLabels[state.result.receipt.action]} · 原编号 {state.result.receipt.operationId} · 申请 {state.result.receipt.reference.requestId}。{state.pending ? "请仅 GET 核验原编号后继续，不重发。" : "原号已核验；继续须重新读取当前精确授权。"}回执不恢复原正文或当前审批资格。</p>}
    </section>
  </section>;
}
