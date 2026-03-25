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
} from "@/lib/merchantBusinessCardShare";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCardImageRouteUrl(origin: string, shareKey: string) {
  const normalizedOrigin = String(origin ?? "").trim().replace(/\/+$/g, "");
  const normalizedKey = String(shareKey ?? "").trim();
  if (!normalizedOrigin || !normalizedKey) return "";
  return `${normalizedOrigin}/card/${normalizedKey}/image`;
}

function forcePublicStorageImageUrl(value: string, origin: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const normalizedOrigin = String(origin ?? "").trim().replace(/\/+$/g, "");
  if (!normalizedOrigin) return trimmed;
  const localhostMatch = trimmed.match(/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/storage\/v1\/object\/public\/.+)$/i);
  if (localhostMatch?.[1]) {
    return `${normalizedOrigin}${localhostMatch[1]}`;
  }
  return trimmed;
}

function buildShareCardHtml(input: {
  title: string;
  description: string;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  targetUrl: string;
  shareUrl: string;
  contactUrl?: string;
}) {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const imageUrl = input.imageUrl ? escapeHtml(input.imageUrl) : "";
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
    ${imageUrl ? `<meta property="og:image:url" content="${imageUrl}" />` : ""}
    ${imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : ""}
    ${imageUrl ? `<meta property="og:image:secure_url" content="${imageUrl}" />` : ""}
    ${imageUrl ? `<meta property="og:image:alt" content="${title}" />` : ""}
    ${imageUrl ? `<meta property="og:image:type" content="image/png" />` : ""}
    ${imageUrl && input.imageWidth ? `<meta property="og:image:width" content="${input.imageWidth}" />` : ""}
    ${imageUrl && input.imageHeight ? `<meta property="og:image:height" content="${input.imageHeight}" />` : ""}
    <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}" />` : ""}
    ${imageUrl ? `<meta name="twitter:image:alt" content="${title}" />` : ""}
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
        width: min(100%, 520px);
        background: rgba(255,255,255,.94);
        border: 1px solid rgba(15,23,42,.08);
        border-radius: 28px;
        padding: 20px;
        box-shadow: 0 24px 80px rgba(15,23,42,.12);
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
        padding: 18px;
        line-height: 1.7;
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
        background: #0f172a;
        color: #fff;
        text-decoration: none;
      }
      a.button.secondary {
        background: #fff;
        color: #0f172a;
        border: 1px solid rgba(15,23,42,.12);
      }
      p {
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <h1>${title}</h1>
        <p>${description}</p>
        ${
          imageUrl
            ? `<a class="card" href="${targetUrl}">
          <img src="${imageUrl}" alt="${title}" />
        </a>`
            : `<div class="summary">打开这张电子名片后，可以保存联系人，也可以继续访问网站。</div>`
        }
        <div class="actions">
          ${
            input.contactUrl
              ? `<a class="button" href="${escapeHtml(input.contactUrl)}">保存到通讯录</a>`
              : ""
          }
          <a class="button secondary" href="${targetUrl}">打开网页</a>
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
    targetUrl: payload.targetUrl,
    name: payload.name,
  });

  return new NextResponse(
    buildShareCardHtml({
      title,
      description,
      imageUrl: previewImageUrl || undefined,
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
