import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MemberRedemptionHarness from "./MemberRedemptionHarness";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function MemberRedemptionBrowserHarnessPage() {
  if (process.env.FAOLLA_ENTERPRISE_E2E_HARNESS !== "enabled-for-local-browser-tests") notFound();
  return <MemberRedemptionHarness />;
}
