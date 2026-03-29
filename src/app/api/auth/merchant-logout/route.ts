import { NextResponse } from "next/server";
import { clearMerchantAuthCookies } from "@/lib/merchantAuthSession";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearMerchantAuthCookies(response);
  return response;
}
