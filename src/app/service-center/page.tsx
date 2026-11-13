import { headers } from "next/headers";
import { notFound } from "next/navigation";
import ServiceFrameClient from "@/components/service-center/ServiceFrameClient";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { authorizeMerchantServiceOrigin } from "@/lib/merchantServiceOrigin.server";
import { isServiceSection } from "@/lib/merchantServiceFrame";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function ServiceCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const values = await searchParams;
  const read = (key: string) => typeof values[key] === "string" ? values[key] as string : "";
  const siteId = read("siteId"), parentOrigin = read("parentOrigin"), nonce = read("nonce");
  const requestHeaders = await headers();
  const request = new Request("https://launch.faolla.com/service-center", { headers: requestHeaders });
  if (!isCanonicalPortalRequest(request) || !/^[a-zA-Z0-9-]{16,80}$/.test(nonce) ||
      !await authorizeMerchantServiceOrigin(request, parentOrigin, siteId)) notFound();
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId);
  const section = read("section");
  return <ServiceFrameClient siteId={siteId} siteName={site?.merchantName || site?.name || siteId}
    parentOrigin={parentOrigin} nonce={nonce} initialSection={isServiceSection(section) ? section : "account"} />;
}
