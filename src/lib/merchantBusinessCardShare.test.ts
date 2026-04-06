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
  createMerchantBusinessCardShareKey,
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardShareContact,
  normalizeMerchantBusinessCardShareImageUrl,
  normalizeMerchantBusinessCardShareKey,
  parseMerchantBusinessCardShareParams,
  readMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
} from "./merchantBusinessCardShare";

test("createMerchantBusinessCardShareKey uses contact name slug with a short code", () => {
  assert.equal(
    createMerchantBusinessCardShareKey({
      contactName: "Felix",
      name: "fafona",
      targetUrl: "https://fafona.faolla.com",
      code: "abc123",
    }),
    "felix-abc123",
  );
});

test("createMerchantBusinessCardShareKey falls back to merchant or target slug when contact name is unavailable", () => {
  assert.equal(
    createMerchantBusinessCardShareKey({
      contactName: "联系人",
      name: "fafona",
      targetUrl: "https://fafona.faolla.com",
      code: "abc123",
    }),
    "fafona-abc123",
  );

  assert.equal(
    createMerchantBusinessCardShareKey({
      contactName: "联系人",
      name: "商户名片",
      targetUrl: "https://felix.faolla.com",
      code: "abc123",
    }),
    "felix-abc123",
  );
});

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
        invoiceName: " Fafona Trading ",
        invoiceTaxNumber: " ESB12345678 ",
        invoiceAddress: " Sevilla, Spain ",
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
      invoiceName: "Fafona Trading",
      invoiceTaxNumber: "ESB12345678",
      invoiceAddress: "Sevilla, Spain",
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

test("share helpers preserve invoice contact params", () => {
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "https://faolla.com",
    name: "fafona",
    targetUrl: "https://fafona.faolla.com",
    contact: {
      displayName: "Felix",
      invoiceName: "Fafona Trading",
      invoiceTaxNumber: "ESB12345678",
      invoiceAddress: "Sevilla, Spain",
    },
  });

  assert.match(shareUrl, /invoiceName=Fafona\+Trading|invoiceName=Fafona%20Trading/);
  assert.match(shareUrl, /invoiceTaxNumber=ESB12345678/);

  const parsed = parseMerchantBusinessCardShareParams(new URL(shareUrl).searchParams, "https://faolla.com");
  assert.equal(parsed?.contact?.invoiceName, "Fafona Trading");
  assert.equal(parsed?.contact?.invoiceTaxNumber, "ESB12345678");
  assert.equal(parsed?.contact?.invoiceAddress, "Sevilla, Spain");
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

test("loadMerchantBusinessCardSharePayloadByKey prefers the newest manifest across buckets", async () => {
  const originalFetch = globalThis.fetch;
  const responses = new Map<string, unknown>([
    [
      "https://faolla.com/storage/v1/object/public/page-assets/merchant-shares/card-abc123.json",
      {
        name: "fafona",
        imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
        targetUrl: "https://fafona.faolla.com",
        updatedAt: "2026-03-30T15:00:00.000Z",
        contact: {
          displayName: "Felix",
          tiktok: "old-tiktok",
        },
      },
    ],
    [
      "https://faolla.com/storage/v1/object/public/assets/merchant-shares/card-abc123.json",
      {
        name: "fafona",
        imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
        targetUrl: "https://fafona.faolla.com",
        updatedAt: "2026-03-30T15:05:00.000Z",
        contact: {
          displayName: "Felix",
          tiktok: "new-tiktok",
          douyin: "new-douyin",
          telegram: "new-telegram",
        },
      },
    ],
  ]);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const lookupUrl = new URL(url);
    lookupUrl.searchParams.delete("_ts");
    const payload = responses.get(lookupUrl.toString());
    if (!payload) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof fetch;

  try {
    const payload = await loadMerchantBusinessCardSharePayloadByKey("card-abc123", "https://faolla.com");
    assert.equal(payload?.contact?.tiktok, "new-tiktok");
    assert.equal(payload?.contact?.douyin, "new-douyin");
    assert.equal(payload?.contact?.telegram, "new-telegram");
    assert.equal(payload?.updatedAt, "2026-03-30T15:05:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadMerchantBusinessCardSharePayloadByKey prefers richer contact data when old manifests lack timestamps", async () => {
  const originalFetch = globalThis.fetch;
  const responses = new Map<string, unknown>([
    [
      "https://faolla.com/storage/v1/object/public/page-assets/merchant-shares/card-abc123.json",
      {
        name: "fafona",
        imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
        targetUrl: "https://fafona.faolla.com",
        contact: {
          displayName: "Felix",
          tiktok: "old-tiktok",
        },
      },
    ],
    [
      "https://faolla.com/storage/v1/object/public/assets/merchant-shares/card-abc123.json",
      {
        name: "fafona",
        imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
        targetUrl: "https://fafona.faolla.com",
        contact: {
          displayName: "Felix",
          tiktok: "new-tiktok",
          douyin: "new-douyin",
          telegram: "new-telegram",
          linkedin: "new-linkedin",
        },
      },
    ],
  ]);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const lookupUrl = new URL(url);
    lookupUrl.searchParams.delete("_ts");
    const payload = responses.get(lookupUrl.toString());
    if (!payload) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof fetch;

  try {
    const payload = await loadMerchantBusinessCardSharePayloadByKey("card-abc123", "https://faolla.com");
    assert.equal(payload?.contact?.tiktok, "new-tiktok");
    assert.equal(payload?.contact?.douyin, "new-douyin");
    assert.equal(payload?.contact?.telegram, "new-telegram");
    assert.equal(payload?.contact?.linkedin, "new-linkedin");
  } finally {
    globalThis.fetch = originalFetch;
  }
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
