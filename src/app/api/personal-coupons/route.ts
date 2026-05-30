import { NextResponse } from "next/server";
import { readPersonalClaimedCouponsFromUserMetadata } from "@/lib/personalCoupons";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const session = await resolvePersonalAccountSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    coupons: readPersonalClaimedCouponsFromUserMetadata(session.user.user_metadata ?? {}),
  });
}
