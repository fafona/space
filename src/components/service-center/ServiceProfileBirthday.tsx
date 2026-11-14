"use client";
import { useId, useRef, useState } from "react";
import { serviceInput } from "./serviceCenterClient";
import { validProfileBirthday } from "./serviceProfileOptions";

const pad = (value: number) => String(value).padStart(2, "0");
export default function ServiceProfileBirthday({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const id = useId(), text = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const valid = validProfileBirthday(value), year = Number(month.slice(0, 4)), monthNumber = Number(month.slice(5, 7));
  const currentYear = new Date().getFullYear();
  const years = [...new Set([year, ...Array.from({ length: currentYear - 1899 }, (_, index) => currentYear - index)])].sort((a, b) => b - a);
  const firstWeekday = (new Date(`${month}-01T00:00:00.000Z`).getUTCDay() + 6) % 7;
  const days = Array.from({ length: 31 }, (_, index) => index + 1).filter(day => validProfileBirthday(`${month}-${pad(day)}`));
  return <div className="relative min-w-0 text-sm" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); text.current?.focus(); }
  }}>
    <label htmlFor={id} className="mb-1.5 block font-medium text-slate-700">生日</label>
    <div className="relative" translate="no" data-no-translate="1"><input id={id} ref={text} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" maxLength={10} autoComplete="bday" className={serviceInput + " pr-12"} value={value || ""} disabled={disabled} aria-invalid={!valid} aria-describedby={!valid ? `${id}-error` : undefined} onChange={event => onChange(event.target.value)} />
      <button type="button" disabled={disabled} className="absolute inset-y-0 right-1 rounded-lg px-3 text-slate-500 hover:bg-slate-50" aria-label="选择生日日期" aria-expanded={open} aria-controls={`${id}-calendar`} onClick={() => { if (!open) setMonth(valid && value ? value.slice(0, 7) : new Date().toISOString().slice(0, 7)); setOpen(current => !current); }}><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 5h16v15H4ZM4 10h16M8 3v4M16 3v4" /></svg></button></div>
    {!valid ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-rose-700">请输入有效日期，格式为 YYYY-MM-DD。</p> : null}
    {open ? <section id={`${id}-calendar`} aria-label="生日日期选择器" className="absolute z-30 mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
      <div className="mb-3 grid grid-cols-2 gap-2"><label className="text-xs text-slate-500">年份<select aria-label="生日年份" data-no-translate="1" className={serviceInput + " mt-1 !py-2"} value={year} onChange={event => setMonth(`${String(event.target.value).padStart(4, "0")}-${pad(monthNumber)}`)}>{years.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="text-xs text-slate-500">月份<select aria-label="生日月份" data-no-translate="1" className={serviceInput + " mt-1 !py-2"} value={monthNumber} onChange={event => setMonth(`${String(year).padStart(4, "0")}-${pad(Number(event.target.value))}`)}>{Array.from({ length: 12 }, (_, index) => index + 1).map(item => <option key={item} value={item}>{pad(item)}</option>)}</select></label></div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs"><div className="col-span-7 grid grid-cols-7 py-1 text-slate-500" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day}>{day}</span>)}</div>
        {Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} />)}{days.map(day => { const date = `${month}-${pad(day)}`; return <button key={day} type="button" aria-label={date} aria-pressed={date === value} data-no-translate="1" className={`min-h-9 rounded-lg py-2 hover:bg-violet-100 ${date === value ? "bg-violet-700 text-white" : "text-slate-700"}`} onClick={() => { onChange(date); setOpen(false); text.current?.focus(); }}>{day}</button>; })}
      </div><button type="button" className="mt-3 rounded-lg px-2 py-2 text-xs text-slate-600 hover:bg-slate-100" onClick={() => { onChange(""); setOpen(false); text.current?.focus(); }}>清空生日</button>
    </section> : null}
  </div>;
}
