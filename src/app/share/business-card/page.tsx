import type { Metadata } from "next";
import { headers } from "next/headers";
import QRCode from "qrcode";
import {
  buildMerchantBusinessCardContactDownloadUrl,
  buildMerchantBusinessCardLegacyContactDownloadUrl,
  buildMerchantBusinessCardShareDescription,
  buildMerchantBusinessCardShareTitle,
  buildMerchantBusinessCardShareUrl,
  readMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardSharePayload,
} from "@/lib/merchantBusinessCardShare";

type ShareBusinessCardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveRequestOrigin(requestHeaders: Headers) {
  const host =
    requestHeaders.get("x-forwarded-host")?.trim() ||
    requestHeaders.get("host")?.trim() ||
    "";
  if (!host) return "";
  const protocol =
    requestHeaders.get("x-forwarded-proto")?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`.replace(/\/+$/g, "");
}

function looksLikeMobileRequest(requestHeaders: Headers) {
  const userAgent = requestHeaders.get("user-agent")?.trim() || "";
  return /android|iphone|ipad|ipod|mobile|micromessenger|wechat/i.test(userAgent);
}

function renderContactSummary(payload: NonNullable<Awaited<ReturnType<typeof resolveMerchantBusinessCardSharePayload>>>) {
  const primaryRows = [
    payload.contact?.title || "",
    payload.contact?.displayName || "",
    payload.contact?.phone || "",
    payload.contact?.phones?.filter(Boolean).join(" / ") || "",
    payload.contact?.email || "",
    payload.contact?.address || "",
  ].filter(Boolean);
  const extraRows = (payload.contact?.note || "")
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean);

  if (primaryRows.length === 0 && extraRows.length === 0) return null;

  return (
    <div
      className="mt-5 rounded-[28px] border border-slate-200 bg-slate-50 p-6 shadow-[0_16px_42px_rgba(15,23,42,.08)]"
      data-no-translate="1"
    >
      <div className="space-y-4 text-slate-800">
        {primaryRows.map((row, index) => (
          <div
            key={`${index}-${row}`}
            className={index < 2 ? "text-[15px] font-medium leading-7 text-slate-900" : "text-sm leading-7 text-slate-700"}
          >
            {row}
          </div>
        ))}

        {extraRows.length > 0 ? (
          <div className="grid gap-x-6 gap-y-2 pt-1 text-sm leading-7 text-slate-700 sm:grid-cols-2">
            {extraRows.map((row) => (
              <div key={row}>{row}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export async function generateMetadata({ searchParams }: ShareBusinessCardPageProps): Promise<Metadata> {
  const requestHeaders = await headers();
  const origin = resolveRequestOrigin(requestHeaders);
  const resolvedSearchParams = await searchParams;
  const payload = await resolveMerchantBusinessCardSharePayload(resolvedSearchParams, origin);
  const metadataBase = origin ? new URL(origin) : undefined;

  if (!payload) {
    return {
      metadataBase,
      title: "商户名片",
      description: "名片链接无效",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const title = buildMerchantBusinessCardShareTitle(payload.name);
  const description = buildMerchantBusinessCardShareDescription(payload.name, payload.targetUrl);
  const shareKey = readMerchantBusinessCardShareKey(resolvedSearchParams);
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin,
    shareKey,
    imageUrl: payload.imageUrl,
    detailImageUrl: payload.detailImageUrl,
    targetUrl: payload.targetUrl,
    name: payload.name,
    contact: payload.contact,
  });

  return {
    metadataBase,
    title,
    description,
    alternates: shareUrl
      ? {
          canonical: shareUrl,
        }
      : undefined,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      type: "website",
      siteName: "Faolla",
      title,
      description,
      url: shareUrl || undefined,
      ...(payload.imageUrl
        ? {
            images: [
              {
                url: payload.imageUrl,
                alt: title,
                secureUrl: payload.imageUrl,
                width: payload.imageWidth,
                height: payload.imageHeight,
                type: "image/png",
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(payload.imageUrl ? { images: [payload.imageUrl] } : {}),
    },
  };
}

export default async function ShareBusinessCardPage({ searchParams }: ShareBusinessCardPageProps) {
  const requestHeaders = await headers();
  const origin = resolveRequestOrigin(requestHeaders);
  const resolvedSearchParams = await searchParams;
  const payload = await resolveMerchantBusinessCardSharePayload(resolvedSearchParams, origin);
  const isMobileRequest = looksLikeMobileRequest(requestHeaders);

  if (!payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7efe3] px-6 py-12 text-slate-900">
        <section className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white px-8 py-10 shadow-[0_20px_60px_rgba(15,23,42,.08)]">
          <div className="text-lg font-semibold">链接无效</div>
          <p className="mt-3 text-sm leading-6 text-slate-600">这张联系卡缺少有效信息，暂时无法打开。</p>
        </section>
      </main>
    );
  }

  const title = buildMerchantBusinessCardShareTitle(payload.name);
  const shareKey = readMerchantBusinessCardShareKey(resolvedSearchParams);
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin,
    shareKey,
    imageUrl: payload.imageUrl,
    detailImageUrl: payload.detailImageUrl,
    targetUrl: payload.targetUrl,
    name: payload.name,
    contact: payload.contact,
  });
  const contactUrl =
    (shareKey
      ? buildMerchantBusinessCardContactDownloadUrl({
          origin,
          shareKey,
          targetUrl: payload.targetUrl,
        })
      : "") ||
    buildMerchantBusinessCardLegacyContactDownloadUrl({
      origin,
      name: payload.name,
      imageUrl: payload.imageUrl,
      detailImageUrl: payload.detailImageUrl,
      targetUrl: payload.targetUrl,
      contact: payload.contact,
    });
  const desktopQrCodeUrl =
    !isMobileRequest && shareUrl
      ? await QRCode.toDataURL(shareUrl, {
          width: 280,
          margin: 1,
          errorCorrectionLevel: "M",
        }).catch(() => "")
      : "";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,.96),_rgba(247,239,227,1)_58%,_rgba(229,218,200,1))] px-5 py-8 text-slate-900 sm:px-6 sm:py-10">
      <section className="mx-auto w-full max-w-xl rounded-[32px] border border-white/70 bg-white/90 p-5 shadow-[0_28px_90px_rgba(15,23,42,.12)] backdrop-blur sm:p-6">
        <div className="mb-4">
          <div className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">FAOLLA CARD</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900" data-no-translate="1">
            {payload.name || title}
          </h1>
        </div>

        {payload.detailImageUrl ? (
          <div
            className="overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 shadow-[0_16px_42px_rgba(15,23,42,.08)]"
            style={payload.detailImageHeight ? { height: `${payload.detailImageHeight}px` } : undefined}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={payload.detailImageUrl}
              alt={title}
              className={`block w-full object-cover ${payload.detailImageHeight ? "h-full" : "h-auto"}`}
            />
          </div>
        ) : (
          renderContactSummary(payload)
        )}

        {isMobileRequest ? (
          <>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              {contactUrl ? (
                <a
                  href={contactUrl}
                  className="flex-1 rounded-full bg-slate-900 px-5 py-3 text-center text-base font-semibold text-white transition hover:bg-slate-700"
                >
                  一键保存到通讯录
                </a>
              ) : null}
              <a
                href={payload.targetUrl}
                className="rounded-full border border-slate-300 bg-white px-5 py-3 text-center text-base font-medium text-slate-900 transition hover:bg-slate-50"
              >
                打开网页
              </a>
            </div>
            <div className="mt-3 text-xs leading-6 text-slate-500">
              如果微信提示无法直接打开，请选择“用其他应用打开”，再优先使用通讯录或联系人应用处理。
            </div>
          </>
        ) : (
          <>
            <div className="mt-5 rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
              电脑端通常会交给 Outlook 或其他程序处理，不够直接。最简单的方式是用手机扫码打开，再点击保存到通讯录。
            </div>

            {desktopQrCodeUrl ? (
              <div className="mt-5 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_42px_rgba(15,23,42,.08)]">
                <div className="text-base font-semibold text-slate-900">手机扫码保存联系人</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">扫码后会在手机里打开这张联系卡，再由对方手动点击“保存到通讯录”。</div>
                <div className="mt-4 flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={desktopQrCodeUrl} alt="联系卡二维码" className="h-56 w-56 rounded-2xl border border-slate-200 bg-white p-3" />
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <a
                href={payload.targetUrl}
                className="rounded-full bg-slate-900 px-5 py-3 text-center text-base font-semibold text-white transition hover:bg-slate-700"
              >
                打开网页
              </a>
              {shareUrl ? (
                <a
                  href={shareUrl}
                  className="rounded-full border border-slate-300 bg-white px-5 py-3 text-center text-base font-medium text-slate-900 transition hover:bg-slate-50"
                >
                  复制到手机后打开
                </a>
              ) : null}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
