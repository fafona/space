"use client";

import { useId, useMemo, useState } from "react";
import { filterBookingTimeZoneOptions, getBookingTimeZoneOptions } from "@/lib/merchantBookingTimeZoneOptions";

export default function BookingTimeZoneSelect({ value, countryCode, locale, className, disabled, onChange }: {
  value: string; countryCode: string; locale: string; className: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const zh = locale.startsWith("zh"), es = locale.startsWith("es");
  const options = useMemo(() => getBookingTimeZoneOptions(locale, countryCode, value), [locale, countryCode, value]);
  const filtered = useMemo(() => filterBookingTimeZoneOptions(options, query, value), [options, query, value]);
  const local = filtered.filter((option) => option.local), other = filtered.filter((option) => !option.local);
  const label = zh ? "新预约使用的商户时区（IANA）" : es ? "Zona horaria del comercio para nuevas reservas (IANA)" : "Merchant time zone for new bookings (IANA)";
  const searchLabel = zh ? "搜索时区" : es ? "Buscar zona horaria" : "Search time zones";
  return (
    <div className="mt-4 min-w-0 space-y-2">
      <label htmlFor={id} className="block text-sm">{label}</label>
      <input type="search" className={className} aria-label={searchLabel} value={query} disabled={disabled}
        placeholder={zh ? "搜索城市、时区名称或 IANA 名称" : es ? "Buscar ciudad, zona horaria o nombre IANA" : "Search city, time zone or IANA name"}
        onChange={(event) => setQuery(event.target.value)} />
      <select id={id} className={`${className} min-w-0 max-w-full`} value={value} disabled={disabled}
        onChange={(event) => { onChange(event.target.value); setQuery(""); }}>
        <option value="">{zh ? "不设置（保留旧行为）" : es ? "Sin configurar (comportamiento anterior)" : "Not set (keep previous behavior)"}</option>
        {local.length ? <optgroup label={zh ? "商户所在国家 / 地区" : es ? "País / región del comercio" : "Merchant country / region"}>
          {local.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </optgroup> : null}
        {other.length ? <optgroup label={zh ? "其他时区" : es ? "Otras zonas horarias" : "Other time zones"}>
          {other.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </optgroup> : null}
      </select>
      {query && !filtered.some((option) => option.value !== value) ? <p className="text-xs opacity-70" role="status">
        {zh ? "没有其他匹配项，已保留当前选择。" : es ? "No hay más coincidencias. Se conserva la selección actual." : "No other matches. Your current selection is preserved."}
      </p> : null}
    </div>
  );
}
