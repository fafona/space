import QRCode from "qrcode";
import { notFound } from "next/navigation";
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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 128" width="${width}" height="128"><rect width="100%" height="100%" fill="white"/><g fill="#020617">${bars}</g><text x="50%" y="116" text-anchor="middle" font-family="monospace" font-size="14" fill="#020617">${value}</text></svg>`,
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

  const coupons = await listMerchantCoupons(siteId).catch(() => []);
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
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950">
      <section className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-slate-500">{merchantName}</div>
        <h1 className="mt-2 text-2xl font-bold">{title}</h1>
        <div className="mt-2 text-base font-semibold text-rose-600">{discount}</div>
        {description ? <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p> : null}

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
          <div className="text-sm font-semibold text-slate-700">{claimEvent.settlementType === "barcode" ? "核销条形码" : "核销二维码"}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mx-auto mt-3 max-h-[280px] max-w-full rounded-xl bg-white p-3" src={codeImage} alt="核销码" />
          <div className="mt-3 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-slate-600">{claimEvent.settlementCode}</div>
        </div>

        <a
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
          href={codeImage}
          download={`${merchantName}-${title}-核销码.${claimEvent.settlementType === "barcode" ? "svg" : "png"}`}
        >
          保存至相册
        </a>

        <dl className="mt-5 grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">领取时间</dt>
            <dd className="font-medium">{formatDateTime(claimEvent.at)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">有效期</dt>
            <dd className="font-medium">{formatDateTime(claimEvent.validUntil ?? coupon.expiresAt)}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
