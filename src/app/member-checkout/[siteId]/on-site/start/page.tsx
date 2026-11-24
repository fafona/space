import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isMemberCheckoutIntentPilotEnabled } from "@/lib/merchantCheckoutCartPilot.server";
import { isMemberCheckoutSingleRetainedIntentEnabled } from "@/lib/merchantCheckoutSingleRetainedPilot.server";
import { buildOnSiteCheckoutStartHref } from "@/lib/merchantCheckoutOnSiteClient";
import { isMemberCheckoutOnSitePilotEnabled } from "@/lib/merchantCheckoutOnSitePilot.server";
import { parseCheckoutStartQuery, type CheckoutClientSelection } from "@/lib/merchantCheckoutClient";
import CheckoutStartClient from "../../start/CheckoutStartClient";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function OnSiteCheckoutStartPage({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { siteId } = await params; if (!isMemberCheckoutOnSitePilotEnabled(siteId)) notFound(); let selection: CheckoutClientSelection;
  const query = await searchParams;
  try { selection = parseCheckoutStartQuery(siteId, query); } catch { notFound(); }
  const intentEnabled = isMemberCheckoutIntentPilotEnabled(siteId);
  if (intentEnabled && !isCanonicalPortalRequest(new Request("https://invalid.invalid", { headers: await headers() })))
    redirect(new URL(buildOnSiteCheckoutStartHref(selection, query.uiLocale as string | undefined), resolveCanonicalPortalOrigin()).toString());
  return <CheckoutStartClient siteId={siteId} initialSelection={selection} onSite showOnSiteChoice intentEnabled={intentEnabled} retainedIntentEnabled={isMemberCheckoutSingleRetainedIntentEnabled(siteId)}/>;
}
