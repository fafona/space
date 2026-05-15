"use client";

import { useEffect, useMemo, useState } from "react";
import type { CouponProps } from "@/data/homeBlocks";
import {
  getMerchantCouponDiscountLabel,
  normalizeMerchantCouponRecords,
  type MerchantCouponRecord,
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
              const remaining = coupon.totalQuantity > 0 ? Math.max(0, coupon.totalQuantity - coupon.usedCount) : null;
              const expiresLabel = formatDate(coupon.expiresAt);
              const copied = copiedCode === coupon.code;
              return (
                <article
                  key={coupon.id}
                  className={`overflow-hidden rounded-lg border border-slate-200 bg-white/90 shadow-sm ${
                    isList ? "grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" : "p-4"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">
                      {getMerchantCouponDiscountLabel(coupon, runtimePricePrefix)}
                    </div>
                    <h3 className="mt-2 truncate text-base font-bold text-slate-950">{coupon.title}</h3>
                    {coupon.description ? <p className="mt-1 line-clamp-2 text-sm text-slate-500">{coupon.description}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                      {coupon.minimumAmount > 0 ? <span>门槛 {runtimePricePrefix}{coupon.minimumAmount.toFixed(2)}</span> : null}
                      {couponShowRemaining && remaining !== null ? <span>剩余 {remaining}</span> : null}
                      {couponShowExpiresAt && expiresLabel ? <span>至 {expiresLabel}</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border px-4 text-sm font-semibold transition ${
                      copied
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-950 bg-slate-950 text-white hover:bg-slate-800"
                    } ${isList ? "sm:mt-0 sm:w-auto" : ""}`}
                    onClick={() => void copyCouponCode(coupon.code)}
                    disabled={!interactive || couponActionMode === "none"}
                  >
                    {couponActionMode === "none" ? coupon.code : copied ? "已复制" : couponActionMode === "order" ? "立即使用" : "复制优惠码"}
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
