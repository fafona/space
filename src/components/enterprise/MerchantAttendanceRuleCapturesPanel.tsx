"use client";

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AttendanceRuleCapturesClient } from "@/lib/merchantAttendanceRuleCapturesClient";
import type { CompactRuleCaptureResponse } from "@/lib/merchantAttendanceRuleCapturesBrowser";
import type { RuleSourcesResponse } from "@/lib/merchantAttendanceRuleSources";
import type { AttendanceRuleCapturesPanelProps } from "./MerchantAttendanceRuleCapturesLauncher";

type Props = AttendanceRuleCapturesPanelProps & { onClose: () => void; registerCloseHandler?: (handler: (() => void) | null) => void };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const validCaptureUiOperationId = (value: string) => uuid.test(value.trim());
export function capturePreflightEligible(source: RuleSourcesResponse | null): boolean {
  return !!source && source.moduleEnabled && source.worker.active && source.worker.employeeActive
    && !!source.worker.employeeId && !!source.worker.employeeAuthUserId
    && !source.assignments.limited && !source.rules.limited && !source.personal.limited;
}

// Only a UI continuation fence, not an authorization or storage boundary.
export function captureUiConfirmationCurrent(life: { alive: boolean; visible: boolean; epoch: number }, epoch: number,
  documentVisible: boolean, expected: unknown, current: unknown, expectedVisible = true): boolean {
  return life.alive && life.visible === expectedVisible && life.epoch === epoch && documentVisible && expected === current;
}
export function checkedCaptureReason(value: string): string {
  const reason = value.trim();
  if (!reason || [...reason].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(reason)
    || [...reason].some(char => char.length === 1 && /[\ud800-\udfff]/.test(char))) throw Error("留存理由需为 1–200 字且不含控制字符或无效字符；尚未提交。");
  return reason;
}

export default function MerchantAttendanceRuleCapturesPanel(props: Props) {
  const [binding, setBinding] = useState({ apiFetch: props.apiFetch, revision: 0 });
  if (binding.apiFetch !== props.apiFetch) setBinding({ apiFetch: props.apiFetch, revision: binding.revision + 1 });
  return <Screen key={`${props.siteId}:${props.ownerId}:${props.workerId}:${binding.revision}`} {...props}/>;
}

function Screen({ siteId, ownerId, workerId, apiFetch, onClose, registerCloseHandler }: Props) {
  const client = useMemo(() => new AttendanceRuleCapturesClient({ siteId, ownerId, workerId, apiFetch, storage: () => window.sessionStorage }), [siteId, ownerId, workerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [visible, setVisible] = useState(false), [dirty, setDirty] = useState(false);
  const [fromDate, setFrom] = useState(""), [throughDate, setThrough] = useState(""), [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState(""), [error, setError] = useState("");
  const lifecycle = useRef({ alive: false, visible: false, epoch: 0 });
  useLayoutEffect(() => {
    const life = lifecycle.current; life.alive = true;
    const clearInputs = () => { setFrom(""); setThrough(""); setReason(""); setOperationId(""); setDirty(false); setError(""); };
    const show = async () => {
      const epoch = ++life.epoch; life.visible = false; setVisible(false); clearInputs();
      await client.initialize(); // Local pending / recent ID only; never a network read.
      if (life.alive && epoch === life.epoch && document.visibilityState !== "hidden") {
        setOperationId(client.getSnapshot().recoveryId ?? ""); life.visible = true; setVisible(true);
      }
    };
    const hide = () => { ++life.epoch; life.visible = false; setVisible(false); clearInputs(); client.pause(); };
    const hidden = () => flushSync(hide);
    const visibility = () => { if (document.visibilityState === "hidden") hidden(); else void show(); };
    const pageshow = () => { if (!life.visible && document.visibilityState !== "hidden") void show(); };
    if (document.visibilityState === "hidden") hide(); else void show();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hidden); window.addEventListener("pageshow", pageshow);
    return () => {
      life.alive = false; ++life.epoch; life.visible = false; client.pause();
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hidden); window.removeEventListener("pageshow", pageshow);
    };
  }, [client]);
  useLayoutEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty || state.pending) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, state.pending]);
  const current = (epoch: number, expected: unknown, value: unknown, expectedVisible = true) => captureUiConfirmationCurrent(lifecycle.current, epoch,
    document.visibilityState !== "hidden", expected, value, expectedVisible);
  const close = () => {
    const epoch = lifecycle.current.epoch, wasVisible = lifecycle.current.visible, expected = client.getSnapshot();
    const warnings = [dirty ? "未提交的日期、理由或编号输入将清除，不会保存。" : "", expected.pending ? "原留存结果仍待确认。离开不代表撤销；请记下原编号，之后明确核对，不会自动重发。关闭标签页或清理存储后不能保证恢复。" : ""].filter(Boolean);
    if (warnings.length && !window.confirm(`${warnings.join("\n")}\n确认关闭？`)) return;
    if (!current(epoch, expected, client.getSnapshot(), wasVisible)) return;
    ++lifecycle.current.epoch; lifecycle.current.visible = false; client.pause(); onClose();
  };
  const closeHandler = useRef(close);
  useLayoutEffect(() => { closeHandler.current = close; });
  useLayoutEffect(() => { registerCloseHandler?.(() => closeHandler.current()); return () => registerCloseHandler?.(null); }, [registerCloseHandler]);
  const edit = (update: () => void) => {
    if (!lifecycle.current.visible || client.getSnapshot().pending || client.getSnapshot().phase === "saving") return;
    ++lifecycle.current.epoch; client.invalidate(); setError(""); setDirty(true); update();
  };
  const source = visible ? state.source : null, result = visible ? state.result : null;
  const busy = state.phase === "loading" || state.phase === "saving", locked = !visible || !!state.pending || state.phase === "saving";
  const canCapture = capturePreflightEligible(source) && state.phase === "ready" && !state.pending && source?.fromDate === fromDate && source?.throughDate === throughDate;
  const settle = (epoch: number) => {
    if (!current(epoch, client, client)) return;
    const latest = client.getSnapshot();
    if (latest.pending || latest.result?.receipt) { setFrom(""); setThrough(""); setReason(""); setDirty(false); }
    setOperationId(latest.pending?.command.operationId ?? latest.recoveryId ?? "");
  };
  const capture = async () => {
    if (!source || !canCapture || !lifecycle.current.visible) return;
    setError(""); let checked: string;
    try { checked = checkedCaptureReason(reason); } catch (caught) { setError(caught instanceof Error ? caught.message : "请核对留存理由。"); return; }
    const epoch = lifecycle.current.epoch;
    const message = `请核对本次候选来源留存：\n人员：${source.worker.workerName}（${source.worker.workerNo}；${workerId}）\n员工身份：${source.worker.employeeId}\n登录身份：${source.worker.employeeAuthUserId}\n日期：${source.fromDate} 至 ${source.throughDate}（含尾日；${source.timeZone}）\n理由：${checked}\n预核对时间：${source.readAt}\n服务器会重新读取，可能与预核对不同；不上传或保存浏览器拼装的来源。仅留存本次候选来源，未应用，不证明过去实际采用了这些规则，不形成异常或工资结论。\n确认留存？`;
    if (!window.confirm(message)) return;
    const latest = client.getSnapshot();
    if (!current(epoch, source, latest.source) || latest.phase !== "ready" || latest.pending || !latest.source?.moduleEnabled) return;
    await client.capture(checked); settle(epoch);
  };
  const recover = async (requested?: string) => {
    if (!lifecycle.current.visible || document.visibilityState === "hidden" || busy) return;
    setError(""); const epoch = lifecycle.current.epoch;
    // Read-only lookup leaves unsent inputs in place. A new save still needs a fresh preflight.
    await client.recover(requested);
    if (current(epoch, client, client)) setOperationId(client.getSnapshot().pending?.command.operationId ?? client.getSnapshot().recoveryId ?? requested ?? "");
  };
  const retry = async () => {
    const expected = client.getSnapshot().pending, epoch = lifecycle.current.epoch;
    if (!expected || busy || !lifecycle.current.visible) return;
    if (!window.confirm(`先核对原留存编号 ${expected.command.operationId}；仅在仍未找到且当前模块允许时，按原编号、原身份和原内容明确重试，不生成新编号。\n原日期：${expected.command.fromDate} 至 ${expected.command.throughDate}\n原理由：${expected.command.reason}\n服务器将重新读取候选来源，可能与原预核对不同；未应用，也不证明历史实际采用。继续核对并重试？`)) return;
    const latest = client.getSnapshot();
    if (!current(epoch, expected, latest.pending) || latest.phase === "loading" || latest.phase === "saving") return;
    await client.retry(); settle(epoch);
  };
  return <section aria-label="单员工候选来源留存" className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">候选来源留存（未应用）</h2><p className="mt-1 text-sm text-slate-600">仅当前负责人 · 单员工 · 连续 1–7 个企业当地日期</p></div><button type="button" className={button} onClick={close}>关闭候选来源留存</button></header>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6">只留存候选规则来源，不应用到打卡、工时、异常或工资，也不证明历史上实际采用了这些规则。服务器会重新读取，可能与预核对不同。留存后仍不是正式规则或历史应用证明。</p>
    <p className="break-all text-xs text-slate-600">当前档案编号：{workerId}。只按明确身份关联，不按姓名关联。</p>
    <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); if (!locked && !busy && document.visibilityState !== "hidden") { setError(""); void client.read(fromDate, throughDate); } }}>
      <fieldset disabled={locked} className="min-w-0 space-y-3"><legend className="font-semibold">先填写，再明确读取核对</legend>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="min-w-0 text-sm">留存开始日期<input className={input} type="date" min="2000-01-01" max="2100-12-31" value={fromDate} onChange={event => edit(() => setFrom(event.target.value))}/></label>
          <label className="min-w-0 text-sm">留存结束日期<input className={input} type="date" min="2000-01-01" max="2100-12-31" value={throughDate} onChange={event => edit(() => setThrough(event.target.value))}/></label></div>
        <label className="block text-sm">留存理由<input className={input} autoComplete="off" value={reason} maxLength={400} onChange={event => edit(() => setReason(event.target.value))}/></label>
        <p className="text-xs leading-6 text-slate-600">日期含结束日，理由 1–200 字。修改日期或理由会清除旧核对结果；请填写完后重新读取。打开和返回页面均不会自动读取或保存。</p>
        <button type="submit" className={button} disabled={locked || busy || !fromDate || !throughDate}>读取留存前核对</button>
      </fieldset>
    </form>
    <p role="status" className="text-sm leading-6">{visible ? state.message : "资料已隐藏或正在读取本标签页恢复编号；不会自动请求服务器。"}</p>
    {visible && (error || state.phase === "blocked") && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900">{error || state.message}</p>}
    {source && <RuleCapturePreflight source={source}/>}
    <button type="button" className={button} disabled={!canCapture || !reason.trim()} onClick={() => void capture()}>确认留存当前来源</button>
    {visible && state.pending && <RuleCapturePending operationId={state.pending.command.operationId} busy={busy} onRecover={() => void recover()} onRetry={() => void retry()}/>}
    <section aria-label="按编号读取候选留存" className="space-y-3 rounded-xl border border-slate-200 p-3">
      <h3 className="font-bold">按已知编号读取</h3><p className="text-xs leading-6 text-slate-600">预填编号仅是本标签页最近一次留存的便利记录，不是全部历史或全库检索；可输入已知 UUID 明确读取。此操作只读取，不重试保存。</p>
      <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); if (!locked && !busy) void recover(operationId.trim()); }}>
        <label className="block text-sm">留存操作编号<input className={`${input} font-mono`} autoComplete="off" spellCheck={false} value={operationId} maxLength={36} disabled={locked} onChange={event => edit(() => setOperationId(event.target.value))}/></label>
        <button type="submit" className={button} disabled={locked || busy || !validCaptureUiOperationId(operationId)}>读取指定留存</button>
      </form>
    </section>
    {result && <RuleCaptureReceipt result={result}/>}
    <p className="text-xs leading-6 text-slate-600">未提交输入只在内存中，隐藏、关闭或切换身份会清空；返回后需明确操作。待确认原编号与原内容仅尝试保存在当前标签页，关闭标签页、存储不可用或清理站点后不能保证恢复。没有自动重发、全量历史列表、下载或剪贴板权限请求。</p>
  </section>;
}

function Datum({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="font-semibold">{label}</dt><dd className="break-all whitespace-pre-wrap">{children}</dd></div>;
}
export function RuleCapturePending({ operationId, busy, onRecover, onRetry }: { operationId: string; busy: boolean; onRecover: () => void; onRetry: () => void }) {
  return <section aria-label="待确认留存操作" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
    <h3 className="font-bold">原留存结果待确认</h3><p className="break-all">原编号：{operationId}</p>
    <p>不会自动重发；核对完成前不能修改输入或发起新留存。未查到收据不等于证明没有写入。请保留原编号。</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={onRecover}>核对原留存编号</button>
      <button type="button" className={button} disabled={busy} onClick={onRetry}>原编号核对并重试</button></div>
  </section>;
}
export function RuleCapturePreflight({ source: s }: { source: RuleSourcesResponse }) {
  return <section aria-label="留存前来源核对" data-rule-capture-preflight className="min-w-0 space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
    <h3 className="font-bold">留存前来源核对（尚未保存）</h3>
    <dl className="grid min-w-0 gap-3 sm:grid-cols-2"><Datum label="当前人员">{s.worker.workerName} · 工号 {s.worker.workerNo} · 档案 {s.worker.workerId}</Datum>
      <Datum label="本次授权上下文">站点 {s.siteId} · 负责人 {s.actorId}</Datum><Datum label="当前员工身份">{s.worker.employeeId ?? "未绑定"}</Datum><Datum label="当前登录身份">{s.worker.employeeAuthUserId ?? "未绑定"}</Datum>
      <Datum label="日期与企业时区">{s.fromDate} 至 {s.throughDate}（含尾日） · {s.timeZone}</Datum><Datum label="人员 / 设置 / 个人流版本">{s.worker.version} / {s.settingsVersion} / {s.personal.revision}</Datum>
      <Datum label="UTC 半开区间">{s.fromAt} → {s.toAt}（不含终点）</Datum><Datum label="本次服务器预核对时间">{s.readAt}</Datum></dl>
    {!s.moduleEnabled && <p className="font-semibold text-amber-950">新考勤模块已暂停，不能发起新留存；仍可按原编号核对已有收据。</p>}
    {(!s.worker.active || !s.worker.employeeActive || !s.worker.employeeId || !s.worker.employeeAuthUserId) && <p className="font-semibold text-amber-950">当前人员或员工未启用，或双身份未绑定，不能发起新留存。</p>}
    {(s.assignments.limited || s.rules.limited || s.personal.limited) && <p className="font-semibold text-amber-950">本次来源未完整取得，不能把截断当作没有记录；服务器将拒绝不完整留存。</p>}
    <p>预核对不是最终留存内容。服务器会重新读取，可能与预核对不同；不在浏览器上传来源，也不据此作考勤判断。</p>
  </section>;
}

export function RuleCaptureReceipt({ result: r }: { result: CompactRuleCaptureResponse }) {
  const receipt = r.receipt;
  return <section aria-label="候选来源留存收据" data-rule-capture-result className="min-w-0 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
    <h3 className="font-bold">候选来源留存收据（未应用）</h3>
    <p className="break-all">读取操作编号：{r.operationId} · 本次收据查询时间：{r.readAt}</p>
    {!r.moduleEnabled && <p>新考勤模块已暂停；这里只读取原收据，不恢复新写入。</p>}
    {!receipt ? <p>本次未找到该编号的收据。未找到不等于证明没有写入；如有待确认操作，请保留原编号并明确核对，不要另建编号。</p> : <>
      <dl className="grid min-w-0 gap-3 sm:grid-cols-2"><Datum label="留存操作编号">{receipt.operationId}</Datum><Datum label="来源编号">{receipt.sourceId}</Datum>
        <Datum label="原操作人与目标档案">{receipt.actorId} · 站点 {r.siteId} · 档案 {r.workerId}</Datum><Datum label="来源人员展示快照">{receipt.summary.workerName} · {receipt.summary.workerNo}</Datum>
        <Datum label="原员工 / 登录身份">{receipt.command.employeeId} / {receipt.command.employeeAuthUserId}</Datum><Datum label="留存理由">{receipt.command.reason}</Datum>
        <Datum label="原日期与保存时区">{receipt.summary.fromDate} 至 {receipt.summary.throughDate}（含尾日） · {receipt.summary.timeZone}</Datum><Datum label="原 UTC 半开区间">{receipt.summary.fromAt} → {receipt.summary.toAt}（不含终点）</Datum>
        <Datum label="本操作新读取时间">{receipt.observedAt}</Datum><Datum label="本操作登记时间">{receipt.recordedAt}</Datum><Datum label="被留存来源的读取时间">{receipt.sourceReadAt}</Datum>
        <Datum label="来源大小与编码">{receipt.sourceBytes} UTF-8 字节 · {receipt.canonicalFormat}</Datum><Datum label="来源 SHA-256（内容摘要，不是签名）">{receipt.sourceSha256}</Datum>
        <Datum label="本次来源记录数">归组 {receipt.summary.assignmentCount} · 企业／组流 {receipt.summary.ruleStreamCount} · 候选发布 {receipt.summary.publicationCount} · 个人核准 {receipt.summary.personalApprovalCount} · 个人撤回 {receipt.summary.personalWithdrawalCount}</Datum></dl>
      <p>相同来源可能复用来源编号，因此被留存来源的读取时间可早于本操作新读取时间。记录数只描述这份有限日期来源，不是全部历史数量。</p>
      <p className="font-semibold">此收据只证明候选来源已留存；未应用，不证明历史上实际采用了这些规则。摘要不是签名，也不是异常或工资结论。</p>
    </>}
  </section>;
}
