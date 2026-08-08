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
  normalizeMerchantBusinessCardShareTargetUrl,
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
    introVideoUrl: "https://faolla.com/storage/v1/object/public/page-assets/intro.mp4",
    targetUrl: "https://fafona.faolla.com",
    contact: {
      displayName: "Felix",
      phone: "633130577",
      email: "caimin00x@gmail.com",
    },
  });

  assert.equal(
    shareUrl,
    "https://faolla.com/share/business-card?image=https%3A%2F%2Ffaolla.com%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fpage-assets%2Fcard.png&detailImage=https%3A%2F%2Ffaolla.com%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fpage-assets%2Fcontact.png&introVideo=https%3A%2F%2Ffaolla.com%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fpage-assets%2Fintro.mp4&target=https%3A%2F%2Ffafona.faolla.com%2F&name=fafona&contactName=Felix&phone=633130577&email=caimin00x%40gmail.com&website=https%3A%2F%2Ffafona.faolla.com%2F",
  );
});

test("share helpers preserve non-muted intro video setting", () => {
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "https://faolla.com",
    name: "fafona",
    imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
    introVideoUrl: "https://faolla.com/storage/v1/object/public/page-assets/intro.mp4",
    introVideoMuted: false,
    targetUrl: "https://fafona.faolla.com",
  });

  assert.match(shareUrl, /introMuted=0/);
  const parsed = parseMerchantBusinessCardShareParams(new URL(shareUrl).searchParams, "https://faolla.com");
  assert.equal(parsed?.introVideoMuted, false);
});

test("share helpers preserve intro image duration and contact-card audio", () => {
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "https://faolla.com",
    name: "fafona",
    imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
    introImageUrl: "https://faolla.com/storage/v1/object/public/page-assets/intro.webp",
    introImageDurationSeconds: 12,
    introMusicUrl: "https://faolla.com/storage/v1/object/public/page-assets/intro.mp3",
    backgroundMusicUrl: "https://faolla.com/storage/v1/object/public/page-assets/background.mp3",
    targetUrl: "https://fafona.faolla.com",
  });

  const url = new URL(shareUrl);
  assert.equal(url.searchParams.get("introImageDuration"), "12");
  assert.equal(url.searchParams.get("introMusic"), "https://faolla.com/storage/v1/object/public/page-assets/intro.mp3");
  assert.equal(
    url.searchParams.get("backgroundMusic"),
    "https://faolla.com/storage/v1/object/public/page-assets/background.mp3",
  );

  const parsed = parseMerchantBusinessCardShareParams(url.searchParams, "https://faolla.com");
  assert.equal(parsed?.introImageUrl, "https://faolla.com/storage/v1/object/public/page-assets/intro.webp");
  assert.equal(parsed?.introImageDurationSeconds, 12);
  assert.equal(parsed?.introMusicUrl, "https://faolla.com/storage/v1/object/public/page-assets/intro.mp3");
  assert.equal(
    parsed?.backgroundMusicUrl,
    "https://faolla.com/storage/v1/object/public/page-assets/background.mp3",
  );
});

test("share normalization gives intro video precedence and drops orphan intro music", () => {
  const withVideo = parseMerchantBusinessCardShareParams(
    new URLSearchParams({
      introVideo: "https://faolla.com/storage/v1/object/public/page-assets/intro.mp4",
      introImage: "https://faolla.com/storage/v1/object/public/page-assets/intro.webp",
      introMusic: "https://faolla.com/storage/v1/object/public/page-assets/intro.mp3",
      target: "https://fafona.faolla.com",
    }),
    "https://faolla.com",
  );
  const withoutIntro = parseMerchantBusinessCardShareParams(
    new URLSearchParams({
      introMusic: "https://faolla.com/storage/v1/object/public/page-assets/intro.mp3",
      target: "https://fafona.faolla.com",
    }),
    "https://faolla.com",
  );

  assert.equal(withVideo?.introImageUrl, undefined);
  assert.equal(withVideo?.introMusicUrl, "https://faolla.com/storage/v1/object/public/page-assets/intro.mp3");
  assert.equal(withoutIntro?.introMusicUrl, undefined);
});

test("share helpers preserve contact card layout controls and custom links", () => {
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "https://faolla.com",
    name: "fafona",
    imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
    detailImageUrl: "https://faolla.com/storage/v1/object/public/page-assets/contact.png",
    detailImageLinkUrl: "https://menu.example.com",
    detailImageX: 18,
    detailImageY: -24,
    detailImageScale: 1.35,
    detailImageOpacity: 0.72,
    contactPageSectionOrder: ["contacts", "image", "coupons"],
    showContactPoll: true,
    contactPagePollId: "poll-customer-feedback",
    contactPagePollBlockId: "poll-block-page-2",
    ownerMerchantId: "10000000",
    showContactSaveButton: false,
    showContactWebsiteButton: false,
    targetUrl: "https://fafona.faolla.com",
    contact: {
      displayName: "Felix",
      contactDisplayFields: {
        phone: { businessCard: false, contactCard: false },
        googleReview: { businessCard: false, contactCard: true },
      },
      customLinks: [
        {
          id: "google-review",
          label: "Google",
          displayText: "欢迎评价",
          url: "https://g.page/r/example/review",
          iconPreset: "google",
          iconUrl: "https://faolla.com/storage/v1/object/public/page-assets/google.png",
          bgColor: "#15803d",
        },
      ],
    },
  });

  const url = new URL(shareUrl);
  assert.equal(url.searchParams.get("contactSections"), "contacts,image,coupons,poll");
  assert.equal(url.searchParams.get("showPoll"), "1");
  assert.equal(url.searchParams.get("poll"), "poll-customer-feedback");
  assert.equal(url.searchParams.get("pollBlock"), "poll-block-page-2");
  assert.equal(url.searchParams.get("owner"), "10000000");
  assert.equal(url.searchParams.get("showContactSave"), "0");
  assert.equal(url.searchParams.get("showContactWebsite"), "0");
  assert.equal(url.searchParams.get("detailImageLink"), "https://menu.example.com/");
  assert.equal(url.searchParams.get("detailImageX"), "18");
  assert.equal(url.searchParams.get("detailImageY"), "-24");
  assert.equal(url.searchParams.get("detailImageScale"), "1.35");
  assert.equal(url.searchParams.get("detailImageOpacity"), "0.72");
  assert.equal(url.searchParams.get("contactDisplay"), "phone:00,googleReview:01");
  assert.ok(url.searchParams.get("customLinks")?.includes("欢迎评价"));

  const parsed = parseMerchantBusinessCardShareParams(url.searchParams, "https://faolla.com");
  assert.deepEqual(parsed?.contactPageSectionOrder, ["contacts", "image", "coupons", "poll"]);
  assert.equal(parsed?.showContactPoll, true);
  assert.equal(parsed?.contactPagePollId, "poll-customer-feedback");
  assert.equal(parsed?.contactPagePollBlockId, "poll-block-page-2");
  assert.equal(parsed?.ownerMerchantId, "10000000");
  assert.equal(parsed?.showContactSaveButton, false);
  assert.equal(parsed?.showContactWebsiteButton, false);
  assert.equal(parsed?.detailImageLinkUrl, "https://menu.example.com/");
  assert.equal(parsed?.detailImageX, 18);
  assert.equal(parsed?.detailImageY, -24);
  assert.equal(parsed?.detailImageScale, 1.35);
  assert.equal(parsed?.detailImageOpacity, 0.72);
  assert.deepEqual(parsed?.contact?.contactDisplayFields?.phone, { businessCard: false, contactCard: false });
  assert.deepEqual(parsed?.contact?.contactDisplayFields?.googleReview, { businessCard: false, contactCard: true });
  assert.equal(parsed?.contact?.customLinks?.[0]?.displayText, "欢迎评价");
  assert.equal(parsed?.contact?.customLinks?.[0]?.iconPreset, "google");
});

test("share helpers normalize bare domain click links", () => {
  assert.equal(normalizeMerchantBusinessCardShareTargetUrl("www.faolla.com"), "https://www.faolla.com/");
  assert.equal(normalizeMerchantBusinessCardShareTargetUrl("faolla.com/card/felix"), "https://faolla.com/card/felix");
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "https://faolla.com",
    name: "fafona",
    imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
    detailImageUrl: "https://faolla.com/storage/v1/object/public/page-assets/contact.png",
    detailImageLinkUrl: "www.faolla.com",
    targetUrl: "https://fafona.faolla.com",
  });
  const url = new URL(shareUrl);
  assert.equal(url.searchParams.get("detailImageLink"), "https://www.faolla.com/");
  const parsed = parseMerchantBusinessCardShareParams(url.searchParams, "https://faolla.com");
  assert.equal(parsed?.detailImageLinkUrl, "https://www.faolla.com/");
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
  const contact = normalizeMerchantBusinessCardShareContact(
    {
      displayName: " Felix ",
      organization: " fafona ",
      phone: " 633130577 ",
      phones: [" 633130577 ", " 666888999 ", " 777000111 "],
      invoiceName: " Fafona Trading ",
      invoiceTaxNumber: " ESB12345678 ",
      invoiceAddress: " Sevilla, Spain ",
      douyin: " fafona_douyin ",
      googleReview: " https://g.page/r/fafona/review ",
      contactOnlyFields: {
        merchantName: true,
        douyin: true,
        phone: false,
      },
      note: " WeChat: felix ",
    },
    "https://fafona.faolla.com",
  );
  assert.deepEqual(contact?.contactDisplayFields?.merchantName, { businessCard: false, contactCard: true });
  assert.deepEqual(contact?.contactDisplayFields?.douyin, { businessCard: false, contactCard: true });
  assert.deepEqual(contact?.contactDisplayFields?.phone, { businessCard: true, contactCard: true });
  assert.deepEqual(
    contact ? { ...contact, contactDisplayFields: undefined } : contact,
    {
      displayName: "Felix",
      organization: "fafona",
      phone: "633130577",
      phones: ["633130577", "666888999"],
      invoiceName: "Fafona Trading",
      invoiceTaxNumber: "ESB12345678",
      invoiceAddress: "Sevilla, Spain",
      douyin: "fafona_douyin",
      googleReview: "https://g.page/r/fafona/review",
      contactOnlyFields: {
        merchantName: true,
        douyin: true,
      },
      websiteUrl: "https://fafona.faolla.com/",
      note: "WeChat: felix",
      contactDisplayFields: undefined,
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

test("share helpers preserve Google review contact params", () => {
  const googleReview = "https://g.page/r/fafona/review";
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: "https://faolla.com",
    name: "fafona",
    targetUrl: "https://fafona.faolla.com",
    contact: {
      displayName: "Felix",
      googleReview,
    },
  });

  assert.match(shareUrl, /googleReview=https%3A%2F%2Fg\.page%2Fr%2Ffafona%2Freview/);

  const parsed = parseMerchantBusinessCardShareParams(new URL(shareUrl).searchParams, "https://faolla.com");
  assert.equal(parsed?.contact?.googleReview, googleReview);
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
        ownerMerchantId: "10000000",
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
    assert.equal(payload?.ownerMerchantId, "10000000");
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
        merchantName: true,
        twitter: true,
        instagram: true,
      },
    },
  });

  assert.match(shareUrl, /contactOnly=merchantName%2Ctwitter%2Cinstagram/);

  const parsed = parseMerchantBusinessCardShareParams(new URL(shareUrl).searchParams, "https://faolla.com");
  assert.deepEqual(parsed?.contact?.contactOnlyFields, {
    merchantName: true,
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
  };

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
