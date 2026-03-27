import { NextResponse } from "next/server";
import { clearMerchantAuthCookie } from "@/lib/merchantAuthSession";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearMerchantAuthCookie(response);
  return response;
}
