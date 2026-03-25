import type { Metadata } from "next";
import { headers } from "next/headers";
import ContactAutoLaunch from "@/app/share/business-card/ContactAutoLaunch";
import {
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

function renderContactSummary(payload: NonNullable<Awaited<ReturnType<typeof resolveMerchantBusinessCardSharePayload>>>) {
  const rows = [
    payload.contact?.displayName
      ? { label: "联系人", value: payload.contact.displayName }
      : null,
    payload.contact?.phone ? { label: "电话", value: payload.contact.phone } : null,
    payload.contact?.email ? { label: "邮箱", value: payload.contact.email } : null,
    payload.contact?.address ? { label: "地址", value: payload.contact.address } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-[0_16px_42px_rgba(15,23,42,.08)]">
      <div className="text-base font-semibold text-slate-900">联系人信息</div>
      <div className="mt-4 space-y-3 text-sm text-slate-700">
        {rows.map((row) => (
          <div key={row.label}>
            <span className="font-medium text-slate-900">{row.label}：</span>
            <span>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function ShareBusinessCardPage({ searchParams }: ShareBusinessCardPageProps) {
  const requestHeaders = await headers();
  const origin = resolveRequestOrigin(requestHeaders);
  const payload = await resolveMerchantBusinessCardSharePayload(await searchParams, origin);

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
  const description = buildMerchantBusinessCardShareDescription(payload.name, payload.targetUrl);
  const contactUrl = buildMerchantBusinessCardLegacyContactDownloadUrl({
    origin,
    name: payload.name,
    imageUrl: payload.imageUrl,
    targetUrl: payload.targetUrl,
    contact: payload.contact,
  });
  const hostLabel = payload.targetUrl.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,.96),_rgba(247,239,227,1)_58%,_rgba(229,218,200,1))] px-5 py-8 text-slate-900 sm:px-6 sm:py-10">
      {contactUrl ? <ContactAutoLaunch contactUrl={contactUrl} /> : null}
      <section className="mx-auto w-full max-w-xl rounded-[32px] border border-white/70 bg-white/90 p-5 shadow-[0_28px_90px_rgba(15,23,42,.12)] backdrop-blur sm:p-6">
        <div className="mb-4">
          <div className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Business Card</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
          <div className="mt-2 text-base text-slate-700">{hostLabel}</div>
        </div>

        {payload.imageUrl ? (
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 shadow-[0_16px_42px_rgba(15,23,42,.08)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={payload.imageUrl} alt={title} className="block h-auto w-full object-cover" />
          </div>
        ) : null}

        {renderContactSummary(payload)}

        <div className="mt-5 rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
          手机打开后会自动尝试拉起“保存联系人”。如果没有自动弹出，再点下面这个按钮。
        </div>

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
      </section>
    </main>
  );
}
