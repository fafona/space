import QRCode from "qrcode";
import { notFound } from "next/navigation";
import CouponClaimResultClient from "./CouponClaimResultClient";
import {
  getMerchantCouponDiscountLabel,
  getMerchantCouponDisplayDescription,
  getMerchantCouponDisplayTitle,
  type MerchantCouponClaimEvent,
} from "@/lib/merchantCoupons";
import { listMerchantCoupons } from "@/lib/merchantCoupons.server";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "长期有效";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "长期有效";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildBarcodeSvg(value: string) {
  const chars = value.split("");
  let x = 12;
  const bars = chars
    .flatMap((char, index) => {
      const code = char.charCodeAt(0);
      return Array.from({ length: 7 }, (_, bit) => {
        const width = ((code + bit + index) % 3) + 1;
        const gap = ((code + bit) % 2) + 1;
        const height = 72 - ((code + bit * 3) % 18);
        const currentX = x;
        x += width + gap;
        return (code >> bit) & 1 ? `<rect x="${currentX}" y="${96 - height}" width="${width}" height="${height}" rx="0.6" />` : "";
      });
    })
    .join("");
  const width = Math.max(280, x + 12);
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 128" width="${width}" height="128"><rect width="100%" height="100%" fill="white"/><g fill="#020617">${bars}</g><text x="50%" y="116" text-anchor="middle" font-family="monospace" font-size="14" fill="#020617">${escapeSvgText(value)}</text></svg>`,
  )}`;
}

export default async function CouponClaimResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ claimId: string }>;
  searchParams: Promise<{ siteId?: string; couponId?: string }>;
}) {
  const { claimId } = await params;
  const query = await searchParams;
  const siteId = trimText(query.siteId, 32);
  const couponId = trimText(query.couponId, 120);
  const normalizedClaimId = trimText(decodeURIComponent(claimId), 120);
  if (!siteId || !couponId || !normalizedClaimId) notFound();

  const coupons = await listMerchantCoupons(siteId);
  const coupon = coupons.find((item) => item.id === couponId);
  if (!coupon) notFound();
  const claimEvent = coupon.claimEvents.find((event) => event.id === normalizedClaimId) as MerchantCouponClaimEvent | undefined;
  if (!claimEvent?.settlementCode) notFound();

  const title = getMerchantCouponDisplayTitle(coupon);
  const description = getMerchantCouponDisplayDescription(coupon);
  const discount = getMerchantCouponDiscountLabel(coupon);
  const codeImage =
    claimEvent.settlementType === "barcode"
      ? buildBarcodeSvg(claimEvent.settlementCode)
      : await QRCode.toDataURL(claimEvent.settlementCode, { margin: 1, width: 260, errorCorrectionLevel: "M" });
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  const merchantName = trimText(site?.merchantName) || trimText(site?.name) || siteId;

  return (
    <CouponClaimResultClient
      merchantName={merchantName}
      title={title}
      description={description}
      discount={discount}
      codeImage={codeImage}
      settlementType={claimEvent.settlementType}
      settlementCode={claimEvent.settlementCode}
      claimedAtLabel={formatDateTime(claimEvent.at)}
      validUntilLabel={formatDateTime(claimEvent.validUntil ?? coupon.expiresAt)}
    />
  );
}
