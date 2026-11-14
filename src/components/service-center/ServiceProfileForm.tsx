"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadEuropeLocationOptionsApi, type EuropeLocationOptionsApi } from "@/lib/europeLocationOptionsLoader";
import type { PersonalGuestProfile } from "@/lib/personalGuestSession";
import type { MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import ServiceProfileSelect from "./ServiceProfileSelect";
import ServiceProfileBirthday from "./ServiceProfileBirthday";
import { normalizeProfileSearch, profileContactCardOptions, validProfileBirthday } from "./serviceProfileOptions";
import { prepareServiceAvatar } from "./serviceProfileAvatar";
import { serviceButton, serviceCard, serviceInput, serviceRequest } from "./serviceCenterClient";

const genders = [{ value: "female", label: "女", keywords: "female woman mujer" }, { value: "male", label: "男", keywords: "male man hombre" }, { value: "other", label: "其他", keywords: "other otro" }];
export default function ServiceProfileForm({ profile, cards, authenticated, accountId, busy, loading, onChange, onSave }: {
  profile: PersonalGuestProfile; cards: MerchantBusinessCardAsset[]; authenticated: boolean; accountId: string;
  busy: boolean; loading: boolean; onChange: (key: keyof PersonalGuestProfile, value: string) => void; onSave: () => void;
}) {
  const [locations, setLocations] = useState<EuropeLocationOptionsApi | null>(null);
  const [locationError, setLocationError] = useState(false), [locationRetry, setLocationRetry] = useState(0);
  const [avatarBusy, setAvatarBusy] = useState(false), [avatarError, setAvatarError] = useState(""), [avatarNote, setAvatarNote] = useState("");
  const upload = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void loadEuropeLocationOptionsApi().then(api => { if (active) { setLocations(api); setLocationError(false); } }).catch(() => { if (active) setLocationError(true); });
    return () => { active = false; };
  }, [locationRetry]);
  useEffect(() => () => { upload.current?.abort(); }, []);
  const countries = useMemo(() => (locations?.getEuropeCountryOptions() || []).map(country => {
    const names = [country.name, country.code];
    for (const locale of ["zh-CN", "es", "en"]) { try { names.push(new Intl.DisplayNames([locale], { type: "region" }).of(country.code) || ""); } catch { /* Country names and codes remain searchable. */ } }
    return { value: country.name, label: `${country.name} · ${names[2] || country.code}`, keywords: names.join(" "), code: country.code, aliases: names };
  }), [locations]);
  const country = countries.find(option => option.aliases.some(value => normalizeProfileSearch(value) === normalizeProfileSearch(profile.country)));
  const provinces = locations?.getEuropeProvinceOptions(country?.code || "") || [];
  // Resolve saved names exactly; the older "findBest" helper selects a first
  // province on a miss, which must not rewrite a person's existing location.
  const province = provinces.find(option => [option.name, option.code].some(value => normalizeProfileSearch(value) === normalizeProfileSearch(profile.province)));
  const cities = locations?.getEuropeCityOptions(country?.code || "", province?.code || "") || [];
  const contactOptions = useMemo(() => profileContactCardOptions(cards), [cards]);
  const disabled = busy || loading || avatarBusy;
  const birthdayValid = validProfileBirthday(profile.birthday);
  const chooseAvatar = async (file: File | undefined) => {
    if (!file || disabled) return;
    const controller = new AbortController(); upload.current?.abort(); upload.current = controller;
    setAvatarBusy(true); setAvatarError(""); setAvatarNote("");
    try {
      const dataUrl = await prepareServiceAvatar(file);
      if (controller.signal.aborted) return;
      const result = authenticated ? await serviceRequest<{ url: string }>("/api/assets/upload", { method: "POST", signal: controller.signal,
        body: JSON.stringify({ dataUrl, merchantHint: accountId, folder: "merchant-assets", usage: "generic-image" }) }) : { url: dataUrl };
      if (controller.signal.aborted) return;
      if (!result.url) throw new Error("头像上传失败，请重试。");
      onChange("avatarUrl", result.url); setAvatarNote("头像已准备好，保存资料后生效。");
    } catch (error) { if (!controller.signal.aborted) setAvatarError(error instanceof Error ? error.message : "头像上传失败，请重试。"); }
    finally { if (!controller.signal.aborted) setAvatarBusy(false); }
  };
  return <form className={serviceCard + " space-y-5"} data-service-profile-form onSubmit={event => { event.preventDefault(); if (!disabled && birthdayValid) onSave(); }}>
    {loading ? <p role="status" className="text-sm text-slate-500">正在读取个人资料…</p> : null}
    <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 pb-5">
      <div className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-violet-100 bg-violet-50 text-violet-700">
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 22v-2a8 8 0 0 1 16 0v2" /></svg>
        {profile.avatarUrl ? <img key={profile.avatarUrl} src={profile.avatarUrl} alt="当前头像" className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} /> : null}
      </div>
      <div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">头像</h4><div className="mt-2 flex flex-wrap gap-2">
        <label className={serviceButton + " relative inline-flex cursor-pointer focus-within:outline-2 focus-within:outline-violet-700"}>{avatarBusy ? "正在处理图片…" : "上传头像"}<input type="file" aria-label="上传头像" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={event => { void chooseAvatar(event.target.files?.[0]); event.target.value = ""; }} /></label>
        {profile.avatarUrl ? <button type="button" className={serviceButton} disabled={disabled} onClick={() => { onChange("avatarUrl", ""); setAvatarNote(""); setAvatarError(""); }}>移除头像</button> : null}</div>
        <p className="mt-2 text-xs leading-5 text-slate-500">JPG、PNG 或 WebP，最大 10 MB；自动缩小压缩。{authenticated ? "" : "游客头像仅保存在本设备。"}</p>
      </div>
    </div>
    {avatarError ? <p role="alert" className="text-sm text-rose-700">{avatarError}</p> : null}
    {avatarNote ? <p role="status" className="text-sm text-emerald-700">{avatarNote}</p> : null}
    <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {([['displayName', '姓名 / 昵称'], ['phone', '电话'], ['email', '联系邮箱']] as const).map(([key, label]) => <label className="min-w-0 text-sm font-medium text-slate-700" key={key}>{label}<input type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} className={serviceInput + " mt-1.5"} value={profile[key]} onChange={event => onChange(key, event.target.value)} /></label>)}
      <ServiceProfileBirthday value={profile.birthday} disabled={disabled} onChange={value => onChange("birthday", value)} />
      <ServiceProfileSelect label="性别" value={profile.gender} options={genders} disabled={disabled} onChange={value => onChange("gender", value)} />
      <ServiceProfileSelect label="国家" value={profile.country} options={countries} disabled={disabled || !locations} placeholder={locations ? "选择或搜索国家" : "正在读取地区…"} onChange={value => { if (value !== profile.country) { onChange("country", value); onChange("province", ""); onChange("city", ""); } }} />
      <ServiceProfileSelect label="省份" value={profile.province} options={provinces.map(option => ({ value: option.name, label: option.name, keywords: option.code }))} disabled={disabled || !locations} placeholder="先选择国家，再搜索省份" emptyText="请先选择有地区数据的国家" onChange={value => { if (value !== profile.province) { onChange("province", value); onChange("city", ""); } }} />
      <ServiceProfileSelect label="城市" value={profile.city} options={cities.map(value => ({ value, label: value }))} disabled={disabled || !locations} placeholder="先选择省份，再搜索城市" emptyText="请先选择有城市数据的省份" onChange={value => onChange("city", value)} />
      {([['address', '地址'], ['signature', '个人签名']] as const).map(([key, label]) => <label className="min-w-0 text-sm font-medium text-slate-700" key={key}>{label}<input className={serviceInput + " mt-1.5"} value={profile[key]} onChange={event => onChange(key, event.target.value)} /></label>)}
      <div className="min-w-0 sm:col-span-2"><ServiceProfileSelect label="联系卡" value={profile.contactCard} options={contactOptions} disabled={disabled} placeholder="不选择（留空）" emptyText="暂无可选联系卡，可先在名片夹创建并保存" onChange={value => onChange("contactCard", value)} />
        <p className="mt-1.5 text-xs leading-5 text-slate-500">{contactOptions.length ? "从名片夹中选择已保存的联系卡，也可以留空。" : "没有联系卡可以留空；登录后可在名片夹创建并保存。"}{profile.contactCard && !contactOptions.some(option => option.value === profile.contactCard) ? " 当前已保存的内容会保留，除非你重新选择或清空。" : ""}</p></div>
    </fieldset>
    {locationError ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">地区选项暂时无法读取，原有资料已保留。<button type="button" className={serviceButton} disabled={disabled} onClick={() => setLocationRetry(value => value + 1)}>重新读取地区</button></div> : null}
    <button type="submit" className={serviceButton + " w-full !border-violet-700 !bg-violet-700 !text-white"} disabled={disabled || !birthdayValid}>{busy ? "保存中…" : avatarBusy ? "请等待头像处理完成" : "保存资料"}</button>
  </form>;
}
