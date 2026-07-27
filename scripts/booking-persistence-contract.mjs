export const BOOKING_PERSISTENCE_MERCHANT_ID = "__faolla_booking_persistence__";

export const EXPECTED_BOOKING_PERSISTENCE_STORES = {
  "__merchant_booking_records__:v1": {
    collection: "records",
    isValid: (value) => Array.isArray(value?.records),
  },
  "__merchant_booking_workbench__:v1": {
    collection: "settingsBySiteId",
    isValid: (value) => isRecord(value?.settingsBySiteId),
  },
  "__merchant_booking_rules__:v1": {
    collection: "snapshots",
    isValid: (value) => isRecord(value?.snapshots),
  },
};

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function entryCount(value, collection) {
  const entries = value?.[collection];
  if (Array.isArray(entries)) return entries.length;
  if (isRecord(entries)) return Object.keys(entries).length;
  return null;
}

export function summarizeBookingPersistenceRows(rows) {
  const bySlug = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const slug = typeof row?.slug === "string" ? row.slug.trim() : "";
    if (!Object.hasOwn(EXPECTED_BOOKING_PERSISTENCE_STORES, slug)) continue;
    const expected = EXPECTED_BOOKING_PERSISTENCE_STORES[slug];
    if (bySlug.has(slug)) continue;
    const value = row?.blocks;
    bySlug.set(slug, {
      slug,
      valid: expected.isValid(value),
      entryCount: entryCount(value, expected.collection),
      updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
    });
  }

  const stores = Object.keys(EXPECTED_BOOKING_PERSISTENCE_STORES).map(
    (slug) =>
      bySlug.get(slug) ?? {
        slug,
        valid: false,
        entryCount: null,
        updatedAt: null,
      },
  );
  return {
    complete: stores.every((store) => store.valid),
    stores,
  };
}

export function summarizeBookingPersistenceMetadataRows(rows) {
  const bySlug = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const slug = typeof row?.slug === "string" ? row.slug.trim() : "";
    if (!Object.hasOwn(EXPECTED_BOOKING_PERSISTENCE_STORES, slug)) continue;
    if (bySlug.has(slug)) continue;
    bySlug.set(slug, {
      slug,
      valid: true,
      entryCount: null,
      updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
    });
  }

  const stores = Object.keys(EXPECTED_BOOKING_PERSISTENCE_STORES).map(
    (slug) =>
      bySlug.get(slug) ?? {
        slug,
        valid: false,
        entryCount: null,
        updatedAt: null,
      },
  );
  return {
    complete: stores.every((store) => store.valid),
    stores,
  };
}
