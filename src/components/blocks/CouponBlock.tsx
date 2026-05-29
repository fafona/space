"use client";

import { useEffect, useMemo, useState } from "react";
import type { CouponProps } from "@/data/homeBlocks";
import {
  getMerchantCouponRemainingCount,
  getMerchantCouponDiscountLabel,
  normalizeMerchantCouponRecords,
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
};

function formatCouponUsageScenarios(coupon: MerchantCouponRecord) {
  return coupon.usageScenarios.map((item) => COUPON_USAGE_SCENARIO_LABELS[item]).filter(Boolean).join(" / ");
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
    if (!interactive || couponActionMode !== "copy") return;
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
    if (!interactive || couponActionMode !== "claim") return;
    setClaimErrorCouponId("");
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
        body: JSON.stringify({ siteId: runtimeSiteId, couponId: coupon.id }),
      });
      const payload = (await response.json().catch(() => null)) as { coupon?: unknown } | null;
      if (!response.ok) throw new Error("claim_failed");
      const [claimedCoupon] = normalizeMerchantCouponRecords(payload?.coupon ? [payload.coupon] : []);
      if (claimedCoupon) {
        setLoadedCoupons((current) => current.map((item) => (item.id === claimedCoupon.id ? claimedCoupon : item)));
      }
      markCouponClaimed(coupon.id, perCustomerLimit);
      setCopiedCode(coupon.code);
      try {
        await navigator.clipboard?.writeText(coupon.code);
      } catch {
        // Claiming succeeds even if the browser does not allow copying.
      }
      window.setTimeout(() => setCopiedCode((current) => (current === coupon.code ? "" : current)), 1200);
    } catch {
      setClaimErrorCouponId(coupon.id);
    } finally {
      setClaimingCouponId("");
    }
  };

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
              const usageScenarioLabel = formatCouponUsageScenarios(coupon);
              const couponBackgroundStyle = getBackgroundStyle({
                imageUrl: coupon.backgroundImageUrl,
                fillMode: "cover",
                position: "center",
                imageOpacity: coupon.backgroundImageOpacity,
              });
              const actionLabel =
                couponActionMode === "none"
                  ? coupon.code
                  : couponActionMode === "claim"
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
                      : couponActionMode === "order"
                        ? "立即使用"
                        : "复制优惠码";
              return (
                <article
                  key={coupon.id}
                  className={`overflow-hidden rounded-lg border border-slate-200 bg-white/90 shadow-sm ${
                    isList ? "grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" : "p-4"
                  }`}
                  style={couponBackgroundStyle}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">
                      {getMerchantCouponDiscountLabel(coupon, runtimePricePrefix)}
                    </div>
                    <h3 className="mt-2 truncate text-base font-bold text-slate-950">{coupon.title}</h3>
                    {coupon.description ? <p className="mt-1 line-clamp-2 text-sm text-slate-500">{coupon.description}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                      {coupon.minimumAmount > 0 ? <span>门槛 {runtimePricePrefix}{coupon.minimumAmount.toFixed(2)}</span> : null}
                      {usageScenarioLabel ? <span>{usageScenarioLabel}</span> : null}
                      {couponShowRemaining && remaining !== null ? <span>剩余 {remaining}</span> : null}
                      {couponShowExpiresAt && expiresLabel ? <span>至 {expiresLabel}</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border px-4 text-sm font-semibold transition ${
                      copied || (couponActionMode === "claim" && claimed)
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : exhausted
                          ? "border-slate-200 bg-slate-100 text-slate-400"
                        : "border-slate-950 bg-slate-950 text-white hover:bg-slate-800"
                    } ${isList ? "sm:mt-0 sm:w-auto" : ""}`}
                    onClick={() => {
                      if (couponActionMode === "claim") {
                        void claimCoupon(coupon);
                      } else {
                        void copyCouponCode(coupon.code);
                      }
                    }}
                    disabled={!interactive || couponActionMode === "none" || exhausted || claiming}
                  >
                    {actionLabel}
                  </button>
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
