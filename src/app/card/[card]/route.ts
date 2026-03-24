import { NextResponse } from "next/server";
import {
  buildMerchantBusinessCardShareDescription,
  buildMerchantBusinessCardShareTitle,
  buildMerchantBusinessCardShareUrl,
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardShareKey,
  normalizeMerchantBusinessCardShareImageUrl,
} from "@/lib/merchantBusinessCardShare";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildShareCardHtml(input: {
  title: string;
  description: string;
  imageUrl: string;
  targetUrl: string;
  shareUrl: string;
}) {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const imageUrl = escapeHtml(input.imageUrl);
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
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:secure_url" content="${imageUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <link rel="canonical" href="${shareUrl}" />
    <script>
      window.setTimeout(function () {
        window.location.replace(${JSON.stringify(input.targetUrl)});
      }, 120);
    </script>
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
      a.card {
        display: block;
        overflow: hidden;
        border-radius: 22px;
        border: 1px solid rgba(15,23,42,.08);
        background: #fff;
      }
      a.card img {
        display: block;
        width: 100%;
        height: auto;
      }
      a.button {
        display: inline-block;
        margin-top: 16px;
        padding: 10px 16px;
        border-radius: 999px;
        background: #0f172a;
        color: #fff;
        text-decoration: none;
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
        <a class="card" href="${targetUrl}">
          <img src="${imageUrl}" alt="${title}" />
        </a>
        <a class="button" href="${targetUrl}">Open Website</a>
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
  const origin = requestUrl.origin;
  if (!shareKey) {
    return new NextResponse("Invalid business card link", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=60",
      },
    });
  }

  const payload = await loadMerchantBusinessCardSharePayloadByKey(shareKey, origin);
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
  const imageUrl = normalizeMerchantBusinessCardShareImageUrl(payload.imageUrl, origin) || payload.imageUrl;
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin,
    shareKey,
    imageUrl,
    targetUrl: payload.targetUrl,
    name: payload.name,
  });

  return new NextResponse(
    buildShareCardHtml({
      title,
      description,
      imageUrl,
      targetUrl: payload.targetUrl,
      shareUrl,
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
