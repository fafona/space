import { notFound } from "next/navigation";
import { isMemberCheckoutOnSitePilotEnabled } from "@/lib/merchantCheckoutOnSitePilot.server";
import { parseCheckoutStartQuery, type CheckoutClientSelection } from "@/lib/merchantCheckoutClient";
import CheckoutStartClient from "../../start/CheckoutStartClient";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function OnSiteCheckoutStartPage({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { siteId } = await params; if (!isMemberCheckoutOnSitePilotEnabled(siteId)) notFound(); let selection: CheckoutClientSelection;
  try { selection = parseCheckoutStartQuery(siteId, await searchParams); } catch { notFound(); }
  return <CheckoutStartClient siteId={siteId} initialSelection={selection} onSite showOnSiteChoice/>;
}
