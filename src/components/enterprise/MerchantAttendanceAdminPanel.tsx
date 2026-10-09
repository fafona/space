"use client";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceAdminClient } from "@/lib/merchantAttendanceAdminClient";
import type { AttendanceAdminLocation, AttendanceAdminSettings, AttendanceAdminWorker, AttendanceAdminView, AttendanceAdminChange } from "@/lib/merchantAttendanceAdmin";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import ScheduleLauncher from "./MerchantAttendanceScheduleLauncher";
import MissingLauncher from "./MerchantAttendanceMissingLauncher";
import TerminalLauncher from "./MerchantAttendanceTerminalLauncher";
import OwnerBacklogLauncher from "./MerchantAttendanceOwnerBacklogLauncher";
import { ownerBacklogHostReady, type OwnerBacklogTarget } from "@/lib/merchantAttendanceOwnerBacklogNavigation";
import ScheduleOverviewLauncher from "./MerchantAttendanceScheduleOverviewLauncher";
import LeaveLauncher from "./MerchantAttendanceLeaveLauncher";
import WorkArrangementLauncher from "./MerchantAttendanceWorkArrangementLauncher";
import MissingDelegationLauncher from "./MerchantAttendanceMissingDelegationLauncher";
import ApplicationDelegationLauncher from "./MerchantAttendanceApplicationDelegationLauncher";
import ScheduleDelegationLauncher from "./MerchantAttendanceScheduleDelegationLauncher";
import PeriodDelegationLauncher from "./MerchantAttendancePeriodDelegationLauncher";
import CorrectionDelegationLauncher from "./MerchantAttendanceCorrectionDelegationLauncher";
import OperationalRulesLauncher from "./MerchantAttendanceOperationalRulesLauncher";
import OperationalPunchActivationLauncher from "./MerchantAttendanceOperationalPunchActivationLauncher";
import OperationalConsumerActivationLauncher from "./MerchantAttendanceOperationalConsumerActivationLauncher";
import OwnerNotificationsLauncher from "./MerchantAttendanceOwnerNotificationsLauncher";
import AccountSuspensionLauncher from "./MerchantAttendanceAccountSuspensionLauncher";
import EmploymentLifecycleLauncher from "./MerchantAttendanceEmploymentLifecycleLauncher";
import AdministrativeClosureLauncher from "./MerchantAttendanceAdministrativeClosureLauncher";
import ReviewRoutingLauncher from "./MerchantAttendanceReviewRoutingLauncher";
import RemindersLauncher from "./MerchantAttendanceRemindersLauncher";
import ManagementDelegatedLauncher from "./MerchantAttendanceManagementDelegatedLauncher";
import DelegatedPlanExceptionsLauncher from "./MerchantAttendanceDelegatedPlanExceptionsLauncher";
import { attendanceReminderPendingKey } from "@/lib/merchantAttendanceRemindersClient";
import { correctionDecisionKey } from "@/lib/merchantAttendanceCorrectionDecisionClient";
import { reviewRoutingPendingKey } from "@/lib/merchantAttendanceReviewRoutingClient";
import DayReviewLauncher from "./MerchantAttendanceDayReviewLauncher";
import CycleIntentLauncher from "./MerchantAttendanceCycleIntentLauncher";
import { cycleIntentAuthCurrent, cycleIntentPendingKey } from "@/lib/merchantAttendanceCycleIntentClient";
import { periodClosurePendingKey } from "@/lib/merchantAttendancePeriodClosureClient";
import type { CycleIntentScope } from "@/lib/merchantAttendanceCycleIntent";
import type { CycleIntentResult } from "@/lib/merchantAttendanceCycleIntentResult";
import IndependentAdminLauncher from "./MerchantAttendanceIndependentAdminLauncher";
import type { ReviewRoutingRequest } from "@/lib/merchantAttendanceReviewRouting";
import OutageLauncher from "./MerchantAttendanceOutageLauncher";
import RetentionLauncher from "./MerchantAttendanceRetentionLauncher";
import RetentionDisposalLauncher from "./MerchantAttendanceRetentionDisposalLauncher";
import CalendarLauncher from "./MerchantAttendanceCalendarLauncher";
import GroupsLauncher from "./MerchantAttendanceGroupsLauncher";
import RulesLauncher from "./MerchantAttendanceRulesLauncher";
import SourcesLauncher from "./MerchantAttendanceSourcesLauncher";
import PersonalRulesLauncher from "./MerchantAttendancePersonalRulesLauncher";
import RuleSourcesLauncher from "./MerchantAttendanceRuleSourcesLauncher";
import RuleCapturesLauncher from "./MerchantAttendanceRuleCapturesLauncher";
import RuleCaptureHistoryLauncher from "./MerchantAttendanceRuleCaptureHistoryLauncher";
import { PlanExceptionEntry } from "./MerchantAttendancePlanExceptionWorkspace";

const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm disabled:bg-slate-50 disabled:text-slate-500";
const button = "shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40";
const primary = "rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40";
const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const defaults: AttendanceAdminSettings = { timeZone: "Europe/Madrid", enabled: false, webClockEnabled: false, webBreakPaid: false };
type Editor = (AttendanceAdminChange & { baseVersion: number; fresh: boolean });
const AuditPanel = lazy(() => import("./MerchantAttendanceAuditPanel"));
const LocationWorkspace = lazy(() => import("./MerchantAttendanceLocationWorkspace"));
const ExceptionWorkspace = lazy(() => import("./MerchantAttendanceExceptionWorkspace"));
const PlanExceptionWorkspace = lazy(() => import("./MerchantAttendancePlanExceptionWorkspace"));
const CorrectionReviewPanel = lazy(() => import("./MerchantAttendanceCorrectionReviewPanel"));
const CorrectionControlsPanel = lazy(() => import("./MerchantAttendanceCorrectionControlsPanel"));
const TimesheetPanel = lazy(() => import("./MerchantAttendanceTimesheetPanel"));
const RevisionApprovalPanel = lazy(() => import("./MerchantAttendanceRevisionApprovalPanel"));
const ReminderCycleIntentPanel = lazy(() => import("./MerchantAttendanceCycleIntentPanel"));

function SettingsForm({ value, version, disabled, onSave, onDirtyChange }: { value: AttendanceAdminSettings | null; version: number; disabled: boolean; onSave: (v: AttendanceAdminSettings, version: number) => void; onDirtyChange: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState(value ?? defaults);
  useLayoutEffect(() => { onDirtyChange(JSON.stringify(draft) !== JSON.stringify(value ?? defaults)); return () => onDirtyChange(false); }, [draft, value, onDirtyChange]);
  return <form className={card} onSubmit={(e) => { e.preventDefault(); onSave(draft, version); }}>
    <h3 className="text-lg font-bold">考勤设置</h3>
    <p className="mt-2 text-sm leading-6 text-slate-500">先确认企业时区，再添加地点和人员。这里只配置普通网页打卡，不会请求员工定位、生成排班或计算工资。</p>
    <fieldset disabled={disabled} className="mt-5 space-y-4">
      <label className="block max-w-md text-sm">企业考勤时区<input aria-label="企业考勤时区" className={input} list="attendance-zones" value={draft.timeZone} onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })} required maxLength={100} /></label>
      <datalist id="attendance-zones"><option value="Europe/Madrid" /><option value="Atlantic/Canary" /><option value="Europe/Lisbon" /><option value="Asia/Shanghai" /><option value="UTC" /></datalist>
      {([["enabled", "启用企业考勤", "员工仍需本人查看／打卡权限，并有有效的考勤档案。"], ["webClockEnabled", "允许普通网页打卡", "需在线登录；不作为已验证到店或定位打卡。"], ["webBreakPaid", "休息计入计薪候选时长", "只是休息策略标记，不会直接生成工资或自动扣除休息。"]] as const).map(([key, label, note]) =>
        <label key={key} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <input className="mt-1" type="checkbox" checked={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
          <span><span className="text-sm font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{note}</span></span>
        </label>)}
      <button className={primary} type="submit">{value ? "保存考勤设置" : "创建考勤配置"}</button>
    </fieldset>
  </form>;
}

export default function MerchantAttendanceAdminPanel(props: Parameters<typeof AdminScreen>[0]) {
  return <AdminScreen key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}
function AdminScreen({ siteId, ownerId, authUserId, isCurrentAuth, siteName, apiFetch, registerLeaveGuard, locationWorkspaceEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LOCATION_WORKSPACE_ENABLED === "1",
  exceptionWorkspaceEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EXCEPTION_WORKSPACE_ENABLED === "1",
  planExceptionsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_ENABLED === "1",
  workArrangementsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_WORK_ARRANGEMENTS_ENABLED === "1",
  missingDelegationEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED === "1",
  applicationDelegationEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_DELEGATION_ENABLED === "1",
  scheduleDelegationEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED === "1",
  periodDelegationEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_DELEGATION_ENABLED === "1",
  correctionDelegationEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED === "1",
  operationalRulesEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OPERATIONAL_RULES_ENABLED === "1",
  operationalCycleEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_ENABLED === "1",
  ownerNotificationsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_ENABLED === "1",
  employmentLifecycleEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EMPLOYMENT_LIFECYCLE_ENABLED === "1",
  administrativeClosureEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_ADMINISTRATIVE_CLOSURES_ENABLED === "1",
  reviewRoutingEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVIEW_ROUTING_ENABLED === "1",
  remindersEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REMINDERS_ENABLED === "1",
  managementDelegationsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_MANAGEMENT_DELEGATIONS_ENABLED === "1",
  delegatedAuditEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_AUDIT_ENABLED === "1",
  independentWorkersEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED === "1",
  outageEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OUTAGE_ENABLED === "1",
  retentionEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RETENTION_ENABLED === "1",
  correctionReviewEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_REVIEW_ENABLED === "1",
  correctionControlsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_CONTROLS_ENABLED === "1",
  timesheetEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_TIMESHEET_ENABLED === "1",
  ownerBacklogEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OWNER_BACKLOG_ENABLED === "1",
  missingEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_MISSING_ENABLED === "1",
  correctionDecisionsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DECISIONS_ENABLED === "1" && process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CURRENT_CORRECTION_DECISIONS_ENABLED === "1",
  revisionApprovalEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVISION_DECISIONS_ENABLED === "1" }: {
  siteId: string; ownerId: string; siteName?: string; apiFetch: AttendanceApiFetch; registerLeaveGuard?: (guard: (() => boolean) | null) => void; locationWorkspaceEnabled?: boolean; exceptionWorkspaceEnabled?: boolean; planExceptionsEnabled?: boolean; workArrangementsEnabled?: boolean; missingDelegationEnabled?: boolean; applicationDelegationEnabled?: boolean; scheduleDelegationEnabled?: boolean; employmentLifecycleEnabled?: boolean; outageEnabled?: boolean; retentionEnabled?: boolean; correctionReviewEnabled?: boolean; correctionControlsEnabled?: boolean; timesheetEnabled?: boolean; revisionApprovalEnabled?: boolean;
  ownerBacklogEnabled?: boolean; missingEnabled?: boolean; correctionDecisionsEnabled?: boolean; administrativeClosureEnabled?: boolean; reviewRoutingEnabled?: boolean; remindersEnabled?: boolean;
  managementDelegationsEnabled?: boolean; delegatedAuditEnabled?: boolean;
  authUserId?: string | null; isCurrentAuth?: () => boolean; periodDelegationEnabled?: boolean; correctionDelegationEnabled?: boolean; ownerNotificationsEnabled?: boolean; operationalRulesEnabled?: boolean; operationalCycleEnabled?: boolean; independentWorkersEnabled?: boolean;
}) {
  const cycleAuthCurrent = useCallback(() => authUserId === ownerId && cycleIntentAuthCurrent(isCurrentAuth), [authUserId, ownerId, isCurrentAuth]);
  const client = useMemo(() => new AttendanceAdminClient({ siteId, ownerId, apiFetch, storage: () => window.sessionStorage }), [siteId, ownerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const reminderContext = useMemo(() => ({ siteId, ownerId, authUserId, apiFetch, isCurrentAuth, epoch: state.authorizationEpoch }),
    [siteId, ownerId, authUserId, apiFetch, isCurrentAuth, state.authorizationEpoch]);
  const [reminderPeriod, setReminderPeriod] = useState<{ context: typeof reminderContext; scope: CycleIntentScope; intentId: string } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [chooser, setChooser] = useState<"employees" | "locations" | null>(null);
  const [search, setSearch] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [locationWorkspace, setLocationWorkspace] = useState<AttendanceAdminLocation | null>(null);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [planExceptionOpen, setPlanExceptionOpen] = useState(false);
  const [correctionReviewOpen, setCorrectionReviewOpen] = useState(false);
  const [correctionControlsOpen, setCorrectionControlsOpen] = useState(false);
  const [timesheetOpen, setTimesheetOpen] = useState(false);
  const [revisionApprovalOpen,setRevisionApprovalOpen]=useState(false);
  const [missingOpen, setMissingOpen] = useState(false), [backlogOpen, setBacklogOpen] = useState(false);
  const [backlogTarget, setBacklogTarget] = useState<OwnerBacklogTarget | null>(null);
  const [routingTarget, setRoutingTarget] = useState<ReviewRoutingRequest | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false), [navigationMessage, setNavigationMessage] = useState("");
  const inlineWorkspaces = useRef(new Set<string>()), [inlineCount, setInlineCount] = useState(0);
  const inlineReporters = useRef(new Map<string, (open: boolean) => void>());
  const reportInline = useCallback((id: string) => {
    if (!inlineReporters.current.has(id)) inlineReporters.current.set(id, open => {
      if (open) inlineWorkspaces.current.add(id); else inlineWorkspaces.current.delete(id);
      setInlineCount(inlineWorkspaces.current.size);
    });
    return inlineReporters.current.get(id)!;
  }, []);
  type Guard = () => boolean;
  const childGuards = useRef(new Map<string, Guard>());
  const registrars = useRef(new Map<string, (guard: Guard | null) => void>());
  const registerChild = useCallback((id: string) => {
    if (!registrars.current.has(id)) registrars.current.set(id, guard => {
      if (guard) childGuards.current.set(id, guard); else childGuards.current.delete(id);
    });
    return registrars.current.get(id)!;
  }, []);
  const parentDraft = useRef(false);
  useLayoutEffect(() => { parentDraft.current = !!editor || settingsDirty; }, [editor, settingsDirty]);
  useLayoutEffect(() => {
    registerLeaveGuard?.(() => {
      // Do not partially discard several open workspaces if a later guard refuses.
      if (inlineWorkspaces.current.size || childGuards.current.size > 1) { window.alert("请先逐一关闭已打开的考勤工作区，再离开企业管理。"); return false; }
      let pending = !!client.getSnapshot().pending;
      try { pending ||= window.sessionStorage.getItem(client.storageKey) !== null; } catch { pending = true; }
      if ((pending || parentDraft.current) && !window.confirm("考勤配置仍有草稿或待确认操作。离开不会自动保存；已发送操作保留原编号供核对。确定离开吗？")) return false;
      return [...childGuards.current.values()].every(guard => guard());
    });
    return () => registerLeaveGuard?.(null);
  }, [registerLeaveGuard, client]);
  useEffect(() => {
    void client.initialize();
    const unload = (e: BeforeUnloadEvent) => { if (client.getSnapshot().pending) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { client.dispose(); window.removeEventListener("beforeunload", unload); };
  }, [client]);
  const busy = state.phase === "loading" || state.phase === "saving";
  const disabled = state.phase !== "ready" || !!state.pending || !state.result?.moduleEnabled;
  const result = state.result;
  const view = result?.view ?? "settings";
  const tabs: { view: AttendanceAdminView; label: string }[] = [{ view: "settings", label: "考勤设置" }, { view: "locations", label: "工作地点" }, { view: "workers", label: "考勤人员" }];
  const navigation = { correction: correctionReviewEnabled && correctionDecisionsEnabled, revision: revisionApprovalEnabled, missing: missingEnabled };
  const targetOccupied = inlineCount > 0 || !!editor || !!chooser || settingsDirty || !!locationWorkspace || planExceptionOpen || exceptionOpen
    || correctionReviewOpen || correctionControlsOpen || revisionApprovalOpen || timesheetOpen || missingOpen || reminderPeriod !== null;
  function selectBacklog(target: OwnerBacklogTarget) {
    if (!ownerBacklogEnabled || !navigation[target.kind] || document.hidden || childGuards.current.size || inlineWorkspaces.current.size
      || !ownerBacklogHostReady(client.getSnapshot(), targetOccupied, () => window.sessionStorage.getItem(client.storageKey))) {
      setNavigationMessage("请先完成或关闭现有编辑、工作区及待确认操作，再打开审批详情；未提交任何审批。"); return false;
    }
    setNavigationMessage(""); setBacklogTarget(target); setBacklogOpen(false);
    if (target.kind === "correction") setCorrectionReviewOpen(true);
    else if (target.kind === "revision") setRevisionApprovalOpen(true);
    else setMissingOpen(true);
    return true;
  }
  function openRoutingOriginal(request: ReviewRoutingRequest) {
    const kind = request.family === "correction" ? "correction" : request.family === "correction_revision" ? "revision" : request.family === "missing" || request.family === "missing_revision" ? "missing" : null;
    if (authUserId !== ownerId || isCurrentAuth?.() === false || document.hidden || parentDraft.current || backlogOpen || inlineWorkspaces.current.size
      || [...childGuards.current.keys()].some(key => key !== "review-routing") || !ownerBacklogHostReady(client.getSnapshot(), targetOccupied, () => window.sessionStorage.getItem(client.storageKey))
      || kind && !navigation[kind] || request.family === "work_arrangement" && !workArrangementsEnabled || request.family === "leave" && process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_ENABLED !== "1") return false;
    setRoutingTarget(request);
    if (kind) { setBacklogTarget({ kind, requestId: request.requestId, submittedAt: request.submittedAt }); if (kind === "correction") setCorrectionReviewOpen(true); else if (kind === "revision") setRevisionApprovalOpen(true); else setMissingOpen(true); }
    return true;
  }
  function openReminderOriginal(request: ReviewRoutingRequest) {
    //The fresh 198 reference carries identity only, not approval authority.
    const kind = request.family === "correction" ? "correction" : request.family === "correction_revision" ? "revision" : request.family === "missing" || request.family === "missing_revision" ? "missing" : null;
    if (!cycleAuthCurrent() || document.hidden || kind && !navigation[kind]
      || request.family === "work_arrangement" && !workArrangementsEnabled || request.family === "leave" && process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_ENABLED !== "1"
      || parentDraft.current || backlogOpen || inlineWorkspaces.current.size
      || [...childGuards.current.keys()].some(key => key !== "reminders")
      || !ownerBacklogHostReady(client.getSnapshot(), targetOccupied, () => window.sessionStorage.getItem(client.storageKey))) return false;
    try {
      if ([attendanceReminderPendingKey(siteId, ownerId), correctionDecisionKey(siteId, ownerId), reviewRoutingPendingKey(siteId, ownerId)]
        .some(key => window.sessionStorage.getItem(key) !== null)) return false;
    } catch { return false; }
    if (!cycleAuthCurrent() || document.hidden) return false;
    setRoutingTarget(request);
    if (kind) { setBacklogTarget({ kind, requestId: request.requestId, submittedAt: request.submittedAt });
      if (kind === "correction") setCorrectionReviewOpen(true); else if (kind === "revision") setRevisionApprovalOpen(true); else setMissingOpen(true); }
    return true;
  }
  function openReminderPeriod(value: CycleIntentResult) {
    //Keep only a scoped pointer, not the reminder's or navigation's old body.
    if (!cycleAuthCurrent() || document.hidden || value.siteId !== siteId || value.actorId !== ownerId || value.receipt !== null || value.data.kind !== "detail"
      || value.data.intent.access !== "owner" || value.data.intent.actorId !== ownerId || value.data.intent.grantId !== null
      || value.data.head.action !== "accept" || value.data.head.revision !== 1 || parentDraft.current || backlogOpen || inlineWorkspaces.current.size
      || [...childGuards.current.keys()].some(key => key !== "reminders")
      || !ownerBacklogHostReady(client.getSnapshot(), targetOccupied, () => window.sessionStorage.getItem(client.storageKey))) return false;
    try {
      if ([attendanceReminderPendingKey(siteId, ownerId), correctionDecisionKey(siteId, ownerId), reviewRoutingPendingKey(siteId, ownerId),
        cycleIntentPendingKey(siteId, ownerId), periodClosurePendingKey(siteId, "owner", ownerId)].some(key => window.sessionStorage.getItem(key) !== null)) return false;
    } catch { return false; }
    if (!cycleAuthCurrent() || document.hidden) return false;
    setReminderPeriod({ context: reminderContext, scope: { siteId, access: "owner", workerId: value.data.intent.workerId, grantId: null }, intentId: value.data.intent.intentId });
    return true;
  }
  function closeApproval(kind: OwnerBacklogTarget["kind"]) {
    if (kind === "correction") setCorrectionReviewOpen(false);
    else if (kind === "revision") setRevisionApprovalOpen(false);
    else setMissingOpen(false);
    if (routingTarget) { setRoutingTarget(null); setBacklogTarget(null); }
    else if (backlogTarget) { setBacklogTarget(null); setBacklogOpen(true); }
    else if (kind === "revision") void client.initialize();
  }
  function navigate(next: AttendanceAdminView) { setEditor(null); setChooser(null); setSearch(""); void client.load(next, null, ""); }
  function create() {
    if (!result?.settings) return;
    if (view === "locations") setEditor({ kind: "location", baseVersion: result.version, fresh: true, values: { id: crypto.randomUUID(), name: "", timeZone: result.settings.timeZone, active: false } });
    else setEditor({ kind: "worker", baseVersion: result.version, fresh: true, values: { id: crypto.randomUUID(), employeeId: "", workerNo: "", displayName: "", locationId: "", startsOn: "", active: false } });
  }
  async function saveEditor() {
    if (!editor) return;
    const { kind, values, baseVersion } = editor;
    const confirmed = await client.submit({ kind, values } as AttendanceAdminChange, baseVersion);
    if (confirmed) { setEditor(null); setChooser(null); }
  }
  if (reminderPeriod && (reminderPeriod.context !== reminderContext || !cycleAuthCurrent())) { setReminderPeriod(null); return null; }
  if (reminderPeriod) return <Suspense fallback={<p role="status" className="p-4">正在加载原周期意向…</p>}>
    <ReminderCycleIntentPanel scope={reminderPeriod.scope} actorId={ownerId} apiFetch={apiFetch} isCurrentAuth={cycleAuthCurrent} enabled={operationalCycleEnabled}
      initialIntentId={reminderPeriod.intentId} registerLeaveGuard={registerChild("reminder-cycle")} onClose={() => setReminderPeriod(null)}/>
  </Suspense>;
  if (planExceptionOpen) return <Suspense fallback={<p role="status" className="p-4">正在加载排班异常处理…</p>}><PlanExceptionWorkspace key={`plan-exceptions:${siteId}:${ownerId}:${state.authorizationEpoch}`}
    siteId={siteId} access="owner" actorId={ownerId} enabled={planExceptionsEnabled} apiFetch={apiFetch} registerLeaveGuard={registerChild("plan-exception")} onClose={() => setPlanExceptionOpen(false)}/></Suspense>;
  if (locationWorkspaceEnabled && locationWorkspace) return <Suspense fallback={<p role="status" className="p-4 text-sm">正在加载地点定位设置…</p>}>
    <LocationWorkspace siteId={siteId} ownerId={ownerId} locationId={locationWorkspace.id} locationName={locationWorkspace.name} apiFetch={apiFetch}
      onClose={() => { setLocationWorkspace(null); setEditor(null); setChooser(null); void client.load("locations", null, search); }}/>
  </Suspense>;
  return <><section hidden={missingOpen || exceptionOpen || correctionReviewOpen || correctionControlsOpen || revisionApprovalOpen || (timesheetEnabled && timesheetOpen)} aria-label="考勤配置管理" className="mt-5 space-y-4">
    <header className={`${card} flex flex-wrap items-center justify-between gap-4`}>
      <div><p className="text-xs text-slate-500">{siteName || "企业管理"} · 仅商户负责人</p><h2 className="mt-2 text-2xl font-bold">员工考勤配置</h2>
        <p className="mt-2 text-sm text-slate-500">设置 → 地点 → 关联员工。不会自动给已有角色增加权限。</p></div>
      <button className={button} disabled={busy} onClick={() => { setEditor(null); setChooser(null); void client.initialize(); }}>重新读取</button>
    </header>
    <ScheduleLauncher siteId={siteId} actorId={ownerId} access="owner" apiFetch={apiFetch} onOpenChange={reportInline("schedule")}/>
    <RetentionLauncher key={`retention:${siteId}:${ownerId}:${state.authorizationEpoch}`} siteId={siteId} actorId={ownerId} apiFetch={apiFetch}
      enabled={retentionEnabled} disabled={busy || !!state.pending || !!editor || state.phase !== "ready"} registerLeaveGuard={registerChild("retention")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    {authUserId === ownerId && isCurrentAuth && <RetentionDisposalLauncher siteId={siteId} authUserId={authUserId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth}
      disabled={busy || !!state.pending || !!editor || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || !isCurrentAuth() || busy || client.getSnapshot().pending || parentDraft.current || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("retention-disposal")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    <OutageLauncher key={`outages:${siteId}:${ownerId}:${state.authorizationEpoch}`} siteId={siteId} actorId={ownerId} access="owner" apiFetch={apiFetch}
      enabled={outageEnabled} disabled={busy || !!state.pending || !!editor} registerLeaveGuard={registerChild("outage")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    <AccountSuspensionLauncher key={`account-suspensions:${siteId}:${ownerId}:${state.authorizationEpoch}`} siteId={siteId} ownerId={ownerId} apiFetch={apiFetch}
      disabled={busy || !!state.pending || !!editor} registerLeaveGuard={registerChild("suspension")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    <EmploymentLifecycleLauncher key={`employment-lifecycle:${siteId}:${ownerId}:${state.authorizationEpoch}`} siteId={siteId} ownerId={ownerId} apiFetch={apiFetch}
      enabled={employmentLifecycleEnabled} disabled={busy || !!state.pending || !!editor} registerLeaveGuard={registerChild("employment")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    {authUserId === ownerId && <AdministrativeClosureLauncher key={`administrative-closure:${siteId}:${ownerId}:${authUserId}`} siteId={siteId} access="owner" authUserId={authUserId}
      apiFetch={apiFetch} isCurrentAuth={isCurrentAuth} enabled={administrativeClosureEnabled} disabled={busy || !!state.pending || !!editor || targetOccupied || backlogOpen}
      beforeOpen={() => { if (document.hidden || busy || client.getSnapshot().pending || parentDraft.current || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("administrative-closure")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && <ReviewRoutingLauncher siteId={siteId} authUserId={authUserId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth} enabled={reviewRoutingEnabled}
      disabled={busy || !!state.pending || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || isCurrentAuth?.() === false || busy || client.getSnapshot().pending || parentDraft.current || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("review-routing")} onOpenOriginal={openRoutingOriginal}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && isCurrentAuth && <RemindersLauncher siteId={siteId} actorId={authUserId} ownerId={ownerId} apiFetch={apiFetch}
      isCurrentAuth={cycleAuthCurrent} enabled={remindersEnabled} requesterKey={String(state.authorizationEpoch)}
      disabled={busy || !!state.pending || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || !cycleAuthCurrent() || parentDraft.current || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        return ownerBacklogHostReady(client.getSnapshot(), targetOccupied, () => window.sessionStorage.getItem(client.storageKey)); }}
      registerLeaveGuard={registerChild("reminders")} onOpenOriginal={openReminderOriginal} onOpenPeriod={openReminderPeriod}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && isCurrentAuth && <ManagementDelegatedLauncher key={`management-delegated:${siteId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={authUserId} ownerMode isCurrentAuth={cycleAuthCurrent} apiFetch={apiFetch}
      grantEnabled={managementDelegationsEnabled} auditEnabled={delegatedAuditEnabled} requesterKey={String(state.authorizationEpoch)}
      disabled={busy || !!state.pending || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || !cycleAuthCurrent() || busy || client.getSnapshot().pending || parentDraft.current || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        return ownerBacklogHostReady(client.getSnapshot(), targetOccupied, () => window.sessionStorage.getItem(client.storageKey)); }}
      registerLeaveGuard={registerChild("management-delegated")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && isCurrentAuth && <DelegatedPlanExceptionsLauncher key={`plan-exceptions-delegated:${siteId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={authUserId} ownerMode isCurrentAuth={cycleAuthCurrent} apiFetch={apiFetch}
      grantEnabled={managementDelegationsEnabled} requesterKey={String(state.authorizationEpoch)}
      disabled={busy || !!state.pending || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || !cycleAuthCurrent() || busy || client.getSnapshot().pending || parentDraft.current || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        return ownerBacklogHostReady(client.getSnapshot(), targetOccupied, () => window.sessionStorage.getItem(client.storageKey)); }}
      registerLeaveGuard={registerChild("plan-exceptions-delegated")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {missingEnabled && <button type="button" className={button} disabled={busy || !!state.pending || targetOccupied || state.phase !== "ready"}
      onClick={() => { if (ownerBacklogHostReady(client.getSnapshot(), targetOccupied, () => window.sessionStorage.getItem(client.storageKey)) && !childGuards.current.size && !inlineWorkspaces.current.size) setMissingOpen(true); }}>整段漏卡审核</button>}
    <MissingDelegationLauncher key={`missing-delegation:${siteId}:${ownerId}:${state.authorizationEpoch}`} siteId={siteId} actorId={ownerId} access="owner" apiFetch={apiFetch}
      enabled={missingDelegationEnabled} disabled={busy || !!state.pending || !!editor} registerLeaveGuard={registerChild("missing-delegation")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    <ApplicationDelegationLauncher key={`application-delegation:${siteId}:${ownerId}:${state.authorizationEpoch}`} siteId={siteId} actorId={ownerId} access="owner" apiFetch={apiFetch}
      enabled={applicationDelegationEnabled} disabled={busy || !!state.pending || !!editor} registerLeaveGuard={registerChild("application-delegation")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    <ScheduleDelegationLauncher key={`schedule-delegation:${siteId}:${ownerId}:${state.authorizationEpoch}`} siteId={siteId} actorId={ownerId} access="owner" apiFetch={apiFetch}
      enabled={scheduleDelegationEnabled} disabled={busy || !!state.pending || !!editor} registerLeaveGuard={registerChild("schedule-delegation")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    {authUserId === ownerId && <OwnerNotificationsLauncher key={`owner-notifications:${siteId}:${ownerId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={ownerId} authUserId={authUserId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth} enabled={ownerNotificationsEnabled}
      planExceptionsEnabled={planExceptionsEnabled} disabled={busy || state.phase !== "ready" || !!state.pending || targetOccupied || backlogOpen}
      beforeOpen={() => { if (document.hidden || client.getSnapshot().phase !== "ready" || client.getSnapshot().pending || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      beforeTarget={() => { if (document.hidden || client.getSnapshot().phase !== "ready" || client.getSnapshot().pending || targetOccupied || backlogOpen || inlineWorkspaces.current.size || [...childGuards.current.keys()].some(key => key !== "owner-notifications")) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("owner-notifications")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && <PeriodDelegationLauncher key={`period-delegation:${siteId}:${ownerId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={ownerId} authUserId={authUserId} access="owner" apiFetch={apiFetch} isCurrentAuth={isCurrentAuth}
      enabled={periodDelegationEnabled} disabled={busy || !!state.pending || targetOccupied || backlogOpen}
      beforeOpen={() => { if (document.hidden || busy || client.getSnapshot().pending || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("period-delegation")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && <CorrectionDelegationLauncher key={`correction-delegation:${siteId}:${ownerId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={ownerId} authUserId={authUserId} access="owner" apiFetch={apiFetch} isCurrentAuth={isCurrentAuth}
      enabled={correctionDelegationEnabled} disabled={busy || !!state.pending || !!editor || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || busy || editor || client.getSnapshot().phase !== "ready" || client.getSnapshot().pending || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("correction-delegation")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && <OperationalRulesLauncher key={`operational-rules:${siteId}:${ownerId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={authUserId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth} enabled={operationalRulesEnabled} readOnlyAvailable
      disabled={busy || !!state.pending || !!editor || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || busy || editor || client.getSnapshot().phase !== "ready" || client.getSnapshot().pending || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("operational-rules")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && <OperationalPunchActivationLauncher key={`operational-punch-activation:${siteId}:${ownerId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={authUserId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth} readOnlyAvailable
      disabled={busy || !!state.pending || !!editor || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || busy || editor || client.getSnapshot().phase !== "ready" || client.getSnapshot().pending || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("operational-punch-activation")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && <OperationalConsumerActivationLauncher key={`operational-consumer-activation:${siteId}:${ownerId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={authUserId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth} readOnlyAvailable
      disabled={busy || !!state.pending || !!editor || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || busy || editor || client.getSnapshot().phase !== "ready" || client.getSnapshot().pending || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("operational-consumer-activation")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && <OperationalConsumerActivationLauncher key={`review-routing-activation:${siteId}:${ownerId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={authUserId} consumer="review_routing" apiFetch={apiFetch} isCurrentAuth={isCurrentAuth} enabled={reviewRoutingEnabled} readOnlyAvailable
      disabled={busy || !!state.pending || !!editor || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || busy || editor || client.getSnapshot().phase !== "ready" || client.getSnapshot().pending || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("review-routing-activation")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && isCurrentAuth && <OperationalConsumerActivationLauncher key={`timesheet-cycle-activation:${siteId}:${ownerId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={authUserId} consumer="timesheet_cycle" apiFetch={apiFetch} isCurrentAuth={cycleAuthCurrent} enabled={operationalCycleEnabled} readOnlyAvailable
      disabled={busy || !!state.pending || !!editor || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || !cycleAuthCurrent() || client.getSnapshot().phase !== "ready" || client.getSnapshot().pending || parentDraft.current || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("timesheet-cycle-activation")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && isCurrentAuth && <OperationalConsumerActivationLauncher key={`reminders-activation:${siteId}:${ownerId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={authUserId} consumer="reminders" apiFetch={apiFetch} isCurrentAuth={cycleAuthCurrent} enabled={remindersEnabled} readOnlyAvailable
      disabled={busy || !!state.pending || !!editor || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || !cycleAuthCurrent() || client.getSnapshot().phase !== "ready" || client.getSnapshot().pending || parentDraft.current || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("reminders-activation")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    {authUserId === ownerId && <IndependentAdminLauncher key={`independent-workers:${siteId}:${authUserId}:${state.authorizationEpoch}`}
      siteId={siteId} actorId={authUserId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth} enabled={independentWorkersEnabled}
      disabled={busy || !!state.pending || !!editor || targetOccupied || backlogOpen || state.phase !== "ready"}
      beforeOpen={() => { if (document.hidden || busy || editor || isCurrentAuth?.() === false || client.getSnapshot().phase !== "ready" || client.getSnapshot().pending || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
        try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
      registerLeaveGuard={registerChild("independent-workers")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
    <TerminalLauncher siteId={siteId} ownerId={ownerId} apiFetch={apiFetch} onOpenChange={reportInline("terminal")}/>
    <OwnerBacklogLauncher siteId={siteId} ownerId={ownerId} apiFetch={apiFetch} enabled={ownerBacklogEnabled}
      open={backlogOpen} onOpenChange={setBacklogOpen} navigation={navigation} onSelect={selectBacklog}
      disabled={busy || !!state.pending || targetOccupied || state.phase !== "ready"}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    {navigationMessage && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{navigationMessage}</p>}
    <ScheduleOverviewLauncher siteId={siteId} ownerId={ownerId} apiFetch={apiFetch} active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    {/* A rejected parent read invalidates old child displays, not the child's independent read permission. */}
    <LeaveLauncher key={`${siteId}:${ownerId}:${state.authorizationEpoch}:${routingTarget?.family === "leave" ? routingTarget.requestId : "list"}`} siteId={siteId} actorId={ownerId} access="owner" apiFetch={apiFetch}
      initialSelection={routingTarget?.family === "leave" ? routingTarget : null} isCurrentAuth={isCurrentAuth}
      onOpenChange={reportInline("leave")} onTargetClose={() => setRoutingTarget(null)}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    <WorkArrangementLauncher key={`work-arrangements:${siteId}:${ownerId}:${state.authorizationEpoch}:${routingTarget?.family === "work_arrangement" ? routingTarget.requestId : "list"}`} siteId={siteId} actorId={ownerId} access="owner" apiFetch={apiFetch}
      initialSelection={routingTarget?.family === "work_arrangement" ? routingTarget : null} isCurrentAuth={isCurrentAuth}
      onTargetClose={() => setRoutingTarget(null)}
      enabled={workArrangementsEnabled} disabled={busy || !!state.pending || !!editor} registerLeaveGuard={registerChild("arrangements")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    <CalendarLauncher siteId={siteId} ownerId={ownerId} apiFetch={apiFetch}
      onOpenChange={reportInline("calendar")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    <GroupsLauncher siteId={siteId} ownerId={ownerId} apiFetch={apiFetch} rulesAuthorizationEpoch={state.authorizationEpoch}
      onOpenChange={reportInline("groups")}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    <RulesLauncher key={`rules:${siteId}:${ownerId}:${state.authorizationEpoch}`} siteId={siteId} ownerId={ownerId} groupId={null} apiFetch={apiFetch}
      active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>
    {exceptionWorkspaceEnabled && <button type="button" className={button} disabled={busy || !!state.pending || !!editor || state.phase !== "ready"} onClick={() => setExceptionOpen(true)}>定位异常核查／员工说明</button>}
    <PlanExceptionEntry key={`plan-exceptions-entry:${siteId}:${ownerId}:${state.authorizationEpoch}`} siteId={siteId} access="owner" actorId={ownerId} enabled={planExceptionsEnabled}
      disabled={busy || !!state.pending || !!editor || state.phase !== "ready"} onOpen={() => setPlanExceptionOpen(true)}/>
    {correctionReviewEnabled && <button type="button" className={button} disabled={busy || !!state.pending || !!editor || state.phase !== "ready"} onClick={() => setCorrectionReviewOpen(true)}>补正申请核对（只读）</button>}
    {revisionApprovalEnabled && <button type="button" className={button} disabled={busy || !!state.pending || !!editor || state.phase !== "ready"} onClick={() => setRevisionApprovalOpen(true)}>连续修订审批／恢复</button>}
    {correctionControlsEnabled && <button type="button" className={button} disabled={busy || !!state.pending || !!editor || state.phase !== "ready"} onClick={() => setCorrectionControlsOpen(true)}>补正规则／锁定配置</button>}
    {timesheetEnabled && <button type="button" className={button} disabled={busy || !!state.pending || !!editor || state.phase !== "ready" || !result?.settings} onClick={() => setTimesheetOpen(true)}>周期工时核对（只读）</button>}
    <div role="status" aria-live="polite" className={`rounded-2xl border p-4 text-sm leading-6 ${state.pending ? "border-amber-200 bg-amber-50 text-amber-950" : state.phase === "blocked" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-blue-100 bg-blue-50 text-blue-900"}`}>
      <p className="font-semibold">{state.phase === "saving" ? "保存中" : state.pending ? "保存结果待确认" : "配置状态"}</p><p>{state.message}</p>
      {state.pending && <div className="mt-3 flex flex-wrap items-center gap-3"><span className="break-all text-xs">操作编号：{state.pending.command.operationId}</span>
        <button className={button} disabled={state.phase !== "unconfirmed"} onClick={() => void client.retry()}>原编号重试保存</button></div>}
    </div>
    {result && !result.moduleEnabled && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">平台尚未开放或已暂停新考勤。此处可查看已有配置和核对保存结果，不能新建或修改。仅暂停考勤不会删除记录；权限仍有效的在岗员工可以结束休息、下班。</p>}
    <nav aria-label="考勤管理分类" className="flex flex-wrap gap-2">{tabs.map((t) => <button className={`${button} ${view === t.view ? "ring-2 ring-blue-500" : ""}`} key={t.view}
      disabled={busy || !!state.pending} onClick={() => navigate(t.view)}>{t.label}</button>)}</nav>
    {result && <>
      {view === "settings" && <SettingsForm key={`${siteId}:${result.version}`} value={result.settings} version={result.version} disabled={disabled}
        onDirtyChange={setSettingsDirty}
        onSave={(values, v) => void client.submit({ kind: "settings", values }, v)} />}
      {view !== "settings" && !result.settings && <div className={card}>请先在「考勤设置」中确认时区并创建配置。</div>}
      {editor && <form className={card} onSubmit={(e) => { e.preventDefault(); void saveEditor(); }}>
        <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold">{editor.fresh ? "新增" : "修改"}{editor.kind === "location" ? "工作地点" : "考勤人员"}</h3>
          <button type="button" className={button} disabled={busy || !!state.pending} onClick={() => { setEditor(null); setChooser(null); }}>取消编辑</button></div>
        <fieldset disabled={disabled} className="mt-4 grid gap-4 sm:grid-cols-2">
          {editor.kind === "location" ? <>
            <label className="text-sm">地点名称<input className={input} aria-label="地点名称" required maxLength={120} value={editor.values.name} onChange={(e) => setEditor({ ...editor, values: { ...editor.values, name: e.target.value } })} /></label>
            <label className="text-sm">地点时区<input className={input} aria-label="地点时区" required maxLength={100} value={editor.values.timeZone} onChange={(e) => setEditor({ ...editor, values: { ...editor.values, timeZone: e.target.value } })} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editor.values.active} onChange={(e) => setEditor({ ...editor, values: { ...editor.values, active: e.target.checked } })} />启用此地点</label>
          </> : editor.kind === "worker" ? <>
            <div className="text-sm"><p>关联员工（保存后不可直接换人）</p><button type="button" className={`${button} mt-1 w-full text-left`} disabled={!editor.fresh}
              onClick={() => { setChooser("employees"); setSearch(""); void client.load("employees", null, ""); }}>{editor.values.employeeId ? `已选择：${editor.values.displayName || "员工"}` : "选择已有员工"}</button></div>
            <label className="text-sm">考勤显示名<input className={input} required maxLength={120} value={editor.values.displayName} onChange={(e) => setEditor({ ...editor, values: { ...editor.values, displayName: e.target.value } })} /></label>
            <label className="text-sm">企业内工号<input className={input} required maxLength={40} value={editor.values.workerNo} onChange={(e) => setEditor({ ...editor, values: { ...editor.values, workerNo: e.target.value } })} /></label>
            <label className="text-sm">在职起始日期<input type="date" className={input} required min="2000-01-01" max="2100-12-31" disabled={!editor.fresh} value={editor.values.startsOn}
              onInput={(e) => setEditor({ ...editor, values: { ...editor.values, startsOn: e.currentTarget.value } })}
              onChange={(e) => setEditor({ ...editor, values: { ...editor.values, startsOn: e.target.value } })} /></label>
            <div className="text-sm"><p>默认工作地点</p><button type="button" className={`${button} mt-1 w-full text-left`} onClick={() => { setChooser("locations"); setSearch(""); void client.load("locations", null, ""); }}>
              {editor.values.locationId ? "已选择地点 · 点击更换" : "选择工作地点"}</button></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editor.values.active} onChange={(e) => setEditor({ ...editor, values: { ...editor.values, active: e.target.checked } })} />启用此考勤人员</label>
          </> : null}
          <div className="sm:col-span-2"><button className={primary} type="submit" disabled={disabled || (editor.kind === "worker" && (!editor.values.employeeId || !editor.values.locationId))}>保存{editor.kind === "location" ? "地点" : "考勤人员"}</button></div>
        </fieldset>
        <p className="mt-4 text-xs leading-5 text-slate-500">不自动修改员工角色。已有打卡后的时区、身份、在职日期变更，需要后续的生效日期／补正流程；未下班时不允许停用或换地点。</p>
      </form>}
      {view !== "settings" && result.settings && <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">{chooser ? `选择${chooser === "employees" ? "未关联的员工" : "工作地点"}` : view === "locations" ? "工作地点" : "考勤人员"}</h3>
          {!chooser && <button className={button} disabled={disabled} onClick={create}>新增{view === "locations" ? "地点" : "考勤人员"}</button>}</div>
        <form className="my-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void client.load(view, null, search); }}><input aria-label="搜索考勤列表" className={`${input} mt-0`} maxLength={80} placeholder="按名称或工号搜索" value={search} onChange={(e) => setSearch(e.target.value)} /><button className={button} disabled={busy} type="submit">搜索</button></form>
        <div className="space-y-2">{result.items.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">暂无符合条件的记录。</p> : result.items.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
          <div className="min-w-0"><p className="break-words font-semibold">{"name" in item ? item.name : item.displayName}</p><p className="mt-1 text-xs text-slate-500">{"workerNo" in item ? `工号 ${item.workerNo} · ${item.startsOn} 起` : "timeZone" in item ? item.timeZone : "已激活的员工账号"}{"active" in item ? ` · ${item.active ? "启用" : "停用"}` : ""}</p></div>
          {locationWorkspaceEnabled && view === "locations" && !chooser && "name" in item && <button type="button" className={button}
            disabled={busy || !!state.pending || !!editor || state.phase !== "ready"} onClick={() => setLocationWorkspace(item as AttendanceAdminLocation)}>定位政策与围栏</button>}
          {view === "workers" && !chooser && "workerNo" in item && <SourcesLauncher key={`sources:${state.authorizationEpoch}`} siteId={siteId} ownerId={ownerId} workerId={item.id} apiFetch={apiFetch}
            active={!busy && !state.pending && !editor && state.phase === "ready" && !missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
          {view === "workers" && !chooser && "workerNo" in item && authUserId && <DayReviewLauncher key={`day-reviews:${state.authorizationEpoch}`} siteId={siteId} actorId={authUserId}
            access="owner" workerId={item.id} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth} registerLeaveGuard={registerChild(`day-review-worker:${item.id}`)}
            disabled={busy || !!state.pending || !!editor || state.phase !== "ready"} beforeOpen={() => childGuards.current.size === 0 && !parentDraft.current}
            active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
          {view === "workers" && !chooser && "workerNo" in item && authUserId === ownerId && isCurrentAuth && <CycleIntentLauncher key={`cycle-worker:${item.id}:${state.authorizationEpoch}`}
            scope={{ siteId, access: "owner", workerId: item.id, grantId: null }} actorId={authUserId} apiFetch={apiFetch} isCurrentAuth={cycleAuthCurrent} enabled={operationalCycleEnabled}
            disabled={busy || !!state.pending || targetOccupied || backlogOpen || state.phase !== "ready"} registerLeaveGuard={registerChild(`cycle-worker:${item.id}`)}
            beforeOpen={() => { if (document.hidden || !cycleAuthCurrent() || client.getSnapshot().phase !== "ready" || client.getSnapshot().pending || parentDraft.current || targetOccupied || backlogOpen || childGuards.current.size || inlineWorkspaces.current.size) return false;
              try { return window.sessionStorage.getItem(client.storageKey) === null; } catch { return false; } }}
            active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
          {view === "workers" && !chooser && "workerNo" in item && <EmploymentLifecycleLauncher key={`employment-lifecycle-worker:${state.authorizationEpoch}`} siteId={siteId} ownerId={ownerId} workerId={item.id} apiFetch={apiFetch}
            enabled={employmentLifecycleEnabled} disabled={busy || !!state.pending || !!editor} registerLeaveGuard={registerChild(`employment-worker:${item.id}`)}
            active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
          {view === "workers" && !chooser && "workerNo" in item && <OutageLauncher key={`outage-worker:${state.authorizationEpoch}`} siteId={siteId} actorId={ownerId} access="owner" workerId={item.id} apiFetch={apiFetch}
            enabled={outageEnabled} disabled={busy || !!state.pending || !!editor} registerLeaveGuard={registerChild(`outage-worker:${item.id}`)}
            active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
          {view === "workers" && !chooser && "workerNo" in item && <PersonalRulesLauncher key={`personal-rules:${state.authorizationEpoch}`} siteId={siteId} ownerId={ownerId} workerId={item.id} apiFetch={apiFetch}
            active={!busy && !state.pending && !editor && state.phase === "ready" && !missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
          {view === "workers" && !chooser && "workerNo" in item && <RuleSourcesLauncher key={`rule-sources:${state.authorizationEpoch}`} siteId={siteId} ownerId={ownerId} workerId={item.id} apiFetch={apiFetch}
            active={!busy && !state.pending && !editor && state.phase === "ready" && !missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
          {view === "workers" && !chooser && "workerNo" in item && <RuleCapturesLauncher key={`rule-captures:${state.authorizationEpoch}`} siteId={siteId} ownerId={ownerId} workerId={item.id} apiFetch={apiFetch}
            active={!busy && !state.pending && !editor && state.phase === "ready" && !missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
          {view === "workers" && !chooser && "workerNo" in item && <RuleCaptureHistoryLauncher key={`rule-capture-history:${state.authorizationEpoch}`} siteId={siteId} ownerId={ownerId} workerId={item.id} apiFetch={apiFetch}
            active={!busy && !state.pending && !editor && state.phase === "ready" && !missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}/>}
          <button className={button} disabled={disabled || (chooser === "locations" && "active" in item && !item.active)} onClick={() => {
            if (chooser && editor?.kind === "worker") {
              setEditor({ ...editor, values: chooser === "employees" ? { ...editor.values, employeeId: item.id, displayName: "displayName" in item ? item.displayName : "" } : { ...editor.values, locationId: item.id } });
              setChooser(null); setSearch(""); void client.load("workers", null, "");
            } else if (view === "locations") setEditor({ kind: "location", values: item as AttendanceAdminLocation, fresh: false, baseVersion: result.version });
            else if (view === "workers") setEditor({ kind: "worker", values: item as AttendanceAdminWorker, fresh: false, baseVersion: result.version });
          }}>{chooser ? "选择" : "编辑"}</button>
        </div>)}</div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><span>每页最多 25 项 · 不加载全部员工</span><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => void client.load(view, null, search)}>回到首页</button>
          <button className={button} disabled={busy || !result.nextCursor} onClick={() => void client.load(view, result.nextCursor, search)}>下一页</button></div></div>
      </div>}
    </>}
    <div><button type="button" className={button} aria-expanded={auditOpen} onClick={() => setAuditOpen(!auditOpen)}>{auditOpen ? "收起考勤变更记录" : "查看考勤变更记录"}</button></div>
    {auditOpen && <Suspense fallback={<p role="status" className="p-4 text-sm text-slate-500">正在加载变更记录…</p>}><AuditPanel siteId={siteId} ownerId={ownerId} apiFetch={apiFetch}/></Suspense>}
    <p className="text-xs leading-6 text-slate-500">此处支持已有员工账号的普通网页考勤配置。主管范围及打卡明细使用独立入口；负责人定位工作区需独立候选开关，完整定位联调、设备、排班、审批与报表尚待完成。考勤接口还需发布开关开放后才能使用。</p>
  </section>{exceptionOpen && <Suspense fallback={<p role="status" className="p-4">正在加载异常处理工作区…</p>}>
    <ExceptionWorkspace siteId={siteId} access="owner" actorId={ownerId} apiFetch={apiFetch} registerLeaveGuard={registerChild("exception")}
      parentLeaveWarning="考勤配置页及其中其他面板可能仍有未提交的输入；离开会丢弃这些输入，不会自动保存。已发送操作不会因此撤销，请返回后核对原编号。" onClose={() => setExceptionOpen(false)}/>
  </Suspense>}{correctionReviewOpen && <Suspense fallback={<p role="status" className="p-4">正在加载补正申请核对…</p>}>
    <CorrectionReviewPanel siteId={siteId} ownerId={ownerId} apiFetch={apiFetch} decisionsEnabled={correctionDecisionsEnabled}
      initialRequestId={backlogTarget?.kind === "correction" ? backlogTarget.requestId : undefined}
      registerLeaveGuard={registerChild("correction")} onClose={() => closeApproval("correction")}/>
  </Suspense>}{correctionControlsOpen && <Suspense fallback={<p role="status" className="p-4">正在加载补正规则与锁定配置…</p>}>
    <CorrectionControlsPanel siteId={siteId} ownerId={ownerId} apiFetch={apiFetch} onClose={() => setCorrectionControlsOpen(false)}/>
  </Suspense>}{timesheetEnabled && timesheetOpen && <Suspense fallback={<p role="status" className="p-4">正在加载周期工时报表…</p>}>
    <TimesheetPanel key={`period-context:${siteId}:${ownerId}:${state.authorizationEpoch}`} siteId={siteId} ownerId={ownerId} apiFetch={apiFetch} registerLeaveGuard={registerChild("timesheet")} onClose={() => { setTimesheetOpen(false); void client.initialize(); }}/>
  </Suspense>}{revisionApprovalEnabled && revisionApprovalOpen && <Suspense fallback={<p role="status" className="p-4">正在加载连续修订审批…</p>}>
    <RevisionApprovalPanel siteId={siteId} ownerId={ownerId} apiFetch={apiFetch}
      initialRequestId={backlogTarget?.kind === "revision" ? backlogTarget.requestId : null}
      registerLeaveGuard={registerChild("revision")} onClose={()=>closeApproval("revision")}/>
  </Suspense>}
    <MissingLauncher siteId={siteId} actorId={ownerId} access="owner" apiFetch={apiFetch} enabled={missingEnabled}
      open={missingOpen} showTrigger={false} onOpenChange={open => { if (!open) closeApproval("missing"); }}
      initialSelection={backlogTarget?.kind === "missing" ? { requestId: backlogTarget.requestId, submittedAt: backlogTarget.submittedAt } : null} registerLeaveGuard={registerChild("missing")}/>
  </>;
}
