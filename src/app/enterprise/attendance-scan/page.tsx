import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { onsiteScanOrigin } from "@/lib/merchantAttendanceOnsiteQrBrowser";
import MerchantAttendanceOnsitePhone from "@/components/enterprise/MerchantAttendanceOnsitePhone";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "现场扫码打卡 · Faolla", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function Page() {
  if (process.env.FAOLLA_ATTENDANCE_SELF_ENABLED !== "1" || process.env.FAOLLA_ATTENDANCE_TERMINALS_ENABLED !== "1" || process.env.FAOLLA_ATTENDANCE_ONSITE_QR_ENABLED !== "1") notFound();
  let origin: string | null = null; try { origin = onsiteScanOrigin(resolveCanonicalPortalOrigin()); } catch { /* Fail closed with manual assistance. */ }
  return <MerchantAttendanceOnsitePhone scanOrigin={origin}/>;
}
