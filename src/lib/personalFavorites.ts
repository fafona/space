/** A favorite created from a merchant website is also its membership entry. */
export type PersonalFavoriteSite = { id: string; url: string; name: string; subtitle: string; addedAt: string };

export function readFavoriteSiteId(value: Pick<PersonalFavoriteSite, "id" | "url">) {
  const storedId = value.id.match(/^(?:merchant:)?(\d{8})$/)?.[1];
  if (storedId) return storedId;
  try {
    const path = new URL(value.url, "https://faolla.com").pathname;
    return path.match(/^\/(?:site\/)?(\d{8})(?:\/|$)/)?.[1] ?? "";
  } catch { return ""; }
}

export function favoriteMatchesMerchant(value: Pick<PersonalFavoriteSite, "id" | "url">, siteId: string, tenantOrigin = "") {
  const knownId = readFavoriteSiteId(value);
  if (knownId) return knownId === siteId;
  if (!tenantOrigin) return false;
  try { return new URL(value.url).origin === tenantOrigin; } catch { return false; }
}

export function normalizePersonalFavorites(value: unknown): PersonalFavoriteSite[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    try {
      const url = new URL(String(row.url ?? ""), "https://faolla.com");
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return [];
      const id = String(row.id ?? "").trim().slice(0, 256) || url.origin + url.pathname;
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ id, url: url.toString(), name: String(row.name ?? "").slice(0, 160),
        subtitle: String(row.subtitle ?? "").slice(0, 320), addedAt: String(row.addedAt ?? "").slice(0, 64) }];
    } catch { return []; }
  }).slice(0, 500);
}

/** Only the selected favorite changes; unrelated profile fields and historical data stay intact. */
export function projectMembershipFavorite<T extends Record<string, unknown>>(metadata: T, change: {
  siteId: string; favorite?: PersonalFavoriteSite; remove?: boolean; previousId?: string;
}) {
  const profile = metadata.personal_profile && typeof metadata.personal_profile === "object"
    ? metadata.personal_profile as Record<string, unknown> : {};
  const favorites = normalizePersonalFavorites(profile.favoriteSites);
  const matches = (site: PersonalFavoriteSite) => readFavoriteSiteId(site) === change.siteId ||
    Boolean(change.previousId && site.id === change.previousId) ||
    Boolean(change.favorite && site.url.replace(/\/$/, "") === change.favorite.url.replace(/\/$/, ""));
  const existing = favorites.find(matches);
  const remaining = favorites.filter(site => !matches(site));
  const next = change.remove ? remaining : change.favorite
    ? [{ ...change.favorite, addedAt: existing?.addedAt || change.favorite.addedAt }, ...remaining] : favorites;
  return { ...metadata, personal_profile: { ...profile, favoriteSites: next } };
}
