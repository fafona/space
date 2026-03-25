import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantBusinessCardContactDownloadUrl,
  buildMerchantBusinessCardLegacyContactDownloadUrl,
  MERCHANT_BUSINESS_CARD_SHARE_CARD_PATH,
  MERCHANT_BUSINESS_CARD_SHARE_KEY_PARAM,
  buildMerchantBusinessCardVCard,
  buildMerchantBusinessCardVCardFileName,
  buildMerchantBusinessCardShareDescription,
  buildMerchantBusinessCardShareManifestObjectPath,
  buildMerchantBusinessCardShareManifestPublicUrls,
  buildMerchantBusinessCardShareTitle,
  buildMerchantBusinessCardShareUrl,
  normalizeMerchantBusinessCardShareContact,
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

  assert.equal(shareUrl, `https://faolla.com${MERCHANT_BUSINESS_CARD_SHARE_CARD_PATH}/card-abc123`);
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
    contact: {
      displayName: "Felix",
      phone: "633130577",
      email: "caimin00x@gmail.com",
    },
  });

  assert.equal(
    shareUrl,
    "https://faolla.com/share/business-card?image=https%3A%2F%2Ffaolla.com%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fpage-assets%2Fcard.png&target=https%3A%2F%2Ffafona.faolla.com%2F&name=fafona&contactName=Felix&phone=633130577&email=caimin00x%40gmail.com&website=https%3A%2F%2Ffafona.faolla.com%2F",
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

test("parseMerchantBusinessCardShareParams ignores unsupported image urls but keeps usable contact data", () => {
  const payload = parseMerchantBusinessCardShareParams(
    {
      image: "data:image/png;base64,abc",
      target: "https://fafona.faolla.com",
      name: "fafona",
    },
    "https://faolla.com",
  );

  assert.deepEqual(payload, {
    name: "fafona",
    targetUrl: "https://fafona.faolla.com/",
    contact: {
      websiteUrl: "https://fafona.faolla.com/",
    },
  });
});

test("buildMerchantBusinessCardShareUrl still works without a share image", () => {
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "https://faolla.com",
    name: "fafona",
    targetUrl: "https://fafona.faolla.com",
    contact: {
      displayName: "Felix",
      phone: "633130577",
      email: "caimin00x@gmail.com",
    },
  });

  assert.equal(
    shareUrl,
    "https://faolla.com/share/business-card?target=https%3A%2F%2Ffafona.faolla.com%2F&name=fafona&contactName=Felix&phone=633130577&email=caimin00x%40gmail.com&website=https%3A%2F%2Ffafona.faolla.com%2F",
  );
});

test("parseMerchantBusinessCardShareParams normalizes storage image urls with preferred origin", () => {
  const payload = parseMerchantBusinessCardShareParams(
    {
      image: "/storage/v1/object/public/page-assets/card.png",
      target: "https://fafona.faolla.com",
      name: "fafona",
      imageWidth: "680",
      imageHeight: "432",
    },
    "https://faolla.com",
  );

  assert.deepEqual(payload, {
    imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
    targetUrl: "https://fafona.faolla.com/",
    name: "fafona",
    imageWidth: 680,
    imageHeight: 432,
    contact: {
      websiteUrl: "https://fafona.faolla.com/",
    },
  });
});

test("normalizeMerchantBusinessCardShareContact keeps useful contact fields and target url", () => {
  assert.deepEqual(
    normalizeMerchantBusinessCardShareContact(
      {
        displayName: " Felix ",
        organization: " fafona ",
        phone: " 633130577 ",
        note: " WeChat: felix ",
      },
      "https://fafona.faolla.com",
    ),
    {
      displayName: "Felix",
      organization: "fafona",
      phone: "633130577",
      websiteUrl: "https://fafona.faolla.com/",
      note: "WeChat: felix",
    },
  );
});

test("normalizeMerchantBusinessCardShareImageUrl rewrites localhost storage urls to preferred public origin", () => {
  assert.equal(
    normalizeMerchantBusinessCardShareImageUrl(
      "https://localhost:3000/storage/v1/object/public/page-assets/merchant-assets/fafona/card.png",
      "https://faolla.com",
    ),
    "https://faolla.com/storage/v1/object/public/page-assets/merchant-assets/fafona/card.png",
  );
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

test("business card contact helpers build downloadable vcard links and content", () => {
  const payload = {
    name: "fafona",
    imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
    targetUrl: "https://fafona.faolla.com/",
    contact: {
      displayName: "Felix",
      organization: "fafona",
      title: "Manager",
      phone: "633130577",
      email: "caimin00x@gmail.com",
      address: "C. Transporte, 12 / Sevilla / Spain",
      websiteUrl: "https://fafona.faolla.com/",
      note: "WhatsApp: felix",
    },
  } as const;

  assert.equal(
    buildMerchantBusinessCardContactDownloadUrl({
      origin: "http://localhost:3000",
      shareKey: "card-abc123",
      targetUrl: payload.targetUrl,
    }),
    "https://faolla.com/card/card-abc123/contact",
  );
  assert.equal(
    buildMerchantBusinessCardLegacyContactDownloadUrl({
      origin: "http://localhost:3000",
      name: payload.name,
      imageUrl: payload.imageUrl,
      targetUrl: payload.targetUrl,
      contact: payload.contact,
    }),
    "https://faolla.com/share/business-card/contact?image=https%3A%2F%2Ffaolla.com%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fpage-assets%2Fcard.png&target=https%3A%2F%2Ffafona.faolla.com%2F&name=fafona&contactName=Felix&organization=fafona&title=Manager&phone=633130577&email=caimin00x%40gmail.com&address=C.+Transporte%2C+12+%2F+Sevilla+%2F+Spain&website=https%3A%2F%2Ffafona.faolla.com%2F&note=WhatsApp%3A+felix",
  );
  const vcard = buildMerchantBusinessCardVCard(payload);
  assert.equal(buildMerchantBusinessCardVCardFileName(payload), "felix.vcf");
  assert.ok(vcard.includes("BEGIN:VCARD"));
  assert.ok(vcard.includes("FN:Felix"));
  assert.ok(vcard.includes("ORG:fafona"));
  assert.ok(vcard.includes("URL:https://fafona.faolla.com/"));
  assert.ok(vcard.includes("NOTE:WhatsApp: felix"));
});
