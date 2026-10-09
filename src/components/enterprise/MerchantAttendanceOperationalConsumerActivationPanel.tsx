"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceOperationalConsumerActivationClient, type OperationalConsumerActivationClientState } from "@/lib/merchantAttendanceOperationalConsumerActivationClient";
import { parseOperationalConsumerActivationCommand } from "@/lib/merchantAttendanceOperationalConsumerActivation";
export type ImplementedOperationalConsumer = "application_window" | "review_routing" | "timesheet_cycle" | "reminders";
export type OperationalConsumerActivationPanelProps = { siteId: string; actorId: string; apiFetch: AttendanceApiFetch; consumer?: ImplementedOperationalConsumer; enabled?: boolean; isCurrentAuth?: () => boolean;
  onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
const button = "min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
export const operationalConsumerName = (consumer: ImplementedOperationalConsumer = "application_window") => consumer === "reminders" ? "站内提醒规则" : consumer === "timesheet_cycle" ? "工时表周期规则" : consumer === "review_routing" ? "办理责任规则" : "申请窗口规则";
export const operationalConsumerPublicEnabled = (consumer: ImplementedOperationalConsumer = "application_window") => consumer === "reminders"
  ? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REMINDERS_ENABLED === "1" : consumer === "timesheet_cycle"
  ? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_ENABLED === "1" : consumer === "review_routing"
    ? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVIEW_ROUTING_ENABLED === "1" : process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED === "1";
export function activationReasonValid(reason: string) { try { parseOperationalConsumerActivationCommand({ siteId: "99990001", consumer: "application_window", operationId: "24200000-0000-4000-8000-000000000001", action: "activate", expectedRevision: 0, reason }); return true; } catch { return false; } }
export function confirmActivationAction(confirm: () => boolean, current: () => boolean, run: () => void) { if (!current() || !confirm() || !current()) return false; run(); return true; }
/* eslint-disable react-hooks/refs -- Revoke the old scope synchronously, before effect cleanup; abandoned renders cannot grant old authority. */
export default function MerchantAttendanceOperationalConsumerActivationPanel(props: OperationalConsumerActivationPanelProps) {
  const { siteId, actorId, apiFetch, isCurrentAuth, consumer = "application_window" } = props, enabled = props.enabled ?? operationalConsumerPublicEnabled(consumer);
  const key = JSON.stringify([siteId, actorId, consumer, enabled]), live = useRef({ key, apiFetch, isCurrentAuth, token: 0 });
  if (live.current.key !== key || live.current.apiFetch !== apiFetch || live.current.isCurrentAuth !== isCurrentAuth) live.current = { key, apiFetch, isCurrentAuth, token: live.current.token + 1 };
  const token = live.current.token, current = useCallback(() => live.current.token === token && isCurrentAuth?.() !== false, [token, isCurrentAuth]);
  return <Prepared key={token} {...props} enabled={enabled} current={current}/>;
}
/* eslint-enable react-hooks/refs */
function Prepared(props: OperationalConsumerActivationPanelProps & { enabled: boolean; current: () => boolean }) {
  const { siteId, actorId, apiFetch, enabled, current, consumer = "application_window" } = props;
  const client = useMemo(() => { try { return new AttendanceOperationalConsumerActivationClient({ siteId, consumer, actorId, apiFetch, enabled, storage: () => sessionStorage, isCurrentAuth: current }); } catch { return null; } }, [siteId, actorId, consumer, apiFetch, enabled, current]);
  return client ? <Screen {...props} client={client}/> : <section className="p-4"><p role="alert">无法核验启用管理身份，未请求或提交。</p><button className={button} onClick={props.onClose}>关闭启用管理</button></section>;
}
function Screen({ client, enabled, current, onClose, registerLeaveGuard, consumer = "application_window" }: OperationalConsumerActivationPanelProps & { client: AttendanceOperationalConsumerActivationClient; enabled: boolean; current: () => boolean }) {
  const name = operationalConsumerName(consumer);
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
  const live = (generation: number, snapshot: OperationalConsumerActivationClientState) => current() && shown && !document.hidden && generation === epoch.current && snapshot === client.getSnapshot();
  const submit = (action: "activate" | "deactivate") => { const generation = epoch.current, snapshot = client.getSnapshot(), input = reason;
    confirmActivationAction(() => window.confirm(consumer === "reminders"
      ? action === "activate" ? "启用站内提醒规则？仅登记随后真实产生的新来源，不补发历史提醒；不启动定时任务，也不自动审批、送审、确认或封存。" : "停用站内提醒规则？停止后续投递；已停止计划不会因重新启用而复活，旧提醒和原操作编号保留。"
      : consumer === "timesheet_cycle"
      ? action === "activate" ? "启用周期规则采用？负责人或有送审授权的人员仍须明确采用完整日期并送审，不会自动生成周期或重算旧工时表。" : "停用新的周期规则采用？已保存计划、周期和原操作编号保留，未送审计划仍可明确取消。"
      : consumer === "review_routing"
      ? action === "activate" ? "启用后，仅新提交申请固定办理责任；不改变审批权限、不补填旧申请。现在启用吗？" : "停用新申请的办理责任固定？已保存责任、原授权和原编号继续保留。"
      : action === "activate" ? "启用后，新补正和漏卡申请须通过申请窗口核验入口，旧入口不能绕过。请确认新申请入口已按发布安排可用。现在启用吗？" : "停用新的申请窗口规则消费？独立企业申请政策仍有效；旧申请、已保存截止和原编号不会删除。"),
      () => live(generation, snapshot) && !snapshot.pending && snapshot.phase === "ready" && snapshot.query?.mode === "current" && !snapshot.result?.receipt && activationReasonValid(input)
        && (action === "activate" ? enabled && !!snapshot.result?.canActivate : !!snapshot.result?.canDeactivate),
      () => { epoch.current++; clear(); void client.submit(action, input); }); };
  const read = (recover: boolean) => { const generation = epoch.current, snapshot = client.getSnapshot(); if (!live(generation, snapshot) || ["loading", "saving"].includes(snapshot.phase)) return;
    if (dirty.current && !window.confirm("读取会清除未提交理由，继续吗？")) return; if (!live(generation, snapshot)) return; epoch.current++; clear(); void (recover ? client.recover() : client.load()); };
  return <section aria-label={`${name}启用管理`} className="min-w-0 space-y-4 p-4 sm:p-6"><header className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-bold">{name}启用管理</h2><button className={button} onClick={() => { if (leave()) onClose(); }}>关闭启用管理</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">{consumer === "reminders" ? "这是站内提醒规则的独立启用决定。仅登记随后真实产生且规则允许的新来源，不补发历史提醒；不授予审批权，不自动送审、确认或封存，也不启动定时任务。手动检查及受控 runner 仍有各自服务端开关。停用停止后续投递，已停止计划不复活，旧提醒和原号恢复保留。" : consumer === "timesheet_cycle" ? "这里只启用明确采用周期规则的入口，不会自动排期、自动送审、扩大权限或改写旧周期。采用和首次送审须由原有送审资格的负责人或被授权人员执行；停用保留旧计划、旧归档及原号恢复，自动提醒另行启用。" : consumer === "review_routing" ? "这是办理责任的独立启用决定。仅新提交申请固定责任，不授予审批权、不阻止其他合法审批人、不补填旧申请；停用不删历史、不撤授权，周期和提醒不在此开通。" : "这是申请窗口的独立启用决定，不会发布规则、扩大申请期限、授予权限或重算旧申请。停用后企业原有政策仍有效，已保存申请和原号恢复保留；办理责任另行启用，周期和提醒尚不在此开通。"}</p>
    <OperationalConsumerActivationControls consumer={consumer} state={state} visible={shown && current()} enabled={enabled} reason={reason} onReason={value => { epoch.current++; dirty.current = true; setReason(value); }} onRead={() => read(false)} onRecover={() => read(true)} onSubmit={submit}/>
  </section>;
}
export function OperationalConsumerActivationControls({ state, visible, enabled, reason, consumer = "application_window", onReason = () => {}, onRead = () => {}, onRecover = () => {}, onSubmit = () => {} }: {
  state: OperationalConsumerActivationClientState; visible: boolean; enabled: boolean; reason: string; onReason?: (value: string) => void; onRead?: () => void; onRecover?: () => void; onSubmit?: (action: "activate" | "deactivate") => void;
  consumer?: ImplementedOperationalConsumer;
}) {
  const name = operationalConsumerName(consumer);
  const result = visible ? state.result : null, pending = visible ? state.pending : null, busy = !visible || state.phase === "loading" || state.phase === "saving";
  const fresh = state.phase === "ready" && state.query?.mode === "current" && result && !result.receipt && !pending;
  return <div className="min-w-0 space-y-4"><p role="status" className="break-words text-sm">{visible ? state.message : "页面隐藏或身份变化，正文和草稿已清除；原编号保留。"}</p>
    {!enabled && <p className="text-sm">新启用已关闭；当前负责人仍可读取并安全停用，原操作者仍可只读恢复原号。</p>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !!pending} onClick={onRead}>读取当前启用状态</button>{pending && <button className={button} disabled={busy} onClick={onRecover}>核对原启用操作编号</button>}</div>
    {pending && <p className="break-all rounded-xl bg-amber-50 p-3 text-sm">待确认原编号：{pending.command.operationId}。不会重新发送；未找到回执也不代表未提交。</p>}
    {result && !result.receipt && state.query?.mode === "current" && <div className="space-y-2 rounded-xl border p-3 text-sm"><p>当前：{result.current?.action === "activate" ? `已启用${name}` : `未启用${name}`} · 修订 {result.current?.revision ?? 0}</p>{result.current && <><p className="break-all">保存 UTC：{result.current.recordedAt}</p><p className="break-words">保存理由：{result.current.reason}</p></>}</div>}
    {result?.receipt && <div className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><p>原操作已确认：{result.receipt.action === "activate" ? "启用" : "停用"} · 修订 {result.receipt.revision}</p><p className="break-all">原编号：{result.receipt.operationId}</p><p className="break-all">UTC：{result.receipt.recordedAt}</p><p>仅证明这个账本操作已保存；不恢复负责人资格，新操作必须明确重读。</p></div>}
    {fresh && <><label className="block text-sm">启用／停用理由<textarea className="mt-1 w-full min-w-0 rounded-xl border bg-white p-3" maxLength={400} value={reason} disabled={busy} onChange={e => onReason(e.target.value)}/></label>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !enabled || !result.canActivate || !activationReasonValid(reason)} onClick={() => onSubmit("activate")}>确认启用{name}</button><button className={button} disabled={busy || !result.canDeactivate || !activationReasonValid(reason)} onClick={() => onSubmit("deactivate")}>确认停用{name}</button></div></>}
  </div>;
}


