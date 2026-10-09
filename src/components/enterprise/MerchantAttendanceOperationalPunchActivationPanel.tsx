"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceOperationalPunchActivationClient, type OperationalPunchActivationClientState } from "@/lib/merchantAttendanceOperationalPunchActivationClient";
import { parseOperationalPunchActivationCommand } from "@/lib/merchantAttendanceOperationalPunchActivation";
export type OperationalPunchActivationPanelProps = { siteId: string; actorId: string; apiFetch: AttendanceApiFetch; enabled?: boolean; isCurrentAuth?: () => boolean;
  onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
const button = "min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
export function activationReasonValid(reason: string) { try { parseOperationalPunchActivationCommand({ siteId: "99990001", operationId: "24200000-0000-4000-8000-000000000001", action: "activate", expectedRevision: 0, reason }); return true; } catch { return false; } }
export function confirmActivationAction(confirm: () => boolean, current: () => boolean, run: () => void) { if (!current() || !confirm() || !current()) return false; run(); return true; }
/* eslint-disable react-hooks/refs -- Revoke the old scope synchronously, before effect cleanup; abandoned renders cannot grant old authority. */
export default function MerchantAttendanceOperationalPunchActivationPanel(props: OperationalPunchActivationPanelProps) {
  const { siteId, actorId, apiFetch, isCurrentAuth } = props, enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_ENABLED === "1";
  const key = JSON.stringify([siteId, actorId, enabled]), live = useRef({ key, apiFetch, isCurrentAuth, token: 0 });
  if (live.current.key !== key || live.current.apiFetch !== apiFetch || live.current.isCurrentAuth !== isCurrentAuth) live.current = { key, apiFetch, isCurrentAuth, token: live.current.token + 1 };
  const token = live.current.token, current = useCallback(() => live.current.token === token && isCurrentAuth?.() !== false, [token, isCurrentAuth]);
  return <Prepared key={token} {...props} enabled={enabled} current={current}/>;
}
/* eslint-enable react-hooks/refs */
function Prepared(props: OperationalPunchActivationPanelProps & { enabled: boolean; current: () => boolean }) {
  const { siteId, actorId, apiFetch, enabled, current } = props;
  const client = useMemo(() => { try { return new AttendanceOperationalPunchActivationClient({ siteId, actorId, apiFetch, enabled, storage: () => sessionStorage, isCurrentAuth: current }); } catch { return null; } }, [siteId, actorId, apiFetch, enabled, current]);
  return client ? <Screen {...props} client={client}/> : <section className="p-4"><p role="alert">无法核验启用管理身份，未请求或提交。</p><button className={button} onClick={props.onClose}>关闭启用管理</button></section>;
}
function Screen({ client, enabled, current, onClose, registerLeaveGuard }: OperationalPunchActivationPanelProps & { client: AttendanceOperationalPunchActivationClient; enabled: boolean; current: () => boolean }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [shown, setShown] = useState(false), [reason, setReason] = useState("");
  const epoch = useRef(0), dirty = useRef(false);
  const clear = useCallback(() => { dirty.current = false; setReason(""); }, []);
  const invalidate = useCallback(() => { epoch.current++; client.pause(); clear(); }, [client, clear]);
  const leave = useCallback(() => { const generation = epoch.current, snapshot = client.getSnapshot(); return confirmActivationAction(
    () => !(dirty.current || client.hasLeaveRisk()) || window.confirm("离开会清除未提交理由；已发送操作不会撤销，原编号继续保留。继续吗？"),
    () => current() && generation === epoch.current && snapshot === client.getSnapshot(), invalidate); }, [client, current, invalidate]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [leave, registerLeaveGuard]);
  useLayoutEffect(() => { const generation = epoch;
    const hide = () => flushSync(() => { invalidate(); setShown(false); }), show = () => { if (!current() || document.hidden) return; epoch.current++; clear(); void client.initialize(); setShown(true); };
    const visibility = () => document.hidden ? hide() : show(), unload = (e: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { e.preventDefault(); e.returnValue = ""; } };
    if (!document.hidden) show(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => { generation.current++; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, current, clear, invalidate]);
  const live = (generation: number, snapshot: OperationalPunchActivationClientState) => current() && shown && !document.hidden && generation === epoch.current && snapshot === client.getSnapshot();
  const submit = (action: "activate" | "deactivate") => { const generation = epoch.current, snapshot = client.getSnapshot(), input = reason;
    confirmActivationAction(() => window.confirm(action === "activate" ? "启用后，新的上班必须通过在线规则核验入口；旧入口不能绕过。请确认四通路候选已按发布安排可用。现在启用吗？" : "停用新规则开班？已有受管班次仍按保存规则核验休息，旧事实和原编号不会删除。"),
      () => live(generation, snapshot) && !snapshot.pending && snapshot.phase === "ready" && snapshot.query?.mode === "current" && !snapshot.result?.receipt && activationReasonValid(input)
        && (action === "activate" ? enabled && !!snapshot.result?.canActivate : !!snapshot.result?.canDeactivate),
      () => { epoch.current++; clear(); void client.submit(action, input); }); };
  const read = (recover: boolean) => { const generation = epoch.current, snapshot = client.getSnapshot(); if (!live(generation, snapshot) || ["loading", "saving"].includes(snapshot.phase)) return;
    if (dirty.current && !window.confirm("读取会清除未提交理由，继续吗？")) return; if (!live(generation, snapshot)) return; epoch.current++; clear(); void (recover ? client.recover() : client.load()); };
  return <section aria-label="在线打卡规则启用管理" className="min-w-0 space-y-4 p-4 sm:p-6"><header className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-bold">在线打卡规则启用管理</h2><button className={button} onClick={() => { if (leave()) onClose(); }}>关闭启用管理</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">这是一项独立的负责人启用决定，不会发布规则、授予权限、重算历史或证明四通路已验收。启用后新上班必须走支持规则核验的入口；停用不会移除已有班次的固定休息政策或原号恢复能力。</p>
    <OperationalPunchActivationControls state={state} visible={shown && current()} enabled={enabled} reason={reason} onReason={value => { epoch.current++; dirty.current = true; setReason(value); }} onRead={() => read(false)} onRecover={() => read(true)} onSubmit={submit}/>
  </section>;
}
export function OperationalPunchActivationControls({ state, visible, enabled, reason, onReason = () => {}, onRead = () => {}, onRecover = () => {}, onSubmit = () => {} }: {
  state: OperationalPunchActivationClientState; visible: boolean; enabled: boolean; reason: string; onReason?: (value: string) => void; onRead?: () => void; onRecover?: () => void; onSubmit?: (action: "activate" | "deactivate") => void;
}) {
  const result = visible ? state.result : null, pending = visible ? state.pending : null, busy = !visible || state.phase === "loading" || state.phase === "saving";
  const fresh = state.phase === "ready" && state.query?.mode === "current" && result && !result.receipt && !pending;
  return <div className="min-w-0 space-y-4"><p role="status" className="break-words text-sm">{visible ? state.message : "页面隐藏或身份变化，正文和草稿已清除；原编号保留。"}</p>
    {!enabled && <p className="text-sm">新启用已关闭；当前负责人仍可读取并安全停用，原操作者仍可只读恢复原号。</p>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !!pending} onClick={onRead}>读取当前启用状态</button>{pending && <button className={button} disabled={busy} onClick={onRecover}>核对原启用操作编号</button>}</div>
    {pending && <p className="break-all rounded-xl bg-amber-50 p-3 text-sm">待确认原编号：{pending.command.operationId}。不会重新发送；未找到回执也不代表未提交。</p>}
    {result && !result.receipt && state.query?.mode === "current" && <div className="space-y-2 rounded-xl border p-3 text-sm"><p>当前：{result.current?.action === "activate" ? "已启用新规则开班" : "未启用新规则开班"} · 修订 {result.current?.revision ?? 0}</p>{result.current && <><p className="break-all">保存 UTC：{result.current.recordedAt}</p><p className="break-words">保存理由：{result.current.reason}</p></>}</div>}
    {result?.receipt && <div className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><p>原操作已确认：{result.receipt.action === "activate" ? "启用" : "停用"} · 修订 {result.receipt.revision}</p><p className="break-all">原编号：{result.receipt.operationId}</p><p className="break-all">UTC：{result.receipt.recordedAt}</p><p>仅证明这个账本操作已保存；不恢复负责人资格，新操作必须明确重读。</p></div>}
    {fresh && <><label className="block text-sm">启用／停用理由<textarea className="mt-1 w-full min-w-0 rounded-xl border bg-white p-3" maxLength={400} value={reason} disabled={busy} onChange={e => onReason(e.target.value)}/></label>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !enabled || !result.canActivate || !activationReasonValid(reason)} onClick={() => onSubmit("activate")}>确认启用在线规则开班</button><button className={button} disabled={busy || !result.canDeactivate || !activationReasonValid(reason)} onClick={() => onSubmit("deactivate")}>确认停用新规则开班</button></div></>}
  </div>;
}
