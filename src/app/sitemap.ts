import type { MetadataRoute } from "next";
import { buildMerchantSitemapEntry } from "@/lib/merchantSeo";
import { loadPublishedMerchantSnapshotSites } from "@/lib/publishedMerchantService";

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
  const merchantEntries = (await loadPublishedMerchantSnapshotSites().catch(() => []))
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
