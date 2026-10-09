"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { AttendanceAction, AttendanceEvent } from "@/lib/merchantAttendance";
import { attendanceActionAllowed } from "@/lib/merchantAttendanceEntitlement";
import { AttendanceSelfClient, attendancePendingKey, type AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { hasEmployeeLocationPending } from "@/lib/merchantAttendanceEmployeeLocationWorkspace";
import ScopedTimesheetLauncher from "./MerchantAttendanceScopedTimesheetLauncher";
import ScheduleLauncher from "./MerchantAttendanceScheduleLauncher";
import MissingLauncher from "./MerchantAttendanceMissingLauncher";
import SelfRevisionHistoryLauncher from "./MerchantAttendanceSelfRevisionHistoryLauncher";
import SelfRequestsLauncher from "./MerchantAttendanceSelfRequestsLauncher";
import LeaveLauncher from "./MerchantAttendanceLeaveLauncher";
import WorkArrangementLauncher from "./MerchantAttendanceWorkArrangementLauncher";
import MissingDelegationLauncher from "./MerchantAttendanceMissingDelegationLauncher";
import ApplicationDelegationLauncher from "./MerchantAttendanceApplicationDelegationLauncher";
import ScheduleDelegationLauncher from "./MerchantAttendanceScheduleDelegationLauncher";
import LeaveNotificationsLauncher from "./MerchantAttendanceLeaveNotificationsLauncher";
import EventNotificationsLauncher from "./MerchantAttendanceEventNotificationsLauncher";
import OutageLauncher from "./MerchantAttendanceOutageLauncher";
import DayReviewLauncher from "./MerchantAttendanceDayReviewLauncher";
import { AttendanceSelfScheduleClient } from "@/lib/merchantAttendanceSelfScheduleClient";
import { AttendanceSelfScheduleAdoptionClient, selfScheduleAdoptionPendingKey } from "@/lib/merchantAttendanceSelfScheduleAdoptionClient";
import SelfScheduleAdoptionClock from "./MerchantAttendanceSelfScheduleAdoptionClock";
import { PlanExceptionEntry } from "./MerchantAttendancePlanExceptionWorkspace";
import OperationalPunchHost from "./MerchantAttendanceOperationalPunchHost";

const ACTION_LABELS: Record<AttendanceAction, string> = {
  clock_in: "上班打卡", break_start: "开始休息", break_end: "结束休息", clock_out: "下班打卡",
};
const HistoryPanel = lazy(() => import("./MerchantAttendanceHistoryPanel"));
const LocationWorkspace = lazy(() => import("./MerchantAttendanceEmployeeLocationWorkspace"));
const ExceptionWorkspace = lazy(() => import("./MerchantAttendanceExceptionWorkspace"));
const PlanExceptionWorkspace = lazy(() => import("./MerchantAttendancePlanExceptionWorkspace"));
const CorrectionWorkspace = lazy(() => import("./MerchantAttendanceCorrectionWorkspace"));
function eventTime(event: AttendanceEvent) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: event.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(event.occurredAt));
}

export default function MerchantAttendanceSelfPanel({ openOperationalOnMount = false, ...props }: Parameters<typeof LegacySelfPanel>[0] & { openOperationalOnMount?: boolean }) {
  const legacyGuard = useRef<(() => boolean) | null>(null), parentGuard = props.registerLeaveGuard;
  const register = useCallback((guard: (() => boolean) | null) => { legacyGuard.current = guard; parentGuard?.(guard); }, [parentGuard]);
  if (!props.authUserId) return <LegacySelfPanel {...props}/>;
  return <OperationalPunchHost key={`${props.siteId}:${props.employeeId}:${props.authUserId}`} scope={{ siteId: props.siteId, channel: "self", authUserId: props.authUserId, terminalId: null, workerNo: null }}
    employeeId={props.employeeId} canClock={props.canClock} apiFetch={props.apiFetch} openOperationalOnMount={openOperationalOnMount}
    registerLeaveGuard={parentGuard} beforeOpen={() => !legacyGuard.current || legacyGuard.current()}>
    <LegacySelfPanel {...props} registerLeaveGuard={register}/>
  </OperationalPunchHost>;
}
function LegacySelfPanel({ siteId, employeeId, authUserId, isCurrentAuth, employeeName, siteName, canClock, apiFetch, registerLeaveGuard: registerParentLeaveGuard,
  locationWorkspaceEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EMPLOYEE_LOCATION_WORKSPACE_ENABLED === "1",
  exceptionWorkspaceEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EXCEPTION_WORKSPACE_ENABLED === "1",
  planExceptionsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_ENABLED === "1",
  workArrangementsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_WORK_ARRANGEMENTS_ENABLED === "1",
  missingDelegationEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED === "1",
  applicationDelegationEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_DELEGATION_ENABLED === "1",
  scheduleDelegationEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED === "1",
  eventNotificationsEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_ENABLED === "1",
  outageEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OUTAGE_ENABLED === "1",
  selfScheduleEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_SCHEDULE_ENABLED === "1",
  selfScheduleAdoptionEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_SCHEDULE_ADOPTION_ENABLED === "1",
  correctionWorkspaceEnabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED === "1" }: {
  siteId: string; employeeId: string; authUserId?: string | null; isCurrentAuth?: () => boolean; employeeName: string; siteName?: string; canClock: boolean; apiFetch: AttendanceApiFetch; registerLeaveGuard?: (guard: (() => boolean) | null) => void; locationWorkspaceEnabled?: boolean; exceptionWorkspaceEnabled?: boolean; planExceptionsEnabled?: boolean; workArrangementsEnabled?: boolean; missingDelegationEnabled?: boolean; applicationDelegationEnabled?: boolean; scheduleDelegationEnabled?: boolean; eventNotificationsEnabled?: boolean; outageEnabled?: boolean; correctionWorkspaceEnabled?: boolean; selfScheduleEnabled?: boolean; selfScheduleAdoptionEnabled?: boolean;
}) {
  // Keep the new independent modal's guard without replacing any existing guard.
  const legacyLeaveGuard = useRef<(() => boolean) | null>(null), outageLeaveGuard = useRef<(() => boolean) | null>(null);
  const missingLeaveGuard = useRef<(() => boolean) | null>(null), correctionLeaveGuard = useRef<(() => boolean) | null>(null);
  const dayReviewLeaveGuard = useRef<(() => boolean) | null>(null);
  const combinedOutageLeaveGuard = useCallback(() => (!dayReviewLeaveGuard.current || dayReviewLeaveGuard.current()) && (!missingLeaveGuard.current || missingLeaveGuard.current()) && (!correctionLeaveGuard.current || correctionLeaveGuard.current()) && (!outageLeaveGuard.current || outageLeaveGuard.current()) && (!legacyLeaveGuard.current || legacyLeaveGuard.current()), []);
  const registerLeaveGuard = useCallback((guard: (() => boolean) | null) => { legacyLeaveGuard.current = guard;
    registerParentLeaveGuard?.(guard || dayReviewLeaveGuard.current || outageLeaveGuard.current || missingLeaveGuard.current || correctionLeaveGuard.current ? combinedOutageLeaveGuard : null); }, [registerParentLeaveGuard, combinedOutageLeaveGuard]);
  const registerOutageLeaveGuard = useCallback((guard: (() => boolean) | null) => { outageLeaveGuard.current = guard;
    registerParentLeaveGuard?.(guard || dayReviewLeaveGuard.current || legacyLeaveGuard.current || missingLeaveGuard.current || correctionLeaveGuard.current ? combinedOutageLeaveGuard : null); }, [registerParentLeaveGuard, combinedOutageLeaveGuard]);
  const registerMissingLeaveGuard = useCallback((guard: (() => boolean) | null) => { missingLeaveGuard.current = guard;
    registerParentLeaveGuard?.(guard || dayReviewLeaveGuard.current || legacyLeaveGuard.current || outageLeaveGuard.current || correctionLeaveGuard.current ? combinedOutageLeaveGuard : null); }, [registerParentLeaveGuard, combinedOutageLeaveGuard]);
  const registerCorrectionLeaveGuard = useCallback((guard: (() => boolean) | null) => { correctionLeaveGuard.current = guard;
    registerParentLeaveGuard?.(guard || dayReviewLeaveGuard.current || legacyLeaveGuard.current || outageLeaveGuard.current || missingLeaveGuard.current ? combinedOutageLeaveGuard : null); }, [registerParentLeaveGuard, combinedOutageLeaveGuard]);
  const registerDayReviewLeaveGuard = useCallback((guard: (() => boolean) | null) => { dayReviewLeaveGuard.current = guard;
    registerParentLeaveGuard?.(guard || legacyLeaveGuard.current || outageLeaveGuard.current || missingLeaveGuard.current || correctionLeaveGuard.current ? combinedOutageLeaveGuard : null); }, [registerParentLeaveGuard, combinedOutageLeaveGuard]);
  const client = useMemo(() => new AttendanceSelfClient({ siteId, employeeId, canClock, apiFetch,
    storage: () => window.sessionStorage }), [siteId, employeeId, canClock, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const scheduleClient = useMemo(() => new AttendanceSelfScheduleClient({ siteId, employeeId, canClock, enabled: selfScheduleEnabled, apiFetch,
    storage: () => window.sessionStorage, canStart: () => {
      const current = client.getSnapshot();
      try { return current.phase === "ready" && !current.pending && !!current.result?.moduleEnabled
        && window.sessionStorage.getItem(attendancePendingKey(siteId, employeeId)) === null
        && window.sessionStorage.getItem(selfScheduleAdoptionPendingKey(siteId, employeeId)) === null
        && !hasEmployeeLocationPending(window.sessionStorage, { siteId, employeeId }); } catch { return false; }
    } }), [siteId, employeeId, canClock, selfScheduleEnabled, apiFetch, client]);
  const scheduleState = useSyncExternalStore(scheduleClient.subscribe, scheduleClient.getSnapshot, scheduleClient.getSnapshot);
  const adoptionClient = useMemo(() => new AttendanceSelfScheduleAdoptionClient({ siteId, employeeId, canClock, enabled: selfScheduleAdoptionEnabled, apiFetch,
    storage: () => window.sessionStorage, canStart: () => {
      const current = client.getSnapshot();
      try { return current.phase === "ready" && !current.pending && !!current.result?.moduleEnabled && !scheduleClient.blocksOtherActions()
        && window.sessionStorage.getItem(attendancePendingKey(siteId, employeeId)) === null
        && !hasEmployeeLocationPending(window.sessionStorage, { siteId, employeeId }); } catch { return false; }
    } }), [siteId, employeeId, canClock, selfScheduleAdoptionEnabled, apiFetch, client, scheduleClient]);
  const adoptionState = useSyncExternalStore(adoptionClient.subscribe, adoptionClient.getSnapshot, adoptionClient.getSnapshot);
  const scheduleBlocked = [scheduleState, adoptionState].some(s => s.phase === "loading" || s.phase === "submitting" || s.phase === "storage_error" || !!s.pending);
  const checkSchedulePending = () => document.hidden || scheduleClient.blocksOtherActions() || adoptionClient.blocksOtherActions();
  const onScheduleConfirmed = useCallback(() => { void client.refresh(); }, [client]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [planExceptionOpen, setPlanExceptionOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const periodLeaveGuard = useRef<(() => boolean) | null>(null);
  const workLeaveGuard = useRef<(() => boolean) | null>(null);
  const delegationLeaveGuard = useRef<(() => boolean) | null>(null);
  const applicationLeaveGuard = useRef<(() => boolean) | null>(null);
  const scheduleDelegationLeaveGuard = useRef<(() => boolean) | null>(null);
  const eventNotificationsLeaveGuard = useRef<(() => boolean) | null>(null);
  const combinedLeaveGuard = useCallback(() => (!eventNotificationsLeaveGuard.current || eventNotificationsLeaveGuard.current()) && (!scheduleDelegationLeaveGuard.current || scheduleDelegationLeaveGuard.current()) && (!applicationLeaveGuard.current || applicationLeaveGuard.current()) && (!delegationLeaveGuard.current || delegationLeaveGuard.current()) && (!workLeaveGuard.current || workLeaveGuard.current()) && (!periodLeaveGuard.current || periodLeaveGuard.current()), []);
  const registerPeriodLeaveGuard = useCallback((guard: (() => boolean) | null) => { periodLeaveGuard.current = guard;
    registerLeaveGuard?.(guard || eventNotificationsLeaveGuard.current || scheduleDelegationLeaveGuard.current || workLeaveGuard.current || delegationLeaveGuard.current || applicationLeaveGuard.current ? combinedLeaveGuard : null); }, [registerLeaveGuard, combinedLeaveGuard]);
  const registerWorkLeaveGuard = useCallback((guard: (() => boolean) | null) => { workLeaveGuard.current = guard;
    registerLeaveGuard?.(guard || eventNotificationsLeaveGuard.current || scheduleDelegationLeaveGuard.current || periodLeaveGuard.current || delegationLeaveGuard.current || applicationLeaveGuard.current ? combinedLeaveGuard : null); }, [registerLeaveGuard, combinedLeaveGuard]);
  const registerDelegationLeaveGuard = useCallback((guard: (() => boolean) | null) => { delegationLeaveGuard.current = guard;
    registerLeaveGuard?.(guard || eventNotificationsLeaveGuard.current || scheduleDelegationLeaveGuard.current || periodLeaveGuard.current || workLeaveGuard.current || applicationLeaveGuard.current ? combinedLeaveGuard : null); }, [registerLeaveGuard, combinedLeaveGuard]);
  const registerApplicationLeaveGuard = useCallback((guard: (() => boolean) | null) => { applicationLeaveGuard.current = guard;
    registerLeaveGuard?.(guard || eventNotificationsLeaveGuard.current || scheduleDelegationLeaveGuard.current || periodLeaveGuard.current || workLeaveGuard.current || delegationLeaveGuard.current ? combinedLeaveGuard : null); }, [registerLeaveGuard, combinedLeaveGuard]);
  const registerScheduleDelegationLeaveGuard = useCallback((guard: (() => boolean) | null) => { scheduleDelegationLeaveGuard.current = guard;
    registerLeaveGuard?.(guard || eventNotificationsLeaveGuard.current || periodLeaveGuard.current || workLeaveGuard.current || delegationLeaveGuard.current || applicationLeaveGuard.current ? combinedLeaveGuard : null); }, [registerLeaveGuard, combinedLeaveGuard]);
  const registerEventNotificationsLeaveGuard = useCallback((guard: (() => boolean) | null) => { eventNotificationsLeaveGuard.current = guard;
    registerLeaveGuard?.(guard || scheduleDelegationLeaveGuard.current || periodLeaveGuard.current || workLeaveGuard.current || delegationLeaveGuard.current || applicationLeaveGuard.current ? combinedLeaveGuard : null); }, [registerLeaveGuard, combinedLeaveGuard]);
  const mayLeavePeriod = () => (!missingLeaveGuard.current || missingLeaveGuard.current()) && (!periodLeaveGuard.current || periodLeaveGuard.current());
  const [locationOpen, setLocationOpen] = useState(false), [locationPending, setLocationPending] = useState(locationWorkspaceEnabled);
  const checkLocationPending = () => {
    if (!locationWorkspaceEnabled) return false;
    let pending = true;
    try { pending = hasEmployeeLocationPending(window.sessionStorage, { siteId, employeeId }); } catch { /* Do not start a second channel when storage is unreadable. */ }
    setLocationPending(pending); return pending;
  };
  useEffect(() => {
    if (locationOpen) return;
    if (exceptionOpen) return;
    if (planExceptionOpen) return;
    if (correctionOpen) return;
    const inspectOtherChannel = () => {
      if (!locationWorkspaceEnabled) { setLocationPending(false); return; }
      try { setLocationPending(hasEmployeeLocationPending(window.sessionStorage, { siteId, employeeId })); } catch { setLocationPending(true); }
    };
    inspectOtherChannel();
    void client.initialize();
    let lastFocusCheck = 0;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastFocusCheck < 10000) return;
      lastFocusCheck = Date.now(); inspectOtherChannel(); void client.refresh();
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (!client.getSnapshot().pending) return;
      event.preventDefault(); event.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      client.dispose(); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("beforeunload", onUnload);
    };
  }, [client, locationOpen, locationWorkspaceEnabled, siteId, employeeId, exceptionOpen, correctionOpen, planExceptionOpen]);
  const waiting = state.phase === "loading" || state.phase === "submitting";
  const ready = state.phase === "ready" && !!state.result;
  const status = state.result?.state.status;
  const statusLabel = !state.result ? "待同步" : status === "off" ? "未在岗" : status === "break" ? "休息中" : "工作中";
  const actions: AttendanceAction[] = status === "off" ? ["clock_in"] : status === "break" ? ["break_end"] : status === "working" ? ["clock_out", "break_start"] : [];
  const last = state.result?.state.lastEvent;
  const confirmed = state.confirmed;
  const neutral = "rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
  const scheduleClock = <SelfScheduleAdoptionClock key={`self-schedule:${siteId}:${employeeId}:${state.authorizationEpoch}`} client={adoptionClient} oldClient={scheduleClient}
    enabled={selfScheduleAdoptionEnabled} oldEnabled={selfScheduleEnabled} canClock={canClock} legacyState={state}
    active={!correctionOpen && !exceptionOpen && !locationOpen && !planExceptionOpen} onConfirmed={onScheduleConfirmed}/>;
  if (planExceptionOpen) return <>{scheduleClock}<Suspense fallback={<p role="status" className="p-4">正在加载异常说明与处理结果…</p>}><PlanExceptionWorkspace
    key={`plan-exceptions:${siteId}:${employeeId}:${state.authorizationEpoch}`} siteId={siteId} access="self" actorId={employeeId} enabled={planExceptionsEnabled} apiFetch={apiFetch}
    registerLeaveGuard={registerLeaveGuard} onClose={() => setPlanExceptionOpen(false)}
    onOpenCorrections={correctionWorkspaceEnabled ? () => { setPlanExceptionOpen(false); setCorrectionOpen(true); } : undefined}/></Suspense></>;
  if (correctionOpen) return <>{scheduleClock}<Suspense fallback={<p role="status" className="p-4">正在加载本人补正申请…</p>}>
    <CorrectionWorkspace siteId={siteId} employeeId={employeeId} authUserId={authUserId} apiFetch={apiFetch} registerLeaveGuard={registerCorrectionLeaveGuard} onClose={() => setCorrectionOpen(false)}/>
  </Suspense></>;
  if (exceptionOpen) return <>{scheduleClock}<Suspense fallback={<p role="status" className="p-4">正在加载本人异常说明…</p>}>
    <ExceptionWorkspace siteId={siteId} access="self" actorId={employeeId} apiFetch={apiFetch} registerLeaveGuard={registerLeaveGuard} onClose={() => setExceptionOpen(false)}/>
  </Suspense></>;
  if (locationOpen) return <>{scheduleClock}<Suspense fallback={<div role="status" className="p-5">正在加载定位考勤…</div>}>
    <LocationWorkspace siteId={siteId} employeeId={employeeId} authUserId={authUserId} canClock={canClock} apiFetch={apiFetch} onClose={() => setLocationOpen(false)}/>
  </Suspense></>;
  return (
    <section aria-label="我的考勤" className="mt-5 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <p className="text-xs font-semibold tracking-wider text-slate-500">{siteName || "企业管理"} · 员工考勤</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-950">我的考勤</h2>
          <p className="mt-2 text-sm text-slate-600">{employeeName} · 仅记录本人打卡</p>
        </div>
        <button type="button" className={neutral} disabled={waiting}
          onClick={() => void (state.phase === "storage_error" ? client.initialize() : client.refresh())}>
          {waiting ? "正在核对…" : state.pending ? "核对打卡结果" : "刷新状态"}
        </button>
      </header>
      <Link className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold" href="/enterprise/attendance-administrative-closures"
        onClick={event => { event.preventDefault(); if (!combinedOutageLeaveGuard()) return;
          // Preserve the existing clock clients' beforeunload pending protection.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- This independent page intentionally performs a full guarded navigation.
          window.location.assign("/enterprise/attendance-administrative-closures"); }}>本人行政结案记录与异议（暂停／离职后仍可核验）</Link>
      <ScopedTimesheetLauncher key={`period-context:${siteId}:${employeeId}:${state.authorizationEpoch}`} siteId={siteId} actorId={employeeId} access="self" apiFetch={apiFetch} registerLeaveGuard={registerPeriodLeaveGuard}/>
      {authUserId && <DayReviewLauncher key={`day-reviews:${siteId}:${employeeId}:${authUserId}:${state.authorizationEpoch}`} siteId={siteId} actorId={authUserId} access="self"
        apiFetch={apiFetch} isCurrentAuth={isCurrentAuth} disabled={waiting} beforeOpen={combinedOutageLeaveGuard} registerLeaveGuard={registerDayReviewLeaveGuard}/>}
      {authUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(authUserId) &&
        <OutageLauncher key={`outages:${siteId}:${employeeId}:${authUserId}:${state.authorizationEpoch}`} siteId={siteId} actorId={authUserId} access="self" apiFetch={apiFetch}
          enabled={outageEnabled} disabled={waiting} beforeOpen={combinedLeaveGuard} registerLeaveGuard={registerOutageLeaveGuard}/>}
      <ScheduleLauncher siteId={siteId} actorId={employeeId} access="self" apiFetch={apiFetch}/>
      <MissingLauncher siteId={siteId} actorId={employeeId} authUserId={authUserId} access="self" apiFetch={apiFetch} registerLeaveGuard={registerMissingLeaveGuard}/>
      <MissingDelegationLauncher key={`missing-delegation:${siteId}:${employeeId}:${state.authorizationEpoch}`} siteId={siteId} actorId={employeeId} access="delegate" apiFetch={apiFetch}
        enabled={missingDelegationEnabled} disabled={waiting} beforeOpen={mayLeavePeriod} registerLeaveGuard={registerDelegationLeaveGuard}/>
      <ApplicationDelegationLauncher key={`application-delegation:${siteId}:${employeeId}:${state.authorizationEpoch}`} siteId={siteId} actorId={employeeId} access="delegate" apiFetch={apiFetch}
        enabled={applicationDelegationEnabled} disabled={waiting} beforeOpen={mayLeavePeriod} registerLeaveGuard={registerApplicationLeaveGuard}/>
      <ScheduleDelegationLauncher key={`schedule-delegation:${siteId}:${employeeId}:${state.authorizationEpoch}`} siteId={siteId} actorId={employeeId} access="delegate" apiFetch={apiFetch}
        enabled={scheduleDelegationEnabled} disabled={waiting} beforeOpen={mayLeavePeriod} registerLeaveGuard={registerScheduleDelegationLeaveGuard}/>
      <SelfRevisionHistoryLauncher siteId={siteId} employeeId={employeeId} apiFetch={apiFetch}/>
      <SelfRequestsLauncher siteId={siteId} employeeId={employeeId} apiFetch={apiFetch}/>
      {/* Reset authorized snapshots/drafts on parent rejection; leave history can still independently reauthorize. */}
      <LeaveLauncher key={`leave:${siteId}:${employeeId}:${state.authorizationEpoch}`} siteId={siteId} employeeId={employeeId} access="self" apiFetch={apiFetch}
        active={!exceptionOpen && !correctionOpen && !locationOpen}/>
      <WorkArrangementLauncher key={`work-arrangements:${siteId}:${employeeId}:${state.authorizationEpoch}`} siteId={siteId} actorId={employeeId} access="self" apiFetch={apiFetch}
        enabled={workArrangementsEnabled} disabled={waiting} beforeOpen={mayLeavePeriod} registerLeaveGuard={registerWorkLeaveGuard}/>
      <LeaveNotificationsLauncher key={`notifications:${siteId}:${employeeId}:${state.authorizationEpoch}`} siteId={siteId} employeeId={employeeId} apiFetch={apiFetch}
        active={!exceptionOpen && !correctionOpen && !locationOpen}/>
      <EventNotificationsLauncher key={`event-notifications:${siteId}:${employeeId}:${state.authorizationEpoch}`} siteId={siteId} employeeId={employeeId} apiFetch={apiFetch}
        enabled={eventNotificationsEnabled} disabled={waiting} beforeOpen={mayLeavePeriod} registerLeaveGuard={registerEventNotificationsLeaveGuard}/>
      {exceptionWorkspaceEnabled && <button type="button" className={neutral} disabled={scheduleBlocked || waiting || !!state.pending || locationPending || state.phase === "storage_error"} onClick={() => { if (mayLeavePeriod() && !checkSchedulePending()) setExceptionOpen(true); }}>我的定位异常／提交说明</button>}
      <PlanExceptionEntry key={`plan-exceptions-entry:${siteId}:${employeeId}:${state.authorizationEpoch}`} siteId={siteId} access="self" actorId={employeeId}
        enabled={planExceptionsEnabled} disabled={waiting} onOpen={() => { if (mayLeavePeriod()) setPlanExceptionOpen(true); }}/>
      {correctionWorkspaceEnabled && <button type="button" className={neutral} disabled={scheduleBlocked || waiting || !!state.pending || locationPending || state.phase === "storage_error"} onClick={() => {
        if (!mayLeavePeriod()) return;
        if (checkSchedulePending()) return;
        try { if (window.sessionStorage.getItem(attendancePendingKey(siteId, employeeId)) !== null) { void client.initialize(); return; } }
        catch { void client.initialize(); return; }
        if (!checkLocationPending()) setCorrectionOpen(true);
      }}>我的补正申请／核对结果</button>}

      {locationWorkspaceEnabled && <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm">
        <button type="button" className={neutral} disabled={scheduleBlocked || waiting || !!state.pending || state.phase === "storage_error"} onClick={() => {
          if (!mayLeavePeriod()) return;
          if (checkSchedulePending()) return;
          try { if (window.sessionStorage.getItem(attendancePendingKey(siteId, employeeId)) !== null) { void client.initialize(); return; } }
          catch { void client.initialize(); return; }
          setLocationOpen(true);
        }}>定位打卡／地点告知</button>
        <p className="mt-2 leading-6">查看本人定位考勤与地点告知；功能暂停后，也可进入核对原定位班次是否能够收尾。打开页面不会请求位置。</p>
        {locationPending && <p className="mt-2 text-amber-900">定位考勤有待核对操作或恢复存储不可用。请先进入上方入口核对，暂不另起普通打卡。</p>}
      </div>}

      <div role="status" aria-live="polite" className={`rounded-2xl border px-5 py-4 text-sm leading-6 ${
        state.pending || state.phase === "storage_error" ? "border-amber-200 bg-amber-50 text-amber-950"
          : state.phase === "blocked" ? "border-rose-200 bg-rose-50 text-rose-800"
            : confirmed && ready ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-blue-100 bg-blue-50 text-blue-900"}`}>
        <p className="font-semibold">{state.phase === "submitting" ? "提交中" : state.pending ? "打卡结果待确认" : confirmed && ready ? "打卡已确认" : "考勤状态"}</p>
        <p className="mt-1">{state.message}</p>
        {state.pending ? (
          <div className="mt-3 space-y-2">
            <p>待核对：{ACTION_LABELS[state.pending.command.action]}。原操作编号已暂存在本浏览器标签页，刷新后会继续核对。</p>
            <p className="break-all text-xs">操作编号：{state.pending.command.operationId}</p>
            <button type="button" className={neutral} disabled={scheduleBlocked || waiting || locationPending || !canClock || !state.result || state.phase !== "unconfirmed"} onClick={() => { if (!checkSchedulePending() && !checkLocationPending()) void client.retry(); }}>
              用原操作编号重试
            </button>
            {!state.result && !waiting ? <p className="text-xs">需先成功核对当前身份与打卡状态，才可用原编号重试；身份异常请联系企业负责人。</p> : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-600">服务器最近确认状态</h3>
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${!state.result ? "bg-slate-100 text-slate-600" : status === "working" ? "bg-emerald-50 text-emerald-700" : status === "break" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{statusLabel}</span>
          </div>
          <p className="mt-5 text-3xl font-bold tracking-tight text-slate-950">{statusLabel}</p>
          <p className="mt-3 text-sm leading-6 text-slate-500">{!state.result ? "同步成功后才可发起打卡。" : status === "break" ? "休息结束后，先点击“结束休息”，再进行其他打卡。" : status === "working" ? "离岗时请进行下班打卡；开始休息请单独记录。" : "开始工作时，请点击上班打卡。"}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {actions.filter(action => action !== "clock_in" || !selfScheduleAdoptionEnabled && !adoptionState.pending && (!selfScheduleEnabled || scheduleState.result?.selectionEnabled === false)).map((action, index) => (
              <button key={action} type="button" disabled={scheduleBlocked || !ready || locationPending || !canClock || !state.result?.locationId || !attendanceActionAllowed(state.result.moduleEnabled, action)}
                onClick={() => { if (!checkSchedulePending() && !checkLocationPending()) void client.submit(action); }} className={index === 0
                  ? "min-h-14 flex-1 rounded-2xl bg-slate-950 px-5 py-4 text-base font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  : `${neutral} min-h-14 flex-1`}>
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
          {scheduleClock}
          {state.result && !state.result.moduleEnabled ? <p className="mt-4 text-sm leading-6 text-amber-800">平台尚未开放或已暂停新考勤。可核对记录；权限仍有效时，可结束已有休息并下班，不能开始新班次或休息。</p> : null}
          {!canClock ? <p className="mt-4 text-sm text-amber-800">当前角色仅可查看本人考勤，不能提交打卡。</p> : null}
          {state.result && !state.result.locationId ? <p className="mt-4 text-sm text-amber-800">尚未分配考勤地点，请联系企业负责人。</p> : null}
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="text-base font-bold text-slate-950">最近一笔打卡</h3>
          {last ? <dl className="mt-5 space-y-4 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">动作</dt><dd className="font-semibold text-slate-900">{ACTION_LABELS[last.action]}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-500">服务器记录时间</dt><dd className="font-semibold tabular-nums text-slate-900">{eventTime(last)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">地点时区</dt><dd className="break-all text-slate-700">{last.timeZone}</dd></div>
          </dl> : <p className="mt-5 text-sm text-slate-500">{state.result ? "暂无已确认的打卡记录。" : "等待服务器同步，不显示推测记录。"}</p>}
          {confirmed ? <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">此次操作收据 · {ACTION_LABELS[confirmed.action]}</p>
            <p className="mt-2 tabular-nums">{eventTime(confirmed)} · {confirmed.timeZone}</p>
            <p className="mt-2 break-all text-xs">收据编号：{confirmed.id}</p>
            <p className="mt-2 text-xs">原操作收据与当前状态分别显示，较早的收据不会覆盖最新状态。</p>
          </div> : null}
        </div>
      </div>
      <div><button type="button" className={neutral} aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}>{historyOpen ? "收起本人历史打卡" : "查看本人历史打卡"}</button></div>
      {historyOpen && <Suspense fallback={<p role="status" className="p-4 text-sm text-slate-500">正在加载本人历史查询…</p>}>
        <HistoryPanel siteId={siteId} employeeId={employeeId} apiFetch={apiFetch}/>
      </Suspense>}
      <p className="px-1 text-xs leading-6 text-slate-500">打卡时间以服务器实际记录为准。网络异常时，结果必须再次核对；本页面不提供离线打卡，也不会据此自动计算工资。</p>
    </section>
  );
}
