import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { isMemberCheckoutIntentPilotEnabled } from "@/lib/merchantCheckoutCartPilot.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { buildCheckoutResumeHref } from "@/lib/merchantCheckoutResumeClient";
import CheckoutResumeClient from "./CheckoutResumeClient";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function CheckoutResumePage({ params, searchParams }: {
  params: Promise<{ siteId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { siteId } = await params, query = await searchParams;
  if (!/^\d{8}$/.test(siteId) || !isMemberCheckoutIntentPilotEnabled(siteId) || Object.keys(query).some(k => k !== "uiLocale")
    || query.uiLocale !== undefined && (typeof query.uiLocale !== "string" || query.uiLocale.length > 40 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(query.uiLocale))) notFound();
  // Login cookies are host-only. Reuse the existing canonical login origin,
  // not cross-origin credentials, an iframe exception or query-borne tokens.
  const request = new Request("https://invalid.invalid", { headers: await headers() });
  if (!isCanonicalPortalRequest(request)) redirect(new URL(buildCheckoutResumeHref(siteId, query.uiLocale as string | undefined), resolveCanonicalPortalOrigin()).toString());
  return <CheckoutResumeClient siteId={siteId}/>;
}
