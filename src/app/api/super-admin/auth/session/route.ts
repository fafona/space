import { NextResponse } from "next/server";
import { readSuperAdminAuthorizedSession } from "@/lib/superAdminRequestAuth";
import { clearSuperAdminSessionCookies } from "@/lib/superAdminSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request) {
  const session = readSuperAdminAuthorizedSession(request);
  if (!session) {
    const response = noStoreJson({ ok: true, authenticated: false }, { status: 401 });
    clearSuperAdminSessionCookies(response, request);
    return response;
  }
  return noStoreJson({
    ok: true,
    authenticated: true,
    deviceId: session.deviceId,
    deviceLabel: session.deviceLabel,
  });
}
