"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendancePeriodDelegationClient, type PeriodDelegationStorage, type PeriodDelegationClientState } from "@/lib/merchantAttendancePeriodDelegationClient";
import { PERIOD_DELEGATION_ACTIONS, parsePeriodDelegationCommand, type PeriodDelegationAction } from "@/lib/merchantAttendancePeriodDelegation";
import { parsePeriodDelegatedClosureQuery } from "@/lib/merchantAttendancePeriodDelegatedClosure";
import { periodDelegatedClosurePendingKey, type PeriodDelegatedClosureScope } from "@/lib/merchantAttendancePeriodDelegatedClosureClient";

export type PeriodDelegationPeriodSelection = Readonly<PeriodDelegatedClosureScope & { fromDate: string; throughDate: string }>;
export type PeriodDelegationPanelProps = { siteId: string; access: "owner" | "delegate"; actorId: string; authUserId: string;
  apiFetch: AttendanceApiFetch; enabled?: boolean; isCurrentAuth?: () => boolean; onClose: () => void;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void; onOpenPeriod?: (value: PeriodDelegationPeriodSelection) => void };
export function periodDelegationPeriodSelection(state: PeriodDelegationClientState, identity: Pick<PeriodDelegationPanelProps, "siteId" | "access" | "actorId" | "authUserId">, fromDate: string, throughDate: string): PeriodDelegationPeriodSelection {
  const r = state.result, q = state.query, g = r?.detail;
  if (identity.access !== "delegate" || state.phase !== "ready" || state.pending || !q || q.mode !== "detail" || q.access !== "delegate" || q.siteId !== identity.siteId
    || !r || r.mode !== "detail" || r.siteId !== identity.siteId || r.access !== "delegate" || r.actorId !== identity.authUserId || r.employeeId !== identity.actorId
    || !g || q.grantId !== g.grantId || g.revision !== 1 || g.status !== "granted" || g.revocation !== null || !g.usableActions.includes("view")
    || g.delegate.employeeId !== identity.actorId || g.delegate.authUserId !== identity.authUserId || r.readAt < g.validFrom || r.readAt >= g.validUntil) throw Error("grant_not_current");
  const scope: PeriodDelegatedClosureScope = { siteId: identity.siteId, actorEmployeeId: identity.actorId, expectedAuthUserId: identity.authUserId,
    grantId: g.grantId, workerId: g.worker.workerId, targetEmployeeId: g.worker.employeeId, targetAuthUserId: g.worker.authUserId,
    authorizedFromDate: g.fromDate, authorizedThroughDate: g.throughDate };
  periodDelegatedClosurePendingKey(scope);
  parsePeriodDelegatedClosureQuery({ siteId: scope.siteId, access: "delegate", grantId: scope.grantId, workerId: scope.workerId, fromDate, throughDate,
    mode: "list", periodId: null, operationId: null, version: null, cursor: null });
  if (fromDate < g.fromDate || throughDate > g.throughDate) throw Error("grant_range");
  return Object.freeze({ ...scope, fromDate, throughDate });
}
const names: Record<PeriodDelegationAction, string> = { view: "查看核对资料", send: "保存版本并送本人核对", respond: "回复争议", seal: "封存", reopen: "重开" };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm";
const initial = () => ({ fromDate: "", throughDate: "", validFrom: "", validUntil: "", reason: "", actions: [] as PeriodDelegationAction[], includeExisting: false, acknowledged: false });
export function periodDelegationUtcInput(v: string) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v) || v.startsWith("0000")) throw Error("invalid_utc");
  const stamp = v + ":00.000Z", ms = Date.parse(stamp); if (!Number.isFinite(ms) || new Date(ms).toISOString() !== stamp) throw Error("invalid_utc"); return v + ":00.000000Z";
}
/** Guard captured handles too: render-time identity changes can precede cleanup. */
export function periodDelegationPorts(apiFetch: AttendanceApiFetch, storage: () => PeriodDelegationStorage, isCurrent: () => boolean) {
  const check = () => { if (!isCurrent()) throw Error("identity_changed"); };
  const target = () => { check(); const value = storage(); check(); return value; };
  return {
    isCurrentAuth: isCurrent,
    storage: (): PeriodDelegationStorage => { check(); return {
      getItem: key => { const value = target().getItem(key); check(); return value; },
      setItem: (key, value) => { target().setItem(key, value); check(); },
      removeItem: key => { target().removeItem(key); check(); },
    }; },
    apiFetch: (async (path, init) => { check(); const response = await apiFetch(path, init);
      if (!isCurrent()) { void response.body?.cancel().catch(() => {}); throw Error("identity_changed"); } return response;
    }) satisfies AttendanceApiFetch,
  };
}
/** A modal may return after the scope, selected identity or read snapshot changed. */
export function confirmPeriodDelegationAction(confirm: () => boolean, current: () => boolean, act: () => void) {
  if (!current() || !confirm() || !current()) return false;
  act(); return true;
}
/* eslint-disable react-hooks/refs -- This exact monotonic scope fence revokes old async/storage authority before effects. An abandoned render can only invalidate a lease; it cannot reauthorize an old A-B-A token. */
export default function MerchantAttendancePeriodDelegationPanel(props: PeriodDelegationPanelProps) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_DELEGATION_ENABLED === "1";
  const key = `${props.siteId}:${props.access}:${props.actorId}:${props.authUserId}`;
  const live = useRef({ key, apiFetch: props.apiFetch, authCheck: props.isCurrentAuth, enabled, token: 0 });
  if (live.current.key !== key || live.current.apiFetch !== props.apiFetch || live.current.authCheck !== props.isCurrentAuth || live.current.enabled !== enabled) {
    live.current = { key, apiFetch: props.apiFetch, authCheck: props.isCurrentAuth, enabled, token: live.current.token + 1 };
  }
  const token = live.current.token;
  const isCurrent = useCallback(() => live.current.token === token && props.isCurrentAuth?.() !== false, [token, props.isCurrentAuth]);
  return <Prepared key={token} {...props} enabled={enabled} isCurrent={isCurrent}/>;
}
/* eslint-enable react-hooks/refs */
function Prepared(props: PeriodDelegationPanelProps & { enabled: boolean; isCurrent: () => boolean }) {
  const client = useMemo(() => { try { return new AttendancePeriodDelegationClient({ siteId: props.siteId, access: props.access,
    actorId: props.actorId, enabled: props.enabled, expectedAuthUserId: props.authUserId,
    ...periodDelegationPorts(props.apiFetch, () => sessionStorage, props.isCurrent) }); } catch { return null; } },
    [props.siteId, props.access, props.actorId, props.authUserId, props.apiFetch, props.isCurrent, props.enabled]);
  return client ? <Screen {...props} client={client}/> : <section className="p-4"><p role="alert">无法核验当前身份，未读取或提交。</p><button type="button" className={button} onClick={props.onClose}>关闭</button></section>;
}
function Screen({ client, siteId, actorId, authUserId, access, enabled, onClose, onOpenPeriod, registerLeaveGuard, isCurrent }: PeriodDelegationPanelProps & { client: AttendancePeriodDelegationClient; enabled: boolean; isCurrent: () => boolean }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [draft, setDraft] = useState(initial), [visible, setVisible] = useState(false), [error, setError] = useState("");
  const [range, setRange] = useState({ fromDate: "", throughDate: "" });
  const dirty = useRef(false), epoch = useRef(0);
  const clear = useCallback(() => { dirty.current = false; setDraft(initial()); setRange({ fromDate: "", throughDate: "" }); setError(""); }, []);
  const invalidate = useCallback(() => { epoch.current++; client.pause(); clear(); }, [client, clear]);
  const leave = useCallback(() => { const generation = epoch.current, snapshot = client.getSnapshot();
    return confirmPeriodDelegationAction(
      () => !(dirty.current || client.hasLeaveRisk()) || window.confirm("离开会清除未提交草稿，已提交操作不会撤销；待确认原编号仍需核对。继续吗？"),
      () => isCurrent() && generation === epoch.current && snapshot === client.getSnapshot(), invalidate);
  }, [client, invalidate, isCurrent]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useLayoutEffect(() => { const hide = () => { invalidate(); setVisible(false); };
    const show = () => { if (!isCurrent() || document.hidden) return; epoch.current++; clear(); void client.initialize(); setVisible(true); };
    const visibility = () => document.hidden ? hide() : show();
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    visibility(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => { epoch.current++; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, clear, invalidate, isCurrent]);
  const busy = state.phase === "loading" || state.phase === "saving", locked = busy || !!state.pending;
  const current = (generation: number, snapshot = state) => isCurrent() && visible && !document.hidden && generation === epoch.current && snapshot === client.getSnapshot();
  const read = (run: () => Promise<void>) => { if (current(epoch.current)) { setRange({ fromDate: "", throughDate: "" }); void run(); } };
  const edit = (patch: Partial<ReturnType<typeof initial>>) => { if (!current(epoch.current) || locked) return; epoch.current++; dirty.current = true; setDraft(d => ({ ...d, ...patch, acknowledged: false })); setError(""); };
  const grant = async () => {
    if (!draft.acknowledged || locked || !enabled || !current(epoch.current)) return;
    const generation = epoch.current, snapshot = client.getSnapshot(), selected = snapshot.choices;
    try { if (!selected.delegate || !selected.worker) throw Error("请选择主管和员工。");
      const delegate = selected.delegate, worker = selected.worker;
      const value = { actions: draft.actions, fromDate: draft.fromDate, throughDate: draft.throughDate, includeExisting: draft.includeExisting,
        validFrom: periodDelegationUtcInput(draft.validFrom), validUntil: periodDelegationUtcInput(draft.validUntil), reason: draft.reason.trim() };
      parsePeriodDelegationCommand({ action: "grant", operationId: "00000000-0000-4000-8000-000000000001", ...value,
        delegateEmployeeId: delegate.employeeId, delegateAuthUserId: delegate.employeeAuthUserId,
        workerId: worker.id, employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId });
      let submission: Promise<void> | null = null;
      confirmPeriodDelegationAction(
        () => window.confirm(`向 ${delegate.name} 授予 ${worker.name} 的周期权限：${draft.actions.map(a => names[a]).join("、")}？不会代替本人确认或改写旧档。`),
        () => current(generation, snapshot), () => { epoch.current++; clear(); submission = client.grant(value); });
      if (submission) await submission;
    } catch { if (current(generation, snapshot)) setError("请检查身份、动作、理由及日期。日期范围最多366天，有效期最多366天；写动作必须包含查看。"); }
  };
  const openPeriod = () => {
    if (!enabled || locked || !onOpenPeriod || !current(epoch.current)) return;
    const generation = epoch.current, snapshot = client.getSnapshot();
    try { const value = periodDelegationPeriodSelection(snapshot, { siteId, access, actorId, authUserId }, range.fromDate, range.throughDate);
      confirmPeriodDelegationAction(() => window.confirm("打开所选员工和日期的受托周期工作区？进入后仍须明确读取并重新核验授权，不会自动送审。"),
        () => current(generation, snapshot), () => { invalidate(); onOpenPeriod(value); });
    } catch { if (current(generation, snapshot)) setError("请重新核验授权详情，选择授权内最多31天的完整业务日期；没有打开或提交。"); }
  };
  return <section aria-label="周期管理授权" className="min-w-0 space-y-4 p-4 text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">周期管理授权</h2><button type="button" className={button} onClick={() => { if (leave()) onClose(); }}>关闭</button></header>
    <p className="text-sm text-slate-600">按指定员工的完整跨地点周期授权；仅角色勾选不授予资料范围。本人确认／争议仍由本人操作，不包含定位证据、附件或报表导出。</p>
    {!visible ? <p>页面已隐藏，资料清除；返回后请重新读取。</p> : <>
      <p role="status" className="break-words rounded-xl bg-slate-50 p-3 text-sm">{state.message}</p>
      {!enabled && <p className="text-sm text-amber-700">新授权关闭。负责人仍可核验／撤销已有授权，原编号只能只读恢复。</p>}
      {state.pending ? <div className="space-y-2"><p className="break-all text-sm">待确认编号：{state.pending.command.operationId}</p><button type="button" className={button} disabled={busy} onClick={() => read(client.recover)}>只读核对原编号</button></div>
        : <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => read(client.load)}>读取授权</button>
          {access === "owner" && enabled && <><button type="button" className={button} disabled={busy} onClick={() => read(() => client.catalog("delegates"))}>选择主管</button><button type="button" className={button} disabled={busy} onClick={() => read(() => client.catalog("workers"))}>选择员工</button></>}</div>}
      {!!state.result?.catalogItems.length && <ul className="space-y-2">{state.result.catalogItems.map(item => <li key={item.id}><button type="button" className={button} disabled={locked} onClick={() => { if (!current(epoch.current) || locked) return; epoch.current++; dirty.current = true; setDraft(initial()); setError(""); state.query?.catalog === "delegates" ? client.selectDelegate(item) : client.selectWorker(item); }}>{item.name}{item.workerNo ? ` · ${item.workerNo}` : ""}</button></li>)}</ul>}
      {access === "owner" && enabled && <fieldset disabled={locked} className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3"><legend>新增授权</legend>
        <p className="break-words text-sm">主管：{state.choices.delegate?.name ?? "未选择"}　员工：{state.choices.worker?.name ?? "未选择"}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{([['fromDate','业务起始日期','date'],['throughDate','业务截止日期（含当天）','date'],['validFrom','授权生效时间（UTC）','datetime-local'],['validUntil','授权到期时间（UTC）','datetime-local']] as const).map(([key,label,type]) =>
          <label key={key} className="min-w-0 text-sm">{label}<input className={input} type={type} value={draft[key]} onChange={e => edit({ [key]: e.target.value })}/></label>)}</div>
        <p className="text-xs text-slate-500">业务日期使用周期保存的当地日期；授权生效／到期使用UTC，不受浏览器时区变化影响。</p>
        <div className="flex flex-wrap gap-3">{PERIOD_DELEGATION_ACTIONS.map(action => <label key={action} className="text-sm"><input type="checkbox" checked={draft.actions.includes(action)}
          disabled={!state.choices.delegate?.actions.includes(action) || action !== "view" && !draft.actions.includes("view")}
          onChange={e => edit({ actions: action === "view" && !e.target.checked ? [] : PERIOD_DELEGATION_ACTIONS.filter(a => a === action ? e.target.checked : draft.actions.includes(a)) })}/> {names[action]}</label>)}</div>
        <label className="block text-sm"><input type="checkbox" checked={draft.includeExisting} onChange={e => edit({ includeExisting: e.target.checked })}/> 同时授权范围内已有周期（默认不包含）</label>
        <label className="block text-sm">授权理由<textarea className={input} maxLength={400} value={draft.reason} onChange={e => edit({ reason: e.target.value })}/></label>
        <label className="block text-sm"><input type="checkbox" checked={draft.acknowledged} onChange={e => { if (!current(epoch.current) || locked) return; epoch.current++; dirty.current = true; setDraft(d => ({ ...d, acknowledged: e.target.checked })); }}/> 已核对人员、资料范围、期限和所选动作</label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}<button type="button" className={button} disabled={!draft.acknowledged || !state.result?.canWrite || !state.choices.delegate || !state.choices.worker} onClick={() => void grant()}>确认授予</button>
      </fieldset>}
      {!!state.result?.grants.length && <ul className="space-y-2">{state.result.grants.map(g => <li key={g.grantId} className="rounded-xl border border-slate-200 p-3 text-sm"><p>{g.delegate.name} → {g.worker.name}</p><p>{g.fromDate} — {g.throughDate} · {g.status === "revoked" ? "已撤销" : g.usableActions.length ? "当前可用" : "当前不可用"}</p><button type="button" className={button} disabled={locked} onClick={() => read(() => client.detailGrant(g.grantId))}>核验详情</button></li>)}</ul>}
      {state.result?.nextAfterId && <button type="button" className={button} disabled={locked} onClick={() => read(client.next)}>下一页</button>}
      {state.result?.detail && <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm"><p>{state.result.detail.delegate.name} → {state.result.detail.worker.name}</p><p>授予动作：{state.result.detail.actions.map(a => names[a]).join("、")}</p>
         <p className="break-words">UTC有效期：{state.result.detail.validFrom} — {state.result.detail.validUntil}</p><p>{state.result.detail.reason}</p>
         {access === "delegate" && enabled && onOpenPeriod && state.result.detail.usableActions.includes("view") && <fieldset disabled={locked} className="space-y-2">
           <legend>明确选择受托周期日期（最多31天）</legend><p>授权业务日期：{state.result.detail.fromDate} — {state.result.detail.throughDate}；完整周期必须落在此范围内。</p>
           {(["fromDate", "throughDate"] as const).map(key => <label key={key} className="block">{key === "fromDate" ? "受托周期起始日期" : "受托周期截止日期"}<input className={input} type="date" value={range[key]}
             min={state.result!.detail!.fromDate} max={state.result!.detail!.throughDate} onChange={event => { if (!current(epoch.current) || locked) return;
               epoch.current++; dirty.current = true; setRange(v => ({ ...v, [key]: event.target.value })); setError(""); }}/></label>)}
           <button type="button" className={button} disabled={!range.fromDate || !range.throughDate} onClick={openPeriod}>打开受托周期工作区</button>
         </fieldset>}
        {access === "owner" && state.result.detail.revision === 1 && <button type="button" className={button} disabled={locked} onClick={() => { const generation = epoch.current, snapshot = client.getSnapshot(), grantId = state.result!.detail!.grantId;
          let reason: string | null = null;
          confirmPeriodDelegationAction(() => { reason = window.prompt("撤销理由（1–200字符）："); return !!reason?.trim(); },
            () => current(generation, snapshot) && !locked, () => { epoch.current++; clear(); void client.revoke(grantId, reason!); }); }}>撤销授权</button>}</div>}
       {state.result?.receipt && <p className="break-all text-sm">已核实操作：{state.result.receipt.operationId}；仅代表这一次授权操作的保存结果。</p>}
       {access === "delegate" && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </>}
  </section>;
}
