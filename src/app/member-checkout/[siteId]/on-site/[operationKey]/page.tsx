import { notFound } from "next/navigation";
import { isMemberCheckoutOnSitePilotEnabled } from "@/lib/merchantCheckoutOnSitePilot.server";
import CheckoutResultClient from "../../[operationKey]/CheckoutResultClient";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function OnSiteCheckoutResultPage({ params }: { params: Promise<{ siteId: string; operationKey: string }> }) {
  const { siteId, operationKey } = await params; if (!isMemberCheckoutOnSitePilotEnabled(siteId) || !/^[a-f0-9]{64}$/.test(operationKey)) notFound();
  return <CheckoutResultClient siteId={siteId} operationKey={operationKey} onSite/>;
}
