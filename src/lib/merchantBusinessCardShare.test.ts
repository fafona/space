import assert from "node:assert/strict";
import test from "node:test";
import {
  MERCHANT_BUSINESS_CARD_SHARE_KEY_PARAM,
  buildMerchantBusinessCardShareDescription,
  buildMerchantBusinessCardShareManifestObjectPath,
  buildMerchantBusinessCardShareManifestPublicUrls,
  buildMerchantBusinessCardShareTitle,
  buildMerchantBusinessCardShareUrl,
  normalizeMerchantBusinessCardShareImageUrl,
  normalizeMerchantBusinessCardShareKey,
  parseMerchantBusinessCardShareParams,
  readMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
} from "./merchantBusinessCardShare";

test("buildMerchantBusinessCardShareUrl creates a short share route when share key exists", () => {
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "http://localhost:3000",
    shareKey: "card-abc123",
    name: "fafona",
    imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
    targetUrl: "https://fafona.faolla.com",
  });

  assert.equal(shareUrl, `https://faolla.com/share/business-card?${MERCHANT_BUSINESS_CARD_SHARE_KEY_PARAM}=card-abc123`);
});

test("readMerchantBusinessCardShareKey normalizes the short share key from search params", () => {
  assert.equal(
    readMerchantBusinessCardShareKey({
      [MERCHANT_BUSINESS_CARD_SHARE_KEY_PARAM]: "Card-Abc123",
    }),
    "card-abc123",
  );
});

test("buildMerchantBusinessCardShareUrl falls back to legacy encoded params when share key is absent", () => {
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "https://faolla.com",
    name: "fafona",
    imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
    targetUrl: "https://fafona.faolla.com",
  });

  assert.equal(
    shareUrl,
    "https://faolla.com/share/business-card?image=https%3A%2F%2Ffaolla.com%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fpage-assets%2Fcard.png&target=https%3A%2F%2Ffafona.faolla.com%2F&name=fafona",
  );
});

test("resolveMerchantBusinessCardShareOrigin prefers target root domain over localhost", () => {
  assert.equal(
    resolveMerchantBusinessCardShareOrigin("http://localhost:3000", "https://fafona.faolla.com"),
    "https://faolla.com",
  );
  assert.equal(resolveMerchantBusinessCardShareOrigin("http://www.faolla.com"), "https://www.faolla.com");
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "www.fafona.com";
  try {
    assert.equal(resolveMerchantBusinessCardShareOrigin("http://localhost:3000"), "https://www.fafona.com");
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});

test("share manifest helpers build stable public paths", () => {
  assert.equal(buildMerchantBusinessCardShareManifestObjectPath("card-abc123"), "merchant-shares/card-abc123.json");
  assert.deepEqual(buildMerchantBusinessCardShareManifestPublicUrls("card-abc123", "https://faolla.com"), [
    "https://faolla.com/storage/v1/object/public/page-assets/merchant-shares/card-abc123.json",
    "https://faolla.com/storage/v1/object/public/assets/merchant-shares/card-abc123.json",
    "https://faolla.com/storage/v1/object/public/uploads/merchant-shares/card-abc123.json",
    "https://faolla.com/storage/v1/object/public/public/merchant-shares/card-abc123.json",
  ]);
});

test("parseMerchantBusinessCardShareParams rejects unsupported image urls", () => {
  const payload = parseMerchantBusinessCardShareParams(
    {
      image: "data:image/png;base64,abc",
      target: "https://fafona.faolla.com",
      name: "fafona",
    },
    "https://faolla.com",
  );

  assert.equal(payload, null);
});

test("parseMerchantBusinessCardShareParams normalizes storage image urls with preferred origin", () => {
  const payload = parseMerchantBusinessCardShareParams(
    {
      image: "/storage/v1/object/public/page-assets/card.png",
      target: "https://fafona.faolla.com",
      name: "fafona",
    },
    "https://faolla.com",
  );

  assert.deepEqual(payload, {
    imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
    targetUrl: "https://fafona.faolla.com/",
    name: "fafona",
  });
});

test("share metadata helpers build readable defaults", () => {
  assert.equal(buildMerchantBusinessCardShareTitle("fafona"), "fafona 名片");
  assert.equal(
    buildMerchantBusinessCardShareDescription("fafona", "https://fafona.faolla.com"),
    "点击打开 fafona 的网站 fafona.faolla.com",
  );
  assert.equal(normalizeMerchantBusinessCardShareImageUrl("https://example.com/card.png", "https://faolla.com"), "https://example.com/card.png");
  assert.equal(normalizeMerchantBusinessCardShareKey("Card-Abc123"), "card-abc123");
});
