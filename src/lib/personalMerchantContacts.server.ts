import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";

export type PersonalMerchantContact = {
  siteId: string;
  name: string;
  email: string;
  phone: string;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function buildPersonalMerchantContactMap(siteIds: string[]) {
  const uniqueSiteIds = [...new Set(siteIds.map((item) => trimText(item)).filter((item) => /^\d{8}$/.test(item)))];
  const entries = await Promise.all(
    uniqueSiteIds.map(async (siteId) => {
      const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
      if (!site) {
        return [
          siteId,
          {
            siteId,
            name: siteId,
            email: "",
            phone: "",
          },
        ] as const;
      }
      const visibility = site.contactVisibility;
      return [
        siteId,
        {
          siteId,
          name: trimText(site.merchantName) || trimText(site.name) || siteId,
          email: visibility?.emailHidden ? "" : trimText(site.contactEmail),
          phone: visibility?.phoneHidden ? "" : trimText(site.contactPhone),
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, PersonalMerchantContact>;
}
