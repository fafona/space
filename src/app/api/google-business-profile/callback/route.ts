import { verifyGoogleBusinessProfileOAuthState } from "@/lib/googleBusinessProfileCrypto";
import {
  exchangeGoogleBusinessProfileAuthorizationCode,
  toGoogleBusinessProfileUserMessage,
} from "@/lib/googleBusinessProfileServer";
import {
  loadGoogleBusinessProfileIntegration,
  saveGoogleBusinessProfileIntegration,
} from "@/lib/googleBusinessProfileStore";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function callbackHtml(payload: { ok: boolean; siteId: string; message: string }) {
  const serialized = JSON.stringify({
    type: "faolla:google-business-profile-connected",
    ...payload,
  }).replaceAll("<", "\\u003c");
  const title = payload.ok ? "Google 商家资料已连接" : "Google 商家资料连接失败";
  const message = payload.message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a}.box{width:min(92vw,520px);padding:28px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;box-shadow:0 18px 45px rgba(15,23,42,.12)}h1{font-size:20px;margin:0 0 12px}p{line-height:1.7;color:#475569}a{display:inline-flex;margin-top:12px;padding:10px 16px;border-radius:8px;background:#0f172a;color:#fff;text-decoration:none}</style>
</head>
<body>
  <main class="box"><h1>${title}</h1><p>${message}</p><a href="/admin">返回编辑器</a></main>
  <script>try{window.opener&&window.opener.postMessage(${serialized},"*");setTimeout(function(){window.close()},500)}catch(e){}</script>
</body>
</html>`;
}

function htmlResponse(payload: { ok: boolean; siteId: string; message: string }, status = 200) {
  return new Response(callbackHtml(payload), {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateValue = (url.searchParams.get("state") ?? "").trim();
  let state: ReturnType<typeof verifyGoogleBusinessProfileOAuthState> = null;
  try {
    state = verifyGoogleBusinessProfileOAuthState(stateValue);
  } catch {
    state = null;
  }
  const siteId = state?.siteId ?? "";
  const oauthError = (url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "").trim();
  if (!state) return htmlResponse({ ok: false, siteId, message: "授权状态无效或已过期，请返回编辑器重新连接。" }, 400);
  if (oauthError) return htmlResponse({ ok: false, siteId, message: oauthError }, 400);
  const code = (url.searchParams.get("code") ?? "").trim();
  if (!code) return htmlResponse({ ok: false, siteId, message: "Google 未返回授权码。" }, 400);

  try {
    const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
    if (!session || session.merchantId !== siteId) {
      return htmlResponse({ ok: false, siteId, message: "商户登录状态已失效，请重新登录后再连接。" }, 401);
    }
    const supabase = createServerSupabaseServiceClient();
    if (!supabase) throw new Error("google_business_profile_store_unavailable");
    const previous = await loadGoogleBusinessProfileIntegration(supabase, siteId);
    const integration = await exchangeGoogleBusinessProfileAuthorizationCode({
      request,
      siteId,
      code,
      previous,
    });
    await saveGoogleBusinessProfileIntegration(supabase, integration);
    return htmlResponse({
      ok: true,
      siteId,
      message: "授权成功。编辑器正在读取可用地点和真实评论。",
    });
  } catch (error) {
    return htmlResponse({ ok: false, siteId, message: toGoogleBusinessProfileUserMessage(error) }, 500);
  }
}
