import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { isMemberCheckoutOriginalServiceEnabled } from "@/lib/merchantCheckoutOriginalService.server";
import { originalServiceHref } from "@/lib/merchantCheckoutOriginalService";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import CheckoutResumeClient from "../../resume/CheckoutResumeClient";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function OriginalServicePage({ params, searchParams }: { params: Promise<{ siteId: string; operationKey: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { siteId, operationKey } = await params, query = await searchParams;
  if (!isMemberCheckoutOriginalServiceEnabled(siteId) || Object.keys(query).some(k => k !== "uiLocale") || query.uiLocale !== undefined && typeof query.uiLocale !== "string") notFound();
  let href: string; try { href = originalServiceHref(siteId, operationKey, query.uiLocale as string | undefined); } catch { notFound(); }
  if (!isCanonicalPortalRequest(new Request("https://invalid.invalid", { headers: await headers() }))) redirect(new URL(href, resolveCanonicalPortalOrigin()).toString());
  return <CheckoutResumeClient siteId={siteId} serviceOperationKey={operationKey}/>;
}
