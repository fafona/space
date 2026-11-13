"use client";
import { useEffect, useState } from "react";
import { buildServiceLoginHref } from "@/lib/merchantServiceLogin";
import { normalizeMerchantMembershipProfileDraft, getMerchantMembershipProfileValidationError, type MerchantMembershipProfileDraft } from "@/lib/merchantMemberships";
import { serviceButton, serviceCard, serviceInput, serviceRequest, SERVICE_IDENTITY_CHANGED, type ServicePanelProps } from "./serviceCenterClient";

export default function ServiceFavorite({ siteId, siteName, identity, refreshIdentity, onDone }: ServicePanelProps & { onDone: () => void }) {
  const [profile, setProfile] = useState(() => normalizeMerchantMembershipProfileDraft(identity?.profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Background identity checks must not overwrite a form the user is editing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setProfile(normalizeMerchantMembershipProfileDraft(identity?.profile)); }, [identity?.accountId]);
  if (!identity) return <p role="status">正在核实登录状态…</p>;
  if (!identity.authenticated) return <div className={serviceCard}><p className="mb-4">请先登录，再收藏并加入本店会员。</p>
    <a className={serviceButton} href={buildServiceLoginHref(window.location.href)} target="_top">用户登录</a></div>;
  const update = (key: keyof MerchantMembershipProfileDraft, value: string | boolean) => setProfile(current => ({ ...current, [key]: value }));
  const submit = async () => {
    if (busy) return;
    const validation = getMerchantMembershipProfileValidationError(profile);
    if (validation) { setError(validation); return; }
    setBusy(true); setError("");
    try {
      await serviceRequest("/api/personal-favorites", { method: "POST", body: JSON.stringify({ action: "favorite", siteId, profile }) });
      window.dispatchEvent(new CustomEvent(SERVICE_IDENTITY_CHANGED, { detail: { siteId, favorited: true, siteName } }));
      await refreshIdentity(); onDone();
    } catch (error) { setError(error instanceof Error ? error.message : "收藏失败，请重试。"); }
    finally { setBusy(false); }
  };
  return <form className={`${serviceCard} mx-auto max-w-2xl space-y-4`} onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div><h3 className="font-semibold">收藏 {siteName || "本店"}</h3><p className="mt-2 text-sm text-slate-500">收藏后同时成为该商户会员。之后可在“我的 → 收藏”中取消收藏并退会。</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      {([['nickname', '昵称', 'text', true], ['name', '姓名', 'text', false], ['phone', '手机', 'tel', true], ['email', '邮箱', 'email', true]] as const).map(([key, label, type, required]) =>
        <label key={key} className="space-y-1 text-sm">{label}{required ? " *" : ""}<input className={serviceInput} type={type} required={required} value={profile[key]} maxLength={key === "email" ? 320 : 120} onChange={event => update(key, event.target.value)} /></label>)}
      <label className="space-y-1 text-sm">生日 *<input className={serviceInput} type={profile.birthdayMonthDayOnly ? "text" : "date"} placeholder="MM-DD" required value={profile.birthday} onChange={event => update("birthday", event.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={profile.birthdayMonthDayOnly}
        onChange={event => { update("birthdayMonthDayOnly", event.target.checked); update("birthday", ""); }} />生日仅填写月日</label>
    </div>
    <p className="text-xs text-slate-500">以上资料用于本店会员服务；已有订单、积分和历史记录不会被清除。</p>
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    <button type="submit" disabled={busy} className="w-full rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "正在收藏…" : "收藏并加入会员"}</button>
  </form>;
}
