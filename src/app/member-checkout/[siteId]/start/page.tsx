import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isMemberCheckoutIntentPilotEnabled } from "@/lib/merchantCheckoutCartPilot.server";
import { isMemberCheckoutSingleRetainedIntentEnabled } from "@/lib/merchantCheckoutSingleRetainedPilot.server";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import { isMemberCheckoutOnSitePilotEnabled } from "@/lib/merchantCheckoutOnSitePilot.server";
import { isMemberCheckoutUnusedReferenceEnabled } from "@/lib/merchantCheckoutUnusedReference.server";
import { buildCheckoutStartHref, parseCheckoutStartQuery, type CheckoutClientSelection } from "@/lib/merchantCheckoutClient";
import CheckoutStartClient from "./CheckoutStartClient";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function MemberCheckoutStartPage({ params, searchParams }: {
  params: Promise<{ siteId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { siteId } = await params;
  if (!/^\d{8}$/.test(siteId) || !isMemberCheckoutPilotEnabled(siteId)) notFound();
  const query = await searchParams;
  let selection: CheckoutClientSelection;
  try {
    selection = parseCheckoutStartQuery(siteId, query);
  } catch { notFound(); }
  const intentEnabled = isMemberCheckoutIntentPilotEnabled(siteId);
  if (intentEnabled && !isCanonicalPortalRequest(new Request("https://invalid.invalid", { headers: await headers() })))
    redirect(new URL(buildCheckoutStartHref(selection, query.uiLocale as string | undefined), resolveCanonicalPortalOrigin()).toString());
  return <CheckoutStartClient siteId={siteId} initialSelection={selection} showOnSiteChoice={isMemberCheckoutOnSitePilotEnabled(siteId)} intentEnabled={intentEnabled} retainedIntentEnabled={isMemberCheckoutSingleRetainedIntentEnabled(siteId)} unusedReferenceEnabled={intentEnabled && isMemberCheckoutUnusedReferenceEnabled(siteId)}/>;
}
