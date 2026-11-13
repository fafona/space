"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { buildServiceLoginHref } from "@/lib/merchantServiceLogin";
import { normalizePersonalFavorites, readFavoriteSiteId, type PersonalFavoriteSite } from "@/lib/personalFavorites";
import { readPersonalGuestProfile, savePersonalGuestProfile, type PersonalGuestProfile } from "@/lib/personalGuestSession";
import { readPersonalAccountServiceConfigFromMetadata, buildPersonalAccountPermissionConfig } from "@/lib/personalAccountServiceConfig";
import type { PersonalClaimedCoupon } from "@/lib/personalCoupons";
import type { MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import { serviceButton, serviceInput, serviceCard, serviceRequest, SERVICE_IDENTITY_CHANGED, type ServicePanelProps } from "./serviceCenterClient";

const CardManager = dynamic(() => import("@/components/admin/MerchantBusinessCardManager"), { ssr: false, loading: () => <p role="status">正在打开名片夹…</p> });
type ProfilePayload = { profile: Partial<PersonalGuestProfile>; businessCards: MerchantBusinessCardAsset[];
  personalServiceConfig?: ReturnType<typeof readPersonalAccountServiceConfigFromMetadata>; user?: Parameters<typeof readPersonalAccountServiceConfigFromMetadata>[0] };

function Qr({ value }: { value: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => { let active = true;
    void import("qrcode").then(qr => qr.default.toDataURL(value, { width: 220, margin: 1 })).then(url => { if (active) setUrl(url); }).catch(() => undefined);
    return () => { active = false; }; }, [value]);
  return url ? <img src={url} alt="会员或优惠券二维码" className="h-40 w-40" /> : <p role="status">二维码生成中…</p>;
}
const tabs = [{ id: "profile", label: "个人资料" }, { id: "favorites", label: "收藏" }, { id: "memberships", label: "会员卡" },
  { id: "coupons", label: "优惠券" }, { id: "cards", label: "名片夹" }, { id: "more", label: "工具与设置" }] as const;

export default function ServiceAccount({ active, identity, refreshIdentity }: ServicePanelProps) {
  const [tab, setTab] = useState<string>("home");
  const [profile, setProfile] = useState<PersonalGuestProfile>(() => readPersonalGuestProfile());
  const [cards, setCards] = useState<MerchantBusinessCardAsset[]>([]);
  const [config, setConfig] = useState(() => readPersonalAccountServiceConfigFromMetadata({}));
  const [coupons, setCoupons] = useState<PersonalClaimedCoupon[]>([]);
  const [pendingCancel, setPendingCancel] = useState<PersonalFavoriteSite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const [refresh, setRefresh] = useState(0);
  const permissions = useMemo(() => buildPersonalAccountPermissionConfig(config), [config]);
  useEffect(() => { setLoadedFor(""); setTab("home"); setPendingCancel(null); setCards([]); setCoupons([]); setError(""); setMessage(""); setProfile(readPersonalGuestProfile()); }, [identity?.accountId]);
  useEffect(() => {
    if (!active || !identity?.authenticated || !["profile", "cards"].includes(tab) || loadedFor === identity.accountId) return;
    const controller = new AbortController();
    void serviceRequest<ProfilePayload>("/api/personal-profile", { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setProfile(current => ({ ...current, ...result.profile })); setCards(result.businessCards ?? []);
      setConfig(result.personalServiceConfig ?? readPersonalAccountServiceConfigFromMetadata(result.user ?? {})); setLoadedFor(identity.accountId);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [active, identity?.authenticated, identity?.accountId, loadedFor, tab, refresh]);
  useEffect(() => {
    if (!active || tab !== "coupons" || !identity?.authenticated) return;
    const controller = new AbortController();
    void serviceRequest<{ coupons?: PersonalClaimedCoupon[] }>("/api/personal-coupons", { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setCoupons(result.coupons ?? []); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [active, identity?.accountId, identity?.authenticated, tab, refresh]);
  const select = (next: string) => { setTab(next); setError(""); setMessage(""); setPendingCancel(null); };
  const favorites = normalizePersonalFavorites(identity?.favoriteSites);
  // Present pre-existing memberships for management without migrating or rewriting their stored bookmarks.
  const manageable = [...favorites, ...(identity?.memberships ?? []).filter(member => member.status === "active" && !favorites.some(site => readFavoriteSiteId(site) === member.siteId))
    .map(member => ({ id: member.siteId, url: `/site/${member.siteId}`, name: member.siteName, subtitle: "已有会员身份", addedAt: member.joinedAt }))];
  const cancel = async (favorite: PersonalFavoriteSite) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await serviceRequest<{ siteId: string }>("/api/personal-favorites", { method: "POST",
        body: JSON.stringify({ action: "unfavorite", favoriteId: favorite.id, siteId: readFavoriteSiteId(favorite) }) });
      setPendingCancel(null); setMessage("已取消收藏并退会，积分、订单和历史记录已保留。");
      window.dispatchEvent(new CustomEvent(SERVICE_IDENTITY_CHANGED, { detail: { siteId: result.siteId, favorited: false } }));
      await refreshIdentity();
    } catch (error) { setError(error instanceof Error ? error.message : "取消失败，原状态已保留。"); }
    finally { setBusy(false); }
  };
  const saveProfile = async () => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (identity?.authenticated) await serviceRequest("/api/personal-profile", { method: "POST", body: JSON.stringify({ profile }) });
      else savePersonalGuestProfile(profile);
      setMessage("资料已保存。"); await refreshIdentity();
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败。"); }
    finally { setBusy(false); }
  };
  if (!identity) return <div><p role="status">暂未读取到账号状态。</p><button type="button" className={serviceButton} onClick={() => void refreshIdentity()}>重新读取</button></div>;
  return <div className="space-y-4" data-service-account>
    {tab === "home" ? <>
      <div className={serviceCard}><h3 data-no-translate={identity.authenticated ? "1" : undefined} className="text-lg font-semibold">{identity.authenticated ? identity.profile.nickname || identity.profile.name || identity.accountId : "游客身份"}</h3>
        <p className="mt-1 text-xs text-slate-500">{identity.authenticated ? `账号 ${identity.accountId}` : "临时资料和记录保存在本设备"}</p>
        {!identity.authenticated ? <a className={serviceButton + " mt-4 inline-block"} href={buildServiceLoginHref(window.location.href)} target="_top">用户登录 / 注册</a> : null}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{tabs.map(item => <button key={item.id} type="button" className={serviceCard + " text-left font-medium hover:border-sky-300"} onClick={() => select(item.id)}>{item.label} →</button>)}</div>
    </> : <div className="flex items-center justify-between gap-2"><button type="button" className={serviceButton} onClick={() => select("home")}>← 返回我的</button><h3 className="font-semibold">{tabs.find(item => item.id === tab)?.label}</h3><button type="button" className={serviceButton} disabled={busy} onClick={() => { setLoadedFor(""); setRefresh(value => value + 1); void refreshIdentity(); }}>刷新</button></div>}
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-emerald-700">{message}</p> : null}
    {tab === "profile" ? <form className={serviceCard + " grid gap-4 sm:grid-cols-2"} onSubmit={event => { event.preventDefault(); void saveProfile(); }}>
      {([['displayName', '姓名 / 昵称'], ['phone', '电话'], ['email', '联系邮箱'], ['birthday', '生日'], ['gender', '性别'], ['country', '国家'], ['province', '省份'], ['city', '城市'], ['address', '地址'], ['signature', '个人签名'], ['avatarUrl', '头像图片地址'], ['contactCard', '联系卡']] as const).map(([key, label]) =>
        <label className="text-sm" key={key}>{label}<input type={key === "email" ? "email" : key === "birthday" ? "date" : "text"} className={serviceInput} value={profile[key]} onChange={event => setProfile(current => ({ ...current, [key]: event.target.value }))} /></label>)}
      <button type="submit" className={serviceButton + " sm:col-span-2 !bg-slate-950 !text-white"} disabled={busy || (identity.authenticated && loadedFor !== identity.accountId)}>{busy ? "保存中…" : "保存资料"}</button>
    </form> : null}
    {tab === "favorites" ? <div className="space-y-3">
      {!manageable.length ? <p className={serviceCard + " text-sm text-slate-500"}>尚未收藏商户。</p> : null}
      {manageable.map(site => <div key={site.id} className={serviceCard}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><a href={site.url} target="_top" className="break-words font-semibold underline">{site.name || "商户网站"}</a><p className="mt-1 break-words text-xs text-slate-500">{site.subtitle}</p></div>
        <button type="button" disabled={busy} className={serviceButton + " shrink-0"} onClick={() => setPendingCancel(site)}>取消收藏</button></div>
        {pendingCancel?.id === site.id ? <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm"><p>取消收藏后将退出该商户会员。积分、订单和历史记录仍保留。</p><div className="mt-3 flex gap-2"><button type="button" disabled={busy} className={serviceButton} onClick={() => void cancel(site)}>确认取消并退会</button><button type="button" disabled={busy} className={serviceButton} onClick={() => setPendingCancel(null)}>保留</button></div></div> : null}
      </div>)}
    </div> : null}
    {tab === "memberships" ? <div className="grid gap-3 sm:grid-cols-2">{identity.memberships.map(member => <div key={member.id} className={serviceCard}>
      <div className="flex justify-between gap-3"><h4 className="font-semibold">{member.siteName}</h4><span className="text-xs text-slate-500">{member.status === "active" ? "有效会员" : "已退会"}</span></div><p className="mt-2 break-all text-sm">会员卡号：{member.memberNo}</p>
      {member.status === "active" ? <details className="mt-3"><summary className="cursor-pointer text-sm">显示会员二维码</summary><Qr value={member.qrValue || member.memberNo} /></details> : null}
      <button className={serviceButton + " mt-3"} type="button" onClick={() => select("favorites")}>到收藏管理</button></div>)}{!identity.memberships.length ? <p className={serviceCard}>暂无会员卡。</p> : null}</div> : null}
    {tab === "coupons" ? <div className="grid gap-3 sm:grid-cols-2">{coupons.map(coupon => <div key={coupon.id} className={serviceCard}><h4 className="font-semibold">{coupon.couponTitle}</h4><p className="mt-1 text-sm">{coupon.siteName} · {coupon.discountLabel}</p><p className="mt-2 text-xs text-slate-500">{coupon.couponDescription}</p><p className="mt-2 break-all text-sm">核销码：{coupon.settlementCode}</p><details className="mt-2"><summary className="cursor-pointer text-sm">显示核销码</summary><Qr value={coupon.settlementCode} /></details><p className="mt-2 text-xs text-slate-500">有效期：{coupon.validUntil || "以商户规则为准"}</p></div>)}{!coupons.length ? <p className={serviceCard}>暂无已领取优惠券。</p> : null}</div> : null}
    {tab === "cards" && identity.authenticated && loadedFor === identity.accountId ? <CardManager merchantId={identity.accountId} siteBaseDomain={window.location.host}
      folderViewMode="page" cards={cards} targetUrlOverride={`https://faolla.com/u/${identity.accountId}`} profile={{ merchantName: profile.displayName, contactName: profile.displayName, contactPhone: profile.phone, contactEmail: profile.email, contactAddress: profile.address, location: { country: profile.country, province: profile.province, city: profile.city } }}
      cardLimit={permissions.businessCardLimit} allowLinkMode={permissions.allowBusinessCardLinkMode} allowIntroVideo={permissions.allowBusinessCardIntroVideo}
      backgroundImageLimitKb={permissions.businessCardBackgroundImageLimitKb} contactPageImageLimitKb={permissions.businessCardContactImageLimitKb} exportImageLimitKb={permissions.businessCardExportImageLimitKb} introVideoLimitMb={permissions.businessCardIntroVideoLimitMb}
      onCardsChange={async next => { try { const result = await serviceRequest<ProfilePayload>("/api/personal-profile", { method: "POST", body: JSON.stringify({ businessCards: next }) }); setCards(result.businessCards); } catch (error) { setError(error instanceof Error ? error.message : "名片保存失败。"); throw error; } }} /> : null}
    {tab === "cards" && !identity.authenticated ? <p className={serviceCard}>请登录后使用名片夹。</p> : null}
    {tab === "more" ? <div className={serviceCard + " flex flex-wrap gap-3"}>
      <a className={serviceButton} href="/me/tools/shuangkoujifen" target="_blank" rel="noreferrer">双扣计分</a><a className={serviceButton} href="/me/games/tank-battle" target="_blank" rel="noreferrer">坦克大战</a><a className={serviceButton} href="/me/games/bufuzai" target="_blank" rel="noreferrer">不服再战</a>
      <a className={serviceButton} href="/legal/privacy" target="_blank" rel="noreferrer">隐私政策</a>
      <a className={serviceButton} target="_top" href={buildServiceLoginHref(window.location.href) + "&loggedOut=1"}>{identity.authenticated ? "退出 / 切换账号" : "用户登录"}</a>
    </div> : null}
  </div>;
}
