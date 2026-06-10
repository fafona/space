"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CouponProps } from "@/data/homeBlocks";
import {
  getMerchantCouponDisplayDescription,
  getMerchantCouponDisplayBoxColor,
  getMerchantCouponDisplayBoxStyle,
  getMerchantCouponDisplayButtonText,
  getMerchantCouponDisplayFieldOrder,
  getMerchantCouponDisplayMetaText,
  getMerchantCouponDisplayTitle,
  getMerchantCouponRemainingCount,
  getMerchantCouponDiscountLabel,
  isMerchantCouponDisplayFieldHidden,
  merchantCouponRequiresClaimCode,
  merchantCouponRequiresPersonalClaim,
  normalizeMerchantCouponRecords,
  type MerchantCouponDisplayBoxStyle,
  type MerchantCouponDisplayField,
  type MerchantCouponRecord,
  type MerchantCouponUsageScenario,
} from "@/lib/merchantCoupons";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { resolveMobileFitCardClass, resolveMobileFitSectionClass } from "./mobileFrame";

type CouponBlockRuntimeProps = CouponProps & {
  runtimeSiteId?: string;
  runtimePricePrefix?: string;
  previewCoupons?: MerchantCouponRecord[];
  interactive?: boolean;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const COUPON_USAGE_SCENARIO_LABELS: Record<MerchantCouponUsageScenario, string> = {
  order_cart: "订单",
  checkout_qr: "二维码",
  checkout_barcode: "条码",
  points_redemption: "积分兑换",
};

function formatCouponUsageScenarios(coupon: MerchantCouponRecord) {
  return coupon.usageScenarios.map((item) => COUPON_USAGE_SCENARIO_LABELS[item]).filter(Boolean).join(" / ");
}

function buildCouponTextStyle(
  coupon: MerchantCouponRecord,
  role: MerchantCouponDisplayField,
): CSSProperties {
  const style: CSSProperties = {};
  if (coupon.contentFontFamily) style.fontFamily = coupon.contentFontFamily;
  const color =
    role === "discount"
      ? coupon.discountTextColor
      : role === "title"
        ? coupon.titleTextColor
        : role === "description"
          ? coupon.descriptionTextColor
          : role === "button"
            ? coupon.buttonTextColor
            : coupon.metaTextColor;
  const fontSize =
    role === "discount"
      ? coupon.discountFontSize
      : role === "title"
        ? coupon.titleFontSize
        : role === "description"
          ? coupon.descriptionFontSize
          : role === "button"
            ? coupon.buttonFontSize
            : coupon.metaFontSize;
  if (color) style.color = color;
  if (fontSize > 0) style.fontSize = `${fontSize}px`;
  return style;
}

function colorWithAlpha(color: string, alpha: number) {
  const raw = color.trim();
  const match = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) return "";
  const hex =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((item) => `${item}${item}`)
          .join("")
      : match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function buildCouponBoxStyle(boxColor: string, boxStyle: MerchantCouponDisplayBoxStyle): CSSProperties {
  const resolvedColor = boxColor || "#020617";
  if (boxStyle === "solid") {
    return {
      backgroundColor: resolvedColor,
      borderColor: resolvedColor,
    };
  }
  if (boxStyle === "outline") {
    return {
      borderColor: resolvedColor,
    };
  }
  if (boxStyle === "soft") {
    return {
      backgroundColor: colorWithAlpha(resolvedColor, 0.12),
      borderColor: colorWithAlpha(resolvedColor, 0.22) || resolvedColor,
    };
  }
  return {};
}

function buildCouponDisplayItems(
  coupon: MerchantCouponRecord,
  input: {
    pricePrefix: string;
    usageScenarioLabel: string;
    remaining: number | null;
    expiresLabel: string;
    showRemaining: boolean;
    showExpiresAt: boolean;
  },
) {
  const displayTitle = getMerchantCouponDisplayTitle(coupon);
  const displayDescription = getMerchantCouponDisplayDescription(coupon);
  const displayMetaText = getMerchantCouponDisplayMetaText(coupon);
  const metaItems = [
    coupon.discountType === "points_voucher" && coupon.discountValue > 0 ? `抵扣 ${Math.round(coupon.discountValue)} 积分` : "",
    coupon.minimumAmount > 0 ? `门槛 ${input.pricePrefix}${coupon.minimumAmount.toFixed(2)}` : "",
    input.usageScenarioLabel,
    input.showRemaining && input.remaining !== null ? `剩余 ${input.remaining}` : "",
    input.showExpiresAt && input.expiresLabel ? `至 ${input.expiresLabel}` : "",
  ].filter(Boolean);
  const defaultMetaText = metaItems.join("  ");
  const itemText: Record<MerchantCouponDisplayField, string> = {
    discount: getMerchantCouponDiscountLabel(coupon, input.pricePrefix),
    title: displayTitle,
    description: displayDescription,
    meta: displayMetaText || defaultMetaText,
    button: getMerchantCouponDisplayButtonText(coupon),
  };
  return getMerchantCouponDisplayFieldOrder(coupon)
    .filter((field) => !isMerchantCouponDisplayFieldHidden(coupon, field))
    .map((field) => ({
      field,
      text: itemText[field],
      boxStyle: getMerchantCouponDisplayBoxStyle(coupon, field),
      boxColor: getMerchantCouponDisplayBoxColor(coupon, field),
    }))
    .filter((item) => item.text.trim());
}

function buildClaimStorageKey(siteId: string) {
  return `faolla:coupon-claims:${siteId || "preview"}`;
}

function readClaimCounts(siteId: string) {
  if (typeof window === "undefined") return {} as Record<string, number>;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(buildClaimStorageKey(siteId)) || "{}") as Record<string, unknown>;
    const entries: Array<[string, number]> = Object.entries(parsed)
      .map(([key, value]): [string, number] => [
        key,
        typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0,
      ])
      .filter(([, value]) => value > 0);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function writeClaimCounts(siteId: string, counts: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(buildClaimStorageKey(siteId), JSON.stringify(counts));
  } catch {
    // Private browsing or storage restrictions should not break coupon display.
  }
}

export default function CouponBlock({
  heading = "优惠券",
  text = "领取后可在下单时使用。",
  couponDisplayMode = "cards",
  couponActionMode = "copy",
  couponShowRemaining = true,
  couponShowExpiresAt = true,
  couponSelectedIds = [],
  couponEmptyText = "暂无可领取优惠券",
  runtimeSiteId = "",
  runtimePricePrefix = "",
  previewCoupons,
  interactive = true,
  ...backgroundProps
}: CouponBlockRuntimeProps) {
  const [loadedCoupons, setLoadedCoupons] = useState<MerchantCouponRecord[]>([]);
  const [copiedCode, setCopiedCode] = useState("");
  const [claimedCounts, setClaimedCounts] = useState<Record<string, number>>({});
  const [claimingCouponId, setClaimingCouponId] = useState("");
  const [claimErrorCouponId, setClaimErrorCouponId] = useState("");
  const [claimCodeByCouponId, setClaimCodeByCouponId] = useState<Record<string, string>>({});
  const [shareClaimCouponId, setShareClaimCouponId] = useState("");
  const autoClaimedCouponIdRef = useRef("");
  const claimCouponRef = useRef<(coupon: MerchantCouponRecord) => Promise<void>>(async () => undefined);
  const effectiveCouponActionMode = shareClaimCouponId ? "claim" : couponActionMode;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const couponId = normalizeText(params.get("claimCoupon") || params.get("couponId"));
    const claimCode = normalizeText(params.get("claimCode"));
    setShareClaimCouponId(couponId);
    if (couponId && claimCode) {
      setClaimCodeByCouponId((current) => (current[couponId] === claimCode ? current : { ...current, [couponId]: claimCode }));
    }
  }, []);

  useEffect(() => {
    setClaimedCounts(readClaimCounts(runtimeSiteId));
    setClaimErrorCouponId("");
  }, [runtimeSiteId]);

  useEffect(() => {
    if (previewCoupons || !runtimeSiteId) return;
    let cancelled = false;
    fetch(`/api/coupons?scope=public&siteId=${encodeURIComponent(runtimeSiteId)}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (cancelled) return;
        setLoadedCoupons(normalizeMerchantCouponRecords(json?.coupons));
      })
      .catch(() => {
        if (!cancelled) setLoadedCoupons([]);
      });
    return () => {
      cancelled = true;
    };
  }, [previewCoupons, runtimeSiteId]);

  const coupons = useMemo(() => {
    const source = normalizeMerchantCouponRecords(previewCoupons ?? loadedCoupons);
    const selected = Array.isArray(couponSelectedIds) ? couponSelectedIds.map((item) => normalizeText(item)).filter(Boolean) : [];
    if (selected.length === 0) return source;
    const selectedSet = new Set(selected);
    return source.filter((coupon) => selectedSet.has(coupon.id));
  }, [couponSelectedIds, loadedCoupons, previewCoupons]);

  const backgroundStyle = getBackgroundStyle({
    imageUrl: backgroundProps.bgImageUrl,
    fillMode: backgroundProps.bgFillMode,
    position: backgroundProps.bgPosition,
    color: backgroundProps.bgColor,
    opacity: backgroundProps.bgOpacity,
    imageOpacity: backgroundProps.bgImageOpacity,
    colorOpacity: backgroundProps.bgColorOpacity,
  });
  const borderClass = getBlockBorderClass(backgroundProps.blockBorderStyle);
  const borderStyle = getBlockBorderInlineStyle(backgroundProps.blockBorderStyle, backgroundProps.blockBorderColor);
  const sizeStyle = {
    width: backgroundProps.blockWidth ? `${Math.max(0, Math.round(backgroundProps.blockWidth))}px` : undefined,
    height: backgroundProps.blockHeight ? `${Math.max(0, Math.round(backgroundProps.blockHeight))}px` : undefined,
  };
  const offsetStyle = {
    transform:
      backgroundProps.blockOffsetX || backgroundProps.blockOffsetY
        ? `translate(${Math.round(backgroundProps.blockOffsetX ?? 0)}px, ${Math.round(backgroundProps.blockOffsetY ?? 0)}px)`
        : undefined,
  };

  const copyCouponCode = async (code: string) => {
    if (!interactive || effectiveCouponActionMode !== "copy") return;
    try {
      await navigator.clipboard?.writeText(code);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode((current) => (current === code ? "" : current)), 1200);
    } catch {
      setCopiedCode("");
    }
  };

  const markCouponClaimed = (couponId: string, limit: number) => {
    setClaimedCounts((current) => {
      const nextCount = Math.min(Math.max(1, limit || 1), (current[couponId] ?? 0) + 1);
      const next = { ...current, [couponId]: nextCount };
      writeClaimCounts(runtimeSiteId, next);
      return next;
    });
  };

  const claimCoupon = async (coupon: MerchantCouponRecord) => {
    if (!interactive || effectiveCouponActionMode !== "claim") return;
    setClaimErrorCouponId("");
    const claimCode = (claimCodeByCouponId[coupon.id] ?? "").trim();
    if (merchantCouponRequiresClaimCode(coupon) && !claimCode) {
      setClaimErrorCouponId(coupon.id);
      return;
    }
    const localClaimCount = claimedCounts[coupon.id] ?? 0;
    const perCustomerLimit = Math.max(1, coupon.perCustomerLimit || 1);
    if (localClaimCount >= perCustomerLimit) {
      setCopiedCode(coupon.code);
      try {
        await navigator.clipboard?.writeText(coupon.code);
      } catch {
        // The claimed state is still useful even when clipboard access is blocked.
      }
      window.setTimeout(() => setCopiedCode((current) => (current === coupon.code ? "" : current)), 1200);
      return;
    }
    if (!runtimeSiteId || previewCoupons) {
      markCouponClaimed(coupon.id, perCustomerLimit);
      setCopiedCode(coupon.code);
      window.setTimeout(() => setCopiedCode((current) => (current === coupon.code ? "" : current)), 1200);
      return;
    }
    setClaimingCouponId(coupon.id);
    try {
      const response = await fetch("/api/coupons/claim", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: runtimeSiteId,
          couponId: coupon.id,
          claimCode,
          siteName: heading,
          pageUrl: typeof window === "undefined" ? "" : window.location.href,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        coupon?: unknown;
        claimResultUrl?: unknown;
        savedToAccount?: unknown;
      } | null;
      if (!response.ok) throw new Error("claim_failed");
      const [claimedCoupon] = normalizeMerchantCouponRecords(payload?.coupon ? [payload.coupon] : []);
      if (claimedCoupon) {
        setLoadedCoupons((current) => current.map((item) => (item.id === claimedCoupon.id ? claimedCoupon : item)));
      }
      markCouponClaimed(coupon.id, perCustomerLimit);
      if (typeof window !== "undefined" && payload?.savedToAccount !== true && typeof payload?.claimResultUrl === "string" && payload.claimResultUrl) {
        window.location.assign(payload.claimResultUrl);
        return;
      }
      setCopiedCode(coupon.code);
      try {
        await navigator.clipboard?.writeText(coupon.code);
      } catch {
        // Claiming succeeds even if the browser does not allow copying.
      }
      window.setTimeout(() => setCopiedCode((current) => (current === coupon.code ? "" : current)), 1200);
    } catch {
      if (typeof window !== "undefined" && merchantCouponRequiresPersonalClaim(coupon)) {
        const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`);
        window.location.assign(`/login?accountType=personal&redirect=${redirect}`);
        return;
      }
      setClaimErrorCouponId(coupon.id);
    } finally {
      setClaimingCouponId("");
    }
  };

  useEffect(() => {
    claimCouponRef.current = claimCoupon;
  });

  useEffect(() => {
    if (!interactive || previewCoupons || !shareClaimCouponId || autoClaimedCouponIdRef.current === shareClaimCouponId) return;
    const targetCoupon = coupons.find((coupon) => coupon.id === shareClaimCouponId);
    if (!targetCoupon) return;
    autoClaimedCouponIdRef.current = shareClaimCouponId;
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        document.getElementById(`coupon-${shareClaimCouponId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
    void claimCouponRef.current(targetCoupon);
  }, [coupons, interactive, previewCoupons, shareClaimCouponId]);

  const isList = couponDisplayMode === "list";

  return (
    <section
      className={resolveMobileFitSectionClass("max-w-6xl mx-auto px-6 py-6", backgroundProps.mobileFitScreenWidth === true)}
      style={offsetStyle}
    >
      <div
        className={resolveMobileFitCardClass(`relative overflow-hidden rounded-xl bg-white p-6 shadow-sm ${borderClass}`, backgroundProps.mobileFitScreenWidth === true)}
        style={{ ...backgroundStyle, ...sizeStyle, ...borderStyle }}
      >
        <div className="relative z-10">
          {heading ? <h2 className="text-xl font-bold text-slate-950">{heading}</h2> : null}
          {text ? <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p> : null}
          <div className={isList ? "mt-5 grid gap-3" : "mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
            {coupons.map((coupon) => {
              const remaining = getMerchantCouponRemainingCount(coupon);
              const expiresLabel = formatDate(coupon.expiresAt);
              const copied = copiedCode === coupon.code;
              const claimed = (claimedCounts[coupon.id] ?? 0) > 0;
              const exhausted = remaining === 0;
              const claiming = claimingCouponId === coupon.id;
              const claimFailed = claimErrorCouponId === coupon.id;
              const requiresClaimCode = merchantCouponRequiresClaimCode(coupon);
              const usageScenarioLabel = formatCouponUsageScenarios(coupon);
              const displayItems = buildCouponDisplayItems(coupon, {
                pricePrefix: runtimePricePrefix,
                usageScenarioLabel,
                remaining,
                expiresLabel,
                showRemaining: couponShowRemaining,
                showExpiresAt: couponShowExpiresAt,
              });
              const couponBackgroundStyle = getBackgroundStyle({
                imageUrl: coupon.backgroundImageUrl,
                fillMode: "cover",
                position: "center",
                imageOpacity: coupon.backgroundImageOpacity,
              });
              const actionLabel =
                effectiveCouponActionMode === "none"
                  ? coupon.code
                  : effectiveCouponActionMode === "claim"
                    ? exhausted
                      ? "已领完"
                      : claiming
                        ? "领取中..."
                        : claimFailed
                          ? "重试领取"
                          : copied || claimed
                            ? "已领取"
                            : "立即领取"
                    : copied
                      ? "已复制"
                      : effectiveCouponActionMode === "order"
                        ? "立即使用"
                        : "复制优惠码";
              return (
                <article
                  id={`coupon-${coupon.id}`}
                  key={coupon.id}
                  className={`overflow-hidden rounded-lg border border-slate-200 bg-white/90 shadow-sm ${
                    isList ? "grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" : "p-4"
                  }`}
                  style={couponBackgroundStyle}
                >
                  <div className="min-w-0">
                    {displayItems.map((item, index) => {
                      const marginClass = index === 0 ? "" : item.field === "meta" ? "mt-3" : "mt-2";
                      const frameClass =
                        item.boxStyle === "none"
                          ? ""
                          : item.field === "button"
                            ? "border px-4 py-2"
                            : "inline-block max-w-full rounded-md border px-2 py-1";
                      const framedStyle = {
                        ...buildCouponTextStyle(coupon, item.field),
                        ...buildCouponBoxStyle(item.boxColor, item.boxStyle),
                      };
                      if (item.field === "button") {
                        const buttonText = copied || claimed || exhausted || claiming || claimFailed ? actionLabel : item.text;
                        return (
                          <button
                            key={item.field}
                            type="button"
                            className={`${marginClass} inline-flex h-10 w-full items-center justify-center rounded-lg text-sm font-semibold transition disabled:opacity-50 ${frameClass}`}
                            style={framedStyle}
                            onClick={() => {
                              if (effectiveCouponActionMode === "claim") {
                                void claimCoupon(coupon);
                              } else {
                                void copyCouponCode(coupon.code);
                              }
                            }}
                            disabled={!interactive || effectiveCouponActionMode === "none" || exhausted || claiming}
                          >
                            {buttonText}
                          </button>
                        );
                      }
                      if (item.field === "title") {
                        return (
                          <h3 key={item.field} className={`${marginClass} truncate text-base font-bold text-slate-950 ${frameClass}`} style={framedStyle}>
                            {item.text}
                          </h3>
                        );
                      }
                      if (item.field === "description") {
                        return (
                          <p key={item.field} className={`${marginClass} line-clamp-2 text-sm text-slate-500 ${frameClass}`} style={framedStyle}>
                            {item.text}
                          </p>
                        );
                      }
                      if (item.field === "meta") {
                        return (
                          <div key={item.field} className={`${marginClass} text-xs text-slate-500 ${frameClass}`} style={framedStyle}>
                            {item.text}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={item.field}
                          className={`${marginClass} text-xs font-semibold uppercase tracking-[0.18em] text-rose-500 ${frameClass}`}
                          style={framedStyle}
                        >
                          {item.text}
                        </div>
                      );
                    })}
                  </div>
                  {displayItems.some((item) => item.field === "button") ? null : (
                    <button
                      type="button"
                      className={`mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border px-4 text-sm font-semibold transition ${
                        copied || (effectiveCouponActionMode === "claim" && claimed)
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : exhausted
                            ? "border-slate-200 bg-slate-100 text-slate-400"
                            : "border-slate-950 bg-slate-950 text-white hover:bg-slate-800"
                      } ${isList ? "sm:mt-0 sm:w-auto" : ""}`}
                      onClick={() => {
                        if (effectiveCouponActionMode === "claim") {
                          void claimCoupon(coupon);
                        } else {
                          void copyCouponCode(coupon.code);
                        }
                      }}
                      disabled={!interactive || effectiveCouponActionMode === "none" || exhausted || claiming}
                    >
                      {actionLabel}
                    </button>
                  )}
                  {effectiveCouponActionMode === "claim" && requiresClaimCode ? (
                    <input
                      className="mt-3 w-full rounded-lg border border-slate-300 bg-white/90 px-3 py-2 text-sm outline-none focus:border-slate-500"
                      value={claimCodeByCouponId[coupon.id] ?? ""}
                      onChange={(event) => setClaimCodeByCouponId((current) => ({ ...current, [coupon.id]: event.target.value }))}
                      placeholder="输入指定优惠码"
                    />
                  ) : null}
                  {effectiveCouponActionMode === "claim" && claimFailed ? (
                    <div className="mt-2 text-xs text-rose-600">暂不符合领取条件或优惠码不正确</div>
                  ) : null}
                </article>
              );
            })}
          </div>
          {coupons.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-center text-sm text-slate-500">
              {couponEmptyText}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
