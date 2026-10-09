import type { Metadata } from "next";
import MerchantAttendanceAdministrativeClosurePage from "@/components/enterprise/MerchantAttendanceAdministrativeClosurePage";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "本人行政结案记录与异议 · Faolla", referrer: "no-referrer", robots: { index: false, follow: false } };
// No active membership, self.view, employment or close-rollout page gate.
// Actual password Auth and saved self identity are checked by the API/SQL.
export default function Page() { return <MerchantAttendanceAdministrativeClosurePage/>; }
