import type { Metadata } from "next";
import MerchantAttendanceIndependentTerminalPanel from "@/components/enterprise/MerchantAttendanceIndependentTerminalPanel";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "独立员工终端打卡 · Faolla", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function IndependentAttendanceTerminalPage() {
  //Flag off only pauses new starts. The paired-device/PIN recovery path must
  //remain reachable; this page exposes no data before actual cookie validation.
  return <MerchantAttendanceIndependentTerminalPanel allowNew={process.env.FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED === "1"} />;
}
