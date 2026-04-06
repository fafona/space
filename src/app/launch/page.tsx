import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  MERCHANT_AUTH_COOKIE,
  MERCHANT_AUTH_MERCHANT_ID_COOKIE,
  MERCHANT_AUTH_REFRESH_COOKIE,
} from "@/lib/merchantAuthSession";
import { buildMerchantBackendHref } from "@/lib/siteRouting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeMerchantId(value: string | undefined) {
  const normalized = String(value ?? "").trim();
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

export default async function LaunchPage() {
  const cookieStore = await cookies();
  const accessToken = String(cookieStore.get(MERCHANT_AUTH_COOKIE)?.value ?? "").trim();
  const refreshToken = String(cookieStore.get(MERCHANT_AUTH_REFRESH_COOKIE)?.value ?? "").trim();
  const merchantId = normalizeMerchantId(cookieStore.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.value);

  if ((accessToken || refreshToken) && merchantId) {
    redirect(buildMerchantBackendHref(merchantId));
  }

  redirect("/login?launchRetry=1");
}
