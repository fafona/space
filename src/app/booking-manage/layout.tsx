import type { Metadata } from "next";

export const metadata: Metadata = { title: "管理预约 · Faolla", referrer: "no-referrer", robots: { index: false, follow: false } };

export default function BookingManageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
