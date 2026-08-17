import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAssetUploadActorContext,
  resolveProductImageUploadProcessingError,
} from "@/app/api/assets/upload/route";

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
