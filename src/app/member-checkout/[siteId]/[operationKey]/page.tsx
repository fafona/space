import { notFound } from "next/navigation";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import CheckoutResultClient from "./CheckoutResultClient";
export default async function MemberCheckoutResultPage({ params }: { params: Promise<{ siteId: string; operationKey: string }> }) {
  const { siteId, operationKey } = await params;
  if (!/^\d{8}$/.test(siteId) || !/^[a-f0-9]{64}$/.test(operationKey) || !isMemberCheckoutPilotEnabled(siteId)) notFound();
  return <CheckoutResultClient siteId={siteId} operationKey={operationKey}/>;
}
