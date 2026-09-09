import { notFound } from "next/navigation";
import type { Metadata } from "next";
import RedemptionCheckoutHarness from "./RedemptionCheckoutHarness";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function RedemptionCheckoutBrowserTestPage() {
  if (process.env.FAOLLA_ENTERPRISE_E2E_HARNESS !== "enabled-for-local-browser-tests") notFound();
  return <RedemptionCheckoutHarness />;
}
