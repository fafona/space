import { NextResponse } from "next/server";
import { clearMerchantAuthCookies } from "@/lib/merchantAuthSession";

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  clearMerchantAuthCookies(response, request);
  return response;
}
