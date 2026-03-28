import { NextResponse } from "next/server";
import {
  buildMerchantBusinessCardContactDownloadUrl,
  buildMerchantBusinessCardShareDescription,
  buildMerchantBusinessCardShareTitle,
  buildMerchantBusinessCardShareUrl,
  isMerchantBusinessCardShareRevoked,
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardShareImageUrl,
  normalizeMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
  type MerchantBusinessCardShareContact,
} from "@/lib/merchantBusinessCardShare";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function buildCardImageRouteUrl(origin: string, shareKey: string) {
  const normalizedOrigin = normalizeText(origin).replace(/\/+$/g, "");
  const normalizedKey = normalizeText(shareKey);
  if (!normalizedOrigin || !normalizedKey) return "";
  return `${normalizedOrigin}/card/${normalizedKey}/image`;
}

function forcePublicStorageImageUrl(value: string, origin: string) {
  const trimmed = normalizeText(value);
  if (!trimmed) return "";
  const normalizedOrigin = normalizeText(origin).replace(/\/+$/g, "");
  if (!normalizedOrigin) return trimmed;
  const localhostMatch = trimmed.match(/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/storage\/v1\/object\/public\/.+)$/i);
  if (localhostMatch?.[1]) {
    return `${normalizedOrigin}${localhostMatch[1]}`;
  }
  return trimmed;
}

function buildPhoneHref(rawPhone?: string) {
  const text = normalizeText(rawPhone);
  if (!text) return "";
  const hasPlus = text.startsWith("+");
  const digits = text.replace(/[^\d]/g, "");
  if (digits.length < 3) return "";
  return `tel:${hasPlus ? "+" : ""}${digits}`;
}

function buildAddressHref(rawAddress?: string) {
  const address = normalizeText(rawAddress);
  if (!address) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function buildInlineSvgIcon(kind: "phone" | "map") {
  if (kind === "phone") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.62 10.79a15.53 15.53 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.4 21 3 13.6 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.19 2.2z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 4.74 6.14 11.84 6.4 12.14a.8.8 0 0 0 1.2 0C12.86 20.84 19 13.74 19 9a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>`;
}

function buildSocialHref(label: string, rawValue?: string) {
  const value = normalizeText(rawValue);
  if (!value) return "";
  if (looksLikeUrl(value) || /^weixin:\/\//i.test(value)) return value;

  if (label === "邮箱") return `mailto:${value}`;
  if (label === "微信") {
    const wechatId = value.replace(/^@+/, "").trim();
    return wechatId ? `weixin://dl/chat?username=${encodeURIComponent(wechatId)}` : "weixin://";
  }
  if (label === "WhatsApp") {
    const digits = value.replace(/[^\d]/g, "");
    return digits ? `https://wa.me/${digits}` : "";
  }
  if (label === "Twitter") return `https://x.com/${value.replace(/^@+/, "")}`;
  if (label === "微博") return `https://weibo.com/n/${encodeURIComponent(value.replace(/^@+/, ""))}`;
  if (label === "Telegram") return `https://t.me/${value.replace(/^@+/, "")}`;
  if (label === "LinkedIn") return `https://www.linkedin.com/in/${value.replace(/^@+/, "")}`;
  if (label === "Discord") {
    const normalized = value.replace(/^@+/, "").trim();
    if (/^\d{5,}$/.test(normalized)) return `https://discord.com/users/${normalized}`;
    if (/^[A-Za-z0-9-]+$/.test(normalized)) return `https://discord.gg/${normalized}`;
    return "";
  }
  if (label === "TikTok") return `https://www.tiktok.com/@${value.replace(/^@+/, "")}`;
  if (label === "Instagram") return `https://www.instagram.com/${value.replace(/^@+/, "")}`;
  if (label === "Facebook") return `https://www.facebook.com/${value.replace(/^@+/, "")}`;
  if (label === "小红书") return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(value)}`;
  return "";
}

function buildActionButtonHtml(input: {
  href: string;
  label: string;
  iconUrl?: string;
  iconSvg?: string;
  bgColor: string;
}) {
  const href = normalizeText(input.href);
  if (!href) return "";
  return `<a class="inline-action" href="${escapeHtml(href)}" aria-label="${escapeHtml(input.label)}" title="${escapeHtml(input.label)}" style="background:${escapeHtml(input.bgColor)}">
    ${
      input.iconUrl
        ? `<img src="${escapeHtml(input.iconUrl)}" alt="" />`
        : input.iconSvg || ""
    }
  </a>`;
}

function buildContactSummaryHtml(input: {
  name: string;
  contact?: MerchantBusinessCardShareContact;
}) {
  const secondaryPhone = input.contact?.phones?.find((value) => normalizeText(value) && value !== input.contact?.phone) || "";
  const rows = [
    input.contact?.title
      ? { label: "职位", value: input.contact.title, actionHtml: "" }
      : null,
    input.contact?.displayName
      ? { label: "联系人", value: input.contact.displayName, actionHtml: "" }
      : null,
    input.contact?.phone
      ? {
          label: "电话",
          value: input.contact.phone,
          actionHtml: buildActionButtonHtml({
            href: buildPhoneHref(input.contact.phone),
            label: "拨号",
            iconSvg: buildInlineSvgIcon("phone"),
            bgColor: "#007AFF",
          }),
        }
      : null,
    secondaryPhone
      ? {
          label: "其他电话",
          value: secondaryPhone,
          actionHtml: buildActionButtonHtml({
            href: buildPhoneHref(secondaryPhone),
            label: "拨打其他电话",
            iconSvg: buildInlineSvgIcon("phone"),
            bgColor: "#007AFF",
          }),
        }
      : null,
    input.contact?.email
      ? {
          label: "邮箱",
          value: input.contact.email,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("邮箱", input.contact.email),
            label: "发送邮件",
            iconUrl: "/social-icons/maildotru.svg",
            bgColor: "#0A84FF",
          }),
        }
      : null,
    input.contact?.address
      ? {
          label: "地址",
          value: input.contact.address,
          actionHtml: buildActionButtonHtml({
            href: buildAddressHref(input.contact.address),
            label: "导航",
            iconSvg: buildInlineSvgIcon("map"),
            bgColor: "#EA4335",
          }),
        }
      : null,
    input.contact?.wechat
      ? {
          label: "微信",
          value: input.contact.wechat,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("微信", input.contact.wechat),
            label: "打开微信",
            iconUrl: "/social-icons/wechat.svg",
            bgColor: "#07C160",
          }),
        }
      : null,
    input.contact?.whatsapp
      ? {
          label: "WhatsApp",
          value: input.contact.whatsapp,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("WhatsApp", input.contact.whatsapp),
            label: "打开 WhatsApp",
            iconUrl: "/social-icons/whatsapp.svg",
            bgColor: "#25D366",
          }),
        }
      : null,
    input.contact?.twitter
      ? {
          label: "Twitter",
          value: input.contact.twitter,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Twitter", input.contact.twitter),
            label: "打开 Twitter",
            iconUrl: "/social-icons/twitter.svg",
            bgColor: "#111827",
          }),
        }
      : null,
    input.contact?.weibo
      ? {
          label: "微博",
          value: input.contact.weibo,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("微博", input.contact.weibo),
            label: "打开微博",
            iconUrl: "/social-icons/weibo.svg",
            bgColor: "#E6162D",
          }),
        }
      : null,
    input.contact?.telegram
      ? {
          label: "Telegram",
          value: input.contact.telegram,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Telegram", input.contact.telegram),
            label: "打开 Telegram",
            iconUrl: "/social-icons/telegram.svg",
            bgColor: "#229ED9",
          }),
        }
      : null,
    input.contact?.linkedin
      ? {
          label: "LinkedIn",
          value: input.contact.linkedin,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("LinkedIn", input.contact.linkedin),
            label: "打开 LinkedIn",
            iconUrl: "/social-icons/linkedin.svg",
            bgColor: "#0A66C2",
          }),
        }
      : null,
    input.contact?.discord
      ? {
          label: "Discord",
          value: input.contact.discord,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Discord", input.contact.discord),
            label: "打开 Discord",
            iconUrl: "/social-icons/discord.svg",
            bgColor: "#5865F2",
          }),
        }
      : null,
    input.contact?.facebook
      ? {
          label: "Facebook",
          value: input.contact.facebook,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Facebook", input.contact.facebook),
            label: "打开 Facebook",
            iconUrl: "/social-icons/facebook.svg",
            bgColor: "#1877F2",
          }),
        }
      : null,
    input.contact?.instagram
      ? {
          label: "Instagram",
          value: input.contact.instagram,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Instagram", input.contact.instagram),
            label: "打开 Instagram",
            iconUrl: "/social-icons/instagram.svg",
            bgColor: "#E4405F",
          }),
        }
      : null,
    input.contact?.tiktok
      ? {
          label: "TikTok",
          value: input.contact.tiktok,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("TikTok", input.contact.tiktok),
            label: "打开 TikTok",
            iconUrl: "/social-icons/tiktok.svg",
            bgColor: "#111827",
          }),
        }
      : null,
    input.contact?.xiaohongshu
      ? {
          label: "小红书",
          value: input.contact.xiaohongshu,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("小红书", input.contact.xiaohongshu),
            label: "打开小红书",
            iconUrl: "/social-icons/xiaohongshu.svg",
            bgColor: "#FF2442",
          }),
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string; actionHtml: string }>;

  if (rows.length === 0) {
    return `<div class="summary-row"><span class="summary-value">${escapeHtml(normalizeText(input.name) || "电子名片")}</span></div>`;
  }

  return rows
    .map(
      (row) => `
        <div class="summary-row">
          <div class="summary-copy">
            <strong class="summary-label">${escapeHtml(row.label)}：</strong>
            <span class="summary-value">${escapeHtml(row.value)}</span>
          </div>
          ${row.actionHtml ? `<div class="summary-action">${row.actionHtml}</div>` : ""}
        </div>`,
    )
    .join("");
}

function buildShareCardHtml(input: {
  title: string;
  description: string;
  merchantName: string;
  previewImageUrl?: string;
  contentImageUrl?: string;
  contentImageHeight?: number;
  summaryHtml: string;
  imageWidth?: number;
  imageHeight?: number;
  targetUrl: string;
  shareUrl: string;
  contactUrl?: string;
}) {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const merchantName = escapeHtml(input.merchantName);
  const previewImageUrl = input.previewImageUrl ? escapeHtml(input.previewImageUrl) : "";
  const contentImageUrl = input.contentImageUrl ? escapeHtml(input.contentImageUrl) : "";
  const contentImageHeight = input.contentImageHeight ?? 0;
  const targetUrl = escapeHtml(input.targetUrl);
  const shareUrl = escapeHtml(input.shareUrl);

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Faolla" />
    <meta property="og:url" content="${shareUrl}" />
    ${previewImageUrl ? `<meta property="og:image:url" content="${previewImageUrl}" />` : ""}
    ${previewImageUrl ? `<meta property="og:image" content="${previewImageUrl}" />` : ""}
    ${previewImageUrl ? `<meta property="og:image:secure_url" content="${previewImageUrl}" />` : ""}
    ${previewImageUrl ? `<meta property="og:image:alt" content="${title}" />` : ""}
    ${previewImageUrl ? `<meta property="og:image:type" content="image/png" />` : ""}
    ${previewImageUrl && input.imageWidth ? `<meta property="og:image:width" content="${input.imageWidth}" />` : ""}
    ${previewImageUrl && input.imageHeight ? `<meta property="og:image:height" content="${input.imageHeight}" />` : ""}
    <meta name="twitter:card" content="${previewImageUrl ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    ${previewImageUrl ? `<meta name="twitter:image" content="${previewImageUrl}" />` : ""}
    ${previewImageUrl ? `<meta name="twitter:image:alt" content="${title}" />` : ""}
    <link rel="canonical" href="${shareUrl}" />
    <style>
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        background: #f5efe5;
        color: #0f172a;
      }
      main {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      article {
        width: min(100%, 560px);
        background: rgba(255,255,255,.94);
        border: 1px solid rgba(15,23,42,.08);
        border-radius: 28px;
        padding: 20px;
        box-shadow: 0 24px 80px rgba(15,23,42,.12);
      }
      .brandline {
        margin: 0;
        text-align: center;
        font-size: 13px;
        letter-spacing: .28em;
        color: #64748b;
        text-transform: uppercase;
      }
      h1 {
        margin: 10px 0 0;
        font-size: 28px;
        text-align: center;
      }
      p {
        line-height: 1.6;
      }
      .card,
      .summary {
        display: block;
        overflow: hidden;
        border-radius: 22px;
        border: 1px solid rgba(15,23,42,.08);
        background: #fff;
      }
      .card img {
        display: block;
        width: 100%;
        height: auto;
      }
      .summary {
        margin-top: 16px;
        padding: 18px;
        line-height: 1.7;
      }
      .summary-row + .summary-row {
        margin-top: 12px;
      }
      .summary-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .summary-copy {
        min-width: 0;
        display: flex;
        align-items: flex-start;
        gap: 4px;
        flex-wrap: wrap;
      }
      .summary-label {
        color: #0f172a;
      }
      .summary-value {
        color: #334155;
        word-break: break-word;
      }
      .summary-action {
        flex-shrink: 0;
      }
      .inline-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 999px;
        box-shadow: 0 8px 20px rgba(15,23,42,.14);
      }
      .inline-action img,
      .inline-action svg {
        width: 18px;
        height: 18px;
      }
      .inline-action img {
        object-fit: contain;
      }
      .inline-action svg {
        fill: #fff;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 16px;
      }
      a.button {
        display: inline-block;
        padding: 10px 16px;
        border-radius: 999px;
        text-decoration: none;
      }
      a.button {
        background: #0f172a;
        color: #fff;
      }
      a.button.secondary {
        background: #fff;
        color: #0f172a;
        border: 1px solid rgba(15,23,42,.12);
      }
      .footer {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid rgba(15,23,42,.08);
        font-size: 13px;
        color: #64748b;
        text-align: center;
      }
      .footer a {
        color: #0f172a;
        text-decoration: none;
        font-weight: 600;
      }
      @media (max-width: 520px) {
        main {
          padding: 12px;
        }
        article {
          padding: 16px;
        }
        .summary-row {
          align-items: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <div class="brandline">FAOLLA CARD</div>
        ${merchantName ? `<h1>${merchantName}</h1>` : ""}
        ${
          contentImageUrl
            ? `<a class="card" href="${targetUrl}">
          <img src="${contentImageUrl}" alt="${title}"${contentImageHeight ? ` style="height:${contentImageHeight}px;object-fit:cover;"` : ""} />
        </a>`
            : ""
        }
        <div class="summary">${input.summaryHtml}</div>
        <div class="actions">
          ${
            input.contactUrl
              ? `<a class="button" href="${escapeHtml(input.contactUrl)}">一键保存到通讯录</a>`
              : ""
          }
          <a class="button secondary" href="${targetUrl}">打开网页</a>
        </div>
        <div class="footer">
          名片服务由 <a href="https://www.faolla.com" target="_blank" rel="noopener noreferrer">www.faolla.com</a> 提供
        </div>
      </article>
    </main>
  </body>
</html>`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ card: string }> },
) {
  const { card } = await params;
  const shareKey = normalizeMerchantBusinessCardShareKey(card);
  const requestUrl = new URL(request.url);
  const requestOrigin = requestUrl.origin;
  if (!shareKey) {
    return new NextResponse("Invalid business card link", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  if (
    await isMerchantBusinessCardShareRevoked({
      shareKey,
      preferredOrigin: requestOrigin,
    })
  ) {
    return new NextResponse("Business card not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const payload = await loadMerchantBusinessCardSharePayloadByKey(shareKey, requestOrigin);
  if (!payload) {
    return new NextResponse("Business card not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const title = buildMerchantBusinessCardShareTitle(payload.name);
  const description = buildMerchantBusinessCardShareDescription(payload.name, payload.targetUrl);
  const publicOrigin = resolveMerchantBusinessCardShareOrigin(request.url, payload.targetUrl) || requestOrigin;
  const normalizedShareImageUrl = payload.imageUrl
    ? normalizeMerchantBusinessCardShareImageUrl(payload.imageUrl, publicOrigin) || payload.imageUrl
    : "";
  const imageUrl = normalizedShareImageUrl ? forcePublicStorageImageUrl(normalizedShareImageUrl, publicOrigin) : "";
  const previewImageUrl = imageUrl ? buildCardImageRouteUrl(publicOrigin, shareKey) || imageUrl : "";
  const detailImageUrl = payload.detailImageUrl
    ? forcePublicStorageImageUrl(
        normalizeMerchantBusinessCardShareImageUrl(payload.detailImageUrl, publicOrigin) || payload.detailImageUrl,
        publicOrigin,
      )
    : "";
  const contactUrl =
    buildMerchantBusinessCardContactDownloadUrl({
      origin: publicOrigin,
      shareKey,
      targetUrl: payload.targetUrl,
    }) || undefined;
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: publicOrigin,
    shareKey,
    imageUrl: previewImageUrl,
    detailImageUrl,
    targetUrl: payload.targetUrl,
    name: payload.name,
    contact: payload.contact,
  });

  return new NextResponse(
    buildShareCardHtml({
      title,
      description,
      merchantName: payload.name,
      previewImageUrl: previewImageUrl || undefined,
      contentImageUrl: detailImageUrl || undefined,
      contentImageHeight: payload.detailImageHeight,
      summaryHtml: buildContactSummaryHtml({
        name: payload.name,
        contact: payload.contact,
      }),
      imageWidth: payload.imageWidth,
      imageHeight: payload.imageHeight,
      targetUrl: payload.targetUrl,
      shareUrl,
      contactUrl,
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
