"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { buildServiceLoginHref } from "@/lib/merchantServiceLogin";
import { normalizePersonalFavorites, readFavoriteSiteId, type PersonalFavoriteSite } from "@/lib/personalFavorites";
import { readPersonalGuestProfile, savePersonalGuestProfile, type PersonalGuestProfile } from "@/lib/personalGuestSession";
import { readPersonalAccountServiceConfigFromMetadata, buildPersonalAccountPermissionConfig } from "@/lib/personalAccountServiceConfig";
import type { PersonalClaimedCoupon } from "@/lib/personalCoupons";
import type { MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import { serviceButton, serviceCard, serviceRequest, SERVICE_IDENTITY_CHANGED, type ServicePanelProps } from "./serviceCenterClient";
import ServiceProfileForm from "./ServiceProfileForm";

const CardManager = dynamic(() => import("@/components/admin/MerchantBusinessCardManager"), { ssr: false, loading: () => <p role="status">正在打开名片夹…</p> });
const Settings = dynamic(() => import("./ServiceAccountSettings"));
const PersonalQr = dynamic(() => import("./ServicePersonalQr"));
const SessionActions = dynamic(() => import("./ServiceAccountSessionActions"));
type ProfilePayload = { profile: Partial<PersonalGuestProfile>; businessCards: MerchantBusinessCardAsset[];
  personalServiceConfig?: ReturnType<typeof readPersonalAccountServiceConfigFromMetadata>; user?: Parameters<typeof readPersonalAccountServiceConfigFromMetadata>[0] };

function Qr({ value }: { value: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => { let active = true;
    void import("qrcode").then(qr => qr.default.toDataURL(value, { width: 220, margin: 1 })).then(url => { if (active) setUrl(url); }).catch(() => undefined);
    return () => { active = false; }; }, [value]);
  return url ? <img src={url} alt="会员或优惠券二维码" className="h-40 w-40" /> : <p role="status">二维码生成中…</p>;
}
const tabs = [
  { id: "profile", label: "个人资料", description: "昵称、头像与联系信息", tone: "bg-violet-100 text-violet-700", hover: "hover:border-violet-200 hover:bg-violet-50/40", path: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2" },
  { id: "favorites", label: "收藏", description: "喜欢的商户与会员管理", tone: "bg-rose-100 text-rose-700", hover: "hover:border-rose-200 hover:bg-rose-50/40", path: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" },
  { id: "memberships", label: "会员卡", description: "会员卡与会员二维码", tone: "bg-sky-100 text-sky-700", hover: "hover:border-sky-200 hover:bg-sky-50/40", path: "M4 5h16v14H4V5ZM4 10h16M8 15h3M15 15h1" },
  { id: "coupons", label: "优惠券", description: "已领取优惠与核销信息", tone: "bg-amber-100 text-amber-800", hover: "hover:border-amber-200 hover:bg-amber-50/40", path: "M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6V5ZM14 5v3M14 11v2M14 16v3" },
  { id: "cards", label: "名片夹", description: "制作与管理数字名片", tone: "bg-teal-100 text-teal-700", hover: "hover:border-teal-200 hover:bg-teal-50/40", path: "M3 6h18v14H3V6ZM7 3h10M10 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM5 17a3 3 0 0 1 6 0M14 10h4M14 14h4" },
  { id: "qr", label: "个人二维码", description: "展示、分享与扫描二维码", tone: "bg-lime-100 text-lime-800", hover: "hover:border-lime-200 hover:bg-lime-50/40", path: "M3 3h6v6H3ZM15 3h6v6h-6ZM3 15h6v6H3ZM15 15h3v3h3M15 21h3M21 15v3" },
  { id: "tools", label: "小工具", description: "常用计分与辅助工具", tone: "bg-blue-100 text-blue-700", hover: "hover:border-blue-200 hover:bg-blue-50/40", path: "M4 8h16v12H4ZM8 8V4h8v4M4 13h16M10 11v4h4v-4" },
  { id: "games", label: "游戏大厅", description: "坦克大战与不服再战", tone: "bg-fuchsia-100 text-fuchsia-700", hover: "hover:border-fuchsia-200 hover:bg-fuchsia-50/40", path: "M7 7h10l4 12-4 1-4-4h-2l-4 4-4-1L7 7ZM8 10v5M5.5 12.5h5M16 11h.1M18 14h.1" },
  { id: "more", label: "工具与设置", description: "语言、隐私与账号", tone: "bg-slate-100 text-slate-700", hover: "hover:border-slate-300 hover:bg-slate-50", path: "M4 7h4M12 7h8M4 17h8M16 17h4M12 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM16 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" },
] as const;
function AccountIcon({ path, className = "h-5 w-5" }: { path: string; className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

export default function ServiceAccount({ active, identity, refreshIdentity, onLocaleChange, onSignedOut }: ServicePanelProps & { onLocaleChange?: (locale: string) => void; onSignedOut?: () => void }) {
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
  const activeTab = tabs.find(item => item.id === tab);
  const displayName = identity.authenticated ? identity.profile.nickname || identity.profile.name || identity.accountId : "游客身份";
  const avatarUrl = identity.authenticated ? identity.profile.avatarUrl : profile.avatarUrl;
  const activeMembershipCount = identity.memberships.filter(member => member.status === "active").length;
  return <div className="space-y-4" data-service-account>
    {tab === "home" ? <>
      <section aria-label="身份信息" className="relative isolate overflow-hidden rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-12 -top-20 -z-10 h-64 w-64 rounded-full border-[32px] border-violet-100/50" aria-hidden="true" />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white bg-white/90 text-violet-700 shadow-sm sm:h-20 sm:w-20" aria-hidden="true">
              <AccountIcon path={tabs[0].path} className="h-8 w-8" />
              {avatarUrl ? <img src={avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} /> : null}
            </div>
            <div className="min-w-0"><span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-white bg-white/80 px-2.5 py-1 text-[11px] font-medium text-violet-800"><span className="h-1.5 w-1.5 rounded-full bg-violet-500" aria-hidden="true" />{identity.authenticated ? "已登录" : "游客模式"}</span>
              <h3 data-no-translate={identity.authenticated ? "1" : undefined} className="break-words text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{displayName}</h3>
              {identity.authenticated ? <p className="mt-1.5 text-xs text-slate-600">账号 <span data-no-translate="1">{identity.accountId}</span></p> : <p className="mt-1.5 text-xs leading-5 text-slate-600">临时资料和记录保存在本设备</p>}
            </div>
          </div>
          {!identity.authenticated ? <a className="inline-flex min-h-11 shrink-0 items-center justify-center gap-3 self-start rounded-xl bg-violet-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700 sm:self-center" href={buildServiceLoginHref(window.location.href)} target="_top">用户登录 / 注册<span aria-hidden="true">→</span></a>
            : <button type="button" className={serviceButton + " shrink-0 self-start !border-violet-200 !text-violet-800 sm:self-center"} onClick={() => select("profile")}>编辑资料<span className="ml-3" aria-hidden="true">→</span></button>}
        </div>
        <div className="mt-5 border-t border-violet-100/80 pt-4">
          {identity.authenticated ? <p className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600"><span>收藏商户 <strong className="ml-1 text-sm font-semibold tabular-nums text-violet-900" data-no-translate="1">{manageable.length}</strong></span><span>有效会员卡 <strong className="ml-1 text-sm font-semibold tabular-nums text-violet-900" data-no-translate="1">{activeMembershipCount}</strong></span></p>
            : <p className="text-xs leading-5 text-slate-600">登录后，跨设备查看账号资料与记录。</p>}
        </div>
      </section>
      <section aria-labelledby="account-features-title" className="pt-1">
        <div className="mb-3 flex items-center justify-between px-1"><h3 id="account-features-title" className="text-sm font-semibold text-slate-800">常用功能</h3><span className="text-xs text-slate-500">资料与权益，集中管理</span></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{tabs.map(item => <button key={item.id} type="button" data-account-section={item.id} aria-label={`${item.label} →`}
          className={`group flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700 sm:p-5 ${item.hover}`} onClick={() => select(item.id)}>
          <span className="mb-4 flex w-full items-center justify-between gap-2"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${item.tone}`}><AccountIcon path={item.path} /></span><span className="text-slate-400 transition-transform group-hover:translate-x-1" aria-hidden="true">↗</span></span>
          <span className="font-semibold text-slate-900">{item.label}</span><span className="mt-1.5 text-xs leading-5 text-slate-500">{item.description}</span>
        </button>)}</div>
      </section>
      {identity.authenticated ? <SessionActions onRefresh={refreshIdentity} onSignedOut={() => { if (onSignedOut) onSignedOut(); else void refreshIdentity(); }} /> : null}
    </> : <div className={serviceCard + " flex flex-wrap items-center justify-between gap-3 !rounded-2xl"}><div className="flex min-w-0 items-center gap-3"><button type="button" className={serviceButton + " !px-3 !text-xs"} onClick={() => select("home")}>← 返回我的</button>{activeTab ? <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${activeTab.tone}`}><AccountIcon path={activeTab.path} /></span> : null}<h3 className="font-semibold">{activeTab?.label}</h3></div><button type="button" className={serviceButton + " !px-3 !text-xs"} disabled={busy} onClick={() => { setLoadedFor(""); setRefresh(value => value + 1); void refreshIdentity(); }}>刷新</button></div>}
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-emerald-700">{message}</p> : null}
    {tab === "profile" ? <ServiceProfileForm profile={profile} cards={cards} authenticated={identity.authenticated} accountId={identity.accountId} busy={busy} loading={identity.authenticated && loadedFor !== identity.accountId}
      onChange={(key, value) => setProfile(current => ({ ...current, [key]: value }))} onSave={() => void saveProfile()} /> : null}
    {tab === "favorites" ? <div className="space-y-3">
      {!manageable.length ? <p className={serviceCard + " text-sm text-slate-500"}>尚未收藏商户。</p> : null}
      {manageable.map(site => <div key={site.id} className={serviceCard}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><a href={site.url} target="_top" className="break-words font-semibold underline">{site.name || "商户网站"}</a><p className="mt-1 break-words text-xs text-slate-500">{site.subtitle}</p></div>
        <button type="button" disabled={busy} className={serviceButton + " shrink-0"} onClick={() => setPendingCancel(site)}>取消收藏</button></div>
        {pendingCancel?.id === site.id ? <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm"><p>取消收藏后将退出该商户会员。积分、订单和历史记录仍保留。</p><div className="mt-3 flex gap-2"><button type="button" disabled={busy} className={serviceButton} onClick={() => void cancel(site)}>确认取消并退会</button><button type="button" disabled={busy} className={serviceButton} onClick={() => setPendingCancel(null)}>保留</button></div></div> : null}
      </div>)}
    </div> : null}
    {tab === "memberships" ? <div className="grid gap-3 sm:grid-cols-2">{identity.memberships.map(member => <div key={member.id} className={serviceCard}>
      <div className="rounded-xl bg-gradient-to-br from-slate-900 to-sky-900 p-4 text-white"><div className="flex justify-between gap-3"><h4 className="font-semibold" data-no-translate="1">{member.siteName}</h4><span className="text-xs text-sky-100">{member.status === "active" ? "有效会员" : "已退会"}</span></div><p className="mt-4 break-all text-sm">会员卡号：<span data-no-translate="1" className="font-mono">{member.memberNo}</span></p></div>
      <p className="mt-3 text-xs text-slate-500">加入时间：<span data-no-translate="1">{member.joinedAt.replace("T", " ").slice(0, 19)}</span></p>{member.leftAt ? <p className="mt-2 text-xs text-slate-500">退会时间：<span data-no-translate="1">{member.leftAt.replace("T", " ").slice(0, 19)}</span></p> : null}
      <p className="mt-3 break-all text-xs text-slate-600">会员二维码内容：<span data-no-translate="1">{member.qrValue || member.memberNo}</span></p>
      {member.status === "active" ? <details className="mt-3"><summary className="cursor-pointer text-sm">显示会员二维码</summary><Qr value={member.qrValue || member.memberNo} /></details> : null}
      <div className="mt-3 flex flex-wrap gap-2"><a className={serviceButton} href={`/site/${encodeURIComponent(member.siteId)}`} target="_top">商户首页</a><button className={serviceButton} type="button" onClick={() => select("favorites")}>到收藏管理</button></div></div>)}{!identity.memberships.length ? <p className={serviceCard}>暂无会员卡。</p> : null}</div> : null}
    {tab === "coupons" ? <div className="grid gap-3 sm:grid-cols-2">{coupons.map(coupon => <div key={coupon.id} className={serviceCard}><h4 className="font-semibold">{coupon.couponTitle}</h4><p className="mt-1 text-sm"><span data-no-translate="1">{coupon.siteName}</span> · {coupon.discountLabel}</p><p className="mt-2 text-xs text-slate-500">{coupon.couponDescription}</p><p className="mt-2 break-all text-sm">{coupon.settlementType === "barcode" ? "核销条形码" : "核销二维码"}：<span data-no-translate="1">{coupon.settlementCode}</span></p>{coupon.settlementType !== "barcode" ? <details className="mt-2"><summary className="cursor-pointer text-sm">显示核销码</summary><Qr value={coupon.settlementCode} /></details> : null}<p className="mt-2 text-xs text-slate-500">领取时间：<span data-no-translate="1">{coupon.claimedAt.replace("T", " ").slice(0, 19)}</span></p><p className="mt-2 text-xs text-slate-500">有效期：<span data-no-translate="1">{coupon.validUntil || "长期有效"}</span></p><a className={serviceButton + " mt-3 inline-flex"} target="_top" href={`/coupon/claim/${encodeURIComponent(coupon.claimEventId)}?siteId=${encodeURIComponent(coupon.siteId)}&couponId=${encodeURIComponent(coupon.couponId)}`}>查看核销码</a></div>)}{!coupons.length ? <p className={serviceCard}>暂无已领取优惠券。</p> : null}</div> : null}
    {tab === "cards" && identity.authenticated && loadedFor === identity.accountId ? <CardManager merchantId={identity.accountId} siteBaseDomain={window.location.host}
      folderViewMode="page" cards={cards} targetUrlOverride={`https://faolla.com/u/${identity.accountId}`} profile={{ merchantName: profile.displayName, contactName: profile.displayName, contactPhone: profile.phone, contactEmail: profile.email, contactAddress: profile.address, location: { country: profile.country, province: profile.province, city: profile.city } }}
      cardLimit={permissions.businessCardLimit} allowLinkMode={permissions.allowBusinessCardLinkMode} allowIntroVideo={permissions.allowBusinessCardIntroVideo}
      backgroundImageLimitKb={permissions.businessCardBackgroundImageLimitKb} contactPageImageLimitKb={permissions.businessCardContactImageLimitKb} exportImageLimitKb={permissions.businessCardExportImageLimitKb} introVideoLimitMb={permissions.businessCardIntroVideoLimitMb}
      onCardsChange={async next => { try { const result = await serviceRequest<ProfilePayload>("/api/personal-profile", { method: "POST", body: JSON.stringify({ businessCards: next }) }); setCards(result.businessCards); } catch (error) { setError(error instanceof Error ? error.message : "名片保存失败。"); throw error; } }} /> : null}
    {tab === "cards" && !identity.authenticated ? <p className={serviceCard}>请登录后使用名片夹。</p> : null}
    {tab === "qr" ? <PersonalQr active={active} identity={identity} onBack={() => select("home")} /> : null}
    {tab === "tools" ? <section className={serviceCard}><h4 className="mb-3 text-sm font-semibold">常用小工具</h4><a className={serviceButton + " inline-flex"} href="/me/tools/shuangkoujifen" target="_blank" rel="noreferrer">双扣计分</a></section> : null}
    {tab === "games" ? <section className={serviceCard}><h4 className="mb-3 text-sm font-semibold">游戏大厅</h4><div className="flex flex-wrap gap-3"><a className={serviceButton} href="/me/games/tank-battle" target="_blank" rel="noreferrer">坦克大战</a><a className={serviceButton} href="/me/games/bufuzai" target="_blank" rel="noreferrer">不服再战</a></div></section> : null}
    {tab === "more" ? <><Settings onLocaleChange={onLocaleChange} />{identity.authenticated ? <SessionActions onRefresh={refreshIdentity} onSignedOut={() => { if (onSignedOut) onSignedOut(); else void refreshIdentity(); }} /> : null}</> : null}
  </div>;
}
