import { NextResponse } from "next/server";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
]);

const ALLOWED_SUPABASE_PROXY_PREFIXES = ["auth/v1/", "rest/v1/", "storage/v1/"] as const;

function readUpstreamBaseUrl() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
}

function buildUpstreamHeaders(request: Request) {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  return headers;
}

function isAllowedSupabaseProxyPath(path: string[]) {
  const joinedPath = path.map((segment) => segment.trim()).filter(Boolean).join("/");
  if (!joinedPath) return false;
  return ALLOWED_SUPABASE_PROXY_PREFIXES.some((prefix) => joinedPath === prefix.slice(0, -1) || joinedPath.startsWith(prefix));
}

async function proxyRequest(request: Request, path: string[]) {
  const upstreamBaseUrl = readUpstreamBaseUrl();
  if (!upstreamBaseUrl) {
    return NextResponse.json({ error: "supabase_proxy_env_missing" }, { status: 503 });
  }

  const joinedPath = path.map((segment) => segment.trim()).filter(Boolean).join("/");
  if (!isAllowedSupabaseProxyPath(path)) {
    return NextResponse.json({ error: "supabase_proxy_path_not_allowed" }, { status: 404 });
  }
  const requestUrl = new URL(request.url);
  const upstreamUrl = `${upstreamBaseUrl}/${joinedPath}${requestUrl.search}`;
  const method = request.method.toUpperCase();
  const headers = buildUpstreamHeaders(request);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });

    const responseHeaders = new Headers();
    upstreamResponse.headers.forEach((value, key) => {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
      responseHeaders.set(key, value);
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json({ error: "supabase_proxy_unavailable" }, { status: 503 });
  }
}

type ProxyRouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

export async function GET(request: Request, context: ProxyRouteContext) {
  const params = await context.params;
  return proxyRequest(request, params.path ?? []);
}

export async function POST(request: Request, context: ProxyRouteContext) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const params = await context.params;
  return proxyRequest(request, params.path ?? []);
}

export async function PUT(request: Request, context: ProxyRouteContext) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const params = await context.params;
  return proxyRequest(request, params.path ?? []);
}

export async function PATCH(request: Request, context: ProxyRouteContext) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const params = await context.params;
  return proxyRequest(request, params.path ?? []);
}

export async function DELETE(request: Request, context: ProxyRouteContext) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const params = await context.params;
  return proxyRequest(request, params.path ?? []);
}

export async function OPTIONS(request: Request, context: ProxyRouteContext) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const params = await context.params;
  return proxyRequest(request, params.path ?? []);
}
