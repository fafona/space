import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { joinMerchantMembership, leaveMerchantMembership, listMerchantMemberships } from "@/lib/merchantMemberships.server";
import {
  resolvePersonalAccountSessionFromFrontendAuthProofPayload,
  resolvePersonalAccountSessionFromRequest,
} from "@/lib/personalAccountSession.server";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { verifyFrontendAuthProof } from "@/lib/frontendAuthProof.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function resolveSiteName(siteId: string, fallback: string) {
  const snapshot = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  return trimText(snapshot?.merchantName, 120) || trimText(snapshot?.name, 120) || trimText(fallback, 120) || siteId;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteId = trimText(url.searchParams.get("siteId"), 64);
  if (!isMerchantNumericId(siteId)) {
    return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
  }
  const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
  if (!session || session.merchantId !== siteId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const memberships = await listMerchantMemberships(siteId);
  return NextResponse.json({
    ok: true,
    memberships,
  });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as {
      siteId?: unknown;
      siteName?: unknown;
      profile?: unknown;
      frontendAuthProof?: unknown;
    } | null;
    const directSession = await resolvePersonalAccountSessionFromRequest(request);
    const session =
      directSession ??
      (await resolvePersonalAccountSessionFromFrontendAuthProofPayload(verifyFrontendAuthProof(body?.frontendAuthProof)));
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const siteId = trimText(body?.siteId, 64);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    const siteName = await resolveSiteName(siteId, trimText(body?.siteName, 120));
    const membership = await joinMerchantMembership({ siteId, siteName, session, profile: body?.profile });
    return NextResponse.json({
      ok: true,
      membership,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "membership_join_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const session = await resolvePersonalAccountSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as { siteId?: unknown } | null;
    const siteId = trimText(body?.siteId, 64);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    const membership = await leaveMerchantMembership({ siteId, session });
    return NextResponse.json({
      ok: true,
      membership,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const status = message === "membership_not_found" ? 404 : 400;
    return NextResponse.json(
      {
        error: "membership_leave_failed",
        message,
      },
      { status },
    );
  }
}
