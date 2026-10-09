import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MerchantAttendanceTerminalDevice from "@/components/enterprise/MerchantAttendanceTerminalDevice";
import {resolveCanonicalPortalOrigin} from "@/lib/canonicalPortalRequest";
import {terminalRecoveryUrlFromOrigin} from "@/lib/merchantAttendanceTerminalRecovery";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "门店终端 · Faolla", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function AttendanceTerminalPage() {
  if (process.env.FAOLLA_ATTENDANCE_TERMINALS_ENABLED !== "1") notFound();
  const onsiteEnabled = process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_ONSITE_QR_ENABLED === "1";
  return <MerchantAttendanceTerminalDevice recoveryUrl={terminalRecoveryUrlFromOrigin(resolveCanonicalPortalOrigin())} onsiteEnabled={onsiteEnabled}/>;
}
