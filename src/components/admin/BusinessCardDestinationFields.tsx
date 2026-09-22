"use client";

import { useId } from "react";
import { normalizeBusinessCardWebsiteAddress, type BusinessCardDestinationSettings } from "@/lib/merchantBusinessCardDestination";

export function BusinessCardDestinationFields({ settings, assignedWebsite, onChange, onFocus }: {
  settings: BusinessCardDestinationSettings;
  assignedWebsite: string;
  onChange: (patch: Pick<BusinessCardDestinationSettings, "websiteAddress">) => void;
  onFocus?: () => void;
}) {
  const id = useId();
  const value = settings.websiteAddress ?? "";
  const invalid = !!value.trim() && !normalizeBusinessCardWebsiteAddress(value);
  return <div className="space-y-3">
    <label className="block text-xs text-slate-600" htmlFor={`${id}-website`}>网站地址</label>
    <div className="flex gap-2">
      <input id={`${id}-website`} type="text" inputMode="url" autoCapitalize="none" spellCheck={false}
        className="min-w-0 flex-1 rounded border bg-white px-3 py-2 text-sm" maxLength={2048}
        value={settings.websiteAddress === undefined ? assignedWebsite : value} placeholder={assignedWebsite || "https://example.com"}
        aria-invalid={invalid} aria-describedby={`${id}-help`} onFocus={onFocus}
        onChange={event => onChange({ websiteAddress: event.target.value })}
        onBlur={() => { const normalized = normalizeBusinessCardWebsiteAddress(value); if (normalized && normalized !== value) onChange({ websiteAddress: normalized }); }} />
      <button type="button" className="shrink-0 rounded border bg-white px-2 text-xs text-slate-600" onClick={() => onChange({ websiteAddress: undefined })}>恢复默认</button>
    </div>
    <div id={`${id}-help`} className={`text-xs leading-5 ${invalid ? "text-red-600" : "text-slate-500"}`}>
      {invalid ? "请输入有效的 http:// 或 https:// 网站地址，不能包含账号、密码或空格。" : `默认使用商户官网：${assignedWebsite || "请先填写域名前缀"}；清空后也会使用此地址。`}
    </div>
    <p className="text-xs leading-5 text-slate-500">{settings.mode === "link" ? "扫码进入联系卡；联系卡中的“进入官网”按钮打开此地址。" : "扫码直接进入此网站地址。"}</p>
  </div>;
}
