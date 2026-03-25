import { NextResponse } from "next/server";
import {
  buildMerchantBusinessCardContactDownloadUrl,
  buildMerchantBusinessCardShareDescription,
  buildMerchantBusinessCardShareTitle,
  buildMerchantBusinessCardShareUrl,
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

function buildContactSummaryHtml(input: {
  name: string;
  contact?: MerchantBusinessCardShareContact;
}) {
  const rows = [
    input.contact?.title ? ["职位", input.contact.title] : null,
    input.contact?.displayName ? ["联系人", input.contact.displayName] : null,
    input.contact?.phone ? ["电话", input.contact.phone] : null,
    input.contact?.phones?.length ? ["其他电话", input.contact.phones.filter(Boolean).join(" / ")] : null,
    input.contact?.email ? ["邮箱", input.contact.email] : null,
    input.contact?.address ? ["地址", input.contact.address] : null,
  ].filter(Boolean) as Array<[string, string]>;

  const socialRows = [
    input.contact?.wechat ? ["微信", input.contact.wechat] : null,
    input.contact?.whatsapp ? ["WhatsApp", input.contact.whatsapp] : null,
    input.contact?.twitter ? ["Twitter", input.contact.twitter] : null,
    input.contact?.weibo ? ["微博", input.contact.weibo] : null,
    input.contact?.telegram ? ["Telegram", input.contact.telegram] : null,
    input.contact?.linkedin ? ["LinkedIn", input.contact.linkedin] : null,
    input.contact?.discord ? ["Discord", input.contact.discord] : null,
    input.contact?.facebook ? ["Facebook", input.contact.facebook] : null,
    input.contact?.instagram ? ["Instagram", input.contact.instagram] : null,
    input.contact?.tiktok ? ["TikTok", input.contact.tiktok] : null,
    input.contact?.xiaohongshu ? ["小红书", input.contact.xiaohongshu] : null,
  ].filter(Boolean) as Array<[string, string]>;

  if (rows.length === 0 && socialRows.length === 0) {
    return `<div class="summary-line">${escapeHtml(normalizeText(input.name) || "电子名片")}</div>`;
  }

  return `
    <div class="summary-group">
      ${rows
        .map(
          ([label, value]) =>
            `<div class="summary-line"><strong>${escapeHtml(label)}：</strong>${escapeHtml(value)}</div>`,
        )
        .join("")}
    </div>
    ${
      socialRows.length > 0
        ? `<div class="summary-social-grid">
      ${socialRows
        .map(
          ([label, value]) =>
            `<div class="summary-social-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
        )
        .join("")}
    </div>`
        : ""
    }
  `;
}

function buildContactActionHtml(contact?: MerchantBusinessCardShareContact) {
  const items = [
    { label: "拨号", href: buildPhoneHref(contact?.phone) },
    { label: "邮件", href: buildSocialHref("邮箱", contact?.email) },
    { label: "导航", href: buildAddressHref(contact?.address) },
    { label: "微信", href: buildSocialHref("微信", contact?.wechat) },
    { label: "WhatsApp", href: buildSocialHref("WhatsApp", contact?.whatsapp) },
    { label: "Twitter", href: buildSocialHref("Twitter", contact?.twitter) },
    { label: "微博", href: buildSocialHref("微博", contact?.weibo) },
    { label: "Telegram", href: buildSocialHref("Telegram", contact?.telegram) },
    { label: "LinkedIn", href: buildSocialHref("LinkedIn", contact?.linkedin) },
    { label: "Discord", href: buildSocialHref("Discord", contact?.discord) },
    { label: "Facebook", href: buildSocialHref("Facebook", contact?.facebook) },
    { label: "Instagram", href: buildSocialHref("Instagram", contact?.instagram) },
    { label: "TikTok", href: buildSocialHref("TikTok", contact?.tiktok) },
    { label: "小红书", href: buildSocialHref("小红书", contact?.xiaohongshu) },
  ].filter((item) => item.href);

  if (items.length === 0) return "";

  return `
    <div class="contact-actions">
      ${items
        .map(
          (item) =>
            `<a class="chip" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`,
        )
        .join("")}
    </div>
  `;
}

function buildShareCardHtml(input: {
  title: string;
  description: string;
  previewImageUrl?: string;
  contentImageUrl?: string;
  summaryHtml: string;
  actionHtml: string;
  imageWidth?: number;
  imageHeight?: number;
  targetUrl: string;
  shareUrl: string;
  contactUrl?: string;
}) {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const previewImageUrl = input.previewImageUrl ? escapeHtml(input.previewImageUrl) : "";
  const contentImageUrl = input.contentImageUrl ? escapeHtml(input.contentImageUrl) : "";
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
      h1 {
        margin: 0;
        font-size: 28px;
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
      .summary-line + .summary-line {
        margin-top: 10px;
      }
      .summary-group + .summary-social-grid {
        margin-top: 16px;
      }
      .summary-social-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 12px;
      }
      .summary-social-item {
        border-radius: 14px;
        background: #f8fafc;
        padding: 10px 12px;
      }
      .summary-social-item span {
        display: block;
        font-size: 12px;
        color: #64748b;
      }
      .summary-social-item strong {
        display: block;
        margin-top: 4px;
        font-size: 14px;
        word-break: break-word;
      }
      .actions,
      .contact-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 16px;
      }
      a.button,
      a.chip {
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
      a.chip {
        background: #f8fafc;
        color: #0f172a;
        border: 1px solid rgba(15,23,42,.08);
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
        .summary-social-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <h1>${title}</h1>
        <p>${description}</p>
        ${
          contentImageUrl
            ? `<a class="card" href="${targetUrl}">
          <img src="${contentImageUrl}" alt="${title}" />
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
        ${input.actionHtml}
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
        "cache-control": "public, max-age=60, s-maxage=60",
      },
    });
  }

  const payload = await loadMerchantBusinessCardSharePayloadByKey(shareKey, requestOrigin);
  if (!payload) {
    return new NextResponse("Business card not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=60",
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
      previewImageUrl: previewImageUrl || undefined,
      contentImageUrl: detailImageUrl || undefined,
      summaryHtml: buildContactSummaryHtml({
        name: payload.name,
        contact: payload.contact,
      }),
      actionHtml: buildContactActionHtml(payload.contact),
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
        "cache-control": "public, max-age=300, s-maxage=300",
      },
    },
  );
}
