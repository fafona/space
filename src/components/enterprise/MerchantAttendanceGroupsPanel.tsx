"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { groupDate, groupRange, type GroupAssignmentDetail, type GroupAssignmentItem, type GroupItem, type GroupsCommand } from "@/lib/merchantAttendanceGroups";
import { AttendanceGroupsClient } from "@/lib/merchantAttendanceGroupsClient";
import { attendanceManagementRequest } from "@/lib/merchantAttendanceManagementClient";
import { parseAttendanceAdminResult, type AttendanceAdminWorker } from "@/lib/merchantAttendanceAdmin";
import type { AttendanceGroupsPanelProps } from "./MerchantAttendanceGroupsLauncher";
import RulesLauncher from "./MerchantAttendanceRulesLauncher";

type Props = AttendanceGroupsPanelProps & { onClose: () => void };
type MemberFilter = { groupId: string | null; workerId: string | null; onDate: string | null };
type AssignInput = { startsOn: string; endsOn: string | null; reason: string };

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50 disabled:text-slate-500";
const statusLabels = { assigned: "已记录（未追加结束／撤销）", ended: "已设置结束日期", cancelled: "整段已撤销" } as const;
const actionLabels = { assign: "新增归组", end: "结束长期归组", cancel: "整段撤销" } as const;

export default function MerchantAttendanceGroupsPanel(props: Props) {
  return <Screen key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}

function Screen({ siteId, ownerId, apiFetch, onClose, rulesAuthorizationEpoch = 0 }: Props) {
  const client = useMemo(() => new AttendanceGroupsClient({ siteId, ownerId, apiFetch, storage: () => window.sessionStorage }), [siteId, ownerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const runtime = useMemo(() => ({ generation: 0, controller: null as AbortController | null }), []);
  const [visible, setVisible] = useState(false), [dirty, setDirty] = useState(false), [draftVersion, setDraftVersion] = useState(0);
  const [memberDate, setMemberDate] = useState(""), [loadedFilter, setLoadedFilter] = useState<MemberFilter | null>(null), [showMembers, setShowMembers] = useState(false);
  const [workerSearch, setWorkerSearch] = useState(""), [workers, setWorkers] = useState<AttendanceAdminWorker[]>([]);
  const [workerCursor, setWorkerCursor] = useState<string | null>(null), [workerLoading, setWorkerLoading] = useState(false);
  const [workerMessage, setWorkerMessage] = useState("输入姓名或工号后明确搜索当前考勤档案；不会自动读取人员。 ");

  const clearPicker = (clearSearch = false) => {
    runtime.generation++; runtime.controller?.abort(); runtime.controller = null;
    setWorkerLoading(false); setWorkers([]); setWorkerCursor(null);
    if (clearSearch) setWorkerSearch("");
  };
  const clearDrafts = (clearFilter = true) => {
    setDirty(false); setDraftVersion(value => value + 1); setShowMembers(false);
    if (clearFilter) { setMemberDate(""); setLoadedFilter(null); }
  };

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      setVisible(false); clearDrafts(); clearPicker(true); const generation = ++runtime.generation;
      await client.initialize();
      if (mounted && generation === runtime.generation && !document.hidden) setVisible(true);
    };
    const hide = () => { runtime.generation++; runtime.controller?.abort(); runtime.controller = null; setVisible(false); clearDrafts(); clearPicker(true); client.pause(); };
    const visibility = () => { if (document.hidden) hide(); else void initialize(); };
    if (document.hidden) hide(); else void initialize();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide);
    return () => { mounted = false; hide(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); };
    // The identity-keyed client and local async guards are stable for this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, runtime]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!dirty && !state.pending) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, state.pending]);

  useEffect(() => {
    if (state.phase !== "blocked") return;
    clearPicker(true); clearDrafts(); setWorkerMessage("读取失败，已清除人员候选和旧分组内容；请重新核对负责人权限。 ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  const result = visible ? state.result : null;
  const busy = state.phase === "loading" || state.phase === "saving";
  const locked = busy || !!state.pending || state.phase !== "ready";
  const writeDisabled = locked || !result?.moduleEnabled;
  const discard = (message = "未保存的考勤组或归组草稿会清除，继续吗？") => !dirty || window.confirm(message);
  const close = () => {
    if (!discard()) return;
    if (state.pending && !window.confirm("操作结果仍待确认。离开不会撤销已发送操作，返回后须按原编号核对。继续吗？")) return;
    clearPicker(true); clearDrafts(); client.pause(); onClose();
  };
  const resetAnd = (run: () => void) => {
    if (!discard()) return;
    clearPicker(true); clearDrafts(); run();
  };

  const readWorkers = async (cursor: string | null) => {
    if (workerLoading || locked || document.hidden || !result?.group) return;
    const generation = ++runtime.generation; runtime.controller?.abort(); const controller = new AbortController(); runtime.controller = controller;
    setWorkerLoading(true); setWorkers([]); setWorkerCursor(null); setWorkerMessage("正在读取当前考勤档案标签…");
    try {
      const params = new URLSearchParams({ siteId, view: "workers", search: workerSearch }); if (cursor) params.set("cursor", cursor);
      const raw = await attendanceManagementRequest(apiFetch, `/api/merchant-enterprise/attendance/admin?${params}`, { method: "GET" },
        { signal: controller.signal, timeoutMs: 12000, maxBytes: 131072 });
      if (generation !== runtime.generation || document.hidden) return;
      const parsed = parseAttendanceAdminResult(raw, { siteId, view: "workers", operationId: null });
      setWorkers(parsed.items as AttendanceAdminWorker[]); setWorkerCursor(parsed.nextCursor);
      setWorkerMessage(parsed.items.length ? "请选择一个当前考勤档案；停用档案可查历史，但不能新增归组。" : "本页没有匹配考勤档案；请修改条件后明确搜索。 ");
    } catch {
      if (generation === runtime.generation) {
        clearPicker(false); clearDrafts(); client.pause();
        setWorkerMessage("无法读取考勤人员；已清除候选和旧分组内容，请重新读取并核对负责人权限。 ");
      }
    } finally { if (generation === runtime.generation) { runtime.controller = null; setWorkerLoading(false); } }
  };

  const selectWorker = (worker: AttendanceAdminWorker) => {
    if (locked || !result?.group || !discard("未保存的归组草稿会清除。确认选择其他当前考勤档案？")) return;
    clearDrafts(); clearPicker(false); void client.context(result.group.groupId, worker.id);
  };
  const clearWorker = () => {
    if (locked || !result?.group || !result.worker || !discard("未保存的归组草稿会清除。确认清除当前人员选择？")) return;
    clearDrafts(); clearPicker(false); void client.context(result.group.groupId, null);
  };
  const validMemberDate = (() => { if (!memberDate) return true; try { groupDate(memberDate); return true; } catch { return false; } })();
  const queryMembers = (scope: "group" | "worker") => {
    const groupId = scope === "group" ? result?.group?.groupId ?? null : null;
    const workerId = result?.worker?.workerId ?? null;
    if (locked || !validMemberDate || scope === "group" && !groupId || scope === "worker" && !workerId
      || !discard("未保存的归组草稿会清除。确认查询归组记录？")) return;
    const filter = { groupId, workerId, onDate: memberDate || null };
    setDirty(false); setDraftVersion(value => value + 1); setLoadedFilter(filter); setShowMembers(true); void client.members(filter);
  };
  const backToMembers = () => {
    if (!discard()) return;
    setDirty(false); setDraftVersion(value => value + 1); setShowMembers(true);
    const filter = loadedFilter ?? { groupId: result?.group?.groupId ?? null, workerId: result?.worker?.workerId ?? null, onDate: null };
    if (filter.groupId || filter.workerId) { setLoadedFilter(filter); void client.members(filter); }
    else void client.groups();
  };

  return <section aria-label="考勤组与人员归组" className="my-4 min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">考勤组与人员归组</h2>
      <p className="mt-1 text-sm text-slate-600">负责人维护 · 企业日期标签 · 独立历史账本</p></div>
      <button type="button" className={button} onClick={close}>关闭考勤组</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">本功能只保存分组定义和人员归组记录，不会改变旧考勤档案、打卡权限、排班、迟到／缺勤分类、审批、工时或工资。当前组没有规则执行能力；停用组只阻止新增归组，不移除已有记录。</p>
    <p role="status" aria-live="polite" className={`rounded-xl p-3 text-sm ${state.phase === "blocked" || state.pending ? "bg-amber-50 text-amber-950" : "bg-blue-50 text-blue-950"}`}>{state.message}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy} onClick={() => resetAnd(() => { setVisible(true); void client.initialize(); })}>{state.pending ? "重新读取／查原收据" : "重新读取考勤组"}</button>
      {result?.view !== "groups" && <button type="button" className={button} disabled={locked} onClick={() => resetAnd(() => void client.groups())}>返回考勤组列表</button>}
      {state.pending && <button type="button" className={button} disabled={state.phase !== "unconfirmed"} onClick={() => {
        if (window.confirm("先查询原操作收据；如仍未确认，只使用同一操作编号重试原内容。继续吗？")) void client.retry();
      }}>用原编号明确重试</button>}
    </div>
    {state.pending && <p className="break-all rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">操作结果待确认；恢复前不能创建第二个编号。<br/>原操作编号：{state.pending.command.operationId}</p>}

    {result && <>
      <p className="text-sm">企业考勤时区：<strong>{result.timeZone}</strong> · 设置版本 {result.settingsVersion}</p>
      {!result.moduleEnabled && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">平台已暂停所有新的考勤组写入；当前负责人仍可查询历史及原操作收据。</p>}
      {result.receipt && <Receipt receipt={result.receipt}/>}

      {result.view === "groups" && <GroupList items={result.items.filter(isGroupItem)} next={result.nextCursor} disabled={locked}
        onNew={() => resetAnd(() => void client.context(null, null))}
        onSelect={groupId => resetAnd(() => void client.context(groupId, null))}
        onNext={() => { if (discard()) { clearDrafts(); void client.next(); } }}
      />}

      {result.view !== "groups" && <>
        <CurrentContext group={result.group} worker={result.worker} disabled={locked} onClearWorker={clearWorker}/>
        {result.group && <RulesLauncher key={rulesAuthorizationEpoch} siteId={siteId} ownerId={ownerId} groupId={result.group.groupId} apiFetch={apiFetch} active={!locked && !dirty}/>}
        {(result.group || !result.worker) && <GroupEditor key={`${result.group?.groupId ?? "new"}:${result.group?.revision ?? 0}:${draftVersion}`} group={result.group} disabled={writeDisabled}
          onDirty={() => setDirty(true)} onSave={value => { setDirty(false); setDraftVersion(current => current + 1); void client.saveGroup(value); }}
        />}

        {result.group && <WorkerPicker search={workerSearch} workers={workers} cursor={workerCursor} loading={workerLoading} message={workerMessage} disabled={locked}
          onSearch={value => { clearPicker(false); setWorkerSearch(value); }} onRead={cursor => void readWorkers(cursor)} onSelect={selectWorker}
        />}

        {(result.group || result.worker) && <section aria-label="归组记录查询" className="space-y-3 rounded-xl border border-slate-200 p-3">
          <h3 className="font-bold">查询归组记录</h3>
          <p className="text-xs leading-5 text-slate-600">日期筛选仅检查每条当前投影的有效起止标签，不是历史 as-of 查询；撤销记录仍保留。结果不是组内总人数。</p>
          <div className="flex flex-wrap items-end gap-3"><label className="text-sm">归组日期（可留空）<input aria-label="归组记录日期" className={input} type="date" min="2000-01-01" max="2100-12-31"
            value={memberDate} disabled={busy || !!state.pending} onChange={event => { setMemberDate(event.target.value); setLoadedFilter(null); setShowMembers(false); }}/></label>
            {result.group && <button type="button" className={button} disabled={locked || !validMemberDate} onClick={() => queryMembers("group")}>{result.worker ? "查询该人员在本组的记录" : "查询本组归组记录"}</button>}
            {result.worker && <button type="button" className={button} disabled={locked || !validMemberDate} onClick={() => queryMembers("worker")}>查看该档案全部归组</button>}</div>
          {!validMemberDate && <p role="alert" className="text-sm text-amber-900">请选择 2000～2100 年内实际存在的企业日期，或留空查询所有区间。</p>}
          {!showMembers && result.view === "members" && <p className="text-xs text-slate-500">筛选已改变；旧列表已隐藏，不会自动发起新请求。</p>}
        </section>}

        {result.group && result.worker && !result.detail && <AssignmentForm key={`${result.group.groupId}:${result.group.revision}:${result.worker.workerId}:${result.worker.version}:${draftVersion}`}
          group={result.group} worker={result.worker} timeZone={result.timeZone} disabled={writeDisabled || !result.group.active || !result.worker.active}
          onDirty={() => setDirty(true)} onAssign={value => { setDirty(false); setDraftVersion(current => current + 1); setShowMembers(true); void client.assign(value); }}
        />}

        {result.detail
          ? <AssignmentDetail key={`${result.detail.assignmentId}:${result.detail.revision}:${draftVersion}`} detail={result.detail} currentGroup={result.group} currentWorker={result.worker}
              disabled={writeDisabled} onDirty={() => setDirty(true)} onBack={backToMembers}
              onEnd={(endsOn, reason) => { setDirty(false); setDraftVersion(current => current + 1); void client.end(endsOn, reason); }}
              onCancel={reason => { setDirty(false); setDraftVersion(current => current + 1); void client.cancel(reason); }}/>
          : showMembers && result.view === "members" && <MemberList items={result.items.filter(isAssignmentItem)} next={result.nextCursor} disabled={locked}
              onDetail={assignmentId => { if (discard()) { setDirty(false); void client.detail(assignmentId); } }}
              onNext={() => { if (discard()) { setDirty(false); void client.next(); } }}
            />}
      </>}
    </>}
    <p className="text-xs leading-6 text-slate-500">正常换组必须先明确结束原长期归组，再新增次日或更晚开始的新归组；这是两次独立操作，不承诺原子调组。隐藏、关闭或离开会清除草稿、人员候选和已显示内容；页面不轮询、不批量导入，也不给员工新增自助权限。</p>
  </section>;
}

function GroupList({ items, next, disabled, onNew, onSelect, onNext }: { items: GroupItem[]; next: unknown; disabled: boolean; onNew: () => void; onSelect: (id: string) => void; onNext: () => void }) {
  return <section aria-label="考勤组列表" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">全部考勤组（含停用）</h3><button type="button" className={button} disabled={disabled} onClick={onNew}>新建考勤组</button></div>
    {!items.length && <p className="rounded-xl border border-slate-200 p-4 text-sm">本页没有考勤组；不会自动创建默认组。</p>}
    {items.map(group => <article key={group.groupId} className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2"><strong className="break-words">{group.name}</strong><span>{group.active ? "允许新增归组" : "停用（不再新增归组）"}</span></div>
      <p className="break-words">{group.description || "（无说明）"}</p>
      <p className="break-all text-xs text-slate-500">组编号：{group.groupId}<br/>修订 {group.revision} · 创建 UTC {group.createdAt} · 更新 UTC {group.updatedAt}</p>
      <button type="button" className={button} disabled={disabled} onClick={() => onSelect(group.groupId)}>选择考勤组</button>
    </article>)}
    <button type="button" className={button} disabled={disabled || !next} onClick={onNext}>下一页考勤组</button>
  </section>;
}

function CurrentContext({ group, worker, disabled, onClearWorker }: { group: GroupItem | null; worker: { workerId: string; workerName: string; workerNo: string; employeeId: string | null; version: number; active: boolean } | null; disabled: boolean; onClearWorker: () => void }) {
  return <section aria-label="当前考勤组上下文" className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
    <h3 className="font-bold">{group ? `当前考勤组：${group.name}` : worker ? "当前考勤档案的跨组记录" : "新建考勤组（尚未保存）"}</h3>
    {group && <p>当前组修订 {group.revision} · {group.active ? "允许新增归组" : "停用，只保留历史处理"}</p>}
    {worker && <p>当前选中考勤档案：<strong>{worker.workerName} · {worker.workerNo}</strong> · 版本 {worker.version} · {worker.active ? "启用" : "停用（不可新增归组）"}</p>}
    {group && worker && <button type="button" className={button} disabled={disabled} onClick={onClearWorker}>清除当前人员选择</button>}
  </section>;
}

function GroupEditor({ group, disabled, onDirty, onSave }: { group: GroupItem | null; disabled: boolean; onDirty: () => void; onSave: (input: { name: string; description: string; active: boolean; reason: string }) => void }) {
  const [name, setName] = useState(group?.name ?? ""), [description, setDescription] = useState(group?.description ?? ""), [active, setActive] = useState(group?.active ?? false), [reason, setReason] = useState("");
  const valid = validText(name, 80, false) && validText(description, 200, true) && validText(reason, 200, false);
  const changed = () => onDirty();
  return <form aria-label={group ? "编辑考勤组" : "新建考勤组"} className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={event => {
    event.preventDefault(); if (disabled || !valid) return;
    const action = group ? "保存当前考勤组的新修订" : "创建新的考勤组";
    if (window.confirm(`确认${action}？这不会改变已有归组、打卡、排班或规则分类；继续将清除本页其他未保存草稿。`)) onSave({ name: name.trim(), description: description.trim(), active, reason: reason.trim() });
  }}>
    <h3 className="font-bold">{group ? "修改考勤组定义" : "新建考勤组"}</h3>
    <p className="text-xs leading-5 text-slate-600">启用只表示允许新增归组；停用不会结束、撤销或隐藏已有归组。</p>
    <fieldset disabled={disabled} className="space-y-3">
      <label className="block text-sm">组名称（1～80 字）<input aria-label="考勤组名称" className={input} maxLength={160} value={name} onChange={event => { setName(event.target.value); changed(); }}/></label>
      <label className="block text-sm">组说明（可留空，最多 200 字）<input aria-label="考勤组说明" className={input} maxLength={400} value={description} onChange={event => { setDescription(event.target.value); changed(); }}/></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={active} onChange={event => { setActive(event.target.checked); changed(); }}/><span>允许向此组新增人员归组记录</span></label>
      <label className="block text-sm">保存原因（1～200 字，单行）<input aria-label="考勤组保存原因" className={input} maxLength={400} value={reason} onChange={event => { setReason(event.target.value); changed(); }}/></label>
      <button className={button} disabled={!valid}>明确保存考勤组</button>
    </fieldset>
  </form>;
}

function WorkerPicker({ search, workers, cursor, loading, message, disabled, onSearch, onRead, onSelect }: { search: string; workers: AttendanceAdminWorker[]; cursor: string | null; loading: boolean; message: string; disabled: boolean; onSearch: (value: string) => void; onRead: (cursor: string | null) => void; onSelect: (worker: AttendanceAdminWorker) => void }) {
  return <section aria-label="选择当前考勤人员" className="space-y-3 rounded-xl border border-slate-200 p-3">
    <h3 className="font-bold">选择当前考勤档案</h3><p className="text-xs leading-5 text-slate-600">仅列出已关联员工、地点和任职记录的档案。此处标签来自当前档案；已保存归组列表显示归组当时的历史标签，两者可能不同。</p>
    <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">归组人员搜索<input aria-label="归组人员搜索" className={input} maxLength={80} disabled={disabled || loading} value={search} onChange={event => onSearch(event.target.value)}/></label>
      <button type="button" className={button} disabled={disabled || loading} onClick={() => onRead(null)}>搜索考勤人员</button>
      <button type="button" className={button} disabled={disabled || loading || !cursor} onClick={() => onRead(cursor)}>下一页人员</button></div>
    <p className="text-xs text-slate-600">{message}</p>
    <div className="grid gap-2 sm:grid-cols-2">{workers.map(worker => <button type="button" className={`${button} whitespace-normal text-left`} key={worker.id} disabled={disabled}
      onClick={() => onSelect(worker)}>{worker.displayName} · {worker.workerNo} · {worker.active ? "启用" : "停用（只查历史）"}</button>)}</div>
  </section>;
}

function AssignmentForm({ group, worker, timeZone, disabled, onDirty, onAssign }: { group: GroupItem; worker: { workerName: string; workerNo: string; active: boolean }; timeZone: string; disabled: boolean; onDirty: () => void; onAssign: (input: AssignInput) => void }) {
  const [startsOn, setStartsOn] = useState(""), [endsOn, setEndsOn] = useState(""), [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ startsOn: string; endsOn: string | null } | null>(null), [ack, setAck] = useState(false), [message, setMessage] = useState("");
  const reasonValid = validText(reason, 200, false);
  const changed = () => { setPreview(null); setAck(false); setMessage(""); onDirty(); };
  const build = () => {
    try { groupRange(startsOn, endsOn || null, timeZone); setPreview({ startsOn, endsOn: endsOn || null }); setAck(false); setMessage("已按当前企业 IANA 时区核对日期端点；尚未保存。 "); }
    catch { setPreview(null); setAck(false); setMessage("请选择 2000～2100 年内实际存在且顺序有效的企业日期。 "); }
  };
  return <form aria-label="新增人员归组" className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={event => {
    event.preventDefault(); if (disabled || !preview || !ack || !reasonValid) return;
    try { groupRange(startsOn, endsOn || null, timeZone); } catch { setPreview(null); setAck(false); setMessage("日期已变化或无效，请重新预览。 "); return; }
    if (preview.startsOn !== startsOn || preview.endsOn !== (endsOn || null)) return;
    if (window.confirm("确认新增这条归组记录？它不会改变打卡、排班、规则分类、审批、工时或工资；继续将清除本页其他未保存草稿。")) onAssign({ startsOn, endsOn: endsOn || null, reason: reason.trim() });
  }}>
    <h3 className="font-bold">新增人员归组</h3>
    <p className="text-sm">当前档案：<strong>{worker.workerName} · {worker.workerNo}</strong><br/>目标组：<strong>{group.name}</strong> · 企业时区 {timeZone}</p>
    {!group.active && <p role="alert" className="text-sm text-amber-900">当前组已停用，不能新增归组；停用不会移除已有记录。</p>}
    {!worker.active && <p role="alert" className="text-sm text-amber-900">当前考勤档案已停用，不能新增归组；历史仍可查询和处理。</p>}
    <fieldset disabled={disabled} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">归组开始日期<input aria-label="归组开始日期" className={input} type="date" min="2000-01-01" max="2100-12-31" value={startsOn} onChange={event => { setStartsOn(event.target.value); changed(); }}/></label>
      <label className="text-sm">归组结束日期（可留空）<input aria-label="归组结束日期" className={input} type="date" min="2000-01-01" max="2100-12-31" value={endsOn} onChange={event => { setEndsOn(event.target.value); changed(); }}/></label></div>
      <button type="button" className={button} onClick={build}>生成新增归组预览</button>
      {message && <p role="status" className="text-sm text-amber-900">{message}</p>}
      {preview && <section aria-label="新增归组预览" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm"><strong>尚未保存</strong><br/>{worker.workerName} · {worker.workerNo}<br/>{group.name}<br/>{preview.startsOn} → {preview.endsOn ?? "无固定结束"}（起止含当日） · {timeZone}</section>}
      <label className="block text-sm">归组原因（1～200 字，单行）<input aria-label="人员归组原因" className={input} maxLength={400} value={reason} onChange={event => { setReason(event.target.value); setAck(false); onDirty(); }}/></label>
      <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={ack} disabled={!preview || !reasonValid} onChange={event => { setAck(event.target.checked); onDirty(); }}/><span>我已核对当前档案、目标组、企业日期、时区和原因；确认这里只保存归组标签。</span></label>
      <button className={button} disabled={!preview || !ack || !reasonValid}>明确新增人员归组</button>
    </fieldset>
  </form>;
}

function MemberList({ items, next, disabled, onDetail, onNext }: { items: GroupAssignmentItem[]; next: unknown; disabled: boolean; onDetail: (id: string) => void; onNext: () => void }) {
  return <section aria-label="归组记录列表" className="space-y-3"><h3 className="font-bold">归组记录（包含撤销历史）</h3>
    {!items.length && <p className="rounded-xl border border-slate-200 p-4 text-sm">本页没有匹配归组记录；这不是组内人数或历史 as-of 结论。</p>}
    {items.map(item => <article key={item.assignmentId} className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2"><strong>归组时人员：{item.workerName} · {item.workerNo}</strong><span>{statusLabels[item.status]}</span></div>
      <p>归组时组名：{item.groupName}<br/>企业日期：{item.startsOn} → {item.endsOn ?? "无固定结束"}（含末日）<br/>历史时区快照：{item.timeZone}</p>
      <p className="break-all text-xs text-slate-500">归组编号：{item.assignmentId}<br/>人员编号：{item.workerId} · 组编号：{item.groupId}<br/>修订 {item.revision} · 创建 UTC {item.createdAt} · 更新 UTC {item.updatedAt}</p>
      <button type="button" className={button} disabled={disabled} onClick={() => onDetail(item.assignmentId)}>查看归组详情</button>
    </article>)}
    <button type="button" className={button} disabled={disabled || !next} onClick={onNext}>下一页归组记录</button>
  </section>;
}

function AssignmentDetail({ detail, currentGroup, currentWorker, disabled, onDirty, onBack, onEnd, onCancel }: { detail: GroupAssignmentDetail; currentGroup: GroupItem | null; currentWorker: { workerName: string; workerNo: string; version: number; active: boolean } | null; disabled: boolean; onDirty: () => void; onBack: () => void; onEnd: (endsOn: string, reason: string) => void; onCancel: (reason: string) => void }) {
  return <article aria-label="归组记录详情" className="space-y-4 rounded-xl border border-blue-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{statusLabels[detail.status]} · 修订 {detail.revision}</h3>
      <p className="text-sm">归组时人员：{detail.workerName} · {detail.workerNo}<br/>归组时组名：{detail.groupName}</p></div><button type="button" className={button} onClick={onBack}>返回归组记录</button></div>
    <p className="text-sm">企业日期：{detail.startsOn} → {detail.endsOn ?? "无固定结束"}（含末日）<br/>历史时区快照：{detail.timeZone}</p>
    <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5">当前组标签：{currentGroup?.name ?? "当前组不可用"}{currentGroup ? ` · 修订 ${currentGroup.revision} · ${currentGroup.active ? "启用" : "停用"}` : ""}<br/>
      当前考勤档案标签：{currentWorker ? `${currentWorker.workerName} · ${currentWorker.workerNo} · 版本 ${currentWorker.version} · ${currentWorker.active ? "启用" : "停用"}` : "当前档案不可用"}<br/>当前标签可能不同；上方历史标签不会被改写。</p>
    <ol aria-label="归组修订历史" className="space-y-2">{detail.history.map((entry, index) => <li key={entry.command.operationId} className="rounded-xl border border-slate-200 p-3 text-sm">
      <strong>{index + 1}. {actionLabels[entry.command.action]}</strong> · 修订 {entry.item.revision} · {statusLabels[entry.item.status]}<br/>
      <span className="break-words">原因：{entry.command.reason}</span><br/><span className="break-all text-xs">操作编号：{entry.command.operationId} · 更新 UTC {entry.item.updatedAt}</span>
    </li>)}</ol>
    {detail.canEnd && <EndForm
      detail={detail} disabled={disabled} onDirty={onDirty} onEnd={onEnd}
    />}
    {detail.canCancel && <CancelForm
      detail={detail} disabled={disabled} onDirty={onDirty} onCancel={onCancel}
    />}
    {!detail.canEnd && !detail.canCancel && <p className="text-sm text-slate-600">该记录已整段撤销，只读保留历史。</p>}
    <p className="break-all text-xs text-slate-500">归组编号：{detail.assignmentId}<br/>人员编号：{detail.workerId} · 组编号：{detail.groupId}<br/>创建 UTC {detail.createdAt} · 更新 UTC {detail.updatedAt}</p>
  </article>;
}

function EndForm({ detail, disabled, onDirty, onEnd }: { detail: GroupAssignmentDetail; disabled: boolean; onDirty: () => void; onEnd: (endsOn: string, reason: string) => void }) {
  const [endsOn, setEndsOn] = useState(""), [reason, setReason] = useState(""), [preview, setPreview] = useState(false), [ack, setAck] = useState(false), [message, setMessage] = useState("");
  const reasonValid = validText(reason, 200, false);
  const changed = () => { setPreview(false); setAck(false); setMessage(""); onDirty(); };
  const build = () => { try { groupRange(detail.startsOn, endsOn, detail.timeZone); setPreview(true); setAck(false); setMessage("结束日是归组最后一日；原开始日和之前日期保留。 "); }
    catch { setPreview(false); setAck(false); setMessage("请选择不早于归组开始日且在历史时区实际存在的日期。 "); } };
  return <section aria-label="结束长期归组" className="space-y-3 rounded-xl border border-slate-200 p-3"><h4 className="font-bold">正常结束长期归组</h4>
    <p className="text-xs leading-5">只为原本无固定结束的记录指定最后一日，不撤销此前归组。换组还需另行新增后续归组，两次操作不具原子性。</p>
    <fieldset disabled={disabled} className="space-y-3"><label className="block text-sm">归组最后一日<input aria-label="归组最后一日" className={input} type="date" min="2000-01-01" max="2100-12-31" value={endsOn} onChange={event => { setEndsOn(event.target.value); changed(); }}/></label>
      <button type="button" className={button} onClick={build}>生成结束归组预览</button>{message && <p role="status" className="text-sm text-amber-900">{message}</p>}
      {preview && <div aria-label="结束归组预览" className="rounded-xl bg-blue-50 p-3 text-sm">保留 {detail.startsOn} 至 {endsOn}（含末日）的归组，之后结束 · {detail.timeZone}</div>}
      <label className="block text-sm">结束原因（1～200 字，单行）<input aria-label="结束归组原因" className={input} maxLength={400} value={reason} onChange={event => { setReason(event.target.value); setAck(false); onDirty(); }}/></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={!preview || !reasonValid} onChange={event => { setAck(event.target.checked); onDirty(); }}/><span>我确认这是正常结束，保留开始日至最后一日的历史，不是整段撤销。</span></label>
      <button type="button" className={button} disabled={!preview || !ack || !reasonValid} onClick={() => {
        if (window.confirm("确认结束这条长期归组？结束日及此前记录保留，后续换组须另行新增；继续将清除本页其他未保存草稿。")) onEnd(endsOn, reason.trim());
      }}>明确结束长期归组</button></fieldset>
  </section>;
}

function CancelForm({ detail, disabled, onDirty, onCancel }: { detail: GroupAssignmentDetail; disabled: boolean; onDirty: () => void; onCancel: (reason: string) => void }) {
  const [reason, setReason] = useState(""), [preview, setPreview] = useState(false), [ack, setAck] = useState(false); const reasonValid = validText(reason, 200, false);
  return <section aria-label="整段撤销归组" className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-3"><h4 className="font-bold">整段撤销归组</h4>
    <p className="text-xs leading-5">撤销会把 {detail.startsOn} 至 {detail.endsOn ?? "无固定结束"} 的整段记录标为作废并保留历史。它不是正常离组，不能代替结束长期归组。</p>
    <fieldset disabled={disabled} className="space-y-3"><label className="block text-sm">撤销原因（1～200 字，单行）<input aria-label="整段撤销归组原因" className={input} maxLength={400} value={reason} onChange={event => { setReason(event.target.value); setPreview(false); setAck(false); onDirty(); }}/></label>
      <button type="button" className={button} disabled={!reasonValid} onClick={() => { setPreview(true); setAck(false); onDirty(); }}>生成整段撤销预览</button>
      {preview && <div aria-label="整段撤销归组预览" className="rounded-xl border border-rose-200 bg-white p-3 text-sm">将整段作废但保留修订历史；不会自动新增替代归组，也不会改变打卡、排班或工资。</div>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={!preview} onChange={event => { setAck(event.target.checked); onDirty(); }}/><span>我确认要整段撤销，而不是正常结束；历史操作仍会保留。</span></label>
      <button type="button" className={button} disabled={!preview || !ack} onClick={() => {
        if (window.confirm("确认整段撤销这条归组记录？这是作废整段记录，不是正常离组；继续将清除本页其他未保存草稿。")) onCancel(reason.trim());
      }}>明确整段撤销归组</button></fieldset>
  </section>;
}

function Receipt({ receipt }: { receipt: { command: GroupsCommand; item: GroupItem | GroupAssignmentItem } }) {
  if (receipt.command.action === "save_group") {
    const item = receipt.item as GroupItem;
    return <section aria-label="考勤组操作收据" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><strong>原操作已确认 · 考勤组修订 {item.revision}</strong><br/>{item.name} · {item.active ? "允许新增归组" : "停用"}<br/><span className="break-all text-xs">组编号：{item.groupId}<br/>操作编号：{receipt.command.operationId}</span></section>;
  }
  const item = receipt.item as GroupAssignmentItem;
  return <section aria-label="归组操作收据" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><strong>原操作已确认 · {actionLabels[receipt.command.action]} · {statusLabels[item.status]}</strong><br/>{item.workerName} · {item.workerNo} → {item.groupName}<br/>{item.startsOn} → {item.endsOn ?? "无固定结束"}<br/><span className="break-all text-xs">归组编号：{item.assignmentId}<br/>操作编号：{receipt.command.operationId}</span></section>;
}

function isGroupItem(item: GroupItem | GroupAssignmentItem): item is GroupItem { return "name" in item; }
function isAssignmentItem(item: GroupItem | GroupAssignmentItem): item is GroupAssignmentItem { return "assignmentId" in item; }
function validText(value: string, max: number, empty: boolean) {
  const text = value.trim(); return (empty || [...text].length >= 1) && [...text].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(text);
}
