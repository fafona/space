"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceScopeClient, attendanceManagementMessage, attendanceManagementRequest } from "@/lib/merchantAttendanceManagementClient";
import { parseAttendanceChoicesResult, type AttendanceChoice, type AttendanceChoiceKind, type AttendanceChoicesResult } from "@/lib/merchantAttendanceChoices";
import type { AttendanceManagementGrant } from "@/lib/merchantAttendanceScope";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceChoiceLabelsClient } from "@/lib/merchantAttendanceChoiceLabelsClient";

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
function ChoicePicker({ siteId, kind, apiFetch, selected, onToggle, disabled = false }: {
  siteId: string; kind: AttendanceChoiceKind; apiFetch: AttendanceApiFetch; selected: readonly string[];
  onToggle: (choice: AttendanceChoice) => void; disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ search: "", cursor: null as string | null, revision: 0 });
  const request = useMemo(() => ({ siteId, kind, apiFetch, query }), [siteId, kind, apiFetch, query]);
  const [loaded, setLoaded] = useState<{ request: typeof request; result: AttendanceChoicesResult | null; message: string } | null>(null);
  const busy = loaded?.request !== request;
  const result = busy ? null : loaded?.result;
  const message = busy ? "正在读取候选…" : loaded?.message;
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    const { siteId, kind, apiFetch, query } = request;
    const expected = { siteId, kind, search: query.search, cursor: query.cursor }, q = new URLSearchParams({ siteId, kind, search: query.search });
    if (query.cursor) q.set("cursor", query.cursor);
    void attendanceManagementRequest(apiFetch, `/api/merchant-enterprise/attendance/choices?${q}`, {}, { signal: controller.signal, maxBytes: 32768 })
      .then(body => { const parsed = parseAttendanceChoicesResult(body, expected); if (current) setLoaded({ request, result: parsed, message: parsed.items.length ? "每页最多 25 项，不自动选择新增人员或地点。" : "没有匹配项。" }); })
      .catch(e => { if (current) setLoaded({ request, result: null, message: attendanceManagementMessage(e) }); });
    return () => { current = false; controller.abort(); };
  }, [request]);
  return <div className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3">
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); setQuery({ search: search.trim(), cursor: null, revision: query.revision + 1 }); }}>
      <label className="min-w-0 flex-1 text-xs text-slate-500">{kind === "managers" ? "搜索主管姓名" : kind === "workers" ? "搜索考勤人员姓名／工号" : "搜索地点名称"}
        <input className={input} value={search} maxLength={80} onChange={e => setSearch(e.target.value)} disabled={disabled} /></label>
      <button type="submit" className={button} disabled={disabled || busy}>搜索</button>
    </form>
    <p role="status" className="text-xs leading-5 text-slate-500">{message}</p>
    <div className="grid gap-2 sm:grid-cols-2">{result?.items.map(c => <button type="button" key={c.id} aria-pressed={selected.includes(c.id)}
      className={`min-w-0 rounded-xl border p-3 text-left text-sm disabled:opacity-40 ${selected.includes(c.id) ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"}`}
      disabled={disabled} onClick={() => onToggle(c)}><span className="block break-words font-semibold">{selected.includes(c.id) ? "✓ " : ""}{c.label}</span>
      <span className="mt-1 block break-words text-xs text-slate-500">{kind === "managers" ? c.eligible ? "可配置新授权" : "未具备明细权限或未启用；仍可查看／撤销" : `${c.detail} · ${c.eligible ? "启用" : "停用（可授权历史记录）"}`}</span></button>)}</div>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={disabled || busy} onClick={() => setQuery({ search: query.search, cursor: null, revision: query.revision + 1 })}>候选首页／重读</button>
      <button type="button" className={button} disabled={disabled || busy || !result?.nextCursor} onClick={() => setQuery({ ...query, cursor: result!.nextCursor })}>候选下一页</button></div>
  </div>;
}
type Draft = AttendanceManagementGrant & { revision: number; labels: Record<string, AttendanceChoice> };
function SelectedChoices({ siteId, apiFetch, kind, ids, known, disabled, onRemove }: {
  siteId: string; apiFetch: AttendanceApiFetch; kind: "workers" | "locations"; ids: readonly string[];
  known: Record<string, AttendanceChoice>; disabled: boolean; onRemove: (choice: AttendanceChoice) => void;
}) {
  const client = useMemo(() => new AttendanceChoiceLabelsClient({ siteId, apiFetch }), [siteId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const selection = useMemo(() => ({ kind, ids, seeds: ids.flatMap(id => known[`${kind}:${id}`] ? [known[`${kind}:${id}`]] : []) }), [kind, ids, known]);
  const [refresh, setRefresh] = useState<{ selection: typeof selection } | null>(null);
  const [finished, setFinished] = useState<{ selection: typeof selection; refresh: typeof refresh } | null>(null);
  useEffect(() => {
    let current = true;
    void client.load(selection.kind, selection.ids, selection.seeds, refresh?.selection === selection).then(() => { if (current) setFinished({ selection, refresh }); });
    return () => { current = false; client.cancel(); };
  }, [client, selection, refresh]);
  const current = finished?.selection === selection && finished.refresh === refresh;
  const busy = !current || state.phase === "loading";
  const items = current ? state.items : {};
  return <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600" aria-label="已选考勤范围">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">已选{kind === "workers" ? "人员" : "地点"} · {ids.length} 项（点击移除）</span>
      <button type="button" className={button} disabled={busy || !ids.length} onClick={() => setRefresh({ selection })}>刷新已选名称</button></div>
    {ids.length > 0 && <p role="status">{busy ? "正在读取已选项名称…" : state.message}</p>}
    <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto">{ids.map(id => {
      const choice = items[id];
      return <button type="button" key={id} className={`${button} max-w-full break-all text-left`} disabled={disabled}
        aria-label={`移除${choice?.label ?? id}`} title={id} onClick={() => onRemove(choice ?? { id, label: id, detail: "", eligible: false })}>
        <span className="block font-semibold">{choice?.label ?? id} ×</span>
        {choice && <span className="block text-xs text-slate-500">{choice.detail} · {choice.eligible ? "启用" : "停用（历史项）"}</span>}
      </button>;
    })}</div>
    {ids.length === 0 && <p>尚未选择{kind === "workers" ? "人员" : "地点"}。</p>}
  </div>;
}
function utcInput(iso: string | null) { return iso?.replace(/Z$/, "") ?? ""; }
function fromUtcInput(value: string) { return value.length === 16 ? `${value}:00.000Z` : value.length === 19 ? `${value}.000Z` : `${value}Z`; }
type ScopePanelProps = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch };
export default function MerchantAttendanceScopePanel(props: ScopePanelProps) {
  return <ScopeScreen key={`${props.siteId}:${props.ownerId}`} {...props} />;
}
function ScopeScreen({ siteId, ownerId, apiFetch }: ScopePanelProps) {
  const client = useMemo(() => new AttendanceScopeClient({ siteId, ownerId, apiFetch, storage: () => window.sessionStorage }), [siteId, ownerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [manager, setManager] = useState<AttendanceChoice | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picker, setPicker] = useState<"workers" | "locations">("workers");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [choosing, setChoosing] = useState(true);
  useEffect(() => { void client.initialize(); return () => client.dispose(); }, [client]);
  const ready = state.phase === "ready" && !!state.result;
  const locked = !ready || !!state.pending;
  const select = (c: AttendanceChoice) => {
    if (state.pending || draft) return;
    setManager(c); setDraft(null); setRemoveId(null); setChoosing(false); setNotice(""); void client.select(c.id);
  };
  const edit = (g?: AttendanceManagementGrant) => {
    if (!state.result || locked) return;
    setDraft({ ...(g ?? { id: crypto.randomUUID(), workerIds: [], locationIds: [], validFrom: new Date().toISOString(), validUntil: null }),
      workerIds: [...(g?.workerIds ?? [])], locationIds: [...(g?.locationIds ?? [])], revision: state.result.scope.revision, labels: {} });
    setRemoveId(null); setNotice(""); setPicker("workers");
  };
  const toggle = (c: AttendanceChoice) => {
    if (!draft) return;
    const key = picker === "workers" ? "workerIds" : "locationIds", ids = draft[key];
    if (!ids.includes(c.id) && ids.length >= (picker === "workers" ? 200 : 50)) { setNotice("已达到本条授权的选择上限。"); return; }
    const labels = { ...draft.labels };
    if (ids.includes(c.id)) delete labels[`${picker}:${c.id}`]; else labels[`${picker}:${c.id}`] = c;
    setNotice(""); setDraft({ ...draft, [key]: ids.includes(c.id) ? ids.filter(id => id !== c.id) : [...ids, c.id], labels });
  };
  const save = async () => {
    if (!draft) return;
    if (!draft.workerIds.length || !draft.locationIds.length) { setNotice("请选择至少一名人员和一个地点；撤销范围请使用撤销按钮。"); return; }
    const { id, workerIds, locationIds, validFrom, validUntil, revision } = draft;
    if (await client.submit({ action: "put", grantId: id, grant: { workerIds, locationIds, validFrom, validUntil } }, revision)) setDraft(null);
  };
  return <section className="mt-5 min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="主管考勤范围">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">主管考勤范围</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">先在角色权限中授予“查看授权考勤明细”，再明确选择人员与地点。只有负责人可修改范围。</p></div>
      <button className={button} disabled={state.phase === "saving" || state.phase === "loading"} onClick={() => { setDraft(null); setRemoveId(null); void client.initialize(); }}>重新读取／核对结果</button></header>
    <div role="status" className={`rounded-xl border p-3 text-sm leading-6 ${state.pending ? "border-amber-200 bg-amber-50" : state.phase === "blocked" ? "border-rose-200 bg-rose-50" : "border-blue-100 bg-blue-50"}`}>
      <p>{state.message}</p>{state.pending && <><p className="break-all text-xs">目标员工：{state.pending.employeeId}<br />操作编号：{state.pending.command.operationId}</p>
        <button className={`${button} mt-2`} disabled={state.phase !== "unconfirmed"} onClick={() => void client.retry().then(ok => { if (ok) setDraft(null); })}>原编号重试保存</button></>}
    </div>
    {state.result && !state.result.moduleEnabled && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">平台暂停新授权；可查看和撤销已有范围。</p>}
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 break-all text-sm font-semibold">当前主管：{manager?.id === state.employeeId ? manager.label : state.employeeId ?? "尚未选择"}</p>
      <button className={button} disabled={!!state.pending || !!draft || state.phase === "saving" || state.phase === "loading"} onClick={() => setChoosing(!choosing)}>{choosing ? "收起主管选择" : "切换主管"}</button></div>
    {choosing && !state.pending && <ChoicePicker siteId={siteId} kind="managers" apiFetch={apiFetch} selected={state.employeeId ? [state.employeeId] : []} onToggle={select} disabled={!!draft || !["ready", "blocked"].includes(state.phase)} />}
    {state.result && <>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{state.result.scope.grants.length} / 32 条授权 · 当前版本 {state.result.scope.revision}</p>
        <button className={button} disabled={locked || !state.result.moduleEnabled || !!draft || state.result.scope.grants.length >= 32 || manager?.eligible === false} onClick={() => edit()}>新增授权</button></div>
      <p className="text-xs leading-5 text-slate-500">同一条内必须同时匹配所选人员和记录发生地点；多条授权各自匹配，不交叉组合。有效期控制何时可访问，不限制历史记录日期。</p>
      {state.result.scope.grants.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">未配置范围，主管不能查看任何人员的明细。</p>}
      {state.result.scope.grants.map((g, i) => <article key={g.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
        <h3 className="font-semibold">授权 {i + 1} · {g.workerIds.length} 名人员 × {g.locationIds.length} 个地点</h3>
        <p className="mt-1 break-words text-xs leading-5 text-slate-500">有效期（UTC）：{g.validFrom} 至 {g.validUntil ?? "长期有效"}</p>
        <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={locked || !!draft} onClick={() => edit(g)}>查看／编辑</button>
          <button className={button} disabled={locked || !!draft} onClick={() => setRemoveId(g.id)}>撤销此条</button></div>
        {removeId === g.id && <div className="mt-3 space-y-2 rounded-xl bg-amber-50 p-3"><p>确认撤销这条授权？不删除打卡记录，其他授权不变。</p>
          <div className="flex flex-wrap gap-2"><button className={button} disabled={locked} onClick={() => void client.submit({ action: "remove", grantId: g.id, grant: null }, state.result!.scope.revision).then(ok => { if (ok) setRemoveId(null); })}>确认撤销</button>
            <button className={button} disabled={locked} onClick={() => setRemoveId(null)}>取消</button></div></div>}
      </article>)}
    </>}
    {draft && <div className="min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-blue-50 p-4" aria-label="授权编辑器">
      <h3 className="font-semibold">编辑一条授权 · 基于版本 {draft.revision}</h3>
      <div className="grid gap-3 sm:grid-cols-2"><label className="min-w-0 text-sm">生效时间（UTC）<input className={input} type="datetime-local" step="0.001" value={utcInput(draft.validFrom)} disabled={locked} onChange={e => setDraft({ ...draft, validFrom: fromUtcInput(e.target.value) })} /></label>
        <label className="min-w-0 text-sm">失效时间（UTC，留空为长期）<input className={input} type="datetime-local" step="0.001" value={utcInput(draft.validUntil)} disabled={locked} onChange={e => setDraft({ ...draft, validUntil: e.target.value ? fromUtcInput(e.target.value) : null })} /></label></div>
      <div className="flex flex-wrap gap-2">{(["workers", "locations"] as const).map(k => <button className={`${button} ${picker === k ? "ring-2 ring-blue-500" : ""}`} key={k} onClick={() => setPicker(k)}>{k === "workers" ? `人员 ${draft.workerIds.length} / 200` : `地点 ${draft.locationIds.length} / 50`}</button>)}</div>
      <ChoicePicker key={`${siteId}:${state.employeeId}:${draft.id}:${picker}`} siteId={siteId} kind={picker} apiFetch={apiFetch}
        selected={picker === "workers" ? draft.workerIds : draft.locationIds} onToggle={toggle} disabled={locked || !state.result?.moduleEnabled} />
      <SelectedChoices key={`${siteId}:${state.employeeId}:${draft.id}:${draft.revision}`} siteId={siteId} apiFetch={apiFetch} kind={picker}
        ids={picker === "workers" ? draft.workerIds : draft.locationIds} known={draft.labels} disabled={locked || !state.result?.moduleEnabled} onRemove={toggle} />
      {notice && <p role="alert" className="text-sm text-rose-800">{notice}</p>}
      <div className="flex flex-wrap gap-3"><button className={button} disabled={locked || !state.result?.moduleEnabled || manager?.eligible === false} onClick={() => void save()}>保存此条授权</button>
        <button className={button} disabled={state.phase === "saving" || !!state.pending} onClick={() => { setDraft(null); setNotice(""); }}>取消编辑</button></div>
    </div>}
  </section>;
}
