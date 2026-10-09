"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { AttendancePersonalRulesClient } from "@/lib/merchantAttendancePersonalRulesClient";
import { RULE_KEYS, RULE_DEFINITIONS, emptyAttendanceRuleDraft, parseAttendanceRuleDraft, type AttendanceRuleDraft, type AttendanceRuleKey } from "@/lib/merchantAttendanceRuleDraft";
import { attendanceDayUtcRange, attendanceLocalDate } from "@/lib/merchantAttendanceTime";
import { attendanceRecordInstant } from "@/lib/merchantAttendanceManagement";
import type { PersonalRulesItem, PersonalRulesResponse } from "@/lib/merchantAttendancePersonalRules";
import type { AttendancePersonalRulesPanelProps } from "./MerchantAttendancePersonalRulesLauncher";

type Props = AttendancePersonalRulesPanelProps & { onClose: () => void; registerCloseHandler?: (handler: (() => void) | null) => void };
type ApprovalInput = { startsOn: string; endsOn: string; rules: AttendanceRuleDraft; reason: string };
type Cell = { mode: "inherit" | "disabled" | "value"; value: string };
type HistoryItem = PersonalRulesItem & { withdrawnByRevision: number | null };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500";
const actionNames = { approve: "负责人核准登记", withdraw: "撤回未开始候选" };
const clearWarning = "开始核对或提交后，本页其他未提交输入将清除，不会随本次操作保存。已登记历史不会删除。";
const targetLabel = (result: PersonalRulesResponse) => `${result.worker.workerName}（工号 ${result.worker.workerNo}；人员 ${result.worker.workerId}）`;
const choiceText = (choice: AttendanceRuleDraft[AttendanceRuleKey]) => choice.mode === "inherit" ? "继承（本层不指定，尚未解析）" : choice.mode === "disabled" ? "明确停用" : `${choice.minutes} 分钟`;
function checkedReason(value: string) {
  const reason = value.trim();
  if (!reason || [...reason].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(reason)) throw Error("理由需为 1–200 字且不含控制字符；尚未发起提交。");
  return reason;
}

// Advisory dates come only from the latest server read and its workplace zone.
// A skipped civil date is not silently normalized into a different selection.
export function personalRulesEarliestDate(result: Pick<PersonalRulesResponse, "readAt" | "timeZone">): string | null {
  try {
    const today = attendanceLocalDate(attendanceRecordInstant(result.readAt).slice(0, 23) + "Z", result.timeZone);
    const epoch = Date.parse(`${today}T00:00:00.000Z`);
    for (let day = 1; day <= 31; day++) {
      const date = new Date(epoch + day * 86400000).toISOString().slice(0, 10);
      if (date > "2100-12-31") return null;
      try { attendanceDayUtcRange(date, result.timeZone); return date; } catch { /* A skipped date is not selectable. */ }
    }
  } catch { /* No client-clock fallback. */ }
  return null;
}
export function validatePersonalRulesApprovalInput(value: ApprovalInput, result: Pick<PersonalRulesResponse, "readAt" | "timeZone">): ApprovalInput {
  const reason = checkedReason(value.reason), rules = parseAttendanceRuleDraft(value.rules);
  if (RULE_KEYS.every(key => rules[key].mode === "inherit")) throw Error("四项不能全部继承；请至少明确指定或停用一项。");
  const earliest = personalRulesEarliestDate(result);
  if (!earliest || value.startsOn < earliest) throw Error("开始日期至少为服务器所示企业当地日期的次日；尚未发起提交。");
  let first, last;
  try { first = attendanceDayUtcRange(value.startsOn, result.timeZone); last = attendanceDayUtcRange(value.endsOn, result.timeZone); }
  catch { throw Error("请选择企业时区中确实存在的开始及结束日期。"); }
  const days = (Date.parse(value.endsOn) - Date.parse(value.startsOn)) / 86400000 + 1;
  if (!Number.isInteger(days) || days < 1 || days > 31 || first.startAt >= last.endAt || attendanceRecordInstant(first.startAt) <= attendanceRecordInstant(result.readAt)) {
    throw Error("日期范围须为未来连续 1–31 个当地日期，包含结束日；尚未发起提交。");
  }
  return { startsOn: value.startsOn, endsOn: value.endsOn, rules, reason };
}
export function personalRulesCanWithdraw(item: HistoryItem, readAt: string) {
  return item.action === "approve" && item.withdrawnByRevision === null && attendanceRecordInstant(readAt) < attendanceRecordInstant(item.fromAt);
}

export default function MerchantAttendancePersonalRulesPanel(props: Props) {
  return <Screen key={`${props.siteId}:${props.ownerId}:${props.workerId}`} {...props}/>;
}
function Screen({ siteId, ownerId, workerId, apiFetch, onClose, registerCloseHandler }: Props) {
  const client = useMemo(() => new AttendancePersonalRulesClient({ siteId, ownerId, workerId, apiFetch, storage: () => window.sessionStorage }), [siteId, ownerId, workerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [visible, setVisible] = useState(false), [dirty, setDirty] = useState(false), [editorEpoch, setEditorEpoch] = useState(0);
  const lifecycle = useRef({ alive: false, epoch: 0, visible: false });
  useLayoutEffect(() => {
    const life = lifecycle.current; life.alive = true;
    const show = async () => {
      const epoch = ++life.epoch; life.visible = false; setVisible(false); setDirty(false); setEditorEpoch(value => value + 1);
      await client.initialize();
      if (life.alive && epoch === life.epoch && document.visibilityState !== "hidden") { life.visible = true; setVisible(true); }
    };
    const hide = () => { ++life.epoch; life.visible = false; setVisible(false); setDirty(false); setEditorEpoch(value => value + 1); client.pause(); };
    const onHide = () => flushSync(hide);
    const visibility = () => { if (document.visibilityState === "hidden") onHide(); else void show(); };
    if (document.visibilityState === "hidden") hide(); else void show();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", onHide);
    return () => { life.alive = false; ++life.epoch; life.visible = false; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", onHide); };
  }, [client]);
  useLayoutEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || state.pending) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, state.pending]);
  const result = visible ? state.result : null, busy = state.phase === "loading" || state.phase === "saving";
  const discard = () => !dirty || window.confirm("未提交的个人例外输入将清除，已登记历史不会删除。继续吗？");
  const navigate = (run: () => Promise<unknown>) => {
    const epoch = lifecycle.current.epoch;
    if (!discard() || !lifecycle.current.alive || !lifecycle.current.visible || lifecycle.current.epoch !== epoch || document.visibilityState === "hidden") return;
    setDirty(false); setEditorEpoch(value => value + 1); void run();
  };
  const close = () => {
    const epoch = lifecycle.current.epoch, wasVisible = lifecycle.current.visible;
    // Closing is still available during the initial read, but an old confirmation
    // must not close a replacement client or a newly visible generation.
    const current = () => lifecycle.current.alive && lifecycle.current.epoch === epoch
      && lifecycle.current.visible === wasVisible && document.visibilityState !== "hidden";
    if (!discard() || !current()) return;
    if (state.pending && !window.confirm("原操作结果仍待确认。离开不会撤销或删除原编号；请返回此人员查询。继续吗？") || !current()) return;
    ++lifecycle.current.epoch; lifecycle.current.visible = false; client.pause(); onClose();
  };
  const closeHandler = useRef(close);
  useLayoutEffect(() => { closeHandler.current = close; });
  useLayoutEffect(() => { registerCloseHandler?.(() => closeHandler.current()); return () => registerCloseHandler?.(null); }, [registerCloseHandler]);
  const confirmCurrent = (message: string, expected: PersonalRulesResponse, run: () => Promise<unknown>) => {
    const epoch = lifecycle.current.epoch;
    if (!window.confirm(message)) return;
    const current = client.getSnapshot(), life = lifecycle.current;
    // A native confirmation can outlive a target/authentication/visibility change.
    if (!life.alive || !life.visible || life.epoch !== epoch || document.visibilityState === "hidden"
      || current.result !== expected || current.phase !== "ready" || current.pending || !expected.moduleEnabled) return;
    setDirty(false); setEditorEpoch(value => value + 1); void run();
  };
  const locked = busy || state.phase !== "ready" || !!state.pending || !result?.moduleEnabled;
  return <section aria-label="个人例外候选记录（未应用）" data-attendance-personal-rules-panel className="my-4 min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">个人例外候选 · 未应用</h2><p className="mt-1 text-sm text-slate-600">仅当前负责人核准登记 · 单一明确人员 · 完整值原子登记</p></div><button className={button} type="button" onClick={close}>关闭个人例外</button></header>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">这里只登记独立候选，不是员工申请或双人审核；未应用到打卡、排班、工时、异常或工资，不改写既有事实。不作正式考勤判定，也不在此解析企业或组规则。继承不等于停用，空白不等于 0。</p>
    <p role="status" className="text-sm leading-6">{visible ? state.message : "个人例外资料已隐藏或正在重新核验当前身份。"}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || !visible} onClick={() => navigate(() => client.refresh())}>{state.pending ? "查询个人例外原操作收据" : "重新读取个人例外"}</button>
      {visible && state.pending && <button type="button" className={button} disabled={busy || state.phase !== "unconfirmed"} onClick={() => {
        const epoch = lifecycle.current.epoch;
        if (window.confirm("先查询原收据；仍未找到时，仅按原编号与原内容明确重试，不创建新操作。继续吗？")
          && lifecycle.current.alive && lifecycle.current.visible && epoch === lifecycle.current.epoch && document.visibilityState !== "hidden") void client.retry();
      }}>按原编号核对并重试个人例外</button>}</div>
    {visible && state.pending && <p className="break-all rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">待确认操作：{state.pending.command.operationId}。原内容暂存在当前标签页；不会自动重发，不能发起新的核准或撤回。</p>}
    {result && <>
      <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><dt className="font-semibold">当前目标人员</dt><dd className="break-all">{targetLabel(result)}</dd></div>
        <div><dt className="font-semibold">当前员工身份 / 登录身份</dt><dd className="break-all">{result.worker.employeeId ?? "未绑定员工"} / {result.worker.employeeAuthUserId ?? "未绑定登录身份"}</dd></div>
        <div><dt className="font-semibold">企业 IANA 时区</dt><dd className="break-all">{result.timeZone}</dd></div><div><dt className="font-semibold">候选流 / 人员 / 设置版本</dt><dd>{result.revision} / {result.worker.version} / {result.settingsVersion}</dd></div>
        <div><dt className="font-semibold">人员 / 员工状态</dt><dd>{result.worker.active ? "人员启用" : "人员停用"} / {result.worker.employeeActive ? "员工启用" : "员工未启用"}</dd></div><div><dt className="font-semibold">服务器读取 UTC</dt><dd className="break-all">{result.readAt}</dd></div></dl>
      {!result.moduleEnabled && <p className="text-sm text-amber-950">当前不开放新写入；仍可读取已有记录和查询原收据，不会丢弃待确认编号。</p>}
      {(!result.worker.active || !result.worker.employeeActive || !result.worker.employeeAuthUserId) && <p className="text-sm text-amber-950">人员或员工未启用，或尚未绑定登录身份：不能核准新候选。同身份历史和未开始候选仍可重新核对。</p>}
      <PersonalRulesApprovalEditor key={`approve:${editorEpoch}`} result={result} disabled={locked || !result.worker.active || !result.worker.employeeActive || !result.worker.employeeId || !result.worker.employeeAuthUserId}
        onDirty={() => setDirty(true)} onApprove={value => confirmCurrent(`请二次核对个人例外候选：\n人员：${targetLabel(result)}\n员工身份：${result.worker.employeeId}\n登录身份：${result.worker.employeeAuthUserId}\n日期：${value.startsOn} 至 ${value.endsOn}（含尾日；${result.timeZone}）\n${RULE_KEYS.map(key => `${RULE_DEFINITIONS[key].label}：${choiceText(value.rules[key])}`).join("\n")}\n理由：${value.reason}\n仅负责人核准登记，不是员工申请或双人审核，未应用、不改工时。服务器仍将复核身份、日期、版本和重叠。${clearWarning}确认核准登记？`, result, () => client.approve(value))}/>
      {result.receipt && <section aria-label="个人例外原操作收据" className="space-y-2 rounded-xl border border-green-200 p-3 text-sm"><h3 className="font-bold">原操作收据（不可变记录）</h3><p className="break-all">编号：{result.receipt.operationId} · 版本 {result.receipt.revision} · {actionNames[result.receipt.command.action]}</p>
        <details><summary className="cursor-pointer">查看原操作完整内容和快照</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded bg-slate-50 p-3">{JSON.stringify({ command: result.receipt.command, item: result.receipt.item }, null, 2)}</pre></details></section>}
      <section aria-label="个人例外候选历史" className="space-y-3"><h3 className="text-lg font-bold">本页候选历史 · 只追加，不覆盖</h3>{!result.items.length && <p className="text-sm text-slate-600">本页没有候选记录；不是全部历史数量。</p>}
        {result.items.map(item => <PersonalRulesHistoryEntry key={`${editorEpoch}:${item.revision}`} item={item} readAt={result.readAt} disabled={locked} onDirty={() => setDirty(true)} onWithdraw={reason => {
          if (!personalRulesCanWithdraw(item, result.readAt)) return;
          confirmCurrent(`仅请求撤回个人例外核准版本 ${item.revision}：\n人员：${targetLabel(result)}\n原员工身份：${item.employeeId}\n原登录身份：${item.employeeAuthUserId}\n原日期：${item.startsOn} 至 ${item.endsOn}（${item.timeZone}）\n撤回理由：${reason}\n服务器将复核它仍未开始；仅追加一条撤回记录，不删除或取消全部历史。${clearWarning}确认撤回？`, result, () => client.withdraw(item.revision, reason));
        }}/>) }
        <button type="button" className={button} disabled={busy || !!state.pending || !result.nextBeforeRevision} onClick={() => navigate(() => client.next())}>下一页个人例外历史</button>
        <p className="text-xs leading-6 text-slate-600">每页最多 25 条，按版本游标读取，不显示伪造总数。可撤回提示只参考本次服务器 readAt，最终仍由服务器锁定当前身份后重新复核；浏览器时钟不作依据。</p>
      </section>
    </>}
    <p className="text-xs leading-6 text-slate-600">未提交输入仅在内存中，隐藏、重新读取、关闭或切换人员会清除；离开前请核对。待确认操作仅在当前标签页保存原编号和原内容，关闭标签页或清理站点后不能保证恢复。此处没有持久草稿，也不会自动提交。</p>
  </section>;
}

export function PersonalRulesApprovalEditor({ result, disabled, onDirty, onApprove }: { result: PersonalRulesResponse; disabled: boolean; onDirty: () => void; onApprove: (value: ApprovalInput) => void }) {
  const prefix = useId(), earliest = personalRulesEarliestDate(result);
  const [cells, setCells] = useState(() => Object.fromEntries(RULE_KEYS.map(key => [key, { mode: "inherit", value: "" }])) as Record<AttendanceRuleKey, Cell>);
  const [startsOn, setStartsOn] = useState(""), [endsOn, setEndsOn] = useState(""), [reason, setReason] = useState(""), [error, setError] = useState("");
  const edit = (key: AttendanceRuleKey, patch: Partial<Cell>) => { onDirty(); setError(""); setCells(previous => ({ ...previous, [key]: { ...previous[key], ...patch } })); };
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (disabled || !earliest) return; setError("");
    try {
      const rules = emptyAttendanceRuleDraft();
      for (const key of RULE_KEYS) {
        const cell = cells[key], definition = RULE_DEFINITIONS[key], value = cell.value.trim();
        if (cell.mode === "value") {
          if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < definition.min || Number(value) > definition.max) throw Error(`${definition.label}需明确填写 ${definition.min}–${definition.max} 的整数分钟；空白不等于 0。`);
          rules[key] = { mode: "value", minutes: Number(value) };
        } else rules[key] = { mode: cell.mode };
      }
      onApprove(validatePersonalRulesApprovalInput({ startsOn, endsOn, rules, reason }, result));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "请核对完整输入；尚未发起提交。"); }
  };
  return <section aria-label="核准个人例外候选" className="space-y-3"><h3 className="text-lg font-bold">核准登记完整候选</h3><p className="text-sm leading-6 text-slate-600">四项至少一项明确指定或停用；继承尚未解析其他层。上下限是技术限制，不是法律要求或建议值。日期含尾日，共 1–31 个当地日期。</p>
    <p className="text-sm">依服务器读取时刻，最早可选当地开始日：{earliest ?? "当前已无支持范围内的未来日期"}（{result.timeZone}）。最终仍由服务器复核。</p>
    <form noValidate onSubmit={submit} className="space-y-3"><fieldset disabled={disabled || !earliest} className="min-w-0 space-y-3"><legend className="sr-only">个人例外日期、完整规则和理由</legend>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">开始日期（企业当地）<input className={input} type="date" min={earliest ?? "2100-12-31"} max="2100-12-31" value={startsOn} onChange={event => { onDirty(); setStartsOn(event.target.value); setError(""); }}/></label>
        <label className="block text-sm">结束日期（含尾日）<input className={input} type="date" min={startsOn || earliest || "2000-01-01"} max="2100-12-31" value={endsOn} onChange={event => { onDirty(); setEndsOn(event.target.value); setError(""); }}/></label></div>
      <div className="grid gap-3 sm:grid-cols-2">{RULE_KEYS.map(key => <div key={key} className="min-w-0 rounded-xl border border-slate-200 p-3"><label htmlFor={`${prefix}-${key}-mode`} className="block text-sm font-semibold">{RULE_DEFINITIONS[key].label}模式<select id={`${prefix}-${key}-mode`} className={input} value={cells[key].mode} onChange={event => edit(key, { mode: event.target.value as Cell["mode"] })}>
        <option value="inherit">继承（本层不指定）</option><option value="disabled">明确停用</option><option value="value">指定分钟数</option></select></label>
        <label htmlFor={`${prefix}-${key}-value`} className="mt-3 block text-sm">{RULE_DEFINITIONS[key].label}（分钟）<input id={`${prefix}-${key}-value`} className={input} type="text" inputMode="numeric" autoComplete="off" maxLength={16} disabled={disabled || cells[key].mode !== "value"} value={cells[key].value} placeholder="不预填数值" onChange={event => edit(key, { value: event.target.value })}/></label><p className="mt-1 text-xs text-slate-600">整数 {RULE_DEFINITIONS[key].min}–{RULE_DEFINITIONS[key].max} 分钟</p></div>)}</div>
      <label className="block text-sm font-semibold">负责人核准理由<input className={input} value={reason} maxLength={200} onChange={event => { onDirty(); setReason(event.target.value); setError(""); }}/></label>
      <button type="submit" className={button} disabled={disabled || !earliest || !startsOn || !endsOn || !reason.trim()}>核对并核准个人例外候选</button>
    </fieldset></form>{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">{error}</p>}
  </section>;
}

export function PersonalRulesHistoryEntry({ item, readAt, disabled, onDirty, onWithdraw }: { item: HistoryItem; readAt: string; disabled: boolean; onDirty: () => void; onWithdraw: (reason: string) => void }) {
  const [reason, setReason] = useState(""), [error, setError] = useState("");
  const canWithdraw = personalRulesCanWithdraw(item, readAt);
  return <article className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3 text-sm"><h4 className="font-bold">版本 {item.revision} · {actionNames[item.action]}</h4>
    <p className="break-all">服务器 UTC：{item.recordedAt} · 操作编号：{item.operationId}</p><p className="break-all">原负责人：{item.actorId}</p><p className="break-words">理由：{item.reason}</p>
    <p className="break-all">原日期：{item.startsOn} 至 {item.endsOn}（含尾日；{item.timeZone}）</p>
    <details><summary className="cursor-pointer">查看版本 {item.revision} 完整原始快照</summary><dl className="mt-2 grid gap-2 sm:grid-cols-2">{RULE_KEYS.map(key => <div key={key}><dt className="font-semibold">{RULE_DEFINITIONS[key].label}</dt><dd>{choiceText(item.rules[key])}</dd></div>)}</dl>
      <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-slate-50 p-3">{JSON.stringify(item, null, 2)}</pre></details>
    {item.action === "withdraw" && <p>只撤回核准版本 {item.approvedRevision}；原身份、规则和日期快照保留，没有删除全部历史。</p>}
    {item.action === "approve" && (item.withdrawnByRevision !== null ? <p>已由版本 {item.withdrawnByRevision} 撤回；原核准内容保留。</p> : !canWithdraw ? <p>本次服务器读取时刻已到开始边界，不能撤回这条历史候选。</p> : <form noValidate className="space-y-2" onSubmit={event => {
      event.preventDefault(); if (disabled || !canWithdraw) return; setError("");
      try { onWithdraw(checkedReason(reason)); } catch (caught) { setError(caught instanceof Error ? caught.message : "请填写撤回理由。"); }
    }}><label className="block">撤回版本 {item.revision} 的理由<input className={input} disabled={disabled} value={reason} maxLength={200} onChange={event => { onDirty(); setReason(event.target.value); setError(""); }}/></label>
      <button type="submit" className={button} disabled={disabled || !reason.trim()}>请求撤回未开始候选 {item.revision}</button><p className="text-xs text-slate-600">仅按本次服务器读取时刻提供操作入口；服务器提交时仍会复核是否尚未开始。</p>{error && <p role="alert" className="text-red-900">{error}</p>}</form>)}
  </article>;
}
