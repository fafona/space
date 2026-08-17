import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantCatalogGet,
  handleMerchantCatalogMutation,
  verifyMerchantCatalogProductImageAssets,
  type MerchantCatalogMutationRouteDependencies,
} from "@/app/api/orders/catalog/route";
import {
  MERCHANT_CATALOG_MAX_PRODUCT_IMAGE_BYTES,
  normalizeMerchantCatalog,
  prepareMerchantCatalogProductImageImport,
  type MerchantCatalog,
} from "@/lib/merchantCatalog";

const SITE_ID = "10000000";

function catalog(): MerchantCatalog {
  return normalizeMerchantCatalog({
    revision: 3,
    updatedAt: "2026-08-17T10:00:00.000Z",
    pricePrefix: "€",
    products: [],
    categories: [],
    collections: [],
  });
}

function request(items: unknown, method = "POST") {
  return new Request("https://merchant.faolla.test/api/orders/catalog", {
    method,
    headers: {
      "content-type": "application/json",
      host: "merchant.faolla.test",
      origin: "https://merchant.faolla.test",
    },
    body: JSON.stringify({
      siteId: SITE_ID,
      action: "bulk_import_products",
      expectedRevision: 3,
      items,
    }),
  });
}

function dependencies(current: MerchantCatalog = catalog()) {
  const calls = {
    mutations: 0,
    siteId: "",
    expectedRevision: -1,
    source: "",
  };
  const overrides: Partial<MerchantCatalogMutationRouteDependencies> = {
    async resolveSession(_request, options) {
      assert.equal(options?.hintedMerchantId, SITE_ID);
      return { merchantId: SITE_ID, merchantEmail: "", merchantName: "" };
    },
    async loadSnapshotSite(siteId) {
      assert.equal(siteId, SITE_ID);
      return {
        id: SITE_ID,
        permissionConfig: {
          allowProductBlock: true,
          allowOrderManagement: true,
        },
      } as NonNullable<Awaited<ReturnType<MerchantCatalogMutationRouteDependencies["loadSnapshotSite"]>>>;
    },
    createServiceClient() {
      return { from: () => null };
    },
    async mutateCatalog(_supabase, input) {
      calls.mutations += 1;
      calls.siteId = input.siteId;
      calls.expectedRevision = input.expectedRevision;
      calls.source = input.source ?? "";
      const decision = await input.mutate(current);
      return decision.ok
        ? { error: null, catalog: decision.catalog }
        : { error: decision.error, catalog: current };
    },
  };
  return { calls, overrides };
}

test("bulk import API forwards its action body into the catalog mutation", async () => {
  const harness = dependencies();
  const response = await handleMerchantCatalogMutation(
    request([
      {
        code: "SKU-NEW",
        name: "Imported product",
        description: "Imported description",
        price: "19.90",
        tag: "Imported",
      },
    ]),
    harness.overrides,
  );
  const payload = (await response.json()) as {
    ok?: boolean;
    catalog?: MerchantCatalog;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(harness.calls.mutations, 1);
  assert.equal(harness.calls.siteId, SITE_ID);
  assert.equal(harness.calls.expectedRevision, 3);
  assert.equal(harness.calls.source, "orders-catalog-bulk_import_products");
  assert.deepEqual(payload.catalog?.products[0], {
    id: payload.catalog?.products[0]?.id,
    code: "SKU-NEW",
    name: "Imported product",
    description: "Imported description",
    price: "19.90",
    imageUrl: "",
    thumbnailUrl: "",
    tag: "Imported",
    availability: "hidden",
  });
});

test("bulk import API maps duplicate, invalid and limit errors to stable statuses", async (t) => {
  const cases: Array<{ name: string; items: unknown; status: number; error: string }> = [
    {
      name: "duplicate normalized code",
      items: [
        { code: "SKU-001", name: "One", price: "1.00" },
        { code: "sku 001", name: "Two", price: "2.00" },
      ],
      status: 409,
      error: "merchant_catalog_import_duplicate_code",
    },
    {
      name: "invalid import row",
      items: [{ code: "", name: "Missing code", price: "1.00" }],
      status: 400,
      error: "invalid_merchant_catalog_import_code",
    },
    {
      name: "catalog limit exceeded",
      items: Array.from({ length: 1_001 }, (_, index) => ({
        code: `SKU-${index}`,
        name: `Product ${index}`,
        price: "1.00",
      })),
      status: 413,
      error: "merchant_catalog_limit_exceeded",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const harness = dependencies();
      const response = await handleMerchantCatalogMutation(request(scenario.items), harness.overrides);
      const payload = (await response.json()) as { error?: string };

      assert.equal(response.status, scenario.status);
      assert.equal(payload.error, scenario.error);
      assert.equal(harness.calls.mutations, 1);
    });
  }
});

function getRequest() {
  return new Request(`https://merchant.faolla.test/api/orders/catalog?siteId=${SITE_ID}`, {
    headers: {
      host: "merchant.faolla.test",
    },
  });
}

test("catalog GET and PATCH convert dependency exceptions into a stable no-store 503", async (t) => {
  const stages = ["resolveSession", "loadSnapshotSite", "createServiceClient"] as const;
  const handlers = [
    {
      name: "GET",
      run: (overrides: Partial<MerchantCatalogMutationRouteDependencies>) =>
        handleMerchantCatalogGet(getRequest(), overrides),
    },
    {
      name: "PATCH",
      run: (overrides: Partial<MerchantCatalogMutationRouteDependencies>) =>
        handleMerchantCatalogMutation(request([], "PATCH"), overrides),
    },
  ];

  for (const handler of handlers) {
    for (const stage of stages) {
      await t.test(`${handler.name} ${stage}`, async () => {
        const harness = dependencies();
        if (stage === "resolveSession") {
          harness.overrides.resolveSession = async () => {
            throw new Error("session dependency failed");
          };
        } else if (stage === "loadSnapshotSite") {
          harness.overrides.loadSnapshotSite = async () => {
            throw new Error("permission dependency failed");
          };
        } else {
          harness.overrides.createServiceClient = () => {
            throw new Error("storage dependency failed");
          };
        }
        const response = await handler.run(harness.overrides);
        const payload = (await response.json()) as { error?: string };

        assert.equal(response.status, 503);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(payload, { error: "merchant_catalog_service_unavailable" });
      });
    }
  }
});

test("catalog GET and PATCH preserve explicit 401 and 403 authorization semantics", async (t) => {
  const handlers = [
    {
      name: "GET",
      run: (overrides: Partial<MerchantCatalogMutationRouteDependencies>) =>
        handleMerchantCatalogGet(getRequest(), overrides),
    },
    {
      name: "PATCH",
      run: (overrides: Partial<MerchantCatalogMutationRouteDependencies>) =>
        handleMerchantCatalogMutation(request([], "PATCH"), overrides),
    },
  ];
  for (const handler of handlers) {
    await t.test(`${handler.name} unauthorized`, async () => {
      const harness = dependencies();
      harness.overrides.resolveSession = async () => null;
      const response = await handler.run(harness.overrides);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { error: "unauthorized" });
    });
    await t.test(`${handler.name} disabled`, async () => {
      const harness = dependencies();
      harness.overrides.loadSnapshotSite = async () => null;
      const response = await handler.run(harness.overrides);
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { error: "order_management_disabled" });
    });
  }
});

function imageCatalog(imageUrl = "", thumbnailUrl = "") {
  const value = catalog();
  value.products.push({
    id: "product-a",
    code: "A",
    name: "Product A",
    description: "",
    price: "10.00",
    imageUrl,
    thumbnailUrl,
    tag: "",
    availability: "hidden",
  });
  return value;
}

function imageUrl(fileName = "1723867200000-abc123.jpg") {
  return `/storage/v1/object/public/page-assets/merchant-assets/${SITE_ID}/2026/08/${fileName}`;
}

function imageMutationRequest(items: unknown, extra: Record<string, unknown> = {}) {
  return new Request("https://merchant.faolla.test/api/orders/catalog", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "merchant.faolla.test",
      origin: "https://merchant.faolla.test",
    },
    body: JSON.stringify({
      siteId: SITE_ID,
      action: "bulk_set_product_images",
      expectedRevision: 3,
      items,
      ...extra,
    }),
  });
}

test("bulk image API injects its authorized site, verifies storage, and returns the applied plan", async () => {
  const mainUrl = imageUrl();
  const thumbnailUrl = imageUrl("1723867200000-abc123-thumb.webp");
  const harness = dependencies(imageCatalog());
  let verified = 0;
  harness.overrides.verifyProductImageAssets = async (_client, items) => {
    verified += 1;
    assert.equal(items.length, 1);
    assert.equal(items[0]?.imageAsset.objectPath, `merchant-assets/${SITE_ID}/2026/08/1723867200000-abc123.jpg`);
    return { ok: true };
  };

  const response = await handleMerchantCatalogMutation(
    imageMutationRequest(
      [{ fileName: "A.jpg", imageUrl: mainUrl, thumbnailUrl }],
      { merchantId: "87654321" },
    ),
    harness.overrides,
  );
  const payload = (await response.json()) as {
    ok?: boolean;
    catalog?: MerchantCatalog;
    rows?: Array<{ action?: string; productId?: string }>;
    summary?: { updated?: number };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(verified, 1);
  assert.equal(harness.calls.source, "orders-catalog-bulk_set_product_images");
  assert.equal(payload.catalog?.products[0]?.imageUrl, mainUrl);
  assert.equal(payload.catalog?.products[0]?.thumbnailUrl, thumbnailUrl);
  assert.deepEqual(payload.rows?.map((row) => [row.action, row.productId]), [["update", "product-a"]]);
  assert.equal(payload.summary?.updated, 1);
});

test("bulk image API rejects cross-tenant and non-storage URLs before catalog mutation", async (t) => {
  const cases = [
    `/storage/v1/object/public/page-assets/merchant-assets/87654321/2026/08/1723867200000-abc123.jpg`,
    "https://evil.example/image.jpg",
    "data:image/png;base64,AA==",
    "blob:https://merchant.faolla.test/id",
  ];
  for (const unsafeUrl of cases) {
    await t.test(unsafeUrl.slice(0, 48), async () => {
      const harness = dependencies(imageCatalog());
      const response = await handleMerchantCatalogMutation(
        imageMutationRequest([{ fileName: "A.jpg", imageUrl: unsafeUrl }]),
        harness.overrides,
      );
      const payload = (await response.json()) as { error?: string; rowIndex?: number };

      assert.equal(response.status, 400);
      assert.equal(payload.error, "invalid_merchant_catalog_product_image_asset");
      assert.equal(payload.rowIndex, 0);
      assert.equal(harness.calls.mutations, 0);
    });
  }
});

test("bulk image API rejects no-op plans before storage traffic", async () => {
  const mainUrl = imageUrl();
  const harness = dependencies(imageCatalog(mainUrl));
  let verified = 0;
  harness.overrides.verifyProductImageAssets = async () => {
    verified += 1;
    return { ok: true };
  };

  const response = await handleMerchantCatalogMutation(
    imageMutationRequest([{ fileName: "A.jpg", imageUrl: mainUrl }]),
    harness.overrides,
  );
  const payload = (await response.json()) as { error?: string; summary?: { unchanged?: number } };

  assert.equal(response.status, 409);
  assert.equal(payload.error, "merchant_catalog_image_import_no_changes");
  assert.equal(payload.summary?.unchanged, 1);
  assert.equal(verified, 0);
});

test("bulk image API returns structured duplicate matches without storage traffic", async () => {
  const harness = dependencies(imageCatalog());
  let verified = 0;
  harness.overrides.verifyProductImageAssets = async () => {
    verified += 1;
    return { ok: true };
  };
  const response = await handleMerchantCatalogMutation(
    imageMutationRequest([
      { fileName: "A.jpg", imageUrl: imageUrl() },
      { fileName: "a.png", imageUrl: imageUrl("1723867200001-def456.png") },
    ]),
    harness.overrides,
  );
  const payload = (await response.json()) as {
    error?: string;
    rowIndex?: number;
    rows?: Array<{ status?: string }>;
    summary?: { duplicates?: number };
  };

  assert.equal(response.status, 409);
  assert.equal(payload.error, "merchant_catalog_image_import_duplicate_code");
  assert.equal(payload.rowIndex, 1);
  assert.deepEqual(payload.rows?.map((row) => row.status), ["duplicate", "duplicate"]);
  assert.equal(payload.summary?.duplicates, 2);
  assert.equal(verified, 0);
});

test("bulk image API fails atomically with stable storage-verification statuses", async (t) => {
  const cases = [
    { error: "merchant_catalog_product_image_asset_not_found", status: 404 },
    { error: "invalid_merchant_catalog_product_image_asset", status: 400 },
    { error: "merchant_catalog_product_image_asset_limit_exceeded", status: 413 },
    { error: "merchant_catalog_product_image_asset_verification_failed", status: 503 },
  ] as const;
  for (const scenario of cases) {
    await t.test(scenario.error, async () => {
      const current = imageCatalog();
      const harness = dependencies(current);
      harness.overrides.verifyProductImageAssets = async () => ({
        ok: false,
        error: scenario.error,
        rowIndex: 0,
      });
      const response = await handleMerchantCatalogMutation(
        imageMutationRequest([{ fileName: "A.jpg", imageUrl: imageUrl() }]),
        harness.overrides,
      );
      const payload = (await response.json()) as {
        error?: string;
        rowIndex?: number;
        catalog?: MerchantCatalog;
        rows?: Array<{ action?: string }>;
      };

      assert.equal(response.status, scenario.status);
      assert.equal(payload.error, scenario.error);
      assert.equal(payload.rowIndex, 0);
      assert.equal(payload.catalog?.products[0]?.imageUrl, "");
      assert.deepEqual(payload.rows?.map((row) => row.action), ["update"]);
    });
  }
});

function preparedImageAssets(withThumbnail = false) {
  const prepared = prepareMerchantCatalogProductImageImport(
    [
      {
        fileName: "A.jpg",
        imageUrl: imageUrl(),
        ...(withThumbnail ? { thumbnailUrl: imageUrl("1723867200000-abc123-thumb.webp") } : {}),
      },
    ],
    SITE_ID,
  );
  if (!prepared.ok) assert.fail(prepared.error);
  return prepared.items;
}

function storageInfoClient(
  info: (bucket: string, objectPath: string) => Promise<{ data: unknown; error: unknown }>,
) {
  return {
    storage: {
      from(bucket: string) {
        return {
          info(objectPath: string) {
            return info(bucket, objectPath);
          },
        };
      },
    },
  } as never;
}

test("product image storage verification accepts robust metadata variants", async () => {
  const result = await verifyMerchantCatalogProductImageAssets(
    storageInfoClient(async (_bucket, objectPath) => ({
      data: objectPath.endsWith("-thumb.webp")
        ? { content_type: "image/webp", size: 123 }
        : { metadata: { mimetype: "image/jpeg", size: 456 } },
      error: null,
    })),
    preparedImageAssets(true),
  );

  assert.deepEqual(result, { ok: true });
});

test("product image storage verification rejects missing, unsafe and oversized objects", async (t) => {
  const cases: Array<{
    name: string;
    response: { data: unknown; error: unknown };
    error: string;
  }> = [
    {
      name: "object does not exist",
      response: { data: null, error: { statusCode: 404 } },
      error: "merchant_catalog_product_image_asset_not_found",
    },
    {
      name: "wrong MIME",
      response: { data: { contentType: "text/plain", size: 10 }, error: null },
      error: "invalid_merchant_catalog_product_image_asset",
    },
    {
      name: "SVG MIME",
      response: { data: { contentType: "image/svg+xml", size: 10 }, error: null },
      error: "invalid_merchant_catalog_product_image_asset",
    },
    {
      name: "GIF MIME",
      response: { data: { contentType: "image/gif", size: 10 }, error: null },
      error: "invalid_merchant_catalog_product_image_asset",
    },
    {
      name: "BMP MIME",
      response: { data: { contentType: "image/bmp", size: 10 }, error: null },
      error: "invalid_merchant_catalog_product_image_asset",
    },
    {
      name: "extension and MIME mismatch",
      response: { data: { contentType: "image/png", size: 10 }, error: null },
      error: "invalid_merchant_catalog_product_image_asset",
    },
    {
      name: "missing verifiable size metadata",
      response: { data: { contentType: "image/jpeg" }, error: null },
      error: "merchant_catalog_product_image_asset_verification_failed",
    },
    {
      name: "larger than 8 MiB",
      response: {
        data: { contentType: "image/jpeg", size: MERCHANT_CATALOG_MAX_PRODUCT_IMAGE_BYTES + 1 },
        error: null,
      },
      error: "merchant_catalog_product_image_asset_limit_exceeded",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const result = await verifyMerchantCatalogProductImageAssets(
        storageInfoClient(async () => scenario.response),
        preparedImageAssets(),
      );
      assert.deepEqual(result, { ok: false, error: scenario.error, rowIndex: 0 });
    });
  }
});

test("product image storage verification bounds concurrent object-info requests", async () => {
  const prepared = prepareMerchantCatalogProductImageImport(
    Array.from({ length: 24 }, (_, index) => ({
      fileName: `SKU-${index}.jpg`,
      imageUrl: imageUrl(`17238672${String(index).padStart(5, "0")}-${String(index).padStart(6, "0")}.jpg`),
    })),
    SITE_ID,
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  let active = 0;
  let maxActive = 0;
  const result = await verifyMerchantCatalogProductImageAssets(
    storageInfoClient(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return { data: { contentType: "image/jpeg", size: 10 }, error: null };
    }),
    prepared.items,
  );

  assert.deepEqual(result, { ok: true });
  assert.ok(maxActive > 1);
  assert.ok(maxActive <= 8);
});
