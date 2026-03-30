import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantBusinessCardContactDownloadUrl,
  buildMerchantBusinessCardShareLegacyFingerprint,
  buildMerchantBusinessCardLegacyContactDownloadUrl,
  MERCHANT_BUSINESS_CARD_SHARE_CARD_PATH,
  MERCHANT_BUSINESS_CARD_SHARE_KEY_PARAM,
  buildMerchantBusinessCardShareRevocationByKeyObjectPath,
  buildMerchantBusinessCardShareRevocationByLegacyPayloadObjectPath,
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
    detailImageUrl: "https://faolla.com/storage/v1/object/public/page-assets/contact.png",
    targetUrl: "https://fafona.faolla.com",
    contact: {
      displayName: "Felix",
      phone: "633130577",
      email: "caimin00x@gmail.com",
    },
  });

  assert.equal(
    shareUrl,
    "https://faolla.com/share/business-card?image=https%3A%2F%2Ffaolla.com%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fpage-assets%2Fcard.png&detailImage=https%3A%2F%2Ffaolla.com%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fpage-assets%2Fcontact.png&target=https%3A%2F%2Ffafona.faolla.com%2F&name=fafona&contactName=Felix&phone=633130577&email=caimin00x%40gmail.com&website=https%3A%2F%2Ffafona.faolla.com%2F",
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

test("share revocation helpers build stable key and legacy payload paths", () => {
  const payload = {
    name: " fafona ",
    targetUrl: "https://fafona.faolla.com",
    imageUrl: "/storage/v1/object/public/page-assets/card.png",
    detailImageUrl: "/storage/v1/object/public/page-assets/contact.png",
    contact: {
      displayName: " Felix ",
      phone: " 633130577 ",
      email: "caimin00x@gmail.com",
    },
  };

  const firstFingerprint = buildMerchantBusinessCardShareLegacyFingerprint(payload, "https://faolla.com");
  const secondFingerprint = buildMerchantBusinessCardShareLegacyFingerprint(
    {
      ...payload,
      name: "fafona",
      contact: {
        ...payload.contact,
        displayName: "Felix",
        phone: "633130577",
      },
    },
    "https://faolla.com",
  );

  assert.equal(firstFingerprint, secondFingerprint);
  assert.match(firstFingerprint, /^legacy-[0-9a-f]{16}$/);
  assert.equal(
    buildMerchantBusinessCardShareRevocationByKeyObjectPath("Card-Abc123"),
    "merchant-share-revocations/key/card-abc123.json",
  );
  assert.equal(
    buildMerchantBusinessCardShareRevocationByLegacyPayloadObjectPath(payload, "https://faolla.com"),
    `merchant-share-revocations/legacy/${firstFingerprint}.json`,
  );
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
      detailImage: "/storage/v1/object/public/page-assets/contact.png",
      target: "https://fafona.faolla.com",
      name: "fafona",
      imageWidth: "680",
      imageHeight: "432",
    },
    "https://faolla.com",
  );

  assert.deepEqual(payload, {
    imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
    detailImageUrl: "https://faolla.com/storage/v1/object/public/page-assets/contact.png",
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
        phones: [" 633130577 ", " 666888999 ", " 777000111 "],
        douyin: " fafona_douyin ",
        contactOnlyFields: {
          douyin: true,
          phone: false,
        },
        note: " WeChat: felix ",
      },
      "https://fafona.faolla.com",
    ),
    {
      displayName: "Felix",
      organization: "fafona",
      phone: "633130577",
      phones: ["633130577", "666888999"],
      douyin: "fafona_douyin",
      contactOnlyFields: {
        douyin: true,
      },
      websiteUrl: "https://fafona.faolla.com/",
      note: "WeChat: felix",
    },
  );
});

test("share helpers preserve douyin contact params", () => {
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "https://faolla.com",
    name: "fafona",
    targetUrl: "https://fafona.faolla.com",
    contact: {
      displayName: "Felix",
      douyin: "fafona_douyin",
    },
  });

  assert.match(shareUrl, /douyin=fafona_douyin/);

  const parsed = parseMerchantBusinessCardShareParams(new URL(shareUrl).searchParams, "https://faolla.com");
  assert.equal(parsed?.contact?.douyin, "fafona_douyin");
});

test("share helpers preserve explicit contact field order", () => {
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "https://faolla.com",
    name: "fafona",
    targetUrl: "https://fafona.faolla.com",
    contact: {
      displayName: "Felix",
      phone: "633130577",
      wechat: "KD66769",
      douyin: "fafona_douyin",
      contactFieldOrder: ["wechat", "phone", "douyin"],
    },
  });

  const parsed = parseMerchantBusinessCardShareParams(new URL(shareUrl).searchParams, "https://faolla.com");
  assert.deepEqual(parsed?.contact?.contactFieldOrder?.slice(0, 4), ["wechat", "phone", "douyin", "contactName"]);
});

test("share helpers preserve contact-only flags in legacy query params", () => {
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "https://faolla.com",
    name: "fafona",
    targetUrl: "https://fafona.faolla.com",
    contact: {
      displayName: "Felix",
      twitter: "MinCai361325",
      instagram: "caimin00x",
      contactOnlyFields: {
        twitter: true,
        instagram: true,
      },
    },
  });

  assert.match(shareUrl, /contactOnly=twitter%2Cinstagram/);

  const parsed = parseMerchantBusinessCardShareParams(new URL(shareUrl).searchParams, "https://faolla.com");
  assert.deepEqual(parsed?.contact?.contactOnlyFields, {
    twitter: true,
    instagram: true,
  });
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
  assert.equal(buildMerchantBusinessCardShareTitle("fafona"), "fafona");
  assert.equal(
    buildMerchantBusinessCardShareDescription("fafona", "https://fafona.faolla.com"),
    "fafona | FAOLLA CARD",
  );
  assert.equal(normalizeMerchantBusinessCardShareImageUrl("https://example.com/card.png", "https://faolla.com"), "https://example.com/card.png");
  assert.equal(normalizeMerchantBusinessCardShareKey("Card-Abc123"), "card-abc123");
});

test("business card contact helpers build downloadable vcard links and content", () => {
  const payload = {
    name: "fafona",
    imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
    detailImageUrl: "https://faolla.com/storage/v1/object/public/page-assets/contact.png",
    targetUrl: "https://fafona.faolla.com/",
    contact: {
      displayName: "Felix",
      organization: "fafona",
      title: "Manager",
      phone: "633130577",
      phones: ["633130577", "666888999"],
      email: "caimin00x@gmail.com",
      address: "C. Transporte, 12 / 41007 / Sevilla / Sevilla / Spain",
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
      detailImageUrl: payload.detailImageUrl,
      targetUrl: payload.targetUrl,
      contact: payload.contact,
    }),
    "https://faolla.com/share/business-card/contact?image=https%3A%2F%2Ffaolla.com%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fpage-assets%2Fcard.png&detailImage=https%3A%2F%2Ffaolla.com%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fpage-assets%2Fcontact.png&target=https%3A%2F%2Ffafona.faolla.com%2F&name=fafona&contactName=Felix&organization=fafona&title=Manager&phone=633130577&phones=633130577%2C666888999&email=caimin00x%40gmail.com&address=C.+Transporte%2C+12+%2F+41007+%2F+Sevilla+%2F+Sevilla+%2F+Spain&website=https%3A%2F%2Ffafona.faolla.com%2F&note=WhatsApp%3A+felix",
  );
  const vcard = buildMerchantBusinessCardVCard(payload);
  assert.match(buildMerchantBusinessCardVCardFileName(payload), /^felix-card\d{5}\.vcf$/);
  assert.ok(vcard.includes("BEGIN:VCARD"));
  assert.ok(vcard.includes("FN:Felix"));
  assert.ok(vcard.includes("ORG:fafona"));
  assert.ok(vcard.includes("TEL;TYPE=WORK:666888999"));
  assert.ok(vcard.includes("ADR;TYPE=WORK:;;C. Transporte\\, 12;Sevilla;Sevilla;41007;Spain"));
  assert.ok(vcard.includes("URL:https://fafona.faolla.com/"));
  assert.ok(vcard.includes("NOTE:WhatsApp: felix"));
});
