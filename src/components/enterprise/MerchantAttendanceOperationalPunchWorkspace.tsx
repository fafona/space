"use client";
import { LOCATION_DISPOSAL_NOTICE } from "@/lib/merchantAttendanceLocationDisposal";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { AttendanceAction } from "@/lib/merchantAttendance";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceOperationalPunchClient, type OperationalPunchClientScope } from "@/lib/merchantAttendanceOperationalPunchClient";
import { OPERATIONAL_PUNCH_ACTION_LABELS as labels, operationalPunchUiBlockedKeys, operationalPunchUiCommand, operationalPunchUiContext, operationalPunchUiErrors, operationalPunchUiTransport } from "@/lib/merchantAttendanceOperationalPunchUi";
import type { OperationalPunchResult } from "@/lib/merchantAttendanceOperationalPunch";
import { acquireAttendancePosition, attendanceBrowserLocationEnvironment, type AttendanceLocationEnvironment } from "@/lib/merchantAttendanceLocationCheckClient";
import { decodeOnsiteToken } from "@/lib/merchantAttendanceOnsiteQrBrowser";
import type { AttendanceWorkspaceReporter } from "./useAttendanceLocationWorkspaceActivity";

const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export type OperationalPunchWorkspaceProps = {
  scope: OperationalPunchClientScope; employeeId?: string | null; workerId?: string | null; apiFetch: AttendanceApiFetch;
  enabled?: boolean; canClock?: boolean; environment?: AttendanceLocationEnvironment; token?: string | null; consumeToken?: () => void;
  recoveryOnly?: boolean;
  onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void; onWorkspaceActivity?: AttendanceWorkspaceReporter;
};
export function OperationalPunchChoices({ result, selection, breakType, disabled, onSelection, onBreakType }: {
  result: OperationalPunchResult; selection: string; breakType: string; disabled: boolean; onSelection: (v: string) => void; onBreakType: (v: string) => void;
}) {
  const fields = result.session?.fields ?? result.policy?.fields;
  const chooseSlot = result.policy && fields?.shiftSource.state !== "disabled" && fields?.shiftSource.value !== "unplanned";
  const explicitBreak = result.session?.fields.breakTypes.state === "value" && result.session.fields.breakTypes.value?.selection === "explicit";
  return <div className="min-w-0 space-y-3 text-sm">
    <p>当前：{{ off: "未上班", working: "工作中", break: "休息中" }[result.clock.state.status]} · 顺序 {result.clock.state.sequence}</p>
    {result.session && <p className="break-words">本班次沿用上班时保存的规则，不随之后的规则发布变化。</p>}
    {fields && <dl className="grid min-w-0 gap-2">
      <div>通路：{fields.allowedChannels.state === "value" ? fields.allowedChannels.value?.join(" / ") : fields.allowedChannels.state === "disabled" ? "已停用新上班" : "沿用原通路配置"}</div>
      <div>排班：{fields.shiftSource.state === "value" ? fields.shiftSource.value === "published_selection" ? "明确选择已发布排班或不关联" : "不关联排班" : fields.shiftSource.state === "disabled" ? "不关联排班" : "沿用原排班配置"}</div>
      <div>休息：{fields.breakTypes.state === "value" ? `${fields.breakTypes.value?.allowed.map(v => v === "paid" ? "带薪" : "不带薪").join(" / ")}（${explicitBreak ? "每次明确选择" : "固定类型"}）` : "沿用上班时保存的原休息配置"}</div>
    </dl>}
    {result.canStart && <label className="block">本次排班关联<select aria-label="本次排班关联" className="mt-2 block w-full min-w-0 max-w-full rounded-xl border p-3" value={selection} disabled={disabled} onChange={e => onSelection(e.target.value)}>
      <option value="">请明确选择</option><option value="none">不关联排班</option>
      {chooseSlot && result.choices?.entries.map(s => <option key={`${s.id}:${s.revision}`} value={`${s.id}:${s.revision}`}>{s.workDate} · {s.locationName} · {s.startAt} — {s.endAt} · v{s.revision}{s.cancelled ? "（已取消）" : ""}</option>)}
    </select></label>}
    {result.choices?.limited && <p>只列出本次有界查询中的排班，不会自动选择其他班次。</p>}
    {result.canBreak && explicitBreak && <label className="block">本次休息类型<select aria-label="本次休息类型" className="mt-2 block w-full rounded-xl border p-3" value={breakType} disabled={disabled} onChange={e => onBreakType(e.target.value)}>
      <option value="">请明确选择</option>{result.session!.fields.breakTypes.value!.allowed.map(v => <option key={v} value={v}>{v === "paid" ? "带薪休息" : "不带薪休息"}</option>)}
    </select></label>}
    {!result.session && result.canBreak && <p>这是未保存在线规则的原班次；休息沿用原规则，不补造上班快照。</p>}
  </div>;
}

// Synchronous render refs fence obsolete Auth/requesters before effects can run.
export default function MerchantAttendanceOperationalPunchWorkspace({ scope: inputScope, employeeId = null, workerId = null, apiFetch,
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_ENABLED === "1", canClock = true,
  environment = attendanceBrowserLocationEnvironment, token = null, consumeToken, onClose, registerLeaveGuard, onWorkspaceActivity, recoveryOnly = false }: OperationalPunchWorkspaceProps) {
  const { siteId, channel, authUserId, terminalId, workerNo } = inputScope;
  const scope = useMemo(() => ({ siteId, channel, authUserId, terminalId, workerNo }), [siteId, channel, authUserId, terminalId, workerNo]);
  const marker = useMemo(() => ({ scope, employeeId, workerId, apiFetch, environment, enabled, canClock, recoveryOnly }), [scope, employeeId, workerId, apiFetch, environment, enabled, canClock, recoveryOnly]);
  const current = useRef(marker), mounted = useRef(false); current.current = marker;
  const live = useCallback(() => mounted.current && current.current === marker && !document.hidden, [marker]);
  const [draft, setDraft] = useState({ marker, selection: "", breakType: "", pin: "", message: "" });
  const [recoveryRetry, setRecoveryRetry] = useState({ marker, enabled: false });
  const recoveryRetryAllowed = recoveryOnly && scope.channel === "location" && recoveryRetry.marker === marker && recoveryRetry.enabled;
  // Mask synchronously, before cleanup, including same-component requester or
  // feature changes. The caller's new context never renders an old PIN/draft.
  const selection = draft.marker === marker ? draft.selection : "", breakType = draft.marker === marker ? draft.breakType : "";
  const pin = draft.marker === marker ? draft.pin : "", message = draft.marker === marker ? draft.message : "";
  const edit = (key: "selection" | "breakType" | "pin" | "message", value: string) => setDraft(previous => ({ ...(previous.marker === marker ? previous : { marker, selection: "", breakType: "", pin: "", message: "" }), [key]: value }));
  const setSelection = (v: string) => edit("selection", v), setBreakType = (v: string) => edit("breakType", v), setPin = (v: string) => edit("pin", v), setMessage = (v: string) => edit("message", v);
  const secret = useRef<{ marker: typeof marker; pin: string; expires: number } | null>(null);
  const tokenRef = useRef({ marker, token, consumed: false });
  if (tokenRef.current.marker !== marker || tokenRef.current.token !== token) tokenRef.current = { marker, token, consumed: false };
  const client = useMemo(() => {
    const c: AttendanceOperationalPunchClient = new AttendanceOperationalPunchClient({ scope, storage: () => sessionStorage, isCurrent: live, errors: operationalPunchUiErrors(scope.channel), blockedKeys: (): string[] => {
      const r = c.getSnapshot().result;
      const boundEmployee = employeeId ?? (r && r.channel !== "self" ? r.clock.employeeId : null);
      return operationalPunchUiBlockedKeys(scope, boundEmployee);
    } }); return c;
  }, [scope, employeeId, live]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), result = current.current === marker ? state.result : null;
  const busy = state.phase === "loading" || state.phase === "submitting", pending = state.pending;
  const dirty = !!selection || !!breakType || !!pin;
  const clear = useCallback(() => { secret.current = null; tokenRef.current.consumed = true; setRecoveryRetry({ marker, enabled: false }); setDraft({ marker, selection: "", breakType: "", pin: "", message: "" }); }, [marker]);
  const leave = useCallback(() => {
    if ((dirty || client.blocksOtherActions()) && !window.confirm("离开会清除本页选择；待确认编号仍保留，已送达的打卡无法撤回。确定离开？")) return false;
    client.pause(); clear(); return true;
  }, [client, clear, dirty]);
  useEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useEffect(() => {
    mounted.current = true; secret.current = null;
    // The synchronous marker above already hides old input; discard its bytes
    // when the context starts, without consuming a newly supplied scan.
    setDraft({ marker, selection: "", breakType: "", pin: "", message: "" });
    setRecoveryRetry({ marker, enabled: false });
    void client.initialize();
    const hide = () => { if (document.hidden) flushSync(() => { client.pause(); clear(); }); };
    const pagehide = () => { client.pause(); clear(); };
    const unload = (e: BeforeUnloadEvent) => { if (client.blocksOtherActions()) { e.preventDefault(); e.returnValue = ""; } };
    const expiry = setInterval(() => { if (secret.current && Date.now() >= secret.current.expires) { secret.current = null; setDraft(previous => previous.marker === marker ? { ...previous, message: "PIN 确认时间已到，请重新输入本人 PIN。" } : previous); } }, 1000);
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", pagehide); window.addEventListener("beforeunload", unload);
    return () => { mounted.current = false; client.dispose(); secret.current = null; clearInterval(expiry); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", pagehide); window.removeEventListener("beforeunload", unload); };
  }, [client, clear, marker]);
  useEffect(() => { onWorkspaceActivity?.({ busy, pendingId: pending?.command.clock.operationId ?? null, receiptId: result?.operation?.eventId ?? null }); }, [onWorkspaceActivity, busy, pending, result]);
  useEffect(() => { if (scope.channel !== "pin" || !result?.operation) return; const timer = setTimeout(() => { client.pause(); clear(); }, 15000); return () => clearTimeout(timer); }, [scope.channel, result, client, clear]);
  const context = () => {
    const saved = client.getSnapshot().pending?.command.clock, r = client.getSnapshot().result;
    return operationalPunchUiContext(scope, saved?.expectedWorkerId ?? r?.clock.workerId ?? workerId,
      saved && "expectedEmployeeId" in saved ? saved.expectedEmployeeId : r && r.channel !== "self" ? r.clock.employeeId : employeeId);
  };
  const transport = (safeFinish = false, noPosition = false) => operationalPunchUiTransport(scope, apiFetch, workerId, async (write, signal) => {
    if (!live() || signal.aborted) throw Error("inactive");
    if (scope.channel === "pin") {
      const held = secret.current; if (!held || held.marker !== marker || Date.now() >= held.expires) throw Error("pin_required");
      const value = held.pin; if (write || pending) secret.current = null;
      return { pin: value };
    }
    if (scope.channel === "onsite" && write) {
      const held = tokenRef.current, value = held.token; if (held.marker !== marker || held.consumed || !value || decodeOnsiteToken(value).expiresAtMs <= Date.now()) throw Error("onsite_code_required");
      held.consumed = true; consumeToken?.(); return { token: value };
    }
    if (scope.channel === "location" && write) {
      if (safeFinish || noPosition) return { position: null, positionFailure: "not_provided" };
      if (!environment.isSecureContext() || !environment.isVisible()) throw Error("position_unavailable");
      const geo = environment.geolocation(); if (!geo) throw Error("position_unavailable");
      const position = await acquireAttendancePosition(geo, signal, 10000);
      if (!live() || signal.aborted) throw Error("inactive"); return { position, positionFailure: null };
    }
    return {};
  });
  const takePin = () => { if (scope.channel !== "pin") return true;
    if (/^\d{8,12}$/.test(pin)) { secret.current = { marker, pin, expires: Date.now() + 30000 }; setPin(""); }
    if (!secret.current || secret.current.marker !== marker || Date.now() >= secret.current.expires) { setMessage("请重新输入本人 PIN；PIN 不写入待确认记录。"); return false; } return true;
  };
  const read = async () => { if (!live() || busy || recoveryOnly && !pending || !takePin()) return; setMessage(""); setSelection(""); setBreakType("");
    try { await (pending ? client.recover(context(), transport()) : client.prepare(context(), transport())); } catch { if (live()) setMessage("当前身份或资料不可用，请重新核对。"); } };
  const submit = async (action: AttendanceAction, safeFinish = false, noPosition = false) => {
    const snapshot = client.getSnapshot(); if (!live() || busy || recoveryOnly || !canClock || !snapshot.result || snapshot.pending || action === "clock_in" && !enabled || !takePin()) return;
    try {
      const selected = selection === "none" ? null : selection ? snapshot.result.choices?.entries.find(s => `${s.id}:${s.revision}` === selection) : undefined;
      const command = operationalPunchUiCommand(snapshot.result, action, crypto.randomUUID(), selected === null ? null : selected ? { slotId: selected.id, revision: selected.revision } : undefined,
        breakType === "paid" || breakType === "unpaid" ? breakType : null, safeFinish);
      if (!window.confirm(`确认现在${labels[action]}？${safeFinish || noPosition ? "本次无定位，将标记待核查。" : ""}时间以服务器实际记录为准。`)) return;
      if (!live() || client.getSnapshot() !== snapshot) return;
      setSelection(""); setBreakType(""); setMessage(""); await client.submit(command, context(), transport(safeFinish, noPosition));
    } catch { if (live()) setMessage("请核对本次排班、休息类型、身份与地点告知后重新读取；不会自动打卡。"); }
  };
  const retry = async (noPosition = false) => { if (!live() || busy || recoveryOnly && !recoveryRetryAllowed || !pending || !takePin()) return; const snapshot = client.getSnapshot();
    if (!window.confirm(`按原编号重试完全相同的动作？${noPosition ? "此次明确无定位，标记待核查。" : ""}这不是重新打卡；请先核对原结果。`) || !live() || client.getSnapshot() !== snapshot) return;
    const c = pending.command.clock; await client.retry(context(), transport("safeFinish" in c && c.safeFinish, noPosition)); };
  const ready = !recoveryOnly && state.phase === "ready" && !!result && !result.operation && !pending;
  const explicit = result?.session?.fields.breakTypes.state === "value" && result.session.fields.breakTypes.value?.selection === "explicit";
  const hasCredential = scope.channel !== "onsite" || !!token && !tokenRef.current.consumed;
  return <section aria-label="规则打卡与原号核对" className="min-w-0 max-w-full space-y-4 rounded-2xl border border-blue-200 bg-white p-4 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">规则打卡／原号核对</h2><button className={button} disabled={busy || !!pending || state.phase === "storage_error"} onClick={() => { if (leave()) onClose(); }}>返回原打卡入口</button></header>
    <p className="text-sm leading-6">只记录本人当前动作。先核对，再明确确认；不会自动选班、补打或计算工资。原入口未确认的操作必须回原入口核对。</p>
    {recoveryOnly && <p className="text-sm text-amber-900">其他通路的原号恢复：默认只查询此原编号，不清其他编号。不会开启新动作。定位原号须另行明确开启原意图重试；现场扫码须回现场页取得新码。</p>}
    {!enabled && <p className="text-sm text-amber-900">新规则上班入口已暂停；仍可核对原号和已有规则班次的休息、收尾。</p>}
    <div role="status" className="break-words rounded-xl bg-blue-50 p-3 text-sm">{message || state.message}{pending && <p className="mt-2 break-all">原编号：{pending.command.clock.operationId}</p>}</div>
    {scope.channel === "pin" && <label className="block text-sm">本人 PIN<input aria-label="规则打卡 PIN" className="mt-2 block w-full rounded-xl border p-3" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={pin} disabled={busy} onChange={e => { secret.current = null; setPin(e.target.value); }}/><span className="text-xs">只在内存保留最多 30 秒供一次确认；核对原号也需本人验证。</span></label>}
    {scope.channel === "onsite" && <p className="text-sm">{token ? "已取得短时现场码，提交时由服务器核验。" : "读取和原号核对不需现场码；提交前请重新扫描上方门店现场码。"}</p>}
    <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || recoveryOnly && !pending} onClick={() => void read()}>{pending ? "核对原操作结果（不重发）" : "读取本次规则与状态"}</button>{busy && <button className={button} onClick={() => { client.pause(); clear(); }}>停止等待</button>}</div>
    {result && !result.operation && <OperationalPunchChoices result={result} selection={selection} breakType={breakType} disabled={!ready || busy} onSelection={setSelection} onBreakType={setBreakType}/>}
    {ready && result && <div className="flex flex-wrap gap-3">
      {result.canStart && <button className={button} disabled={!enabled || !canClock || !selection || !hasCredential} onClick={() => void submit("clock_in")}>确认规则上班</button>}
      {result.canBreak && <button className={button} disabled={!canClock || explicit && !breakType || !hasCredential} onClick={() => void submit("break_start")}>确认开始休息</button>}
      {result.canFinish && <button className={button} disabled={!canClock || !hasCredential} onClick={() => void submit(result.clock.state.status === "break" ? "break_end" : "clock_out")}>确认{result.clock.state.status === "break" ? "结束休息" : "下班"}</button>}
      {result.channel === "location" && result.canFinish && result.clock.finish && <button className={button} disabled={!canClock} onClick={() => void submit(result.clock.state.status === "break" ? "break_end" : "clock_out", true)}>原班次无定位收尾 · 待核查</button>}
      {result.channel === "location" && result.clock.noticeGate.ready && <button className={button} disabled={!canClock || result.canStart && (!selection || !enabled) || result.canBreak && explicit && !breakType} onClick={() => void submit(result.canStart ? "clock_in" : result.canBreak ? "break_start" : result.clock.state.status === "break" ? "break_end" : "clock_out", false, true)}>明确无定位登记 · 待核查</button>}
    </div>}
    {pending && recoveryOnly && scope.channel === "location" && !recoveryRetryAllowed && <button className={button} disabled={busy} onClick={() => {
      const snapshot = client.getSnapshot(); if (window.confirm("切入此定位原号的同协议重试？仍只使用保存的完整原意图，定位告知、身份和版本会由服务器重新核验，不产生新编号。") && live() && snapshot === client.getSnapshot()) setRecoveryRetry({ marker, enabled: true });
    }}>在定位通路重试此原号</button>}
    {pending && (!recoveryOnly || recoveryRetryAllowed) && <button className={button} disabled={busy || !hasCredential} onClick={() => void retry()}>核对后按原编号重试</button>}
    {pending && (!recoveryOnly || recoveryRetryAllowed) && scope.channel === "location" && <button className={button} disabled={busy} onClick={() => void retry(true)}>原编号明确无定位重试 · 待核查</button>}
    {state.canEndRejected && <button className={button} onClick={() => { const snapshot = client.getSnapshot(); if (window.confirm("服务器已明确拒绝本次意图。结束本次尝试后须重新读取规则，确定？") && live() && snapshot === client.getSnapshot()) void client.endRejected(); }}>结束本次已拒绝尝试</button>}
    {result?.operation && <dl className="space-y-2 break-words rounded-xl border p-3 text-sm"><div>已确认：{labels[result.operation.action]} · {result.operation.recordedAt}</div><div className="break-all">回执：{result.operation.eventId}</div><div>此回执不授权下一动作；下一动作须重新读取。</div></dl>}
    {result?.channel === "location" && result.clock.locationResult?.disposal && <p data-location-disposed className="text-sm">{LOCATION_DISPOSAL_NOTICE}</p>}
    {result?.channel === "location" && !result.clock.noticeGate.ready && <p className="text-sm">当前地点告知未就绪，请回定位告知页核对；不会自动请求定位。已有班次可用明确的无定位收尾。</p>}
  </section>;
}
