import { notFound } from "next/navigation";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import { isMemberCheckoutOnSitePilotEnabled } from "@/lib/merchantCheckoutOnSitePilot.server";
import { parseCheckoutStartQuery, type CheckoutClientSelection } from "@/lib/merchantCheckoutClient";
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
  return <CheckoutStartClient siteId={siteId} initialSelection={selection} showOnSiteChoice={isMemberCheckoutOnSitePilotEnabled(siteId)}/>;
}
