import { notFound } from "next/navigation";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import CheckoutConfigurationClient from "./ConfigurationClient";

export default async function CheckoutConfigurationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, siteId = params.siteId;
  if (typeof siteId !== "string" || !/^\d{8}$/.test(siteId) || !isMemberCheckoutPilotEnabled(siteId)) notFound();
  // No merchant data is loaded here. The owner-only API performs current
  // authorization/service/module checks before reading any configuration.
  return <CheckoutConfigurationClient siteId={siteId}/>;
}
