import type { Metadata } from "next";
import EnterpriseSelectorClient from "@/app/enterprise/EnterpriseSelectorClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function EnterpriseSelectorPage() {
  return <EnterpriseSelectorClient />;
}
