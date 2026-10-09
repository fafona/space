"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { correctionTimeOffsets } from "@/lib/merchantAttendanceCorrectionForm";
import { resolveLeaveInterval, type LeaveDecision, type LeaveDetail, type LeaveResponse } from "@/lib/merchantAttendanceLeave";
import { AttendanceLeaveClient } from "@/lib/merchantAttendanceLeaveClient";
import type { LeaveReviewResponse } from "@/lib/merchantAttendanceLeaveReview";
import { AttendanceLeaveReviewClient } from "@/lib/merchantAttendanceLeaveReviewClient";
import type { AttendanceLeavePanelProps } from "./MerchantAttendanceLeaveLauncher";
import ReviewRoutingSelf from "./MerchantAttendanceReviewRoutingSelf";

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50 disabled:text-slate-500";
const statusLabels: Record<string, string> = {
  submitted: "待审批",
  withdrawn: "已撤回",
  approved: "已批准",
  rejected: "已驳回",
  cancelled: "已取消",
};
const historyLabels: Record<string, string> = {
  submit: "提交申请",
  withdraw: "员工撤回",
  approve: "负责人或获授权审批人批准",
  reject: "负责人或获授权审批人驳回",
  cancel: "负责人取消批准",
};

type Props = AttendanceLeavePanelProps & { onClose: () => void; reviewEnabled?: boolean };
type WallTime = { local: string; offset: string };
type ResolvedInterval = { startAt: string; endAt: string };
type OwnerView = "all" | "review";
const inactiveReviewState = { phase: "idle" as const, result: null, message: "待审批视图未启用。" };
const inactiveReviewSnapshot = () => inactiveReviewState;
const inactiveReviewSubscribe = () => () => {};

export default function MerchantAttendanceLeavePanel(props: Props) {
  const identityId = props.access === "self" ? props.employeeId : props.actorId;
  return <Screen key={`${props.siteId}:${identityId}:${props.access}`} {...props}/>;
}

function Screen(props: Props) {
  const { siteId, access, apiFetch, onClose, initialSelection, isCurrentAuth } = props;
  const employeeId = access === "self" ? props.employeeId : null;
  const ownerId = access === "owner" ? props.actorId : null;
  const reviewEnabled = access === "owner" && (props.reviewEnabled
    ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED === "1");
  const client = useMemo(() => new AttendanceLeaveClient(access === "self"
    ? { siteId, access, employeeId: employeeId!, apiFetch, storage: () => window.sessionStorage }
    : { siteId, access, actorId: ownerId!, apiFetch, storage: () => window.sessionStorage }),
  [siteId, access, employeeId, ownerId, apiFetch]);
  const reviewClient = useMemo(() => reviewEnabled && ownerId
    ? new AttendanceLeaveReviewClient({ siteId, ownerId, apiFetch }) : null,
  [reviewEnabled, siteId, ownerId, apiFetch]);
  const clientSubscribe = useMemo(() => (listener: () => void) => client.subscribe(() => {
    if (client.getSnapshot().phase === "blocked") reviewClient?.pause();
    listener();
  }), [client, reviewClient]);
  const state = useSyncExternalStore(clientSubscribe, client.getSnapshot, client.getSnapshot);
  const reviewState = useSyncExternalStore(reviewClient?.subscribe ?? inactiveReviewSubscribe,
    reviewClient?.getSnapshot ?? inactiveReviewSnapshot, reviewClient?.getSnapshot ?? inactiveReviewSnapshot);
  const [dirty, setDirty] = useState(false), [visible, setVisible] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false), [ownerView, setOwnerView] = useState<OwnerView>("all");
  const [draftVersion, setDraftVersion] = useState(0);
  const ownerViewRef = useRef<OwnerView>("all"), uiGeneration = useRef(0);

  const chooseView = (next: OwnerView) => {
    ownerViewRef.current = next;
    setOwnerView(next);
  };
  const currentDocumentIsVisible = () => document.visibilityState !== "hidden";
  const refreshAll = async (mode: "initialize" | "load") => {
    const generation = ++uiGeneration.current;
    reviewClient?.pause();
    setReviewVisible(false);
    setVisible(false);
    if (mode === "initialize") await client.initialize();
    else await client.load();
    if (generation === uiGeneration.current && currentDocumentIsVisible()) setVisible(true);
  };
  const refreshReview = async (mode: "initialize" | "load") => {
    if (!reviewClient) return;
    const generation = ++uiGeneration.current;
    reviewClient.pause();
    setReviewVisible(false);
    setVisible(false);
    if (client.getSnapshot().pending || mode === "initialize") await client.initialize();
    else await client.load();
    if (generation !== uiGeneration.current || !currentDocumentIsVisible()) return;
    setVisible(true);
    const original = client.getSnapshot();
    if (original.phase !== "ready" || original.pending || original.result?.receipt || original.result?.detail) return;
    await reviewClient.load();
    if (generation !== uiGeneration.current || !currentDocumentIsVisible()) return;
    setReviewVisible(true);
    if (reviewClient.getSnapshot().phase === "blocked") setVisible(false);
  };

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      const generation = ++uiGeneration.current;
      setVisible(false);
      setReviewVisible(false);
      reviewClient?.pause();
      await client.initialize();
      if (!mounted || generation !== uiGeneration.current || !currentDocumentIsVisible()) return;
      const original = client.getSnapshot();
      if (initialSelection && access === "owner") {
        if (isCurrentAuth?.() === false) return;
        if (original.pending || original.phase !== "ready") { setVisible(true); return; }
        await client.detail(initialSelection.requestId);
        if (!mounted || generation !== uiGeneration.current || !currentDocumentIsVisible() || isCurrentAuth?.() === false) return;
        const selected = client.getSnapshot().result?.detail, expected = initialSelection;
        if (expected.family !== "leave" || !selected || selected.requestId !== expected.requestId || selected.workerId !== expected.workerId || selected.employeeId !== expected.employeeId
          || Date.parse(selected.submittedAt) !== Date.parse(expected.submittedAt)) { client.pause(); return; }
        setVisible(true); return;
      }
      setVisible(true);
      if (ownerViewRef.current !== "review" || !reviewClient || original.phase !== "ready" || original.pending
        || original.result?.receipt || original.result?.detail) return;
      await reviewClient.load();
      if (!mounted || generation !== uiGeneration.current || !currentDocumentIsVisible()) return;
      setReviewVisible(true);
      if (reviewClient.getSnapshot().phase === "blocked") setVisible(false);
    };
    const hide = () => {
      uiGeneration.current++;
      setDirty(false);
      setDraftVersion(value => value + 1);
      setVisible(false);
      setReviewVisible(false);
      client.pause();
      reviewClient?.pause();
    };
    const visibility = () => {
      if (currentDocumentIsVisible()) void initialize();
      else hide();
    };
    if (currentDocumentIsVisible()) void initialize();
    else hide();
    document.addEventListener("visibilitychange", visibility);
    if (reviewClient) window.addEventListener("pagehide", hide);
    return () => {
      mounted = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate every UI task that may outlive this effect
      uiGeneration.current++;
      document.removeEventListener("visibilitychange", visibility);
      if (reviewClient) window.removeEventListener("pagehide", hide);
      client.pause();
      reviewClient?.pause();
    };
  }, [client, reviewClient, initialSelection, isCurrentAuth, access]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!dirty && !state.pending) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, state.pending]);

  const discardDraft = () => {
    if (dirty && !window.confirm("未提交的请假时间、理由或审批意见会清除，继续吗？")) return false;
    setDirty(false);
    setDraftVersion(value => value + 1);
    return true;
  };
  const switchView = (next: OwnerView) => {
    if (next === ownerView || !reviewClient || switchDisabled || !discardDraft()) return;
    chooseView(next);
    if (next === "review") void refreshReview("load");
    else void refreshAll("load");
  };
  const selectReviewItem = async (requestId: string) => {
    if (!reviewClient) return;
    const source = reviewClient.getSnapshot();
    if (!source?.result?.items.some(item => item.requestId === requestId) || reviewSelectionDisabled || !discardDraft()) return;
    const generation = ++uiGeneration.current;
    reviewClient.pause();
    setReviewVisible(false);
    setVisible(false);
    await client.detail(requestId);
    if (generation === uiGeneration.current && currentDocumentIsVisible()) setVisible(true);
  };
  const nextReviewPage = async () => {
    if (!reviewClient || reviewSelectionDisabled) return;
    const generation = ++uiGeneration.current;
    setReviewVisible(false);
    await reviewClient.next();
    if (generation !== uiGeneration.current || !currentDocumentIsVisible()) return;
    setReviewVisible(true);
    if (reviewClient.getSnapshot().phase === "blocked") setVisible(false);
  };
  const close = () => {
    if (dirty && !window.confirm("未提交的请假时间、理由或审批意见会清除，继续吗？")) return;
    if (state.pending && !window.confirm("操作结果仍待确认。离开不会撤销已发送的操作，返回后须按原编号核对。继续吗？")) return;
    setDirty(false);
    uiGeneration.current++;
    client.pause();
    reviewClient?.pause();
    onClose();
  };
  const busy = state.phase === "loading" || state.phase === "saving";
  const reviewBusy = reviewState.phase === "loading";
  const anyBusy = busy || reviewBusy;
  const result = visible && reviewState.phase !== "blocked" ? state.result : null;
  const reviewResult = ownerView === "review" && reviewVisible && state.phase !== "blocked" ? reviewState.result : null;
  const locked = busy || !!state.pending || state.phase !== "ready";
  const switchDisabled = anyBusy || !!state.pending || state.phase !== "ready";
  const reviewSelectionDisabled = locked || reviewState.phase !== "ready";

  return <section aria-label={access === "self" ? "我的请假申请" : "请假申请审批"}
    className="my-4 min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div>
      <h2 className="text-xl font-bold">{access === "self" ? "我的请假申请" : "请假申请审批"}</h2>
      <p className="mt-1 text-sm text-slate-600">当地时间申请 · 当前企业时区 · 明确审批</p>
    </div><button type="button" className={button} onClick={close}>关闭请假申请</button></header>

    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">
      本功能只保存请假申请及决定，不自动扣减假期余额，不生成、修改或阻止打卡，不改排班，也不计算工时、工资或薪资。无需且请勿填写或上传病历、诊断、证件等敏感资料；本页面没有附件上传。
    </p>
    {reviewClient && <nav aria-label="负责人请假视图" className="flex flex-wrap gap-2">
      <button type="button" className={button} aria-pressed={ownerView === "review"} disabled={ownerView === "review" || switchDisabled}
        onClick={() => switchView("review")}>待审批</button>
      <button type="button" className={button} aria-pressed={ownerView === "all"} disabled={ownerView === "all" || switchDisabled}
        onClick={() => switchView("all")}>全部申请</button>
    </nav>}
    <p role="status" aria-live="polite" className={`rounded-xl p-3 text-sm ${state.phase === "blocked" || state.pending ? "bg-amber-50 text-amber-950" : "bg-blue-50 text-blue-950"}`}>{state.message}</p>
    {ownerView === "review" && reviewClient && <p role="status" aria-live="polite"
      className={`rounded-xl p-3 text-sm ${reviewState.phase === "blocked" ? "bg-amber-50 text-amber-950" : "bg-blue-50 text-blue-950"}`}>{reviewState.message}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={anyBusy} onClick={() => {
        if (!discardDraft()) return;
        if (!reviewClient) void client.initialize();
        else if (ownerView === "review") void refreshReview("initialize");
        else void refreshAll("initialize");
      }}>{state.pending ? "重新读取／查原收据" : "重新读取"}</button>
      <button type="button" className={button} disabled={switchDisabled} onClick={() => {
        if (!discardDraft()) return;
        if (!reviewClient) void client.load();
        else if (ownerView === "review") void refreshReview("load");
        else void refreshAll("load");
      }}>{ownerView === "review" && reviewClient ? "重新查询待审批首页" : "重新查询首页"}</button>
      {state.pending && <button type="button" className={button} disabled={state.phase !== "unconfirmed"} onClick={() => {
        if (window.confirm("先查询原操作收据；如仍未确认，只用同一操作编号重试原内容，不创建新编号。继续吗？")) void client.retry();
      }}>用原编号明确重试</button>}
    </div>
    {state.pending && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p>操作结果待确认；未查到收据不等于失败，不能另起一笔操作。</p>
      <p className="mt-1 break-all text-xs">原操作编号：{state.pending.command.operationId}</p>
    </div>}

    {result && <>
      <p className="text-sm">企业考勤时区：<strong>{result.timeZone}</strong> · 设置版本 {result.settingsVersion}</p>
      {!result.moduleEnabled && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">平台已暂停新的请假申请及处理；仍可只读核对申请和原操作收据。</p>}
      {reviewResult && !reviewResult.moduleEnabled && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">请假处理已暂停；仍可按当前负责人权限只读查找并核对详情，不开放新的决定。</p>}
      {result.receipt && <section aria-label="请假操作收据" className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
        <h3 className="font-semibold">原操作已确认 · {statusLabels[result.receipt.item.status] ?? result.receipt.item.status}</h3>
        <p>申请版本 {result.receipt.revision}；这是该操作的保存收据，不代表假期余额、排班、打卡或工资已变化。</p>
        <p className="break-all text-xs">申请编号：{result.receipt.requestId}<br/>操作编号：{result.receipt.command.operationId}</p>
      </section>}
      {access === "self" && !state.pending && (result.detail || result.receipt) && <ReviewRoutingSelf siteId={siteId} authUserId={result.actorId} family="leave"
        requestId={result.detail?.requestId ?? result.receipt!.requestId} apiFetch={apiFetch} isCurrentAuth={props.isCurrentAuth}/>}
      {access === "self" && !result.detail && <SubmissionForm key={`${result.workerId}:${result.settingsVersion}:${result.timeZone}:${draftVersion}`}
        result={result} disabled={locked || !result.moduleEnabled || !result.canSubmit || !result.workerId || !result.employeeId}
        onDirty={() => setDirty(true)} onSubmit={(reason, interval) => {
          setDirty(false);
          setDraftVersion(value => value + 1);
          void client.submit({ reason, ...interval });
        }}/>
      }

      {result.detail
        ? <Detail key={`${result.detail.requestId}:${result.detail.revision}:${draftVersion}`} detail={result.detail} access={access} navigationDisabled={locked}
            writeDisabled={locked || !result.moduleEnabled}
            onDirty={() => setDirty(true)} onBack={() => {
              if (!discardDraft()) return;
              if (!reviewClient) void client.load();
              else if (ownerView === "review") void refreshReview("load");
              else void refreshAll("load");
            }} onDecide={(action, reason) => {
              setDirty(false);
              setDraftVersion(value => value + 1);
              void client.decide(action, reason);
            }}/>
        : ownerView === "review" && reviewClient
          ? reviewResult && <LeaveReviewList result={reviewResult} disabled={reviewSelectionDisabled}
              onDetail={requestId => void selectReviewItem(requestId)} onNext={() => void nextReviewPage()}/>
          : <LeaveList result={result} disabled={locked} onDetail={requestId => {
              if (discardDraft()) void client.detail(requestId);
            }} onNext={() => {
              if (discardDraft()) void client.next();
            }}/>
      }
    </>}
    <p className="text-xs leading-6 text-slate-500">
      {reviewClient
        ? "页面不会自动提交、审批、轮询、扫描后续候选或后台重试。时区来自服务器当前企业设置，不使用设备时区；每份申请保存其提交时区。隐藏、关闭或离开页面会清除未提交草稿和两侧已显示资料，待确认操作仅按原编号恢复核对。"
        : "页面不会自动提交、审批、轮询或后台重试。时区来自服务器当前企业设置，不使用设备时区；每份申请保存其提交时区。隐藏、关闭或离开页面会清除未提交草稿和已显示资料，待确认操作仅按原编号恢复核对。"}
    </p>
  </section>;
}

function SubmissionForm({ result, disabled, onDirty, onSubmit }: {
  result: LeaveResponse;
  disabled: boolean;
  onDirty: () => void;
  onSubmit: (reason: string, interval: ResolvedInterval) => void;
}) {
  const [start, setStart] = useState<WallTime>({ local: "", offset: "" });
  const [end, setEnd] = useState<WallTime>({ local: "", offset: "" });
  const [reason, setReason] = useState(""), [preview, setPreview] = useState<ResolvedInterval | null>(null);
  const [ack, setAck] = useState(false), [message, setMessage] = useState("");
  const reasonValid = validReason(reason);
  const changeTime = (setter: (value: WallTime) => void, value: WallTime) => {
    setter(value);
    setPreview(null);
    setAck(false);
    setMessage("");
    onDirty();
  };
  const buildPreview = () => {
    try {
      const interval = resolveLeaveInterval(start, end, result.timeZone);
      setPreview(interval);
      setAck(false);
      setMessage("已解析为唯一 UTC 时段。请核对时区、UTC 时差与实际经过时长。 ");
    } catch {
      setPreview(null);
      setAck(false);
      setMessage("请核对起止当地时间及 UTC 时差：时间必须实际存在，结束晚于开始，最长 366 天。 ");
    }
  };
  return <form aria-label="提交请假申请" className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={event => {
    event.preventDefault();
    if (disabled || !preview || !ack || !reasonValid) return;
    try {
      const interval = resolveLeaveInterval(start, end, result.timeZone);
      if (interval.startAt !== preview.startAt || interval.endAt !== preview.endAt) throw Error("preview_changed");
      if (!window.confirm("确认提交这份请假申请，由负责人或获授权审批人处理？提交不会自动扣假、改排班、阻止打卡或计算工资。")) return;
      onSubmit(reason.trim(), interval);
    } catch {
      setPreview(null);
      setAck(false);
      setMessage("时间已变化或无效，请重新生成并核对预览。");
    }
  }}>
    <h3 className="font-bold">新增请假申请</h3>
    <p className="text-xs leading-5 text-slate-600">按企业考勤时区 <strong>{result.timeZone}</strong> 输入，精确到分钟；允许过去或未来时段，单次最长 366 天。普通时刻自动确认 UTC 时差，夏令时重复时刻必须明确选择，不存在的当地时间不能提交。</p>
    {!result.canSubmit && <p role="alert" className="text-sm text-amber-900">当前身份没有请假申请权限，或当前考勤档案不能提交新申请。</p>}
    <fieldset disabled={disabled} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <WallTimeField label="请假开始时间" zone={result.timeZone} value={start} onChange={value => changeTime(setStart, value)}/>
        <WallTimeField label="请假结束时间" zone={result.timeZone} value={end} onChange={value => changeTime(setEnd, value)}/>
      </div>
      <button type="button" className={button} onClick={buildPreview}>生成请假预览</button>
      {message && <p role="status" className="text-sm text-amber-900">{message}</p>}
      {preview && <IntervalPreview interval={preview} zone={result.timeZone}/>}
      <label className="block text-sm">请假理由（1～200 字，单行；请勿填写病历或诊断）
        <input type="text" className={input} value={reason} maxLength={400} required onChange={event => {
          setReason(event.target.value);
          setAck(false);
          onDirty();
        }}/>
      </label>
      {!reasonValid && reason.length > 0 && <p role="alert" className="text-xs text-amber-900">理由须为 1～200 个字符且不能包含换行或控制字符。</p>}
      <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={ack} disabled={!preview || !reasonValid} onChange={event => {
        setAck(event.target.checked);
        onDirty();
      }}/><span>我已核对申请人、企业时区、两端 UTC 时差、实际经过时长和理由；这只是待审批申请，不代表假期余额、排班、打卡或工资已变化。</span></label>
      <button className={button} disabled={!preview || !ack || !reasonValid}>明确提交请假申请</button>
    </fieldset>
  </form>;
}

function WallTimeField({ label, zone, value, onChange }: { label: string; zone: string; value: WallTime; onChange: (value: WallTime) => void }) {
  const offsets = useMemo(() => correctionTimeOffsets(value.local, zone), [value.local, zone]);
  return <div className="min-w-0"><label className="text-sm">{label}
    <input className={input} type="datetime-local" step="60" min="2000-01-01T00:00" max="2100-12-31T23:59" required value={value.local}
      onChange={event => {
        const local = event.target.value, choices = correctionTimeOffsets(local, zone);
        onChange({ local, offset: choices.length === 1 ? choices[0] : "" });
      }}/>
  </label>
    {offsets.length > 1
      ? <label className="text-xs">{label} UTC 时差
          <select aria-label={`${label} UTC 时差`} className={input} required value={offsets.includes(value.offset) ? value.offset : ""}
            onChange={event => onChange({ ...value, offset: event.target.value })}>
            <option value="">重复时刻，请明确选择</option>
            {offsets.map(offset => <option value={offset} key={offset}>UTC{offset}</option>)}
          </select>
        </label>
      : <p className={`mt-1 text-xs ${value.local && !offsets.length ? "text-amber-900" : "text-slate-500"}`}>
          {offsets.length === 1 ? `UTC${offsets[0]}` : value.local ? "该企业时区不存在这个当地时间，请修改。" : `企业时区：${zone}`}
        </p>}
  </div>;
}

function IntervalPreview({ interval, zone }: { interval: ResolvedInterval; zone: string }) {
  const elapsed = Date.parse(interval.endAt) - Date.parse(interval.startAt);
  return <section aria-label="请假时段预览" className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
    <h4 className="font-bold">请假时段预览 · 尚未提交</h4>
    <p>{stamp(interval.startAt, zone)} — {stamp(interval.endAt, zone)}</p>
    <p>企业时区：{zone} · 实际经过时长：{duration(elapsed)}</p>
    <details className="break-all text-xs"><summary>查看 UTC 时间</summary>{interval.startAt} — {interval.endAt}</details>
    <p className="text-xs">实际经过时长仅用于核对跨日及夏令时，不是应出勤、休假余额、工时或工资。</p>
  </section>;
}

function LeaveList({ result, disabled, onDetail, onNext }: {
  result: LeaveResponse;
  disabled: boolean;
  onDetail: (requestId: string) => void;
  onNext: () => void;
}) {
  return <section aria-label="请假申请记录" className="space-y-3">
    <h3 className="font-bold">申请记录 · 按提交时间倒序</h3>
    {!result.items.length && <p className="rounded-xl border border-slate-200 p-4 text-sm">本页没有请假申请，不代表没有排班、出勤或假期余额。</p>}
    {result.items.map(item => <article key={item.requestId} className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{item.workerName} · {statusLabels[item.status] ?? item.status}</strong>
        <button type="button" className={button} disabled={disabled} onClick={() => onDetail(item.requestId)}>查看申请详情</button></div>
      <p>{stamp(item.startAt, item.timeZone)} — {stamp(item.endAt, item.timeZone)}<br/>{item.timeZone}</p>
      <p className="break-all text-xs text-slate-500">提交 UTC：{item.submittedAt} · 版本 {item.revision}<br/>申请编号：{item.requestId}</p>
    </article>)}
    <button type="button" className={button} disabled={disabled || !result.nextCursor} onClick={onNext}>下一页申请</button>
    <p className="text-xs text-slate-500">每页只保留当前有权查看的结果；分页期间新增或变化的申请须重新查询首页。</p>
  </section>;
}

function LeaveReviewList({ result, disabled, onDetail, onNext }: {
  result: LeaveReviewResponse;
  disabled: boolean;
  onDetail: (requestId: string) => void;
  onNext: () => void;
}) {
  return <section aria-label="待审批请假申请" className="min-w-0 space-y-3">
    <h3 className="font-bold">待审批申请 · 按提交时间最旧优先</h3>
    <p className="text-sm leading-6 text-slate-600">
      本批核对 {result.scanned} 个候选，发现 {result.items.length} 份待审批申请；这些数字只属于本批，不是全部历史或待审批总数。
    </p>
    {!result.items.length && <p className="rounded-xl border border-slate-200 p-4 text-sm">
      本批未发现待审批申请，{result.nextCursor ? "仍可继续查询。" : "已到本次查询末尾。"}
    </p>}
    {result.items.map(item => <article key={item.requestId} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="break-words">{item.workerName} · 待审批</strong>
        <button type="button" className={button} disabled={disabled} onClick={() => onDetail(item.requestId)}>查看申请详情</button></div>
      <p>{stamp(item.startAt, item.timeZone)} — {stamp(item.endAt, item.timeZone)}<br/>{item.timeZone}</p>
      <p className="break-all text-xs text-slate-500">提交 UTC：{item.submittedAt} · 版本 {item.revision}<br/>申请编号：{item.requestId}</p>
    </article>)}
    {result.nextCursor && <button type="button" className={button} disabled={disabled} onClick={onNext}>继续查找待审</button>}
    <p className="text-xs leading-6 text-slate-500">
      这是有界只读发现页；空中间页不代表后续没有待审申请。打开详情会重新核验当前负责人权限及申请最新状态，后来发生的提交或处理须重新查询首页。
    </p>
  </section>;
}

function Detail({ detail, access, navigationDisabled, writeDisabled, onDirty, onBack, onDecide }: {
  detail: LeaveDetail;
  access: "self" | "owner";
  navigationDisabled: boolean;
  writeDisabled: boolean;
  onDirty: () => void;
  onBack: () => void;
  onDecide: (action: LeaveDecision, reason: string) => void;
}) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false);
  const reasonValid = validReason(reason);
  const actions: { action: LeaveDecision; label: string; allowed: boolean; confirm: string }[] = access === "self"
    ? [{ action: "withdraw", label: "明确撤回请假申请", allowed: detail.canWithdraw, confirm: "确认撤回这份待审批请假申请？申请及撤回历史仍会保留。" }]
    : [
        { action: "approve", label: "明确批准请假申请", allowed: detail.canApprove, confirm: "确认批准这份请假申请？批准只保存请假决定，不自动扣假、改排班、阻止打卡或计算工资。" },
        { action: "reject", label: "明确驳回请假申请", allowed: detail.canReject, confirm: "确认驳回这份请假申请并保留完整历史？" },
        { action: "cancel", label: "明确取消已批准请假", allowed: detail.canCancel, confirm: "确认取消这份已批准请假？取消会新增历史，不删除原申请或原批准记录。" },
      ];
  const available = actions.filter(action => action.allowed);
  const decide = (action: typeof actions[number]) => {
    if (writeDisabled || !action.allowed || !reasonValid || !ack) return;
    if (!window.confirm(action.confirm)) return;
    onDecide(action.action, reason.trim());
  };
  return <article aria-label="请假申请详情" className="space-y-4 rounded-xl border border-blue-200 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{detail.workerName} · {statusLabels[detail.status] ?? detail.status}</h3>
      <button type="button" className={button} disabled={navigationDisabled} onClick={onBack}>返回申请列表</button></div>
    <p>{stamp(detail.startAt, detail.timeZone)} — {stamp(detail.endAt, detail.timeZone)}<br/>{detail.timeZone} · 实际经过时长 {duration(Date.parse(detail.endAt) - Date.parse(detail.startAt))}</p>
    <p className="break-words text-sm">申请理由：{detail.reason}</p>
    <p className="break-all text-xs text-slate-500">申请编号：{detail.requestId} · 当前版本 {detail.revision}<br/>提交 UTC：{detail.submittedAt}<br/>员工记录：{detail.employeeId} · 考勤人员：{detail.workerId}</p>
    <section aria-label="请假处理历史" className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm"><h4 className="font-semibold">处理历史</h4>
      {detail.history.map((entry, index) => <div key={`${entry.revision}:${entry.recordedAt}:${index}`} className="border-t border-slate-200 pt-2 first:border-0 first:pt-0">
        <p>{historyLabels[entry.action] ?? entry.action} · 版本 {entry.revision}</p>
        <p className="break-words">理由：{entry.reason}</p><p className="break-all text-xs text-slate-500">UTC：{entry.recordedAt}</p>
      </div>)}
    </section>
    {available.length > 0 && <fieldset disabled={writeDisabled} className="space-y-3 rounded-xl border border-slate-200 p-3">
      <legend className="font-semibold">{access === "self" ? "撤回申请" : "作出请假决定"}</legend>
      <label className="block text-sm">{access === "self" ? "撤回理由" : "决定理由"}（1～200 字，单行；员工可见）
        <input type="text" className={input} value={reason} maxLength={400} required onChange={event => {
          setReason(event.target.value);
          setAck(false);
          onDirty();
        }}/>
      </label>
      <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={ack} disabled={!reasonValid} onChange={event => {
        setAck(event.target.checked);
        onDirty();
      }}/><span>我已核对申请人、时段、时区、当前状态及理由，并确认本操作只保存请假历史，不自动改变假期余额、排班、打卡或工资。</span></label>
      <div className="flex flex-wrap gap-2">{available.map(action => <button type="button" className={button} key={action.action}
        disabled={!ack || !reasonValid} onClick={() => decide(action)}>{action.label}</button>)}</div>
    </fieldset>}
    {!available.length && <p className="text-sm text-slate-600">当前状态没有可执行操作；这里只读显示已保存的申请与处理历史。</p>}
  </article>;
}

function validReason(value: string) {
  const text = value.trim();
  return [...text].length >= 1 && [...text].length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(text);
}

function stamp(value: string, zone: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" }).format(new Date(value));
  } catch {
    return value;
  }
}

function duration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "无法核对";
  const minutes = Math.floor(milliseconds / 60_000), days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
  return `${days ? `${days} 天 ` : ""}${hours ? `${hours} 小时 ` : ""}${rest || (!days && !hours) ? `${rest} 分钟` : ""}`.trim();
}
