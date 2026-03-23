import type { Metadata } from "next";
import { headers } from "next/headers";
import ShareBusinessCardRedirect from "./ShareBusinessCardRedirect";
import {
  buildMerchantBusinessCardShareDescription,
  buildMerchantBusinessCardShareTitle,
  buildMerchantBusinessCardShareUrl,
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
  const payload = await resolveMerchantBusinessCardSharePayload(await searchParams, origin);
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
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin,
    imageUrl: payload.imageUrl,
    targetUrl: payload.targetUrl,
    name: payload.name,
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
      title,
      description,
      url: shareUrl || undefined,
      images: [
        {
          url: payload.imageUrl,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [payload.imageUrl],
    },
  };
}

export default async function ShareBusinessCardPage({ searchParams }: ShareBusinessCardPageProps) {
  const requestHeaders = await headers();
  const payload = await resolveMerchantBusinessCardSharePayload(await searchParams, resolveRequestOrigin(requestHeaders));

  if (!payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7efe3] px-6 py-12 text-slate-900">
        <section className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white px-8 py-10 shadow-[0_20px_60px_rgba(15,23,42,.08)]">
          <div className="text-lg font-semibold">链接无效</div>
          <p className="mt-3 text-sm leading-6 text-slate-600">这张名片链接缺少有效参数，暂时无法打开对应网站。</p>
        </section>
      </main>
    );
  }

  const title = buildMerchantBusinessCardShareTitle(payload.name);
  const description = buildMerchantBusinessCardShareDescription(payload.name, payload.targetUrl);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,.96),_rgba(247,239,227,1)_58%,_rgba(229,218,200,1))] px-6 py-10 text-slate-900">
      <ShareBusinessCardRedirect targetUrl={payload.targetUrl} />
      <section className="mx-auto w-full max-w-xl rounded-[32px] border border-white/70 bg-white/90 p-5 shadow-[0_28px_90px_rgba(15,23,42,.12)] backdrop-blur">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Business Card</div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
          </div>
          <a
            href={payload.targetUrl}
            className="shrink-0 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            继续打开
          </a>
        </div>
        <a
          href={payload.targetUrl}
          className="block overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 shadow-[0_16px_42px_rgba(15,23,42,.08)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={payload.imageUrl} alt={title} className="block h-auto w-full object-cover" />
        </a>
        <div className="mt-4 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white/88">
          正在跳转到商户网站。如果没有自动打开，请点击上方名片或“继续打开”。
        </div>
      </section>
    </main>
  );
}
