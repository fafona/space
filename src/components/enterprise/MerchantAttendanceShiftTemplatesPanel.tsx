"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceShiftTemplatesClient } from "@/lib/merchantAttendanceShiftTemplatesClient";
import { parseShiftTemplate, templateDaySlots, templateNominalMinutes,
  type ShiftTemplate, type ShiftTemplateItem } from "@/lib/merchantAttendanceShiftTemplates";
import type { ShiftTemplatesLauncherProps } from "./MerchantAttendanceShiftTemplatesLauncher";

type Props = ShiftTemplatesLauncherProps & { onClose: () => void };
type Preview = { template: ShiftTemplate; minutes: number };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:opacity-50";
const blankTemplate = (): ShiftTemplate => ({ name: "", segments: [{ start: "09:00", end: "17:00", nextDay: false }] });
const copyTemplate = (template: ShiftTemplate): ShiftTemplate => ({ name: template.name,
  segments: template.segments.map(segment => ({ ...segment })) });
const copyName = (name: string) => `${[...name].slice(0, 77).join("")} 副本`;
const duration = (minutes: number) => `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`;

export default function MerchantAttendanceShiftTemplatesPanel(props: Props) {
  return <Screen key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}

function Screen({ siteId, ownerId, apiFetch, applyDisabled = false, writeDisabled = false, onDirty, onApply, onClose }: Props) {
  const client = useMemo(() => new AttendanceShiftTemplatesClient({ siteId, ownerId, apiFetch,
    storage: () => window.sessionStorage }), [siteId, ownerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [draft, setDraft] = useState<ShiftTemplate>(blankTemplate);
  const [selected, setSelected] = useState<ShiftTemplateItem | null>(null);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [localMessage, setLocalMessage] = useState("");
  const result = state.result;
  const busy = state.phase === "loading" || state.phase === "saving";
  const locked = busy || !!state.pending;
  const canApply = !applyDisabled && !locked && state.phase === "ready" && !!result?.moduleEnabled;
  const canWrite = !writeDisabled && !locked && state.phase === "ready" && !!result?.moduleEnabled;

  const clearDraft = () => {
    setDraft(blankTemplate()); setSelected(null); setDirty(false); setPreview(null); setLocalMessage("");
  };
  const pauseAndClear = () => { clearDraft(); client.pause(); };
  useEffect(() => {
    const hide = () => { clearDraft(); client.pause(); };
    const visibility = () => { if (document.hidden) hide(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    return () => { hide(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); };
  }, [client]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || state.pending) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, state.pending]);

  const allowReplace = () => !dirty || window.confirm("当前模板草稿尚未保存，替换后会丢失。继续吗？");
  const edit = (item: ShiftTemplateItem) => {
    if (!allowReplace()) return;
    setSelected(item); setDraft(copyTemplate(item.template)); setDirty(false); setPreview(null); setLocalMessage("");
  };
  const duplicate = (item: ShiftTemplateItem) => {
    if (!allowReplace()) return;
    const template = copyTemplate(item.template); template.name = copyName(template.name);
    setSelected(null); setDraft(template); setDirty(true); onDirty?.(); setPreview(null); setLocalMessage("副本尚未保存；将使用新的模板编号。");
  };
  const create = () => { if (allowReplace()) clearDraft(); };
  const markChanged = () => { setDirty(true); onDirty?.(); setPreview(null); setLocalMessage(""); };
  const parsedDraft = () => {
    try { return parseShiftTemplate(draft); }
    catch { setPreview(null); setLocalMessage("请填写 1 至 80 字名称及 1 至 4 段按时间排序、互不重叠的有效班次。"); return null; }
  };
  const showPreview = () => {
    const template = parsedDraft();
    if (!template) return;
    setPreview({ template, minutes: templateNominalMinutes(template) });
    setLocalMessage("已生成模板日墙钟预览；尚未保存，也未发布排班。");
  };
  const adopt = (item: ShiftTemplateItem, message: string) => {
    if (item.archived) { clearDraft(); setLocalMessage(message); return; }
    setSelected(item); setDraft(copyTemplate(item.template)); setDirty(false); setPreview(null); setLocalMessage(message);
  };
  const initialize = async () => {
    if (busy || !state.pending && !allowReplace()) return;
    if (!state.pending) clearDraft();
    await client.initialize();
    const receipt = client.getSnapshot().result?.receipt;
    if (receipt) adopt(receipt.item, "已按原编号核对模板操作收据。");
  };
  const save = async () => {
    const template = parsedDraft();
    if (!template || !canWrite || !window.confirm("保存模板只会更新模板库，不会发布排班。继续吗？")) return;
    await client.save(template, selected ?? undefined);
    const next = client.getSnapshot();
    if (next.result?.receipt?.command.action === "save") adopt(next.result.receipt.item, "模板已保存；尚未发布任何排班。");
  };
  const archive = async (item: ShiftTemplateItem) => {
    if (!canWrite || dirty || item.archived || !window.confirm(`归档模板“${item.template.name}”？归档不会取消已经发布的排班。`)) return;
    await client.archive(item);
    const receipt = client.getSnapshot().result?.receipt;
    if (receipt?.command.action === "archive" && receipt.item.templateId === item.templateId) clearDraft();
  };
  const retry = async () => {
    await client.retry();
    const next = client.getSnapshot();
    if (next.result?.receipt) adopt(next.result.receipt.item, "已按原编号核对模板操作收据。");
  };
  const load = (view: "active" | "archived") => {
    if (!allowReplace() || locked) return;
    clearDraft(); void client.load(view);
  };
  const apply = (item: ShiftTemplateItem) => {
    if (!canApply || dirty || item.archived || !window.confirm("将替换当前未发布排班草稿中的班次时段；日期范围、每周选项和理由保持不变。继续吗？")) return;
    onApply(copyTemplate(item.template)); pauseAndClear(); onClose();
  };
  const close = () => {
    if (dirty && !window.confirm("当前模板草稿尚未保存，关闭后会丢失。继续吗？")) return;
    if (state.pending && !window.confirm("模板操作结果仍待确认。关闭不会撤销操作；下次请先读取原收据。继续吗？")) return;
    pauseAndClear(); onClose();
  };

  return <section aria-label="班次模板库" className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-3"
    onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    <header className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-bold">班次模板库</h4>
      <p className="mt-1 text-xs leading-5 text-slate-600">保存可复用的单个模板日墙钟时段；模板不含日期、人员、时区、每周选项或发布理由。</p></div>
      <button type="button" className={button} onClick={close}>关闭模板库</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5">保存模板不会发布排班，也不会生成打卡、缺勤、工时或工资。名义时长不是实际经过时长或计薪依据；带入草稿后仍须用原排班预览核对日期、时区和夏令时。</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy} onClick={() => void initialize()}>读取模板／查原收据</button>
      {state.pending && <button type="button" className={button} disabled={state.phase !== "unconfirmed"} onClick={() => void retry()}>用原编号明确重试</button>}
    </div>
    <p role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm leading-6">{state.message}</p>
    {localMessage && <p className="text-sm leading-6 text-slate-700">{localMessage}</p>}
    {state.pending && <p className="break-all text-xs text-amber-900">有一笔模板操作结果待确认；恢复前不会发起新的模板操作。原操作编号：{state.pending.command.operationId}</p>}
    {result && <>
      {!result.moduleEnabled && <p className="text-sm text-amber-900">班次模板写入已暂停；仍可只读核对，但不能保存、归档或带入排班草稿。</p>}
      {writeDisabled && <p className="text-sm text-amber-900">当前排班模块已暂停；模板仍可只读核对，但不能保存或归档。</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={locked || result.view === "active"} onClick={() => load("active")}>查看在用模板</button>
        <button type="button" className={button} disabled={locked || result.view === "archived"} onClick={() => load("archived")}>查看已归档模板</button>
        <span className="text-xs text-slate-600">当前：{result.view === "active" ? "在用模板" : "已归档模板"}</span>
      </div>
      {!result.items.length && <p className="text-sm text-slate-600">本页没有{result.view === "active" ? "在用" : "已归档"}模板。</p>}
      <ul className="space-y-3">{result.items.map(item => <li key={item.templateId} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><strong className="break-words">{item.template.name}</strong><span className="text-xs">修订 {item.revision} · {item.archived ? "已归档" : "在用"}</span></div>
        <TemplateSummary template={item.template}/>
        <p className="break-all text-xs text-slate-500">模板编号：{item.templateId}<br/>更新（UTC）：{item.updatedAt}</p>
        <div className="flex flex-wrap gap-2">{!item.archived && <button type="button" className={button} disabled={locked} onClick={() => edit(item)}>编辑模板</button>}
          <button type="button" className={button} disabled={!canWrite} onClick={() => duplicate(item)}>复制模板</button>
          {!item.archived && <button type="button" className={button} disabled={!canWrite || dirty} onClick={() => void archive(item)}>归档模板</button>}</div>
      </li>)}</ul>
      <button type="button" className={button} disabled={locked || !result.nextCursor} onClick={() => { if (allowReplace()) { clearDraft(); void client.next(); } }}>下一页模板</button>
    </>}
    {selected && !selected.archived && <button type="button" className={button} disabled={!canApply || dirty} onClick={() => apply(selected)}>带入排班草稿</button>}
    <fieldset disabled={!canWrite} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <legend className="px-1 text-sm font-bold">模板编辑（未发布）</legend>
      <button type="button" className={button} onClick={create}>新建模板</button>
      <label className="block text-sm">模板名称<input aria-label="模板名称" className={input} maxLength={80} value={draft.name}
        onChange={event => { setDraft(current => ({ ...current, name: event.target.value })); markChanged(); }}/></label>
      {draft.segments.map((segment, index) => <div key={index} className="grid gap-2 rounded-xl bg-slate-50 p-2 sm:grid-cols-4">
        <label className="text-sm">第 {index + 1} 段开始<input aria-label={`第 ${index + 1} 段开始`} className={input} type="time" value={segment.start}
          onChange={event => { setDraft(current => ({ ...current, segments: current.segments.map((value, i) => i === index ? { ...value, start: event.target.value } : value) })); markChanged(); }}/></label>
        <label className="text-sm">第 {index + 1} 段结束<input aria-label={`第 ${index + 1} 段结束`} className={input} type="time" value={segment.end}
          onChange={event => { setDraft(current => ({ ...current, segments: current.segments.map((value, i) => i === index ? { ...value, end: event.target.value } : value) })); markChanged(); }}/></label>
        <label className="flex items-center gap-2 text-sm"><input aria-label={`第 ${index + 1} 段次日结束`} type="checkbox" checked={segment.nextDay}
          onChange={event => { setDraft(current => ({ ...current, segments: current.segments.map((value, i) => i === index ? { ...value, nextDay: event.target.checked } : value) })); markChanged(); }}/>次日结束</label>
        {draft.segments.length > 1 && <button type="button" className={button} onClick={() => { setDraft(current => ({ ...current, segments: current.segments.filter((_, i) => i !== index) })); markChanged(); }}>删除第 {index + 1} 段</button>}
      </div>)}
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={draft.segments.length >= 4}
        onClick={() => { setDraft(current => ({ ...current, segments: [...current.segments, { start: "17:00", end: "21:00", nextDay: false }] })); markChanged(); }}>增加一段</button>
        <button type="button" className={button} onClick={showPreview}>预览模板日</button>
        <button type="button" className={button} disabled={!dirty} onClick={() => void save()}>保存模板</button></div>
      {preview && <div aria-label="模板日墙钟预览" className="rounded-xl bg-blue-50 p-3"><TemplateSummary template={preview.template}/>
        <p className="mt-2 text-xs text-slate-600">名义时长：{duration(preview.minutes)}。不含日期、时区或夏令时换算，不代表实际时长或工资。</p></div>}
    </fieldset>
    <p className="text-xs leading-5 text-slate-500">列表只在明确点击时读取，不轮询。切到后台、关闭或卸载会清除列表和未保存模板草稿；待确认操作编号保留在当前账号与企业的会话存储中，返回后须手动读取原收据。</p>
  </section>;
}

function TemplateSummary({ template }: { template: ShiftTemplate }) {
  const slots = templateDaySlots(template), minutes = templateNominalMinutes(template);
  return <div className="text-xs leading-5 text-slate-700"><p>模板日墙钟：{slots.map(slot => `${slot.start} → ${slot.nextDay ? "次日 " : ""}${slot.end}`).join(" · ")}</p>
    <p>名义时长：{duration(minutes)}（非实际时长／非工资）</p></div>;
}
