import assert from "node:assert/strict";
import test from "node:test";
import {
  POST,
  assetUploadJson,
  buildAssetUploadFailureMessage,
  buildAssetUploadSuccessBody,
  cleanupEmployeeBusinessAssetUploadObjects,
  reauthorizeAssetUploadStorageWrite,
  resolveAssetUploadActorContext,
  resolveAssetUploadRequestActorContext,
  resolveProductImageUploadProcessingError,
} from "@/app/api/assets/upload/route";

function assertPrivateUploadResponseHeaders(response: Response) {
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("expires"), "0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

const request = new Request("https://merchant.faolla.test/api/assets/upload", {
  method: "POST",
});

const unavailableSnapshotStore = {
  from() {
    throw new Error("snapshot store is not used by this unit test");
  },
} as never;

test("asset upload resolves a numeric merchant hint as the exact session target", async () => {
  let capturedHint = "";
  const actor = await resolveAssetUploadActorContext(
    request,
    unavailableSnapshotStore,
    "12345678",
    {
      async resolveMerchantSession(_request, options) {
        capturedHint = options?.hintedMerchantId ?? "";
        return {
          merchantId: "12345678",
          merchantEmail: "owner@example.com",
          merchantName: "Merchant",
        };
      },
    },
  );

  assert.equal(capturedHint, "12345678");
  assert.equal(actor.ok, true);
  if (actor.ok) assert.equal(actor.effectiveMerchantHint, "12345678");
});

test("asset upload rejects a merchant session that does not match its numeric target", async () => {
  const actor = await resolveAssetUploadActorContext(
    request,
    unavailableSnapshotStore,
    "12345678",
    {
      async resolveMerchantSession(_request, options) {
        assert.equal(options?.hintedMerchantId, "12345678");
        return {
          merchantId: "87654321",
          merchantEmail: "owner@example.com",
          merchantName: "Other merchant",
        };
      },
    },
  );

  assert.deepEqual(actor, { ok: false });
});

test("asset upload keeps the existing non-numeric merchant-hint session behavior", async () => {
  const actor = await resolveAssetUploadActorContext(
    request,
    unavailableSnapshotStore,
    "public",
    {
      async resolveMerchantSession(_request, options) {
        assert.equal(options, undefined);
        return {
          merchantId: "12345678",
          merchantEmail: "owner@example.com",
          merchantName: "Merchant",
        };
      },
    },
  );

  assert.equal(actor.ok, true);
  if (actor.ok) assert.equal(actor.effectiveMerchantHint, "12345678");
});

test("product image uploads fail closed unless JPEG, PNG or WebP decoding produced a thumbnail", () => {
  for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(
      resolveProductImageUploadProcessingError({ usage: "product-image", mime, thumbnailReady: true }),
      null,
    );
    assert.deepEqual(
      resolveProductImageUploadProcessingError({ usage: "product-image", mime, thumbnailReady: false }),
      {
        status: 422,
        code: "product_image_decode_failed",
        message: "Product image decoding failed. Please choose another JPEG, PNG, or WebP file.",
      },
    );
  }
  for (const mime of ["image/gif", "image/bmp", "image/svg+xml", "application/octet-stream"]) {
    assert.deepEqual(
      resolveProductImageUploadProcessingError({ usage: "product-image", mime, thumbnailReady: true }),
      {
        status: 422,
        code: "unsupported_product_image",
        message: "Product images must be JPEG, PNG, or WebP files.",
      },
    );
  }
});

test("thumbnail decode failure does not change non-product upload semantics", () => {
  assert.equal(
    resolveProductImageUploadProcessingError({
      usage: "gallery-block-image",
      mime: "image/gif",
      thumbnailReady: false,
    }),
    null,
  );
});

test("an explicit employee token never falls back to the legacy cookie actor", async () => {
  let legacyCalls = 0;
  let businessCalls = 0;
  const actor = await resolveAssetUploadRequestActorContext(
    new Request("https://merchant.faolla.test/api/assets/upload", {
      method: "POST",
      headers: { "x-merchant-access-token": "employee-token" },
    }),
    unavailableSnapshotStore,
    {
      merchantHint: "12345678",
      rawMerchantHint: "12345678",
      siteId: "12345678",
      folder: "merchant-assets",
      usage: "product-image",
      businessPurpose: undefined,
      businessPurposeProvided: false,
    },
    {
      async resolveLegacyActor() {
        legacyCalls += 1;
        return { ok: true, effectiveMerchantHint: "legacy", permissionConfig: {} } as never;
      },
      async authorizeBusinessRequest() {
        businessCalls += 1;
        return {} as never;
      },
    },
  );

  assert.deepEqual(actor, {
    ok: false,
    status: 400,
    code: "invalid_business_purpose",
  });
  assert.equal(legacyCalls, 0);
  assert.equal(businessCalls, 0);
});

test("legacy owner uploads without a business purpose keep the existing actor resolver", async () => {
  let legacyCalls = 0;
  let businessCalls = 0;
  const actor = await resolveAssetUploadRequestActorContext(
    request,
    unavailableSnapshotStore,
    {
      merchantHint: "12345678",
      rawMerchantHint: "12345678",
      siteId: "",
      folder: "merchant-assets",
      usage: "product-image",
      businessPurpose: undefined,
      businessPurposeProvided: false,
    },
    {
      async resolveLegacyActor(_request, _store, merchantHint) {
        legacyCalls += 1;
        assert.equal(merchantHint, "12345678");
        return {
          ok: true,
          effectiveMerchantHint: merchantHint,
          permissionConfig: {} as never,
        };
      },
      async authorizeBusinessRequest() {
        businessCalls += 1;
        return {} as never;
      },
    },
  );

  assert.equal(actor.ok, true);
  assert.equal(legacyCalls, 1);
  assert.equal(businessCalls, 0);
});

test("order catalog uploads bind exact site and semantic permission", async () => {
  let legacyCalls = 0;
  let authorizationInput: Record<string, unknown> | null = null;
  const employeeActor = {
    type: "employee",
    siteId: "12345678",
    authUserId: "user-1",
    employeeId: "employee-1",
    roleId: "role-1",
    employeeVersion: 2,
    roleVersion: 3,
    principalKey: "employee:employee-1",
    authorizationVersion: "2:3",
    displayName: "Employee",
    email: "employee@example.com",
    collaborationPermissions: [],
    businessPermissions: ["orders.catalog.manage"],
  } as never;
  const actor = await resolveAssetUploadRequestActorContext(
    new Request("https://merchant.faolla.test/api/assets/upload", {
      method: "POST",
      headers: { "x-merchant-access-token": "employee-token" },
    }),
    unavailableSnapshotStore,
    {
      merchantHint: "12345678",
      rawMerchantHint: "12345678",
      siteId: "12345678",
      folder: "merchant-assets",
      usage: "product-image",
      businessPurpose: "order-catalog",
      businessPurposeProvided: true,
    },
    {
      async resolveLegacyActor() {
        legacyCalls += 1;
        return { ok: false };
      },
      async authorizeBusinessRequest(_request, input) {
        authorizationInput = input;
        return employeeActor;
      },
    },
  );

  assert.equal(actor.ok, true);
  assert.equal(legacyCalls, 0);
  assert.deepEqual(authorizationInput, {
    siteId: "12345678",
    requiredPermission: "orders.catalog.manage",
  });
  if (actor.ok) {
    assert.equal(actor.effectiveMerchantHint, "12345678");
    assert.equal(actor.businessAuthorization?.actor, employeeActor);
  }
});

test("the reserved redemption catalog purpose maps to its own manage permission", async () => {
  let requiredPermission = "";
  const actor = await resolveAssetUploadRequestActorContext(
    request,
    unavailableSnapshotStore,
    {
      merchantHint: "12345678",
      rawMerchantHint: "12345678",
      siteId: "12345678",
      folder: "merchant-assets",
      usage: "product-image",
      businessPurpose: "redemption-catalog",
      businessPurposeProvided: true,
    },
    {
      async authorizeBusinessRequest(_request, input) {
        requiredPermission = input.requiredPermission;
        return {
          siteId: input.siteId,
          businessPermissions: [input.requiredPermission],
        } as never;
      },
    },
  );

  assert.equal(actor.ok, true);
  assert.equal(requiredPermission, "redemptions.catalog.manage");
});

test("business uploads reject cross-site hints and non-product scopes before authorization", async () => {
  let authorizationCalls = 0;
  for (const input of [
    {
      merchantHint: "87654321",
      rawMerchantHint: "87654321",
      siteId: "12345678",
      folder: "merchant-assets",
      usage: "product-image",
    },
    {
      merchantHint: "12345678",
      rawMerchantHint: "12345678",
      siteId: "12345678",
      folder: "merchant-files",
      usage: "product-image",
    },
    {
      merchantHint: "12345678",
      rawMerchantHint: "12345678",
      siteId: "12345678",
      folder: "merchant-assets",
      usage: "support-image",
    },
  ]) {
    const actor = await resolveAssetUploadRequestActorContext(
      request,
      unavailableSnapshotStore,
      {
        ...input,
        businessPurpose: "order-catalog",
        businessPurposeProvided: true,
      },
      {
        async authorizeBusinessRequest() {
          authorizationCalls += 1;
          return {} as never;
        },
      },
    );
    assert.equal(actor.ok, false);
    if (!actor.ok) assert.equal(actor.status, 400);
  }
  assert.equal(authorizationCalls, 0);
});

test("storage writes freshly reauthorize the same actor and catalog permission", async () => {
  const actor = {
    ok: true,
    effectiveMerchantHint: "12345678",
    permissionConfig: {},
    businessAuthorization: {
      actor: { principalKey: "employee:employee-1" },
      requiredPermission: "orders.catalog.manage",
      purpose: "order-catalog",
    },
  } as never;
  const reauthorizationInputs: Record<string, unknown>[] = [];
  const result = await reauthorizeAssetUploadStorageWrite(request, actor, {
    async reauthorizeBusinessMutation(_request, input) {
      reauthorizationInputs.push(input as unknown as Record<string, unknown>);
      return input.actor;
    },
  });

  assert.deepEqual(result, { ok: true });
  const reauthorizationInput = reauthorizationInputs[0];
  assert.equal(
    (reauthorizationInput?.actor as { principalKey?: string } | undefined)?.principalKey,
    "employee:employee-1",
  );
  assert.deepEqual(reauthorizationInput?.requiredPermissions, ["orders.catalog.manage"]);
});

test("every upload JSON response carries explicit private anti-cache headers", async () => {
  for (const status of [200, 400, 401, 403, 409, 413, 422, 503]) {
    const response = assetUploadJson({ ok: status === 200 }, { status });
    assert.equal(response.status, status);
    assertPrivateUploadResponseHeaders(response);
  }

  const originRejected = await POST(
    new Request("https://merchant.faolla.test/api/assets/upload", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    }),
  );
  assert.equal(originRejected.status, 403);
  assertPrivateUploadResponseHeaders(originRejected);
});

test("employee success bodies are minimal while owner success schema remains exact", () => {
  const input = {
    bucket: "page-assets",
    objectPath: "merchant-assets/12345678/2026/08/product.webp",
    url: "https://cdn.example.com/product.webp",
    thumbnailUrl: "https://cdn.example.com/product-thumb.webp",
    thumbnailObjectPath:
      "merchant-assets/12345678/2026/08/product-thumb.webp",
    posterUrl: "https://cdn.example.com/product-poster.webp",
    posterObjectPath:
      "merchant-assets/12345678/2026/08/product-poster.webp",
  };

  assert.deepEqual(buildAssetUploadSuccessBody(input, true), {
    ok: true,
    url: input.url,
    thumbnailUrl: input.thumbnailUrl,
    posterUrl: input.posterUrl,
  });
  assert.deepEqual(buildAssetUploadSuccessBody(input, false), {
    ok: true,
    bucket: input.bucket,
    objectPath: input.objectPath,
    url: input.url,
    posterUrl: input.posterUrl,
    posterObjectPath: input.posterObjectPath,
    thumbnailUrl: input.thumbnailUrl,
    thumbnailObjectPath: input.thumbnailObjectPath,
  });
});

test("employee failures never echo bucket or raw storage errors while owner copy stays compatible", () => {
  const internalErrors = [
    "page-assets: new row violates row-level security policy",
    "assets: bucket not found",
  ];
  assert.equal(
    buildAssetUploadFailureMessage(
      internalErrors,
      "Asset upload failed.",
      true,
    ),
    "Asset upload failed.",
  );
  assert.equal(
    buildAssetUploadFailureMessage(
      internalErrors,
      "Asset upload failed.",
      false,
    ),
    internalErrors.join(" | "),
  );
});

test("employee orphan cleanup uses storage service removal without another authorization gate", async () => {
  const removals: Array<{ bucket: string; objectPaths: string[] }> = [];
  const storage = {
    from(bucket: string) {
      return {
        async remove(objectPaths: string[]) {
          removals.push({ bucket, objectPaths });
          return { data: [], error: null };
        },
      };
    },
  };

  await cleanupEmployeeBusinessAssetUploadObjects(
    storage,
    "page-assets",
    ["base.webp", "thumb.webp", "thumb.webp"],
    true,
  );
  assert.deepEqual(removals, [
    {
      bucket: "page-assets",
      objectPaths: ["base.webp", "thumb.webp"],
    },
  ]);

  await cleanupEmployeeBusinessAssetUploadObjects(
    storage,
    "page-assets",
    ["owner.webp"],
    false,
  );
  assert.equal(removals.length, 1, "legacy owner cleanup semantics must not change");
});
