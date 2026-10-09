"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceIndependentAdminClient, type IndependentAdminPending } from "@/lib/merchantAttendanceIndependentAdminClient";
import { parseIndependentBody, type IndependentAdminResult, type IndependentCommand, type IndependentQuery } from "@/lib/merchantAttendanceIndependent";
export type IndependentAdminPanelProps = { siteId: string; actorId: string; apiFetch: AttendanceApiFetch; enabled?: boolean;
  isCurrentAuth?: () => boolean; onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const field = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm";
const actions = { create: "建立独立档案", enable: "启用独立打卡", disable: "停用独立打卡", issue_pin: "签发／重置 PIN", revoke_pin: "撤销 PIN", bind_member: "绑定本人企业账号" };
const clockActions = { clock_in: "上班", break_start: "开始休息", break_end: "结束休息", clock_out: "下班" };
type LocationChoice = { locationId: string; name: string; timeZone: string };
type MemberChoice = { employeeId: string; authUserId: string; displayName: string };
type Draft = { creating: boolean; workerNo: string; displayName: string; startsOn: string; locationId: string; reason: string; pin: string; memberId: string; ack: boolean };
const empty = (): Draft => ({ creating: false, workerNo: "", displayName: "", startsOn: "", locationId: "", reason: "", pin: "", memberId: "", ack: false });
export function confirmIndependentAction(confirm: () => boolean, current: () => boolean, send: () => void) {
  if (!current() || !confirm() || !current()) return false; send(); return true;
}
export default function MerchantAttendanceIndependentAdminPanel(props: IndependentAdminPanelProps) {
  const [scope, setScope] = useState({ siteId: props.siteId, actorId: props.actorId, apiFetch: props.apiFetch, isCurrentAuth: props.isCurrentAuth, enabled: props.enabled, version: 0 });
  if (scope.siteId !== props.siteId || scope.actorId !== props.actorId || scope.apiFetch !== props.apiFetch || scope.isCurrentAuth !== props.isCurrentAuth || scope.enabled !== props.enabled) {
    setScope({ siteId: props.siteId, actorId: props.actorId, apiFetch: props.apiFetch, isCurrentAuth: props.isCurrentAuth, enabled: props.enabled, version: scope.version + 1 }); return null;
  }
  if (props.isCurrentAuth?.() === false) return null;
  return <Scope key={scope.version} {...props}/>;
}
function Scope({ siteId, actorId, apiFetch, isCurrentAuth, onClose, registerLeaveGuard,
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED === "1" }: IndependentAdminPanelProps) {
  const mounted = useRef(false), visible = useRef(true), epoch = useRef(0), working = useRef(false);
  const current = useCallback(() => mounted.current && visible.current && !document.hidden && isCurrentAuth?.() !== false, [isCurrentAuth]);
  const client = useMemo(() => new AttendanceIndependentAdminClient({ siteId, actorId, apiFetch, storage: () => sessionStorage, isCurrent: current }), [siteId, actorId, apiFetch, current]);
  const pauseClient = useCallback(() => { epoch.current++; client.pause(); }, [client]);
  const [data, setData] = useState<IndependentAdminResult | null>(null), [pending, setPending] = useState<IndependentAdminPending | null>(null);
  const [readQuery, setReadQuery] = useState<IndependentQuery | null>(null);
  const [blocked, setBlocked] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [draft, setDraft] = useState<Draft>(empty), [search, setSearch] = useState(""), [state, setState] = useState<"all" | "independent" | "bound">("all");
  const [locations, setLocations] = useState<readonly LocationChoice[]>([]), [members, setMembers] = useState<readonly MemberChoice[]>([]);
  const [locationCursor, setLocationCursor] = useState<string | null>(null), [memberCursor, setMemberCursor] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(""), [throughDate, setThroughDate] = useState("");
  const latest = useRef({ data, draft, locations, members }); latest.current = { data, draft, locations, members };
  const dirty = useCallback(() => Object.entries(latest.current.draft).some(([key, value]) => key === "creating" || key === "ack" ? value === true : value !== ""), []);
  const stored = useCallback(() => { try { return sessionStorage.getItem(client.key) !== null; } catch { return true; } }, [client]);
  const mayLeave = useCallback(() => !(working.current || stored() || dirty()) || window.confirm("仍有草稿或待确认原编号。离开不自动保存、重发或删除编号。确定离开吗？"), [stored, dirty]);
  const clear = useCallback(() => { setData(null); setReadQuery(null); setDraft(empty()); setLocations([]); setMembers([]); setLocationCursor(null); setMemberCursor(null); }, []);
  const local = useCallback(async () => {
    if (!current() || working.current) return; const token = epoch.current;
    try { const value = await client.load(); if (current() && token === epoch.current) { setPending(value); setBlocked(value !== null); } }
    catch { if (current() && token === epoch.current) { setBlocked(true); setMessage("本地原编号无法核实，保留原内容；请勿重复建档或签发。"); } }
  }, [client, current]);
  useLayoutEffect(() => {
    mounted.current = true; visible.current = !document.hidden; void local(); registerLeaveGuard?.(mayLeave);
    const pause = () => { visible.current = false; pauseClient(); working.current = false;
      flushSync(() => { clear(); setSearch(""); setState("all"); setFromDate(""); setThroughDate(""); setPending(null); setBlocked(true); setBusy(false); setMessage("已暂停并清除正文、草稿和 PIN。原编号保留，返回后请重新读取本地状态。"); }); };
    const visibility = () => { if (document.hidden) pause(); else visible.current = true; };
    const unload = (event: BeforeUnloadEvent) => { if (working.current || stored() || dirty()) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", pause); window.addEventListener("beforeunload", unload);
    return () => { mounted.current = false; pauseClient(); registerLeaveGuard?.(null);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", pause); window.removeEventListener("beforeunload", unload); };
  }, [clear, dirty, local, mayLeave, pauseClient, registerLeaveGuard, stored]);
  const read = async (query: IndependentQuery, choices = false) => {
    if (!current() || working.current || blocked || stored()) return; const token = epoch.current;
    if (!choices && dirty() && !window.confirm("重新读取将丢弃未保存草稿和 PIN。是否继续？")) return;
    if (!current() || token !== epoch.current || stored()) return;
    working.current = true; setBusy(true); setMessage(""); if (!choices) clear();
    try { const value = await client.read(query); if (!current() || token !== epoch.current) return;
      if (value.data.kind === "locations") { setLocations(value.data.items); setLocationCursor(value.data.nextCursor); setDraft(d => ({ ...d, locationId: "" })); }
      else if (value.data.kind === "members") { setMembers(value.data.items); setMemberCursor(value.data.nextCursor); setDraft(d => ({ ...d, memberId: "", ack: false })); }
      else { setData(value); setReadQuery(query); }
    } catch { if (current() && token === epoch.current) { if (!choices) clear(); else { setLocations([]); setMembers([]); setLocationCursor(null); setMemberCursor(null); setDraft(d => ({ ...d, locationId: "", memberId: "", ack: false })); } setMessage("未能读取当前授权范围的完整资料，请明确重读；不把失败当成空记录。"); } }
    finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); } }
  };
  const recover = async () => {
    if (!current() || working.current) return; const token = epoch.current; working.current = true; setBusy(true); clear();
    try { const value = await client.recover(); if (current() && token === epoch.current) { setPending(null); setBlocked(false); setMessage(`原操作已核验：${value.receipt!.operationId}。请重新读取当前档案。`); } }
    catch { if (current() && token === epoch.current) { setBlocked(true); setMessage("原编号仍未确认，已保留；未查到不等于失败，不自动重发。"); } }
    finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); } }
  };
  const send = (action: IndependentCommand["action"]) => {
    const snapshot = latest.current, token = epoch.current, frozen = JSON.stringify(snapshot.draft), d = snapshot.draft, result = snapshot.data;
    if ((!enabled && action !== "disable" && action !== "revoke_pin") || !current() || working.current || blocked || stored() || !result || !d.reason.trim() || !d.ack) return;
    let command: IndependentCommand;
    try {
      const base = { operationId: crypto.randomUUID(), expectedSettingsVersion: result.settingsVersion, reason: d.reason.trim() };
      if (action === "create") {
        if (!d.creating || !snapshot.locations.some(l => l.locationId === d.locationId)) return;
        command = { ...base, action, subjectId: crypto.randomUUID(), workerId: crypto.randomUUID(), workerNo: d.workerNo, displayName: d.displayName, locationId: d.locationId, startsOn: d.startsOn };
      } else {
        if (result.data.kind !== "detail" || result.data.subject.state !== "independent") return;
        const { subject: s, credential: c, head: h } = result.data, change = { ...base, subjectId: s.subjectId, expectedSubjectRevision: s.revision, expectedGeneration: s.generation, expectedWorkerVersion: s.workerVersion };
        if (action === "enable" || action === "disable") command = { ...change, action };
        else if (action === "issue_pin" || action === "revoke_pin") command = { ...change, action, expectedCredentialRevision: c.revision };
        else { const member = snapshot.members.find(m => m.employeeId === d.memberId); if (!member || h.status !== "off") return;
          command = { ...change, action, expectedCredentialRevision: c.revision, targetEmployeeId: member.employeeId, targetAuthUserId: member.authUserId, expectedLastEventId: h.lastEventId, expectedSequence: h.sequence }; }
      }
      parseIndependentBody({ query: { siteId, mode: "detail", subjectId: command.subjectId }, command });
    } catch { setMessage("请核对姓名、工号、地点、日期和理由；尚未发送。"); return; }
    const still = () => current() && epoch.current === token && latest.current.data === result && JSON.stringify(latest.current.draft) === frozen && !working.current && !stored();
    confirmIndependentAction(() => window.confirm(`${actions[action]}：只处理已核实的本人档案。绑定会结束独立身份并撤销旧 PIN，不合并或改写历史。新建默认停用；发送一次后保留原编号，须 GET 回执核验。确定提交？`), still, () => {
      const pin = action === "issue_pin" ? d.pin : null; working.current = true; setBusy(true); setBlocked(true); clear();
      void (async () => { try { await client.post({ siteId, mode: "detail", subjectId: command.subjectId }, command, pin); if (current() && token === epoch.current) setMessage("收到结果，原编号仍保留。请仅 GET 核验原编号。"); }
        catch { if (current() && token === epoch.current) setMessage("结果未确认，保留原编号；不要重复建档或签发，请仅 GET 核验。"); }
        finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); void local(); } } })();
    });
  };
  const lock = busy || blocked, detail = data?.data.kind === "detail" ? data.data : null;
  const history = (cursor: string | null) => detail ? void read({ siteId, mode: "history", subjectId: detail.subject.subjectId, fromDate, throughDate, cursor }) : data?.data.kind === "history" ? void read({ siteId, mode: "history", subjectId: data.data.report.subjectId, fromDate: data.data.report.fromDate, throughDate: data.data.report.throughDate, cursor }) : undefined;
  return <section className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">无邮箱员工／独立终端打卡</h2><p className="mt-2 text-sm text-slate-600">不创建假账号，不改写原始打卡，不计算工资。PIN 只用于本次请求，不存入本地原编号。</p></div><button className={button} onClick={() => { if (mayLeave()) onClose(); }}>关闭</button></header>
    {!enabled && <p className="rounded-xl bg-amber-50 p-3 text-sm">新操作尚未开放；当前负责人仍可停用／撤销 PIN，原操作仍可核验。服务端独立校验当前权限和开关。</p>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void local()}>读取本地状态（不联网）</button><button className={button} disabled={busy} onClick={() => void recover()}>仅 GET 核验原编号</button></div>
    {pending && <p className="break-all rounded-xl bg-amber-50 p-3 text-sm">待核验：{actions[pending.command.action]} · {pending.command.operationId}</p>}{message && <p role="status" className="break-words rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
    <fieldset disabled={lock} className="flex min-w-0 flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">搜索姓名／工号<input className={field} value={search} maxLength={80} onChange={e => setSearch(e.target.value)}/></label><label className="text-sm">档案范围<select className={field} value={state} onChange={e => setState(e.target.value as typeof state)}><option value="all">全部</option><option value="independent">独立身份</option><option value="bound">已绑定</option></select></label><button className={button} onClick={() => void read({ siteId, mode: "list", cursor: null, search, state })}>读取档案</button></fieldset>
    {data?.data.kind === "list" && <div className="space-y-2"><p className="text-sm">本页 {data.data.items.length} 人；每页最多 25 人。修改筛选后请重新读取首页。</p>{data.data.items.map(s => <button key={s.subjectId} className={`${button} block w-full text-left whitespace-normal break-words`} disabled={lock} onClick={() => void read({ siteId, mode: "detail", subjectId: s.subjectId })}>{s.displayName} · {s.workerNo} · {s.state === "bound" ? "已绑定账号" : s.enabled ? "独立打卡已启用" : "独立打卡已停用"}</button>)}{data.data.nextCursor && readQuery?.mode === "list" && <button className={button} disabled={lock} onClick={() => void read({ ...readQuery, cursor: data.data.kind === "list" ? data.data.nextCursor : null })}>下一页档案</button>}
      <button className={button} disabled={lock || !enabled} onClick={() => setDraft({ ...empty(), creating: true })}>新建无邮箱员工</button></div>}
    {draft.creating && <fieldset disabled={lock || !enabled} className="grid min-w-0 gap-3 rounded-xl border p-3 sm:grid-cols-2"><label className="text-sm">姓名<input className={field} maxLength={120} value={draft.displayName} onChange={e => setDraft({ ...draft, displayName: e.target.value })}/></label><label className="text-sm">工号<input className={field} maxLength={40} value={draft.workerNo} onChange={e => setDraft({ ...draft, workerNo: e.target.value })}/></label><label className="text-sm">任职开始日期<input type="date" className={field} value={draft.startsOn} onChange={e => setDraft({ ...draft, startsOn: e.target.value })}/></label><div><button className={button} onClick={() => void read({ siteId, mode: "locations", cursor: null, search: "" }, true)}>读取可用工作地点</button>{locationCursor && <button className={button} onClick={() => void read({ siteId, mode: "locations", cursor: locationCursor, search: "" }, true)}>下一页地点</button>}<label className="block text-sm">工作地点<select className={field} value={draft.locationId} onChange={e => setDraft({ ...draft, locationId: e.target.value })}><option value="">请选择真实工作地点</option>{locations.map(l => <option key={l.locationId} value={l.locationId}>{l.name} · {l.timeZone}</option>)}</select></label></div></fieldset>}
    {detail && <article className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="font-bold break-words">{detail.subject.displayName} · {detail.subject.workerNo}</h3><p className="text-sm">档案版本 {detail.subject.revision} · 凭证版本 {detail.credential.revision} · {detail.subject.state === "bound" ? "已绑定账号，独立 PIN 已停用" : detail.subject.enabled ? "独立身份已启用" : "独立身份已停用"}</p><p className="text-sm">当前状态：{{ off: "未在班", working: "工作中", break: "休息中" }[detail.head.status]} · 序列 {detail.head.sequence}</p>
      <fieldset disabled={lock} className="flex flex-wrap items-end gap-2"><label className="text-sm">记录开始日期<input type="date" className={field} value={fromDate} onChange={e => setFromDate(e.target.value)}/></label><label className="text-sm">记录结束日期（最多31天）<input type="date" className={field} value={throughDate} onChange={e => setThroughDate(e.target.value)}/></label><button className={button} disabled={!fromDate || !throughDate} onClick={() => history(null)}>读取原始记录</button></fieldset>
      {detail.subject.state === "independent" && <fieldset disabled={lock || !enabled} className="space-y-3"><label className="block text-sm">本次签发 PIN（8–12位数字）<input className={field} type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={draft.pin} onChange={e => setDraft({ ...draft, pin: e.target.value })}/></label><button className={button} onClick={() => void read({ siteId, mode: "members", cursor: null, search: "" }, true)}>读取可绑定的企业员工</button>{memberCursor && <button className={button} onClick={() => void read({ siteId, mode: "members", cursor: memberCursor, search: "" }, true)}>下一页员工</button>}<label className="block text-sm">经核实为同一人的企业账号<select className={field} value={draft.memberId} onChange={e => setDraft({ ...draft, memberId: e.target.value, ack: false })}><option value="">请选择已接受邀请的本人账号</option>{members.map(m => <option key={m.employeeId} value={m.employeeId}>{m.displayName}</option>)}</select></label><p className="text-xs text-slate-600">绑定前必须核实为同一人并完成独立班次。绑定后旧记录仍归原身份，不合并他人历史。</p></fieldset>}
    </article>}
    {(draft.creating || detail?.subject.state === "independent") && <fieldset disabled={lock} className="space-y-3 rounded-xl border p-3"><label className="block text-sm">本次理由<textarea className={field} maxLength={500} value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })}/></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.ack} onChange={e => setDraft({ ...draft, ack: e.target.checked })}/>已核实本人、档案和本次操作；绑定时已确认所选账号为同一人。</label><div className="flex flex-wrap gap-2">{draft.creating ? <button className={button} disabled={!enabled || !draft.ack || !draft.reason.trim()} onClick={() => send("create")}>建立档案（默认停用）</button> : detail && (["enable", "disable", "issue_pin", "revoke_pin", "bind_member"] as const).map(action => <button key={action} className={button} disabled={!enabled && action !== "disable" && action !== "revoke_pin" || !draft.ack || !draft.reason.trim() || action === "enable" && detail.subject.enabled || action === "disable" && !detail.subject.enabled || action === "issue_pin" && (!detail.subject.enabled || !/^[0-9]{8,12}$/.test(draft.pin)) || action === "revoke_pin" && !detail.credential.enabled || action === "bind_member" && (!draft.memberId || detail.head.status !== "off")} onClick={() => send(action)}>{actions[action]}</button>)}</div></fieldset>}
    {data?.data.kind === "history" && <section className="space-y-3"><h3 className="font-bold">独立身份原始记录</h3><p className="text-sm">{data.data.report.fromDate} — {data.data.report.throughDate} · {data.data.report.timeZone}；未核定规则或工时，不可直接作固定周期／工资。</p>{data.data.report.items.map(s => <article key={s.startEventId} className="min-w-0 rounded-xl border p-3 text-sm"><p>{s.complete ? "原始班次已闭合" : "原始班次未闭合"}</p>{s.events.map(r => <p key={r.event.id} className="break-all">{r.event.sequence} · {clockActions[r.event.action]} · {r.event.occurredAt} · 原编号 {r.operationId}</p>)}</article>)}{data.data.report.nextCursor && <button className={button} disabled={lock} onClick={() => history(data.data.kind === "history" ? data.data.report.nextCursor : null)}>下一页原始班次</button>}</section>}
  </section>;
}
