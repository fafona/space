import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { buildMerchantSitemapEntry } from "@/lib/merchantSeo";
import { loadPublishedMerchantSnapshotSites } from "@/lib/publishedMerchantService";

export const dynamic = "force-dynamic";

const loadCachedPublishedMerchantSnapshotSites = unstable_cache(
  loadPublishedMerchantSnapshotSites,
  ["merchant-sitemap-sites-v1"],
  { revalidate: 60 },
);

function readPublicOrigin() {
  const configured = String(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "").trim();
  if (!configured) return "https://www.faolla.com";
  try {
    return new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`).origin;
  } catch {
    return "https://www.faolla.com";
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = readPublicOrigin();
  const merchantEntries = (await loadCachedPublishedMerchantSnapshotSites().catch(() => []))
    .map((site) => buildMerchantSitemapEntry(site, origin))
    .filter((entry): entry is MetadataRoute.Sitemap[number] => Boolean(entry));

  return [
    {
      url: origin,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    ...merchantEntries,
  ];
}
