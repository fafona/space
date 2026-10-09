"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { AttendanceRulesClient } from "@/lib/merchantAttendanceRulesClient";
import { RULE_KEYS, RULE_DEFINITIONS, emptyAttendanceRuleDraft, type AttendanceRuleDraft, type AttendanceRuleKey } from "@/lib/merchantAttendanceRuleDraft";
import type { RulesItem, RulesResponse } from "@/lib/merchantAttendanceRules";
import type { AttendanceRulesPanelProps } from "./MerchantAttendanceRulesLauncher";

type Props = AttendanceRulesPanelProps & { onClose: () => void; registerCloseHandler?: (handler: (() => void) | null) => void };
type Cell = { mode: "inherit" | "disabled" | "value"; value: string };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500";
const actions = { save_draft: "保存草稿", publish: "登记未来版本", withdraw: "撤回未来版本" };
const otherInputWarning = "开始核对或提交后，本页其他尚未提交的输入将清除，且不会随本次操作保存。已确认的版本记录不会删除。";
const targetLabel = (result: RulesResponse) => result.group ? `考勤组“${result.group.name}”（${result.group.groupId}）` : `企业默认层（${result.siteId}）`;
function checkedReason(value: string, label: string) {
  const reason = value.trim();
  if (!reason || [...reason].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw Error(`${label}需为 1–200 字且不能包含控制字符；尚未发起提交。`);
  return reason;
}

export default function MerchantAttendanceRulesPanel(props: Props) {
  return <Screen key={`${props.siteId}:${props.ownerId}:${props.groupId ?? "enterprise"}`} {...props}/>;
}

function Screen({ siteId, ownerId, groupId, apiFetch, onClose, registerCloseHandler }: Props) {
  const client = useMemo(() => new AttendanceRulesClient({ siteId, ownerId, groupId, apiFetch, storage: () => window.sessionStorage }), [siteId, ownerId, groupId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [visible, setVisible] = useState(false), [dirty, setDirty] = useState(false);

  useLayoutEffect(() => {
    let alive = true;
    const show = async () => {
      setVisible(false); setDirty(false); await client.initialize();
      if (alive && document.visibilityState !== "hidden") setVisible(true);
    };
    const hide = () => { setVisible(false); setDirty(false); client.pause(); };
    const onHide = () => flushSync(hide);
    const visibility = () => { if (document.visibilityState === "hidden") onHide(); else void show(); };
    if (document.visibilityState === "hidden") hide(); else void show();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", onHide);
    return () => { alive = false; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", onHide); };
  }, [client]);

  useLayoutEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || state.pending) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, state.pending]);

  const result = visible ? state.result : null, busy = state.phase === "loading" || state.phase === "saving";
  const discard = () => !dirty || window.confirm("未提交的规则输入将清除。已保存草稿和版本记录不会删除。继续吗？");
  const navigate = (run: () => void) => { if (discard()) { setDirty(false); run(); } };
  const close = () => {
    if (!discard() || state.pending && !window.confirm("原操作结果仍待确认。离开不会撤销或删除原编号；请返回此目标查询。继续吗？")) return;
    client.pause(); onClose();
  };
  const closeHandler = useRef(close);
  useLayoutEffect(() => { closeHandler.current = close; });
  useLayoutEffect(() => {
    registerCloseHandler?.(() => closeHandler.current());
    return () => registerCloseHandler?.(null);
  }, [registerCloseHandler]);
  const locked = busy || state.phase !== "ready" || !!state.pending || !result?.moduleEnabled;

  return <section aria-label="考勤规则版本记录（未应用）" data-attendance-rules-panel className="my-4 min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{groupId === null ? "企业规则版本" : "指定考勤组规则版本"} · 未应用</h2>
      <p className="mt-1 text-sm text-slate-600">仅当前商户负责人 · 单一明确目标 · 草稿与未来版本分开</p></div><button className={button} type="button" onClick={close}>关闭规则版本</button></header>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">这里只保存独立候选规则版本记录，不将规则应用到打卡权限、排班、审批、工时、异常分类或工资，也不改写既有事实。个人例外尚未实现。继承仅是本层设置，不代表已取得或解析另一层的真实规则。登记未来版本不等于考勤计算已经使用它。</p>
    <p role="status" className="text-sm leading-6">{visible ? state.message : "规则资料已隐藏或正在重新核验当前身份。"}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => navigate(() => { setVisible(true); void client.refresh(); })}>{state.pending ? "查询原操作收据" : "重新读取规则版本"}</button>
      {state.pending && <button type="button" className={button} disabled={busy || state.phase !== "unconfirmed"} onClick={() => {
        if (window.confirm("先查询原收据；仍未找到时，仅用原编号与原内容明确重试，不创建新操作。继续吗？")) void client.retry();
      }}>按原编号核对并重试</button>}</div>
    {visible && state.pending && <p className="break-all rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">待确认操作：{state.pending.command.operationId}。原内容暂存于当前标签页；不会自动重发，不能发起新的保存、登记或撤回。</p>}
    {result && <>
      <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><dt className="font-semibold">当前目标</dt><dd>{result.group ? `${result.group.name}（${result.group.active ? "启用" : "已停用"}）` : "企业默认层"}</dd></div>
        <div><dt className="font-semibold">企业 IANA 时区</dt><dd className="break-all">{result.timeZone}</dd></div>
        <div><dt className="font-semibold">规则记录流版本 / 设置版本</dt><dd>{result.revision} / {result.settingsVersion}</dd></div>
        <div><dt className="font-semibold">组版本 / 已保存草稿版本</dt><dd>{result.group?.revision ?? "不适用"} / {result.draft?.revision ?? "无已保存草稿"}</dd></div></dl>
      {!result.moduleEnabled && <p className="text-sm text-amber-950">当前不开放新写入；仍可读取已有记录和查询原收据，不会丢弃待确认编号。</p>}
      {result.group?.active === false && <p className="text-sm text-amber-950">此组已停用：不能保存或登记新草稿；已登记未来版本仍可请求撤回，由服务器复核是否尚未生效。</p>}
      <DraftEditor key={`${result.settingsVersion}:${result.group?.revision ?? "enterprise"}:${result.timeZone}:${result.draft?.revision ?? "none"}`}
        result={result} disabled={locked || result.group?.active === false} onDirty={() => setDirty(true)}
        onSave={async value => { setDirty(false); await client.saveDraft(value); }} onPublish={async (date, reason) => { setDirty(false); await client.publish(date, reason); }}/>
      {result.receipt && <section aria-label="原操作收据" className="space-y-2 rounded-xl border border-green-200 p-3 text-sm"><h3 className="font-bold">原操作收据（不可变记录）</h3>
        <p className="break-all">编号：{result.receipt.operationId} · 记录版本 {result.receipt.revision} · {actions[result.receipt.command.action]}</p>
        <p className="break-all">服务器记录 UTC：{result.receipt.item.recordedAt} · 原操作人：{result.receipt.item.actorId}</p>
        <p>下列是原操作内容；上方当前上下文可能已有后续变化。</p>
        <details><summary className="cursor-pointer">查看原操作完整内容</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-3">{JSON.stringify(result.receipt.command, null, 2)}</pre></details>
      </section>}
      <section aria-label="规则版本历史" className="space-y-3"><h3 className="text-lg font-bold">本页版本历史 · 只追加，不覆盖</h3>
        {!result.items.length && <p className="text-sm text-slate-600">本页没有版本记录；不是全部历史数量。</p>}
        {result.items.map(item => <HistoryEntry key={item.revision} item={item} target={targetLabel(result)} disabled={locked} onDirty={() => setDirty(true)}
          onWithdraw={async reason => { setDirty(false); await client.withdraw(item.revision, reason); }}/>) }
        <button type="button" className={button} disabled={busy || !!state.pending || !result.nextBeforeRevision} onClick={() => navigate(() => { void client.next(); })}>下一页版本历史</button>
        <p className="text-xs leading-6 text-slate-600">每页最多 25 条，以版本游标读取，不显示伪造总数。记录时间由服务器提供，浏览器时钟不作为授权或生效依据。日期、上下文和是否可撤回均由服务器重新核验。</p>
      </section>
    </>}
    <p className="text-xs leading-6 text-slate-600">未提交输入仅在内存中；隐藏、关闭或切换目标会清除。待确认的已发送操作只在当前标签页保存原编号与原内容，关闭标签页或清理站点后不能保证恢复。</p>
  </section>;
}

function DraftEditor({ result, disabled, onDirty, onSave, onPublish }: { result: RulesResponse; disabled: boolean; onDirty: () => void;
  onSave: (input: { rules: AttendanceRuleDraft; reason: string }) => Promise<void>; onPublish: (effectiveOn: string, reason: string) => Promise<void> }) {
  const prefix = useId(), initial = result.draft?.rules ?? emptyAttendanceRuleDraft();
  const [cells, setCells] = useState(() => Object.fromEntries(RULE_KEYS.map(key => [key, { mode: initial[key].mode, value: initial[key].mode === "value" ? String(initial[key].minutes) : "" }])) as Record<AttendanceRuleKey, Cell>);
  const [rulesDirty, setRulesDirty] = useState(false), [saveReason, setSaveReason] = useState(""), [effectiveOn, setEffectiveOn] = useState(""), [publishReason, setPublishReason] = useState(""), [error, setError] = useState("");
  const contextMatches = result.draft && result.draft.settingsVersion === result.settingsVersion && result.draft.groupRevision === (result.group?.revision ?? null) && result.draft.timeZone === result.timeZone;
  const edit = (key: AttendanceRuleKey, patch: Partial<Cell>) => { onDirty(); setRulesDirty(true); setError(""); setCells(previous => ({ ...previous, [key]: { ...previous[key], ...patch } })); };
  const save = (event: FormEvent) => {
    event.preventDefault(); if (disabled) return; setError("");
    try {
      const rules = emptyAttendanceRuleDraft();
      for (const key of RULE_KEYS) {
        const cell = cells[key], definition = RULE_DEFINITIONS[key], value = cell.value.trim();
        if (cell.mode === "value") {
          if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < definition.min || Number(value) > definition.max) throw Error(`${definition.label}需明确填写 ${definition.min}–${definition.max} 的整数分钟；空白不等于 0。`);
          rules[key] = { mode: "value", minutes: Number(value) };
        } else rules[key] = { mode: cell.mode };
      }
      const reason = checkedReason(saveReason, "保存草稿原因");
      if (window.confirm(`将当前规则输入保存为${targetLabel(result)}的新草稿记录；不会登记未来版本或应用到实际考勤。${otherInputWarning}确认继续？`)) void onSave({ rules, reason });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "请核对草稿。"); }
  };
  const publish = (event: FormEvent) => {
    event.preventDefault(); if (disabled || rulesDirty || !contextMatches) return;
    setError("");
    try {
      if (!effectiveOn) throw Error("请填写未来当地日期；尚未发起提交。");
      const reason = checkedReason(publishReason, "登记未来版本原因");
      if (window.confirm(`只将已保存草稿版本 ${result.draft!.revision}（目标：${targetLabel(result)}）登记为 ${effectiveOn}（${result.timeZone}）起的未来候选版本，不应用到打卡、工时或异常。${otherInputWarning}确认继续？`)) void onPublish(effectiveOn, reason);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "请核对登记信息；尚未发起提交。"); }
  };
  return <section className="space-y-4" aria-label="本层规则草稿"><h3 className="text-lg font-bold">本层草稿（不解析其他层）</h3>
    <p className="text-sm leading-6 text-slate-600">明确停用不同于继承；未配置不同于 0。下方上下限仅为技术限制，不是法律要求或建议值。只有保存成功的当前草稿可以登记未来版本。</p>
    <form noValidate onSubmit={save} className="space-y-3"><fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="sr-only">本层四项规则</legend><div className="grid gap-3 sm:grid-cols-2">{RULE_KEYS.map(key => <div key={key} className="min-w-0 rounded-xl border border-slate-200 p-3">
        <label htmlFor={`${prefix}-${key}-mode`} className="block text-sm font-semibold">{RULE_DEFINITIONS[key].label}模式<select id={`${prefix}-${key}-mode`} aria-label={`${RULE_DEFINITIONS[key].label}模式`} className={input} value={cells[key].mode} onChange={event => edit(key, { mode: event.target.value as Cell["mode"] })}>
          <option value="inherit">继承（本层不指定）</option><option value="disabled">明确停用</option><option value="value">指定分钟数</option></select></label>
        <label htmlFor={`${prefix}-${key}-value`} className="mt-3 block text-sm">{RULE_DEFINITIONS[key].label}（分钟）<input id={`${prefix}-${key}-value`} className={input} type="text" inputMode="numeric" autoComplete="off" maxLength={16}
          disabled={disabled || cells[key].mode !== "value"} value={cells[key].value} placeholder="不预填数值" onChange={event => edit(key, { value: event.target.value })}/></label>
        <p className="mt-1 text-xs text-slate-600">整数 {RULE_DEFINITIONS[key].min}–{RULE_DEFINITIONS[key].max} 分钟</p>
      </div>)}</div>
      <label className="block text-sm font-semibold">保存草稿原因<input className={input} value={saveReason} maxLength={200} onChange={event => { onDirty(); setSaveReason(event.target.value); setError(""); }}/></label>
      <button type="submit" className={button} disabled={disabled || !saveReason.trim()}>保存本层草稿</button></fieldset></form>
    <form noValidate onSubmit={publish} className="space-y-3 rounded-xl border border-blue-200 p-3"><h4 className="font-bold">将已保存草稿登记为未来候选版本</h4>
      {rulesDirty && <p className="text-sm text-amber-950">规则输入已有未保存修改；请先保存草稿。不会悄悄登记旧的已保存内容。</p>}
      {!result.draft && <p className="text-sm text-slate-600">没有已保存草稿。已登记版本不会自动复制为新草稿。</p>}
      {result.draft && !contextMatches && <p className="text-sm text-amber-950">草稿关联的设置、组版本或时区已变化；必须重新核对并保存草稿。</p>}
      <fieldset disabled={disabled || rulesDirty || !contextMatches} className="grid gap-3 sm:grid-cols-2"><legend className="sr-only">未来版本登记信息</legend>
        <label className="block text-sm">未来拟生效日期（企业时区）<input type="date" className={input} value={effectiveOn} min="2000-01-01" max="2100-12-31" onChange={event => { onDirty(); setEffectiveOn(event.target.value); setError(""); }}/></label>
        <label className="block text-sm">登记未来版本原因<input className={input} value={publishReason} maxLength={200} onChange={event => { onDirty(); setPublishReason(event.target.value); setError(""); }}/></label>
        <button type="submit" className={`${button} sm:col-span-2`} disabled={disabled || rulesDirty || !contextMatches || !effectiveOn || !publishReason.trim()}>确认登记已保存草稿</button>
      </fieldset><p className="text-xs leading-6 text-slate-600">日期需晚于当前企业当地日期及所有未撤回版本的拟生效日期。只登记边界，不追溯重算；服务器作最终校验。</p></form>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">{error}</p>}
  </section>;
}

function RuleValues({ rules }: { rules: AttendanceRuleDraft }) {
  return <dl className="grid gap-2 text-sm sm:grid-cols-2">{RULE_KEYS.map(key => <div key={key}><dt className="font-semibold">{RULE_DEFINITIONS[key].label}</dt>
    <dd>{rules[key].mode === "inherit" ? "继承（未解析）" : rules[key].mode === "disabled" ? "明确停用" : `${rules[key].minutes} 分钟`}</dd></div>)}</dl>;
}

function HistoryEntry({ item, target, disabled, onDirty, onWithdraw }: { item: RulesItem & { withdrawnByRevision: number | null }; target: string; disabled: boolean; onDirty: () => void; onWithdraw: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(""), [error, setError] = useState("");
  return <article className="space-y-3 rounded-xl border border-slate-200 p-3 text-sm"><h4 className="font-bold">版本 {item.revision} · {actions[item.action]}</h4>
    <p className="break-all">服务器 UTC：{item.recordedAt} · 操作编号：{item.operationId}</p><p className="break-all">原操作人：{item.actorId}</p><p className="break-words">原因：{item.reason}</p>
    {item.timeZone && <p>保存时区：{item.timeZone} · 设置版本 {item.settingsVersion} · 组版本 {item.groupRevision ?? "不适用"}</p>}
    {item.rules && <RuleValues rules={item.rules}/>}
    {item.action === "publish" && <><p className="break-all">拟生效当地日期：{item.effectiveOn} · UTC：{item.effectiveAt}</p>
      {item.withdrawnByRevision !== null ? <p>已由版本 {item.withdrawnByRevision} 撤回；原发布内容保留。</p> : <form onSubmit={event => {
        event.preventDefault(); if (disabled) return; setError("");
        try {
          const validReason = checkedReason(reason, "撤回原因");
          if (window.confirm(`请求撤回版本 ${item.revision}（目标：${target}）。服务器将核验它仍未生效；仅追加撤回记录，不删除原版本。${otherInputWarning}确认继续？`)) void onWithdraw(validReason);
        } catch (caught) { setError(caught instanceof Error ? caught.message : "请核对撤回原因；尚未发起提交。"); }
      }} className="space-y-2"><label className="block">撤回版本 {item.revision} 的原因<input className={input} value={reason} maxLength={200} disabled={disabled} onChange={event => { onDirty(); setReason(event.target.value); setError(""); }}/></label>
        <button type="submit" className={button} disabled={disabled || !reason.trim()}>请求撤回尚未生效的版本 {item.revision}</button>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-red-900">{error}</p>}
        <p className="text-xs text-slate-600">不能撤回已经生效的版本；此按钮不以浏览器时间断言可撤回，服务器会重新核验。</p></form>}</>}
    {item.action === "withdraw" && <p>撤回的发布版本：{item.publishedRevision}；未删除历史。</p>}
  </article>;
}
