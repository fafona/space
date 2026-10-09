import type { Metadata } from "next";
import MerchantAttendanceDelegationRecoveryPage from "@/components/enterprise/MerchantAttendanceDelegationRecoveryPage";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "核对未确认考勤操作 · Faolla", referrer: "no-referrer", robots: { index: false, follow: false } };
// No feature/role gate here: exact original GETs still authorize at the API.
export default function Page() { return <MerchantAttendanceDelegationRecoveryPage/>; }
