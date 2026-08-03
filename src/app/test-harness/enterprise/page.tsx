import { notFound } from "next/navigation";
import type { Metadata } from "next";
import MerchantEnterpriseManager from "@/components/admin/MerchantEnterpriseManager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function EnterpriseBrowserTestHarnessPage() {
  if (
    process.env.FAOLLA_ENTERPRISE_E2E_HARNESS !==
    "enabled-for-local-browser-tests"
  ) {
    notFound();
  }

  return (
    <MerchantEnterpriseManager
      siteId="10000000"
      siteName="企业管理浏览器验收"
      accessToken="enterprise-e2e-access-token"
      collaborationRefreshIntervalMs={400}
      standalone
    />
  );
}
