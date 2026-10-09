import type { Metadata } from "next";
import MerchantAttendanceOwnerNotificationsRecoveryPage from "@/components/enterprise/MerchantAttendanceOwnerNotificationsRecoveryPage";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "核对负责人通知已读结果 · Faolla", referrer: "no-referrer", robots: { index: false, follow: false } };
// No current-owner or rollout gate: API authorizes only the exact original actor receipt.
export default function Page() { return <MerchantAttendanceOwnerNotificationsRecoveryPage/>; }
