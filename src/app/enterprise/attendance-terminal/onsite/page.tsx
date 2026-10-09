import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MerchantAttendanceOnsiteDisplay from "@/components/enterprise/MerchantAttendanceOnsiteDisplay";
import { resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { terminalRecoveryUrlFromOrigin } from "@/lib/merchantAttendanceTerminalRecovery";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "门店现场扫码 · Faolla", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function AttendanceOnsiteTerminalPage() {
  if (process.env.FAOLLA_ATTENDANCE_SELF_ENABLED !== "1" || process.env.FAOLLA_ATTENDANCE_TERMINALS_ENABLED !== "1"
    || process.env.FAOLLA_ATTENDANCE_ONSITE_QR_ENABLED !== "1") notFound();
  // Configuration only: never request Host, forwarded headers or query values.
  const recoveryUrl = terminalRecoveryUrlFromOrigin(resolveCanonicalPortalOrigin());
  const scanOrigin = recoveryUrl ? new URL(recoveryUrl).origin : null;
  return <MerchantAttendanceOnsiteDisplay scanOrigin={scanOrigin} recoveryUrl={recoveryUrl}/>;
}
