import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMerchantCatalogMutation,
  normalizeMerchantCatalog,
  resolveMerchantCatalogCollection,
  type MerchantCatalog,
} from "@/lib/merchantCatalog";
import {
  loadStoredMerchantCatalog,
  mutateStoredMerchantCatalog,
  saveStoredMerchantCatalog,
  type MerchantCatalogStoreClient,
} from "@/lib/merchantCatalogStore";

type MemoryRow = {
  id: string;
  merchant_id?: string | null;
  slug: string;
  blocks: unknown;
  updated_at?: string | null;
};

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createMemoryClient(initialRows: MemoryRow[] = []) {
  const rows = initialRows.map(cloneValue);
  const calls = { selects: 0, updates: 0, inserts: 0 };
  let sequence = rows.length;
  const client: MerchantCatalogStoreClient = {
    from: () => {
      let operation: "select" | "update" | "insert" = "select";
      let body: Record<string, unknown> = {};
      let returnUpdatedRows = false;
      let rowLimit = Number.POSITIVE_INFINITY;
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select: () => {
          if (operation === "update") returnUpdatedRows = true;
          else operation = "select";
          return builder;
        },
        update: (value: Record<string, unknown>) => {
          operation = "update";
          body = cloneValue(value);
          return builder;
        },
        insert: (value: Record<string, unknown>) => {
          operation = "insert";
          body = cloneValue(value);
          return builder;
        },
        eq: (field: string, value: unknown) => {
          filters.push([field, value]);
          return builder;
        },
        is: (field: string, value: unknown) => {
          filters.push([field, value]);
          return builder;
        },
        limit: (value: number) => {
          rowLimit = value;
          return builder;
        },
        then: (
          resolve: (value: { data: unknown; error: unknown }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => {
          const matches = (row: MemoryRow) =>
            filters.every(([field, value]) => row[field as keyof MemoryRow] === value);
          const execute = () => {
            if (operation === "select") {
              calls.selects += 1;
              return { data: rows.filter(matches).slice(0, rowLimit).map(cloneValue), error: null };
            }
            if (operation === "update") {
              calls.updates += 1;
              const updated = rows.filter(matches);
              updated.forEach((row) => Object.assign(row, cloneValue(body)));
              return { data: returnUpdatedRows ? updated.map(cloneValue) : null, error: null };
            }
            calls.inserts += 1;
            const duplicate = rows.some(
              (row) => row.slug === body.slug && row.merchant_id === body.merchant_id,
            );
            if (duplicate) {
              return {
                data: null,
                error: { message: "duplicate key value violates unique constraint (23505)" },
              };
            }
            sequence += 1;
            rows.push({
              id: `row-${sequence}`,
              merchant_id:
                typeof body.merchant_id === "string"
                  ? body.merchant_id
                  : body.merchant_id === null
                    ? null
                    : undefined,
              slug: String(body.slug ?? ""),
              blocks: cloneValue(body.blocks),
              updated_at: typeof body.updated_at === "string" ? body.updated_at : null,
            });
            return { data: null, error: null };
          };
          return Promise.resolve(execute()).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { client, rows, calls };
}

function initialCatalog(): MerchantCatalog {
  return normalizeMerchantCatalog({
    revision: 1,
    updatedAt: "2026-08-17T10:00:00.000Z",
    pricePrefix: "€",
    products: [
      {
        id: "product-a",
        code: "A",
        name: "Product A",
        description: "",
        price: "10.00",
        imageUrl: "",
        thumbnailUrl: "",
        tag: "Featured",
        availability: "available",
      },
      {
        id: "product-b",
        code: "B",
        name: "Product B",
        description: "",
        price: "20.00",
        imageUrl: "",
        thumbnailUrl: "",
        tag: "Featured",
        availability: "available",
      },
    ],
    categories: [{ id: "featured", name: "Featured", productIds: ["product-a", "product-b"] }],
    collections: [
      {
        id: "collection-a",
        blockId: "product-block",
        viewport: "desktop",
        productIds: ["product-a", "product-b"],
      },
    ],
  });
}

test("catalog store saves a site-owned pages row with history and backup", async () => {
  const { client, rows } = createMemoryClient();
  const saved = await saveStoredMerchantCatalog(client, {
    siteId: "10000000",
    catalog: initialCatalog(),
    expectedRevision: 0,
    updatedAt: "2026-08-17T10:00:00.000Z",
  });

  assert.equal(saved.error, null);
  assert.equal(saved.catalog?.revision, 1);
  assert.ok(rows.some((row) => row.slug === "__merchant_catalog__:10000000"));
  assert.ok(rows.some((row) => row.slug === "__merchant_catalog_history__:10000000"));
  assert.ok(rows.some((row) => row.slug === "__merchant_catalog_history_backup__:10000000"));
  const primary = rows.find((row) => row.slug === "__merchant_catalog__:10000000");
  assert.equal((primary?.blocks as { siteId?: unknown }).siteId, "10000000");
  assert.equal((primary?.blocks as { kind?: unknown }).kind, "merchant_catalog");
  assert.equal((await loadStoredMerchantCatalog(client, "10000000"))?.products.length, 2);
  assert.equal(await loadStoredMerchantCatalog(client, "20000000"), null);
});

test("catalog store mutation merges an action and increments revision", async () => {
  const { client } = createMemoryClient();
  await saveStoredMerchantCatalog(client, {
    siteId: "10000000",
    catalog: initialCatalog(),
    expectedRevision: 0,
    updatedAt: "2026-08-17T10:00:00.000Z",
  });

  const result = await mutateStoredMerchantCatalog(client, {
    siteId: "10000000",
    expectedRevision: 1,
    updatedAt: "2026-08-17T10:01:00.000Z",
    mutate: (current) =>
      applyMerchantCatalogMutation(current, {
        action: "upsert_product",
        product: {
          id: "product-c",
          code: "C",
          name: "Product C",
          price: "30.00",
          availability: "available",
        },
        collectionIds: ["collection-a"],
      }),
  });

  assert.equal(result.error, null);
  assert.equal(result.catalog?.revision, 2);
  assert.deepEqual(result.catalog?.products.map((product) => product.id), ["product-a", "product-b", "product-c"]);
  assert.deepEqual(result.catalog?.categories[0]?.productIds, ["product-a", "product-b"]);
});

test("catalog store denies revoked mutations inside the site lock before canonical reads", async () => {
  const { client, calls } = createMemoryClient();
  await saveStoredMerchantCatalog(client, {
    siteId: "10000000",
    catalog: initialCatalog(),
    expectedRevision: 0,
    updatedAt: "2026-08-17T10:00:00.000Z",
  });
  const selectsBeforeRevokedMutation = calls.selects;
  let mutationEvaluations = 0;

  await assert.rejects(
    mutateStoredMerchantCatalog(client, {
      siteId: "10000000",
      expectedRevision: 1,
      beforeMutation: async () => {
        throw new Error("permission_denied");
      },
      mutate: (current) => {
        mutationEvaluations += 1;
        return applyMerchantCatalogMutation(current, {
          action: "set_price_prefix",
          pricePrefix: "$",
        });
      },
    }),
    /permission_denied/,
  );

  assert.equal(calls.selects, selectsBeforeRevokedMutation);
  assert.equal(mutationEvaluations, 0);
});

test("process lock and expectedRevision allow only one concurrent mutation", async () => {
  const { client } = createMemoryClient();
  await saveStoredMerchantCatalog(client, {
    siteId: "10000000",
    catalog: initialCatalog(),
    expectedRevision: 0,
    updatedAt: "2026-08-17T10:00:00.000Z",
  });

  const mutatePrefix = (pricePrefix: string, updatedAt: string) =>
    mutateStoredMerchantCatalog(client, {
      siteId: "10000000",
      expectedRevision: 1,
      updatedAt,
      mutate: (current) => applyMerchantCatalogMutation(current, { action: "set_price_prefix", pricePrefix }),
    });
  const results = await Promise.all([
    mutatePrefix("$", "2026-08-17T10:01:00.000Z"),
    mutatePrefix("£", "2026-08-17T10:02:00.000Z"),
  ]);

  assert.equal(results.filter((result) => result.error === null).length, 1);
  assert.equal(results.filter((result) => result.error === "merchant_catalog_revision_conflict").length, 1);
  const loaded = await loadStoredMerchantCatalog(client, "10000000");
  assert.equal(loaded?.revision, 2);
  assert.ok(loaded?.pricePrefix === "$" || loaded?.pricePrefix === "£");
});

test("catalog store repairs a corrupt primary from history and remains writable", async () => {
  const { client, rows } = createMemoryClient();
  await saveStoredMerchantCatalog(client, {
    siteId: "10000000",
    catalog: initialCatalog(),
    expectedRevision: 0,
    updatedAt: "2026-08-17T10:00:00.000Z",
  });
  const primary = rows.find((row) => row.slug === "__merchant_catalog__:10000000");
  assert.ok(primary);
  primary.blocks = { invalid: true };

  const recovered = await loadStoredMerchantCatalog(client, "10000000");
  assert.equal(recovered?.revision, 1);
  assert.equal(recovered?.products[0]?.id, "product-a");
  assert.equal((primary.blocks as { kind?: unknown }).kind, "merchant_catalog");

  const updated = await mutateStoredMerchantCatalog(client, {
    siteId: "10000000",
    expectedRevision: 1,
    updatedAt: "2026-08-17T10:01:00.000Z",
    mutate: (current) => applyMerchantCatalogMutation(current, { action: "set_price_prefix", pricePrefix: "$" }),
  });
  assert.equal(updated.error, null);
  assert.equal(updated.catalog?.revision, 2);
  assert.equal(updated.catalog?.pricePrefix, "$");
});

test("pure catalog CRUD keeps ids stable and removes deleted product references", () => {
  const original = initialCatalog();
  assert.deepEqual(
    applyMerchantCatalogMutation(original, {
      action: "upsert_product",
      productId: "product-a",
      product: { ...original.products[0], id: "changed-id" },
    }),
    { ok: false, error: "merchant_catalog_product_id_immutable" },
  );
  const renamed = applyMerchantCatalogMutation(original, {
    action: "upsert_product",
    productId: "product-a",
    product: { ...original.products[0], name: "Renamed A" },
  });
  assert.equal(renamed.ok, true);
  if (!renamed.ok) return;
  assert.deepEqual(renamed.catalog.products.map((product) => product.id), ["product-a", "product-b"]);
  assert.equal(renamed.catalog.products[0]?.name, "Renamed A");
  assert.equal(original.products[0]?.name, "Product A");

  const unavailable = applyMerchantCatalogMutation(renamed.catalog, {
    action: "set_availability",
    productId: "product-a",
    availability: "sold_out",
  });
  assert.equal(unavailable.ok, true);
  if (!unavailable.ok) return;
  assert.equal(unavailable.catalog.products[0]?.availability, "sold_out");

  const deleted = applyMerchantCatalogMutation(unavailable.catalog, {
    action: "delete_product",
    productId: "product-a",
  });
  assert.equal(deleted.ok, true);
  if (!deleted.ok) return;
  assert.deepEqual(deleted.catalog.products.map((product) => product.id), ["product-b"]);
  assert.deepEqual(deleted.catalog.categories[0]?.productIds, ["product-b"]);
  assert.deepEqual(deleted.catalog.collections[0]?.productIds, ["product-b"]);
});

test("category and collection CRUD rejects dangling product references", () => {
  const catalog = initialCatalog();
  const invalidCategory = applyMerchantCatalogMutation(catalog, {
    action: "upsert_category",
    category: { id: "new", name: "New", productIds: ["missing"] },
  });
  assert.deepEqual(invalidCategory, { ok: false, error: "merchant_catalog_product_reference_not_found" });

  const category = applyMerchantCatalogMutation(catalog, {
    action: "upsert_category",
    category: { id: "new", name: "New", productIds: ["product-a"] },
  });
  assert.equal(category.ok, true);
  if (!category.ok) return;
  const collection = applyMerchantCatalogMutation(category.catalog, {
    action: "upsert_collection",
    collection: {
      id: "mobile-products",
      blockId: "product-block",
      viewport: "mobile",
      productIds: ["product-a"],
    },
  });
  assert.equal(collection.ok, true);
  if (!collection.ok) return;
  assert.equal(resolveMerchantCatalogCollection(collection.catalog, "product-block", "mobile")?.id, "mobile-products");

  const withoutCategory = applyMerchantCatalogMutation(collection.catalog, {
    action: "delete_category",
    categoryId: "new",
  });
  assert.equal(withoutCategory.ok, true);
  if (!withoutCategory.ok) return;
  const withoutCollection = applyMerchantCatalogMutation(withoutCategory.catalog, {
    action: "delete_collection",
    collectionId: "mobile-products",
  });
  assert.equal(withoutCollection.ok, true);
});

test("collection scopes are unique and ambiguous persisted scopes fail closed", () => {
  const catalog = initialCatalog();
  const duplicate = applyMerchantCatalogMutation(catalog, {
    action: "upsert_collection",
    collection: {
      id: "another-desktop",
      blockId: "product-block",
      viewport: "desktop",
      productIds: ["product-a"],
    },
  });
  assert.deepEqual(duplicate, { ok: false, error: "merchant_catalog_collection_scope_conflict" });

  const ambiguous = normalizeMerchantCatalog({
    ...catalog,
    collections: [
      ...catalog.collections,
      {
        id: "another-desktop",
        blockId: "product-block",
        viewport: "desktop",
        productIds: ["product-a"],
      },
    ],
  });
  assert.equal(resolveMerchantCatalogCollection(ambiguous, "product-block", "desktop"), null);
});
