import { NextResponse } from "next/server";
import { readPersonalMembershipCardsFromUserMetadata } from "@/lib/merchantMemberships";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const session = await resolvePersonalAccountSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const siteId = (url.searchParams.get("siteId") ?? "").trim();
  const memberships = readPersonalMembershipCardsFromUserMetadata(session.user.user_metadata ?? {});
  return NextResponse.json({
    ok: true,
    memberships: siteId ? memberships.filter((membership) => membership.siteId === siteId) : memberships,
  });
}
