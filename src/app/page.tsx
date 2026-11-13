import HomePageClient from "./HomePageClient";
import { homeBlocks } from "@/data/homeBlocks";
import { loadPublishedPlatformHomeBlocks } from "@/lib/platformPublished";
import { headers } from "next/headers";
import SitePage from "./site/[siteId]/page";
import MerchantHostEntry from "@/components/MerchantHostEntry";
import { resolvePublicMerchantHost } from "@/lib/publicMerchantHost.server";
import { resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";

export const revalidate = 30;
export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchParamValue(searchParams: Record<string, string | string[] | undefined> | undefined, key: string) {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function shouldUseLocalTemplate(searchParams: Record<string, string | string[] | undefined> | undefined) {
  const template = readSearchParamValue(searchParams, "template").trim().toLowerCase();
  const localTemplate = readSearchParamValue(searchParams, "localTemplate").trim().toLowerCase();
  return template === "local" || localTemplate === "1" || localTemplate === "true";
}

export default async function Page({ searchParams }: HomePageProps) {
  // Decide on the server, before fetching/rendering the platform homepage.
  // This does not expand auth middleware or change any origin/security boundary.
  const requestHeaders = await headers();
  const merchantHost = await resolvePublicMerchantHost(requestHeaders.get("host") ?? "");
  if (merchantHost?.siteId) return <SitePage params={Promise.resolve({ siteId: merchantHost.siteId })} searchParams={searchParams} />;
  if (merchantHost) return <MerchantHostEntry prefix={merchantHost.prefix} serviceOrigin={resolveCanonicalPortalOrigin()} />;
  const resolvedSearchParams = await searchParams;
  const useLocalTemplate = shouldUseLocalTemplate(resolvedSearchParams);
  const { blocks } = useLocalTemplate ? { blocks: null } : await loadPublishedPlatformHomeBlocks();
  const initialBlocks = blocks ?? homeBlocks;
  return <HomePageClient initialBlocks={initialBlocks} />;
}
