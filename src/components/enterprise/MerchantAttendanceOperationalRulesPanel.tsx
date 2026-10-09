"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceOperationalRuleLedgerClient } from "@/lib/merchantAttendanceOperationalRuleLedgerClient";
import type { OperationalRuleLedgerScope, OperationalRuleLedgerResult, OperationalRuleLedgerReceipt } from "@/lib/merchantAttendanceOperationalRuleLedger";
import { readOperationalRulesDirectory } from "@/lib/merchantAttendanceOperationalRulesDirectory";
import { OperationalRulesFields, emptyOperationalRules, operationalRuleFormValid, operationalRuleReasonValid, type OperationalRouteChoice } from "./MerchantAttendanceOperationalRulesFields";

export type OperationalRulesPanelProps = { siteId: string; actorId: string; apiFetch: AttendanceApiFetch; enabled?: boolean;
  isCurrentAuth?: () => boolean; onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm";
export const operationalRuleScopeLabel = (s: OperationalRuleLedgerScope) => s.kind === "enterprise" ? "企业层" : s.kind === "group" ? "考勤组层" : "保存身份个人层";
export function operationalRuleDatesValid(scope: OperationalRuleLedgerScope, effectiveOn: string, endsOn: string) {
  const date = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "2000-01-01" && v <= "2100-12-31" && Number.isFinite(Date.parse(v + "T00:00:00.000Z")) && new Date(v + "T00:00:00.000Z").toISOString().slice(0, 10) === v;
  return date(effectiveOn) && (scope.kind !== "personal" || date(endsOn) && endsOn >= effectiveOn);
}
export function confirmOperationalRuleAction(confirm: () => boolean, current: () => boolean, run: () => void) { if (!current() || !confirm() || !current()) return false; run(); return true; }
export function operationalRulesPorts(fetch: AttendanceApiFetch, storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">, current: () => boolean) {
  const check = () => { if (!current()) throw Error("identity_changed"); }, target = () => { check(); const value = storage(); check(); return value; };
  return { isCurrentAuth: current, storage: () => ({ getItem: (key: string) => { const v = target().getItem(key); check(); return v; }, setItem: (key: string, value: string) => { target().setItem(key, value); check(); }, removeItem: (key: string) => { target().removeItem(key); check(); } }),
    apiFetch: (async (path, init) => { check(); const response = await fetch(path, init); if (!current()) { void response.body?.cancel().catch(() => {}); throw Error("identity_changed"); } return response; }) satisfies AttendanceApiFetch };
}
/* eslint-disable react-hooks/refs -- Synchronous monotonic revocation precedes effects; abandoned renders may invalidate but cannot grant a stale identity. */
export default function MerchantAttendanceOperationalRulesPanel(props: OperationalRulesPanelProps) {
  const { siteId, actorId, apiFetch, isCurrentAuth } = props, enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OPERATIONAL_RULES_ENABLED === "1";
  const key = JSON.stringify([siteId, actorId, enabled]), live = useRef({ key, apiFetch, isCurrentAuth, token: 0 });
  if (live.current.key !== key || live.current.apiFetch !== apiFetch || live.current.isCurrentAuth !== isCurrentAuth) live.current = { key, apiFetch, isCurrentAuth, token: live.current.token + 1 };
  const token = live.current.token, current = useCallback(() => live.current.token === token && isCurrentAuth?.() !== false, [token, isCurrentAuth]);
  return <ScopeHost key={token} {...props} enabled={enabled} current={current}/>;
}
/* eslint-enable react-hooks/refs */
function ScopeHost(props: OperationalRulesPanelProps & { enabled: boolean; current: () => boolean }) {
  const [scope, setScope] = useState<OperationalRuleLedgerScope>({ kind: "enterprise" });
  return <Prepared key={JSON.stringify(scope)} {...props} scope={scope} onScope={setScope}/>;
}
function Prepared(props: OperationalRulesPanelProps & { enabled: boolean; current: () => boolean; scope: OperationalRuleLedgerScope; onScope: (s: OperationalRuleLedgerScope) => void }) {
  const { siteId, actorId, scope, enabled, apiFetch, current } = props;
  // Scope transitions call leave()/pause before replacing this host. Unmount
  // cleanup also pauses the client; its generation fences every later result.
  const client = useMemo(() => { try { return new AttendanceOperationalRuleLedgerClient({ siteId, actorId, scope, enabled, ...operationalRulesPorts(apiFetch, () => sessionStorage, current) }); } catch { return null; } }, [siteId, actorId, scope, enabled, apiFetch, current]);
  return client ? <Screen {...props} client={client}/> : <section className="p-4"><p role="alert">无法核验当前身份，未读取或提交。</p><button className={button} onClick={props.onClose}>关闭运营规则台账</button></section>;
}
type Directory = Awaited<ReturnType<typeof readOperationalRulesDirectory>>;
function Screen({ siteId, actorId, apiFetch, enabled, current, scope, onScope, client, onClose, registerLeaveGuard }: OperationalRulesPanelProps & {
  enabled: boolean; current: () => boolean; scope: OperationalRuleLedgerScope; onScope: (s: OperationalRuleLedgerScope) => void; client: AttendanceOperationalRuleLedgerClient;
}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [shown, setShown] = useState(false), [rules, setRules] = useState(emptyOperationalRules), [reason, setReason] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(""), [endsOn, setEndsOn] = useState("");
  const [directory, setDirectory] = useState<Directory | null>(null), [directoryBusy, setDirectoryBusy] = useState(false), [directoryMessage, setDirectoryMessage] = useState("");
  const [routes, setRoutes] = useState<OperationalRouteChoice[]>([]), [routeNext, setRouteNext] = useState<string | null>(null);
  const epoch = useRef(0), dirty = useRef(false), running = useRef<AbortController | null>(null);
  const clear = useCallback(() => { dirty.current = false; setRules(emptyOperationalRules()); setReason(""); setEffectiveOn(""); setEndsOn(""); setDirectory(null); setDirectoryMessage(""); setRoutes([]); setRouteNext(null); }, []);
  const invalidate = useCallback(() => { epoch.current++; running.current?.abort(); running.current = null; setDirectoryBusy(false); client.pause(); clear(); }, [client, clear]);
  const leave = useCallback(() => { const generation = epoch.current, snapshot = client.getSnapshot(); return confirmOperationalRuleAction(
    () => !(dirty.current || client.hasLeaveRisk() || running.current) || window.confirm("离开会清除本地未提交输入；已发送操作不会撤销，原编号保留。继续吗？"),
    () => current() && generation === epoch.current && snapshot === client.getSnapshot(), invalidate); }, [client, current, invalidate]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useLayoutEffect(() => { const generation = epoch;
    const hide = () => flushSync(() => { invalidate(); setShown(false); });
    const show = () => { if (!current() || document.hidden) return; epoch.current++; clear(); void client.initialize(); setShown(true); };
    const visibility = () => document.hidden ? hide() : show(), unload = (e: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { e.preventDefault(); e.returnValue = ""; } };
    if (!document.hidden) show(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => { generation.current++; running.current?.abort(); client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, current, clear, invalidate]);
  const visible = shown && current(), result = visible ? state.result : null, pending = visible ? state.pending : null;
  const busy = directoryBusy || state.phase === "loading" || state.phase === "saving", ready = visible && !busy && !pending;
  const d = result?.data.kind === "detail" ? result.data : null, p = result?.data.kind === "preview" ? result.data : null;
  const live = (generation: number, snapshot = state) => current() && shown && !document.hidden && generation === epoch.current && client.getSnapshot() === snapshot;
  const mark = () => { epoch.current++; dirty.current = true; };
  const read = (run: () => void, discard = false) => { const generation = epoch.current, snapshot = client.getSnapshot(); if (!live(generation, snapshot) || busy || pending) return;
    if (discard && dirty.current && !window.confirm("读取会清除未提交输入，继续吗？")) return;
    if (!live(generation, snapshot)) return; epoch.current++; if (discard) clear(); run(); };
  const confirm = (message: string, run: () => void, safeWithdraw = false) => { const generation = epoch.current, snapshot = client.getSnapshot();
    return confirmOperationalRuleAction(() => window.confirm(message), () => live(generation, snapshot) && ready && operationalRuleReasonValid(reason) && (safeWithdraw ? !!d?.canWithdraw : enabled && !!result?.canWrite), () => { epoch.current++; clear(); run(); }); };
  const chooseScope = (next: OperationalRuleLedgerScope) => { if (!ready || !current() || document.hidden) return; if (leave() && current()) onScope(next); };
  const readDirectory = (kind: "groups" | "locations", cursor: string | null = null) => read(() => {
    client.pause(); const generation = ++epoch.current, controller = new AbortController(); running.current = controller; setDirectory(null); setDirectoryBusy(true); setDirectoryMessage("正在读取单页目录…");
    const active = () => current() && shown && !document.hidden && generation === epoch.current && running.current === controller;
    void readOperationalRulesDirectory({ siteId, actorId, kind, cursor, signal: controller.signal, apiFetch, current: active }).then(page => { if (!active()) return; setDirectory(page); setDirectoryMessage("仅当前页；目录不是发布授权。编辑后请明确读取当前台账核验 CAS。"); }).catch(() => { if (active()) setDirectoryMessage("此目录当前不可读取；未使用备用权限或猜测身份，请核对对应目录开关与访问。"); }).finally(() => { if (active()) { running.current = null; setDirectoryBusy(false); } });
  });
  const readRoutes = (cursor: string | null = null) => read(() => { const generation = ++epoch.current; void client.catalog("routes", cursor).then(() => {
    if (!current() || document.hidden || generation !== epoch.current) return; const data = client.getSnapshot().result?.data;
    if (data?.kind === "catalog" && data.catalog === "routes") { setRoutes([...data.items]); setRouteNext(data.nextId); }
  }); });
  const catalog = result?.data.kind === "catalog" ? result.data : null;
  return <section aria-label="八字段运营规则台账" className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-bold">八字段运营规则台账</h2><button className={button} onClick={() => { if (leave()) onClose(); }}>关闭运营规则台账</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">这里只保存草稿、核准未来发布、撤销未生效发布和历史。八项规则尚未接入实际打卡、申请、审批、周期或自动提醒；发布台账不代表这些业务已生效，不授予审批或地点权限。</p>
    {!enabled && <p className="text-sm">新草稿与发布已关闭；当前负责人仍可读取历史、选择旧个人范围并明确撤销未来发布。原操作者只核对原编号。</p>}
    <OperationalRuleScopeView scope={scope}/>
    <p role="status" className="break-words rounded-xl bg-blue-50 p-3 text-sm">{visible ? state.message : "页面隐藏或身份变化，正文与草稿已清除，原编号保留。"}</p>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={!ready} onClick={() => chooseScope({ kind: "enterprise" })}>选择企业层</button><button className={button} disabled={!ready} onClick={() => readDirectory("groups")}>读取考勤组目录</button><button className={button} disabled={!ready} onClick={() => read(() => { void client.catalog("workers"); })}>读取当前人员目录</button><button className={button} disabled={!ready} onClick={() => read(() => { void client.catalog("saved_personal"); })}>读取保存的个人范围</button></div>
    {directoryMessage && <p className="text-sm">{directoryMessage}</p>}
    {directory?.kind === "groups" && <section aria-label="考勤组目录"><ul className="space-y-2">{directory.items.map(g => <li key={g.groupId} className="min-w-0 rounded-xl border p-3 text-sm"><p className="break-words">{g.name} · {g.active ? "启用" : "停用"} · 版本 {g.revision}</p><button className={button} disabled={!ready} onClick={() => chooseScope({ kind: "group", groupId: g.groupId })}>选用此考勤组</button></li>)}</ul>{directory.nextCursor && <button className={button} disabled={!ready} onClick={() => readDirectory("groups", directory.nextCursor)}>下一页考勤组</button>}</section>}
    {catalog && catalog.catalog !== "routes" && <section aria-label="台账范围目录"><ul className="space-y-2">{catalog.catalog === "workers" ? catalog.items.map(w => <li key={w.workerId} className="min-w-0 rounded-xl border p-3 text-sm"><p className="break-words">{w.workerName}</p><OperationalRuleScopeView scope={{ kind: "personal", workerId: w.workerId, employeeId: w.employeeId, employeeAuthUserId: w.employeeAuthUserId }}/><button className={button} disabled={!ready} onClick={() => chooseScope({ kind: "personal", workerId: w.workerId, employeeId: w.employeeId, employeeAuthUserId: w.employeeAuthUserId })}>选用此当前人员身份</button></li>) : catalog.items.map(w => <li key={JSON.stringify(w.scope)} className="min-w-0 rounded-xl border p-3 text-sm"><OperationalRuleScopeView scope={w.scope}/><p className="break-all">保存修订 {w.revision} · UTC {w.updatedAt}</p><button className={button} disabled={!ready} onClick={() => chooseScope(w.scope)}>选择此保存个人范围</button></li>)}</ul>{("nextId" in catalog ? catalog.nextId : catalog.nextScope) && <button className={button} disabled={!ready} onClick={() => read(() => { void client.nextCatalog(); })}>下一页范围目录</button>}</section>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={!ready} onClick={() => read(() => { void client.load(); })}>读取当前台账</button><button className={button} disabled={!ready} onClick={() => read(() => { void client.history(); }, true)}>读取台账历史</button>
      {pending && <button className={button} disabled={!visible || busy} onClick={() => { const generation = epoch.current, snapshot = client.getSnapshot(); if (live(generation, snapshot)) { clear(); epoch.current++; void client.recover(); } }}>核对原规则操作编号</button>}</div>
    {pending && <div className="min-w-0 rounded-xl border border-amber-300 p-3 text-sm"><p>结果未确认；不会重发 POST 或显示本地旧正文。原号可能属于其他层，恢复后仍须重新读取当前台账。</p><p className="break-all">原编号 {pending.command.operationId}</p>
      {state.canEndRejectedAttempt && <><p>仅本次 POST 已收到严格核验的确定拒绝，可明确结束本次尝试；其他未知、恢复查无和重载状态不得据此清除原号。</p><button className={button} disabled={!visible || busy} onClick={() => { const generation = epoch.current, snapshot = client.getSnapshot();
        confirmOperationalRuleAction(() => window.confirm("只结束本次已明确拒绝的尝试并清除匹配原号？不会重发。后续操作必须手动重读。"), () => live(generation, snapshot) && snapshot.canEndRejectedAttempt, () => { if (client.endRejectedAttempt()) { epoch.current++; clear(); } }); }}>结束本次已拒绝尝试</button></>}
    </div>}
    {result?.receipt && <OperationalRuleReceiptView receipt={result.receipt}/>}
    {d && <section className="space-y-3"><h3 className="font-semibold">当前台账 · 修订 {d.revision}</h3><p className="break-words text-sm">{d.context ? `本次企业时区：${d.context.timeZone}；设置版本 ${d.context.settingsVersion}` : "保存身份与当前上下文不匹配；不能新建草稿或发布，仍可核验尚未生效的保存发布并安全撤销。"}</p>
      <OperationalRulePublications result={result!}/>
      {d.draft && <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm"><p>已保存草稿修订 {d.draft.revision} · UTC {d.draft.recordedAt}</p><button className={button} disabled={!ready || !enabled || !result?.canWrite} onClick={() => { const generation = epoch.current, snapshot = client.getSnapshot(); if (!live(generation, snapshot) || dirty.current && !window.confirm("用保存草稿替换本地输入？")) return; if (!live(generation, snapshot)) return; mark(); setRules(d.draft!.rules); }}>载入已保存草稿到表单</button><details><summary>查看已保存八字段</summary><OperationalRulesFields rules={d.draft.rules} disabled onChange={() => {}}/></details></div>}
    </section>}
    {visible && !pending && <section className="space-y-3"><h3 className="font-semibold">本地八字段草稿（不自动保存）</h3><OperationalRulesFields rules={rules} disabled={!ready || !enabled || !!p} onChange={v => { if (!ready || p || !current() || document.hidden) return; mark(); setRules(v); }}
      locations={directory?.kind === "locations" ? directory.items : []} routes={routes} readLocations={() => readDirectory("locations")} nextLocations={directory?.kind === "locations" && directory.nextCursor ? () => readDirectory("locations", directory.nextCursor) : undefined} readRoutes={() => readRoutes()} nextRoutes={routeNext ? () => readRoutes(routeNext) : undefined}/>
      <label className="block text-sm">本次操作理由（1–200 字）<textarea className={input} aria-label="规则操作理由" disabled={!ready} maxLength={400} value={reason} onChange={e => { mark(); setReason(e.target.value); }}/></label>
      <button className={button} disabled={!ready || !enabled || !d?.context || !result?.canWrite || !operationalRuleFormValid(rules, reason)} onClick={() => confirm("明确保存这八字段的新草稿？不发布、不改变实际打卡规则。", () => { void client.saveDraft(rules, reason); })}>明确保存规则草稿</button>
      {!d && <p className="text-xs">目录、历史、预览与回执均不能用于保存草稿；请明确读取当前台账后提交。</p>}
      {(d?.draft || p) && <section className="space-y-3 rounded-xl border p-3"><h3 className="font-semibold">未来日期核准</h3><p className="text-xs">依据服务端核验的企业时区；必须严格晚于当地今天。个人范围必须有截止日；其他层不设截止日。</p><div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="min-w-0 text-sm">未来开始日期<input aria-label="规则未来开始日期" type="date" min="2000-01-01" max="2100-12-31" className={input} disabled={!ready || !enabled} value={effectiveOn} onChange={e => { mark(); setEffectiveOn(e.target.value); }}/></label>{scope.kind === "personal" && <label className="min-w-0 text-sm">个人截止日期（含）<input aria-label="规则个人截止日期" type="date" min={effectiveOn || "2000-01-01"} max="2100-12-31" className={input} disabled={!ready || !enabled} value={endsOn} onChange={e => { mark(); setEndsOn(e.target.value); }}/></label>}</div>
        <button className={button} disabled={!ready || !enabled || !result?.canWrite || !d?.draft || !operationalRuleDatesValid(scope, effectiveOn, endsOn)} onClick={() => { if (operationalRuleDatesValid(scope, effectiveOn, endsOn)) read(() => { void client.preview({ effectiveOn, endsOn: scope.kind === "personal" ? endsOn : null }); }); }}>核验已保存草稿的未来发布</button>
        {p && <><p className="break-all text-sm">核验草稿修订 {p.sourceDraftRevision} · {p.context.timeZone}<br/>UTC 起 {p.effectiveAt}<br/>UTC 止 {p.endsAt ?? "未设置"}</p><p className="text-xs">已核验引用，不证明企业或组内全员最终授权；applied=false，尚未用于实际业务。</p><button className={button} disabled={!ready || !enabled || !result?.canWrite || !operationalRuleReasonValid(reason) || p.effectiveOn !== effectiveOn || p.endsOn !== (scope.kind === "personal" ? endsOn : null)} onClick={() => confirm("明确核准上述已保存草稿及未来日期？这只发布台账，不启动实际业务消费。", () => { void client.publish(reason); })}>明确发布未来规则</button></>}
      </section>}
      {d?.nextPublication && <button className={button} disabled={!ready || !d.canWithdraw || !operationalRuleReasonValid(reason)} onClick={() => confirm("只撤销此尚未生效的发布？不改历史草稿或已经生效的发布。", () => { void client.withdraw(d.nextPublication!.revision, reason); }, true)}>明确撤销未来发布</button>}
    </section>}
    {result?.data.kind === "history" && <section aria-label="规则台账历史" className="space-y-2"><p className="text-sm">固定历史快照修订 {result.data.atRevision}，每页最多 25 条。翻页不会自动累积或派生当前写入资格。</p><ul className="space-y-2">{result.data.items.map(({ item, withdrawnByRevision }) => <li key={item.revision} data-rule-revision={item.revision} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><p>修订 {item.revision} · {item.action === "save_draft" ? "保存草稿" : item.action === "publish" ? "核准发布" : "撤销未来发布"}</p><p className="break-all">UTC {item.recordedAt} · 操作 {item.operationId}</p><p className="break-words">理由：{item.reason}</p>{withdrawnByRevision !== null && <p>该快照内已由修订 {withdrawnByRevision} 撤销</p>}{"rules" in item && <details><summary>查看本条保存八字段</summary><OperationalRulesFields rules={item.rules} disabled onChange={() => {}}/></details>}</li>)}</ul>{result.data.nextCursor && <button className={button} disabled={!ready} onClick={() => read(() => { void client.nextHistory(); }, true)}>下一页台账历史</button>}</section>}
    <p className="text-xs leading-6 text-slate-500">不自动读取、轮询、重送或补写。所有名称只作展示；人员保存双身份，范围、引用、时间与权限在提交时重新核验。请勿清除原标签页网站数据。</p>
  </section>;
}
export function OperationalRuleScopeView({ scope }: { scope: OperationalRuleLedgerScope }) { return <div className="min-w-0 break-all rounded-xl bg-slate-50 p-3 text-xs"><p className="font-semibold">{operationalRuleScopeLabel(scope)}</p>{scope.kind === "group" && <p>组 {scope.groupId}</p>}{scope.kind === "personal" && <p>考勤员工 {scope.workerId}<br/>企业员工 {scope.employeeId}<br/>保存 Auth {scope.employeeAuthUserId}<br/>这些是保存身份，不由当前姓名倒填。</p>}</div>; }
export function OperationalRuleReceiptView({ receipt }: { receipt: OperationalRuleLedgerReceipt }) { return <section aria-label="规则台账最小回执" className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><p>原操作已核实：{receipt.action === "save_draft" ? "草稿已保存" : receipt.action === "publish" ? "未来发布已核准" : "未来发布已撤销"} · 修订 {receipt.revision}</p><p className="break-all">操作 {receipt.operationId}<br/>UTC {receipt.recordedAt}</p><p>仅确认保存结果；不恢复编辑资格、不显示原命令正文，不证明规则已被实际业务消费。</p></section>; }
export function OperationalRulePublications({ result }: { result: OperationalRuleLedgerResult }) { if (result.data.kind !== "detail") return null; const d = result.data; return <div className="grid min-w-0 gap-3 sm:grid-cols-2">{([['当前台账发布', d.currentPublication], ['下一未来发布', d.nextPublication]] as const).map(([label, p]) => <section key={label} className="min-w-0 rounded-xl border p-3 text-sm"><h4 className="font-semibold">{label}</h4>{p ? <><p>修订 {p.revision} · {p.effectiveOn} 至 {p.endsOn ?? "未设置截止日"}</p><p className="break-all">UTC {p.effectiveAt} → {p.endsAt ?? "未设置"}</p><details><summary>查看发布的八字段</summary><OperationalRulesFields rules={p.rules} disabled onChange={() => {}}/></details></> : <p>本次没有对应发布。</p>}</section>)}</div>; }
