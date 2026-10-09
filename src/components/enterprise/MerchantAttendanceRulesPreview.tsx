"use client";

import { useId, useLayoutEffect, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { RULE_KEYS, RULE_DEFINITIONS, emptyAttendanceRuleDraft, previewAttendanceRuleDraft,
  type AttendanceRuleDraft } from "@/lib/merchantAttendanceRuleDraft";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";

type Props = { timeZone: string; now?: () => string };
type RuleKey = (typeof RULE_KEYS)[number];
type Tier = "enterprise" | "group" | "personal";
type Mode = "inherit" | "disabled" | "value";
type EditableRule = { mode: Mode; value: string };
type EditableTier = Record<RuleKey, EditableRule>;
type Form = { effectiveOn: string; tiers: Record<Tier, EditableTier> };
type Preview = ReturnType<typeof previewAttendanceRuleDraft>;

const tiers: Tier[] = ["enterprise", "group", "personal"];
const tierLabels: Record<Tier, string> = { enterprise: "企业假设", group: "组假设", personal: "个人假设" };
const modeLabels: Record<Mode, string> = { inherit: "继承", disabled: "明确停用", value: "指定分钟数" };
const ruleNotes: Record<RuleKey, string> = {
  lateGraceMinutes: "仅试算宽限值的来源，不判断任何员工是否迟到。",
  earlyGraceMinutes: "仅试算宽限值的来源，不改变实际离开时间。",
  openSpanWarningMinutes: "仅演示未结束跨度的提醒阈值，不估算或确认工时。",
  completedBreakMinimumMinutes: "仅针对单段已结束休息的参考值，不是法定休息结论。",
};
const input = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";
const button = "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40";
const clock = () => new Date().toISOString();

function emptyForm(): Form {
  const blank = emptyAttendanceRuleDraft();
  const makeTier = () => Object.fromEntries(RULE_KEYS.map(key => [key, { mode: blank[key].mode, value: "" }])) as EditableTier;
  return { effectiveOn: "", tiers: { enterprise: makeTier(), group: makeTier(), personal: makeTier() } };
}

function draft(tier: EditableTier, source: Tier): AttendanceRuleDraft {
  const result = emptyAttendanceRuleDraft();
  for (const key of RULE_KEYS) {
    const entry = tier[key];
    if (entry.mode === "value") {
      const value = entry.value.trim();
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error(`${tierLabels[source]} · ${RULE_DEFINITIONS[key].label}：请明确填写整数分钟；空白不等于 0。`);
      }
      result[key] = { mode: "value", minutes: Number(value) };
    } else result[key] = { mode: entry.mode };
  }
  return result;
}

function message(error: unknown) {
  if (error instanceof MerchantAttendanceError) {
    if (/zone/.test(error.code)) return "无法识别当前 IANA 时区；未生成试算。请核对时区。";
    if (/date|effective|future|past|instant|day/.test(error.code)) return "请填写当前时区内尚未开始的未来日期；无效日期或因时区／夏令时变化不存在的日期不能试算。";
    return "草稿未通过校验。请核对各字段的整数分钟范围、未来日期和时区；未生成试算。";
  }
  if (error instanceof Error && error.message.includes("空白不等于 0")) return error.message;
  return "暂时无法完成草稿试算；请核对日期、时区和分钟数后重试。未保存或更改任何记录。";
}

/** Isolated hypothetical form only. No actor, worker/group IDs, API, browser
 * storage, publication or existing attendance writer is involved. */
export default function MerchantAttendanceRulesPreview(props: Props) {
  return <Screen key={props.timeZone} {...props}/>;
}

function Screen({ timeZone, now = clock }: Props) {
  const prefix = useId();
  const [form, setForm] = useState<Form>(emptyForm);
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [suspended, setSuspended] = useState(false);
  const [notice, setNotice] = useState("");

  useLayoutEffect(() => {
    const clear = () => {
      setForm(emptyForm()); setResult(null); setError(""); setSuspended(true);
      setNotice("页面已离开或转入后台，内存中的草稿和试算已清除。返回后请明确开始一份空白草稿。");
    };
    // Native visibility/pagehide events are not React discrete events. Commit
    // their removal synchronously, before any retained screen can be reused.
    const hide = () => flushSync(clear);
    const visibility = () => { if (document.visibilityState === "hidden") hide(); };
    if (document.visibilityState === "hidden") clear();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
    };
  }, []);

  const changed = () => { setResult(null); setError(""); setNotice(""); };
  const update = (tier: Tier, key: RuleKey, patch: Partial<EditableRule>) => {
    changed();
    setForm(previous => ({ ...previous, tiers: { ...previous.tiers,
      [tier]: { ...previous.tiers[tier], [key]: { ...previous.tiers[tier][key], ...patch } } } }));
  };
  const reset = () => {
    if (document.visibilityState === "hidden") return;
    setForm(emptyForm()); setResult(null); setError(""); setSuspended(false);
    setNotice("已开始空白草稿；没有恢复任何旧输入或试算结果。");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setResult(null); setError(""); setNotice("");
    if (suspended || document.visibilityState === "hidden") return;
    if (!form.effectiveOn) { setError("请先填写当前时区内的未来拟生效日期；此日期不会发布任何配置。"); return; }
    try {
      const checked = previewAttendanceRuleDraft({ timeZone, now: now(), effectiveOn: form.effectiveOn,
        enterprise: draft(form.tiers.enterprise, "enterprise"), group: draft(form.tiers.group, "group"), personal: draft(form.tiers.personal, "personal") });
      setResult(checked);
    } catch (caught) { setError(message(caught)); }
  };

  return <section aria-labelledby={`${prefix}-title`} data-attendance-rules-preview className="my-4 min-w-0 space-y-5 rounded-2xl border border-blue-200 bg-white p-4 text-slate-900 sm:p-6">
    <header className="space-y-2">
      <h2 id={`${prefix}-title`} className="text-xl font-bold">考勤规则草稿试算（未保存、未生效）</h2>
      <p className="text-sm text-slate-600">独立假设，不读取真实企业规则、考勤组、个人资料、排班或打卡。当前解释时区：<span className="break-all font-semibold">{timeZone}</span>。</p>
    </header>
    <aside id={`${prefix}-scope`} className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      <p>企业、组、个人三个层级均为假设。个人假设不是已获批的个人例外，组假设不是实际考勤组或归组结果。</p>
      <p>按字段试算：个人 → 组 → 企业。继承会继续查找；明确停用会停止查找；全部继承表示未配置，不等于 0。数字 0 必须明确输入且通过该字段校验，不预填任何法定或建议值。下方范围仅为技术输入限制，不是法律要求或推荐阈值。</p>
      <p>仅保存在本页内存；切换时区、转入后台、离开或卸载会清除。没有保存、发布、授权或工资计算，也不新增、删除或改写打卡、审批及异常记录。</p>
    </aside>

    {notice && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm leading-6">{notice}</p>}
    {suspended ? <div className="space-y-3"><p className="text-sm text-slate-600">草稿已清空；不会自动恢复或重新试算。</p>
      <button type="button" className={button} onClick={reset}>重新开始空白草稿</button></div>
      : <form noValidate onSubmit={submit} aria-describedby={`${prefix}-scope`} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold" htmlFor={`${prefix}-effective`}>未来拟生效日期（仅试算）
            <input id={`${prefix}-effective`} type="date" min="2000-01-01" max="2100-12-31" autoComplete="off" className={input} value={form.effectiveOn}
              onChange={event => { changed(); setForm(previous => ({ ...previous, effectiveOn: event.target.value })); }} aria-describedby={`${prefix}-date-help`}/>
          </label>
          <p id={`${prefix}-date-help`} className="self-center text-sm leading-6 text-slate-600">日期按 {timeZone} 解释。仅接受尚未开始的未来当地日期；时区或夏令时导致不存在的日期会被拒绝，不自动移到其他日期。</p>
        </div>

        {RULE_KEYS.map(key => <fieldset key={key} className="min-w-0 rounded-xl border border-slate-200 p-3 sm:p-4">
          <legend className="px-1 text-base font-bold">{RULE_DEFINITIONS[key].label}</legend>
          <p id={`${prefix}-${key}-help`} className="mb-3 text-sm leading-6 text-slate-600">{ruleNotes[key]} 可输入整数 {RULE_DEFINITIONS[key].min}–{RULE_DEFINITIONS[key].max} 分钟。</p>
          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
            {tiers.map(tier => <div key={tier} className="min-w-0 space-y-3 rounded-lg bg-slate-50 p-3">
              <h3 className="text-sm font-bold">{tierLabels[tier]}</h3>
              <label htmlFor={`${prefix}-${tier}-${key}-mode`} className="block text-sm">{tierLabels[tier]} · {RULE_DEFINITIONS[key].label}模式
                <select id={`${prefix}-${tier}-${key}-mode`} aria-label={`${tierLabels[tier]} · ${RULE_DEFINITIONS[key].label}模式`} className={input} value={form.tiers[tier][key].mode}
                  onChange={event => update(tier, key, { mode: event.target.value as Mode })} aria-describedby={`${prefix}-${key}-help`}>
                  <option value="inherit">继承</option><option value="disabled">明确停用</option><option value="value">指定分钟数</option>
                </select>
              </label>
              <label htmlFor={`${prefix}-${tier}-${key}-value`} className="block text-sm">{tierLabels[tier]} · {RULE_DEFINITIONS[key].label}（分钟）
                <input id={`${prefix}-${tier}-${key}-value`} type="text" inputMode="numeric" pattern="[0-9]+" autoComplete="off" maxLength={16}
                  className={input} value={form.tiers[tier][key].value} disabled={form.tiers[tier][key].mode !== "value"} placeholder="明确填写，不预设数值"
                  onChange={event => update(tier, key, { value: event.target.value })} aria-describedby={`${prefix}-${key}-help`}/>
              </label>
            </div>)}
          </div>
        </fieldset>)}

        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={`${button} border-blue-800 bg-blue-800 text-white`}>试算</button>
          <button type="button" className={button} onClick={reset}>清空草稿与试算</button>
        </div>
        <p className="text-xs leading-6 text-slate-600">仅在点击“试算”时校验；修改任意输入立即移除上次结果。此操作没有保存接口，结果不代表真实规则已经生效。</p>
      </form>}

    {!suspended && result && <section aria-labelledby={`${prefix}-result-title`} className="space-y-4 rounded-xl border border-blue-200 bg-blue-50 p-4" data-attendance-rule-preview-result>
      <h3 id={`${prefix}-result-title`} className="text-lg font-bold" tabIndex={-1}>草稿试算结果（未保存、未生效）</h3>
      <p role="status" className="text-sm leading-6">仅展示假设优先级与拟生效边界；不是实际异常判定，也不是授权、规则发布或工资依据。</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold">解释时区 / 当地拟生效日期</dt><dd className="break-words">{result.timeZone} / {result.effectiveOn}</dd></div>
        <div><dt className="font-semibold">试算检查 UTC</dt><dd className="break-all">{result.checkedAt}</dd></div>
      </dl>
      <div className="grid gap-3 md:grid-cols-2">{RULE_KEYS.map(key => {
        const field = result.fields[key];
        return <article key={key} className="min-w-0 space-y-3 rounded-lg border border-blue-100 bg-white p-3">
          <h4 className="font-bold">{RULE_DEFINITIONS[key].label}</h4>
          <p className="text-base font-semibold">{field.state === "value" ? `${field.minutes} 分钟` : field.state === "disabled" ? "明确停用（不是 0）" : "未配置（不是 0）"}</p>
          <dl className="space-y-2 text-sm">
            <div><dt className="font-semibold">假设来源</dt><dd>{field.source ? tierLabels[field.source] : "无：各层均继承"}</dd></div>
            <div><dt className="font-semibold">拟生效 UTC（仅试算）</dt><dd className="break-all">{result.effectiveAt}</dd></div>
            <div><dt className="font-semibold">逐层判断</dt><dd className="break-words leading-6">{field.trace.map(entry => `${tierLabels[entry.source]}：${modeLabels[entry.mode]}`).join(" → ")}</dd></div>
          </dl>
        </article>;
      })}</div>
    </section>}
  </section>;
}
