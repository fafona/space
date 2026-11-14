"use client";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { filterProfileOptions, type ProfileOption } from "./serviceProfileOptions";
import { serviceInput } from "./serviceCenterClient";

export default function ServiceProfileSelect({ label, value, options, onChange, disabled = false, placeholder = "选择或搜索", emptyText = "暂无匹配选项" }: {
  label: string; value: string; options: ProfileOption[]; onChange: (value: string) => void;
  disabled?: boolean; placeholder?: string; emptyText?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [highlight, setHighlight] = useState(0);
  const selected = options.find(option => option.value === value);
  const allOptions = [{ value: "", label: "不选择（留空）" }, ...options];
  // Retain an older saved value even if it is absent from today's lookup data.
  if (value && !selected) allOptions.push({ value, label: `已保存：${value}` });
  const matches = filterProfileOptions(allOptions, query), visible = matches.slice(0, 50);
  useEffect(() => { if (open) document.getElementById(`${id}-option-${highlight}`)?.scrollIntoView({ block: "nearest" }); }, [open, id, highlight, query]);
  const choose = (next: string) => { onChange(next); setOpen(false); setQuery(""); };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true);
      setHighlight(current => Math.max(0, Math.min(visible.length - 1, open ? current + (event.key === "ArrowDown" ? 1 : -1) : 0)));
    }
    if (event.key === "Enter" && open) { event.preventDefault(); if (visible[highlight]) choose(visible[highlight].value); }
  };
  return <div className="relative min-w-0 text-sm" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(""); } }}>
    <label htmlFor={id} className="mb-1.5 block font-medium text-slate-700">{label}</label>
    <div className="relative"><input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list"
      aria-activedescendant={open && visible[highlight] ? `${id}-option-${highlight}` : undefined}
      className={serviceInput + " pr-10"} autoComplete="off" data-no-translate="1" disabled={disabled}
      placeholder={placeholder} value={open ? query : selected?.label || value || ""}
      onFocus={() => { setOpen(true); setQuery(""); setHighlight(0); }}
      onChange={event => { setQuery(event.target.value); setHighlight(0); setOpen(true); }} onKeyDown={keyDown} />
      <button type="button" aria-label={`展开${label}选项`} aria-expanded={open} disabled={disabled} tabIndex={-1}
        className="absolute inset-y-0 right-1 rounded-lg px-3 text-slate-500 hover:bg-slate-50" onMouseDown={event => event.preventDefault()}
        onClick={() => { setOpen(current => !current); setQuery(""); setHighlight(0); }}><span aria-hidden="true">⌄</span></button></div>
    {open && !disabled ? <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
      <ul role="listbox" id={`${id}-options`} aria-label={`${label}选项`} className="max-h-52 overflow-y-auto overscroll-contain p-1">
        {visible.map((option, index) => <li key={option.value} role="option" id={`${id}-option-${index}`} aria-selected={option.value === value} data-no-translate={option.value ? "1" : undefined}
          className={`cursor-pointer break-words rounded-lg px-3 py-2.5 text-sm ${highlight === index ? "bg-violet-50 text-violet-900" : "text-slate-700 hover:bg-slate-50"}`}
          onMouseEnter={() => setHighlight(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(option.value)}>{option.label}{option.value === value ? <span aria-hidden="true" className="ml-2">✓</span> : null}</li>)}
        {!visible.length ? <li className="px-3 py-3 text-xs text-slate-500">{emptyText}</li> : null}
      </ul>
      {matches.length > 50 ? <p className="border-t border-slate-100 p-2 text-xs text-slate-500">仅显示前 50 项，请输入关键词搜索。</p> : null}
    </div> : null}
  </div>;
}
