import { notFound } from "next/navigation";
import type { Metadata } from "next";
import MerchantEmployeeWorkspace from "@/components/enterprise/MerchantEmployeeWorkspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function EmployeeWorkspaceBrowserTestHarnessPage() {
  if (
    process.env.FAOLLA_ENTERPRISE_E2E_HARNESS !==
    "enabled-for-local-browser-tests"
  ) {
    notFound();
  }

  return (
    <MerchantEmployeeWorkspace
      siteId="10000000"
      accessToken="employee-workspace-e2e-access-token"
    />
  );
}
