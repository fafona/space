import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultMerchantBusinessCardDraft,
  disableMerchantBusinessCardChatDisplay,
  getMerchantBusinessCardRequiredFields,
  mergeMerchantBusinessCardAssets,
  normalizeMerchantBusinessCardContactSectionOrder,
  normalizeMerchantBusinessCardDraft,
  normalizeMerchantBusinessCards,
  resolveMerchantBusinessCardForChatDisplay,
  selectMerchantBusinessCardForChat,
} from "./merchantBusinessCards";

test("business card generation only requires merchant domain prefix", () => {
  const missing = getMerchantBusinessCardRequiredFields({
    merchantName: "",
    domainPrefix: "",
    contactAddress: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    industry: "",
    location: {
      country: "",
      province: "",
      city: "",
    },
  });

  assert.deepEqual(missing, ["域名前缀"]);
});

test("default business card draft prefills merchant profile fields", () => {
  const draft = createDefaultMerchantBusinessCardDraft({
    merchantName: "fafona",
    contactName: "felix",
    contactPhone: "0034633130577",
    contactEmail: "caimin00x@gmail.com",
    contactAddress: "C. Transporte, 12",
    location: {
      city: "Sevilla",
      province: "Sevilla",
      country: "Spain",
    },
  });

  assert.equal(draft.name, "fafona");
  assert.equal(draft.backgroundImageOpacity, 1);
  assert.equal(draft.backgroundColorOpacity, 1);
  assert.equal(draft.showWebsiteUrl, true);
  assert.equal(draft.showQr, true);
  assert.deepEqual(draft.customTexts, []);
  assert.equal(draft.backgroundImageX, 0);
  assert.equal(draft.backgroundImageY, 0);
  assert.equal(draft.backgroundImageScale, 1);
  assert.equal(draft.backgroundImageSnapshotOnly, false);
  assert.equal(draft.cornerMode, "rounded");
  assert.equal(draft.contacts.contactName, "felix");
  assert.equal(draft.contacts.phone, "0034633130577");
  assert.deepEqual(draft.contacts.phones, ["0034633130577"]);
  assert.equal(draft.contacts.email, "caimin00x@gmail.com");
  assert.equal(draft.contacts.address, "C. Transporte, 12 / Sevilla / Sevilla / Spain");
  assert.equal(draft.contacts.douyin, "");
  assert.equal(draft.contacts.googleReview, "");
  assert.deepEqual(draft.invoice, {
    name: "",
    taxNumber: "",
    address: "",
  });
  assert.deepEqual(draft.contactFieldOrder.slice(0, 4), ["contactName", "phone", "email", "address"]);
  assert.deepEqual(draft.textLayout.douyin, { x: 360, y: 310 });
  assert.deepEqual(draft.textLayout.googleReview, { x: 360, y: 430 });
  assert.equal(draft.contactOnlyFields.merchantName, false);
  assert.equal(draft.contactOnlyFields.phone, false);
  assert.equal(draft.contactOnlyFields.douyin, false);
  assert.equal(draft.contactOnlyFields.googleReview, false);
  assert.deepEqual(draft.contactDisplayFields.phone, { businessCard: true, contactCard: true });
  assert.deepEqual(draft.contactDisplayFields.googleReview, { businessCard: true, contactCard: true });
  assert.equal(draft.fieldTypography.merchantName.fontSize, 36);
  assert.equal(draft.fieldTypography.contactName.fontSize, 14);
  assert.equal(draft.websiteLabel, "");
  assert.equal(draft.contactIntroVideoMuted, true);
});

test("normalizeMerchantBusinessCardDraft preserves link mode", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    mode: "link",
    name: "fafona card",
    contacts: {
      phone: "111",
      phones: ["111", "222"],
    },
  });

  assert.equal(draft.mode, "link");
  assert.equal(draft.name, "fafona card");
  assert.equal(draft.contacts.phone, "111");
  assert.deepEqual(draft.contacts.phones, ["111", "222"]);
});

test("normalizeMerchantBusinessCardDraft preserves intentionally empty business card name", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    name: "",
  });

  assert.equal(draft.name, "");
});

test("normalizeMerchantBusinessCardDraft preserves square card frame corners", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    cornerMode: "square",
  });
  const invalidDraft = normalizeMerchantBusinessCardDraft({
    cornerMode: "soft",
  });

  assert.equal(draft.cornerMode, "square");
  assert.equal(invalidDraft.cornerMode, "rounded");
});

test("normalizeMerchantBusinessCardDraft preserves intro video muted setting", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    contactIntroVideoUrl: "https://faolla.com/storage/v1/object/public/page-assets/intro.mp4",
    contactIntroVideoMuted: false,
  });

  assert.equal(draft.contactIntroVideoUrl, "https://faolla.com/storage/v1/object/public/page-assets/intro.mp4");
  assert.equal(draft.contactIntroVideoMuted, false);
});

test("normalizeMerchantBusinessCardDraft preserves contact card section order and buttons", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    contactPageSectionOrder: ["contacts", "coupons", "image", "contacts"],
    showContactSaveButton: false,
    showContactWebsiteButton: false,
  });

  assert.deepEqual(draft.contactPageSectionOrder, ["contacts", "coupons", "image"]);
  assert.equal(draft.showContactSaveButton, false);
  assert.equal(draft.showContactWebsiteButton, false);
  assert.deepEqual(normalizeMerchantBusinessCardContactSectionOrder(["coupons"]), ["coupons", "image", "contacts"]);
});

test("normalizeMerchantBusinessCardDraft keeps custom contact links", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    customContactLinks: [
      {
        id: "google-review",
        label: "Google",
        displayText: "欢迎评价",
        url: "https://g.page/r/example/review",
        iconPreset: "google",
        iconUrl: "https://faolla.com/storage/v1/object/public/page-assets/google.png",
        bgColor: "#15803d",
      },
      {
        id: "empty",
        label: "empty",
        displayText: "",
        url: "",
      },
    ],
  });

  assert.equal(draft.customContactLinks.length, 1);
  assert.deepEqual(draft.customContactLinks[0], {
    id: "google-review",
    label: "Google",
    displayText: "欢迎评价",
    url: "https://g.page/r/example/review",
    iconPreset: "google",
    iconUrl: "https://faolla.com/storage/v1/object/public/page-assets/google.png",
    bgColor: "#15803d",
  });
});

test("normalizeMerchantBusinessCardDraft keeps extended custom contact icon presets", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    customContactLinks: ["download", "review", "favorite", "checkin"].map((iconPreset) => ({
      id: iconPreset,
      label: iconPreset,
      displayText: iconPreset,
      url: `https://example.com/${iconPreset}`,
      iconPreset,
    })),
  });

  assert.deepEqual(
    draft.customContactLinks.map((item) => item.iconPreset),
    ["download", "review", "favorite", "checkin"],
  );
});

test("normalizeMerchantBusinessCardDraft keeps at most two phones", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    contacts: {
      phone: "111",
      phones: ["111", "222", "333"],
    },
  });

  assert.equal(draft.contacts.phone, "111");
  assert.deepEqual(draft.contacts.phones, ["111", "222"]);
});

test("normalizeMerchantBusinessCardDraft reorders contact fields and text layout together", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    contactFieldOrder: ["wechat", "phone", "contactName", "douyin"],
  });

  assert.deepEqual(draft.contactFieldOrder.slice(0, 4), ["wechat", "phone", "contactName", "douyin"]);
  assert.deepEqual(draft.textLayout.wechat, { x: 36, y: 190 });
  assert.deepEqual(draft.textLayout.phone, { x: 36, y: 220 });
  assert.deepEqual(draft.textLayout.contactName, { x: 36, y: 250 });
  assert.deepEqual(draft.textLayout.douyin, { x: 36, y: 280 });
});

test("normalizeMerchantBusinessCardDraft migrates legacy social layout into visible area", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    textLayout: {
      douyin: { x: 360, y: 442 },
      weibo: { x: 36, y: 442 },
      discord: { x: 360, y: 406 },
    },
  });

  assert.deepEqual(draft.textLayout.douyin, { x: 360, y: 310 });
  assert.deepEqual(draft.textLayout.weibo, { x: 36, y: 400 });
  assert.deepEqual(draft.textLayout.discord, { x: 360, y: 400 });
});

test("normalizeMerchantBusinessCardDraft allows empty website label", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    websiteLabel: "   ",
  });

  assert.equal(draft.websiteLabel, "");
});

test("normalizeMerchantBusinessCardDraft preserves douyin and contact-only settings", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    contacts: {
      douyin: "fafona_douyin",
      tiktok: "fafona_tiktok",
      googleReview: "https://g.page/r/fafona/review",
    },
    contactOnlyFields: {
      merchantName: true,
      phone: true,
      douyin: true,
      googleReview: true,
    },
  });

  assert.equal(draft.contacts.douyin, "fafona_douyin");
  assert.equal(draft.contacts.tiktok, "fafona_tiktok");
  assert.equal(draft.contacts.googleReview, "https://g.page/r/fafona/review");
  assert.equal(draft.contactOnlyFields.merchantName, true);
  assert.equal(draft.contactOnlyFields.phone, true);
  assert.equal(draft.contactOnlyFields.douyin, true);
  assert.equal(draft.contactOnlyFields.googleReview, true);
  assert.equal(draft.contactOnlyFields.tiktok, false);
  assert.deepEqual(draft.contactDisplayFields.merchantName, { businessCard: false, contactCard: true });
  assert.deepEqual(draft.contactDisplayFields.phone, { businessCard: false, contactCard: true });
  assert.deepEqual(draft.contactDisplayFields.douyin, { businessCard: false, contactCard: true });
  assert.deepEqual(draft.contactDisplayFields.googleReview, { businessCard: false, contactCard: true });
  assert.deepEqual(draft.contactDisplayFields.tiktok, { businessCard: true, contactCard: true });
});

test("normalizeMerchantBusinessCardDraft supports separate business card and contact card visibility", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    contactDisplayFields: {
      phone: { businessCard: false, contactCard: false },
      email: { businessCard: true, contactCard: false },
      googleReview: { businessCard: false, contactCard: true },
    },
  });

  assert.deepEqual(draft.contactDisplayFields.phone, { businessCard: false, contactCard: false });
  assert.deepEqual(draft.contactDisplayFields.email, { businessCard: true, contactCard: false });
  assert.deepEqual(draft.contactDisplayFields.googleReview, { businessCard: false, contactCard: true });
  assert.equal(draft.contactOnlyFields.phone, false);
  assert.equal(draft.contactOnlyFields.email, false);
  assert.equal(draft.contactOnlyFields.googleReview, true);
});

test("normalizeMerchantBusinessCardDraft preserves invoice info", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    invoice: {
      name: "Fafona Trading",
      taxNumber: "ESB12345678",
      address: "Sevilla, Spain",
    },
  });

  assert.deepEqual(draft.invoice, {
    name: "Fafona Trading",
    taxNumber: "ESB12345678",
    address: "Sevilla, Spain",
  });
});

test("normalizeMerchantBusinessCardDraft supports hiding website url and custom texts", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    showWebsiteUrl: false,
    showQr: false,
    customTexts: [
      {
        id: "custom-1",
        text: "VIP only",
        x: 120,
        y: 260,
        typography: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 18,
          fontColor: "#ff6600",
          fontWeight: "bold",
          fontStyle: "normal",
          textDecoration: "none",
        },
      },
    ],
  });

  assert.equal(draft.showWebsiteUrl, false);
  assert.equal(draft.showQr, false);
  assert.equal(draft.customTexts.length, 1);
  assert.equal(draft.customTexts[0]?.text, "VIP only");
  assert.equal(draft.customTexts[0]?.x, 120);
  assert.equal(draft.customTexts[0]?.y, 260);
  assert.equal(draft.customTexts[0]?.typography.fontColor, "#ff6600");
});

test("normalizeMerchantBusinessCardDraft clamps background opacity", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    backgroundImageOpacity: 2,
    backgroundColorOpacity: -1,
  });

  assert.equal(draft.backgroundImageOpacity, 1);
  assert.equal(draft.backgroundColorOpacity, 0);
});

test("normalizeMerchantBusinessCardDraft clamps background image transform", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    backgroundImageX: 9000,
    backgroundImageY: -9000,
    backgroundImageScale: 8,
  });

  assert.equal(draft.backgroundImageX, 5000);
  assert.equal(draft.backgroundImageY, -5000);
  assert.equal(draft.backgroundImageScale, 3);
});

test("normalizeMerchantBusinessCardDraft preserves snapshot-only background flag", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    backgroundImageUrl: "data:image/png;base64,snapshot",
    backgroundImageSnapshotOnly: true,
  });

  assert.equal(draft.backgroundImageUrl, "data:image/png;base64,snapshot");
  assert.equal(draft.backgroundImageSnapshotOnly, true);
});

test("normalizeMerchantBusinessCardDraft keeps gradient background colors", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    backgroundColor: "linear-gradient(135deg, #082f49 0%, #0f172a 55%, #164e63 100%)",
  });

  assert.equal(draft.backgroundColor, "linear-gradient(135deg, #082f49 0%, #0f172a 55%, #164e63 100%)");
});

test("normalizeMerchantBusinessCardDraft migrates legacy info typography to field-level styles", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    typography: {
      info: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 22,
        fontColor: "#336699",
        fontWeight: "bold",
        fontStyle: "italic",
        textDecoration: "underline",
      },
    },
  });

  assert.equal(draft.fieldTypography.contactName.fontFamily, "Arial, Helvetica, sans-serif");
  assert.equal(draft.fieldTypography.contactName.fontSize, 22);
  assert.equal(draft.fieldTypography.phone.fontColor, "#336699");
  assert.equal(draft.fieldTypography.email.fontWeight, "bold");
  assert.equal(draft.fieldTypography.address.fontStyle, "italic");
  assert.equal(draft.fieldTypography.wechat.textDecoration, "underline");
});

test("normalizeMerchantBusinessCardDraft clamps business card font size to 80", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    typography: {
      name: {
        fontSize: 120,
      },
      info: {
        fontSize: 96,
      },
    },
    fieldTypography: {
      title: {
        fontSize: 88,
      },
    },
    customTexts: [
      {
        id: "custom-1",
        text: "VIP only",
        typography: {
          fontSize: 200,
        },
      },
    ],
  });

  assert.equal(draft.typography.name.fontSize, 80);
  assert.equal(draft.fieldTypography.title.fontSize, 80);
  assert.equal(draft.fieldTypography.contactName.fontSize, 80);
  assert.equal(draft.customTexts[0]?.typography.fontSize, 80);
});

test("normalizeMerchantBusinessCards keeps only valid generated card assets", () => {
  const cards = normalizeMerchantBusinessCards([
    {
      id: "card-1",
      createdAt: "2026-03-17T09:00:00.000Z",
      name: "fafona card",
      contactIntroVideoUrl: "https://faolla.com/storage/v1/object/public/page-assets/intro.mp4",
      contactIntroVideoMuted: false,
      imageUrl: "data:image/png;base64,abc",
      shareImageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
      shareKey: "card-share-abc123",
      targetUrl: "https://fafona.faolla.com",
      width: 700,
      height: 420,
      ratioMode: "85:54",
      backgroundColor: "#ffffff",
      backgroundColorOpacity: 0.72,
      backgroundImageUrl: "",
      backgroundImageSnapshotOnly: true,
      backgroundImageOpacity: 0.45,
      title: "Manager",
      websiteLabel: "Visit site",
      showWebsiteUrl: true,
      contacts: {
        contactName: "felix",
        phone: "123",
        phones: ["123", "456"],
        email: "a@example.com",
        address: "Sevilla",
        wechat: "",
        whatsapp: "",
        twitter: "",
        weibo: "",
        telegram: "",
        linkedin: "",
        discord: "",
        facebook: "",
        instagram: "",
        tiktok: "",
        xiaohongshu: "",
      },
      customTexts: [
        {
          id: "custom-1",
          text: "VIP only",
          x: 120,
          y: 260,
          typography: {
            fontFamily: "",
            fontSize: 18,
            fontColor: "#ff6600",
            fontWeight: "bold",
            fontStyle: "normal",
            textDecoration: "none",
          },
        },
      ],
      textLayout: {
        merchantName: { x: 36, y: 34 },
        title: { x: 36, y: 92 },
        website: { x: 36, y: 136 },
        contactName: { x: 36, y: 190 },
        phone: { x: 36, y: 226 },
        email: { x: 36, y: 262 },
        address: { x: 36, y: 298 },
        wechat: { x: 36, y: 334 },
        whatsapp: { x: 36, y: 370 },
        twitter: { x: 36, y: 406 },
        weibo: { x: 36, y: 442 },
        telegram: { x: 360, y: 334 },
        linkedin: { x: 360, y: 370 },
        discord: { x: 360, y: 406 },
        facebook: { x: 360, y: 190 },
        instagram: { x: 360, y: 226 },
        tiktok: { x: 360, y: 262 },
        xiaohongshu: { x: 360, y: 298 },
      },
      qr: { x: 500, y: 120, size: 136 },
      typography: {
        name: {
          fontFamily: "",
          fontSize: 36,
          fontColor: "#111827",
          fontWeight: "bold",
          fontStyle: "normal",
          textDecoration: "none",
        },
        title: {
          fontFamily: "",
          fontSize: 18,
          fontColor: "#334155",
          fontWeight: "bold",
          fontStyle: "normal",
          textDecoration: "none",
        },
        website: {
          fontFamily: "",
          fontSize: 14,
          fontColor: "#475569",
          fontWeight: "normal",
          fontStyle: "normal",
          textDecoration: "none",
        },
        info: {
          fontFamily: "",
          fontSize: 14,
          fontColor: "#0f172a",
          fontWeight: "normal",
          fontStyle: "normal",
          textDecoration: "none",
        },
      },
    },
    {
      id: "invalid-card",
      createdAt: "2026-03-17T09:00:00.000Z",
      imageUrl: "",
    },
  ]);

  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.id, "card-1");
  assert.equal(cards[0]?.name, "fafona card");
  assert.equal(cards[0]?.backgroundImageOpacity, 0.45);
  assert.equal(cards[0]?.backgroundImageSnapshotOnly, true);
  assert.equal(cards[0]?.shareImageUrl, "https://faolla.com/storage/v1/object/public/page-assets/card.png");
  assert.equal(cards[0]?.shareKey, "card-share-abc123");
  assert.equal(cards[0]?.contactIntroVideoUrl, "https://faolla.com/storage/v1/object/public/page-assets/intro.mp4");
  assert.equal(cards[0]?.contactIntroVideoMuted, false);
  assert.equal(cards[0]?.backgroundColorOpacity, 0.72);
  assert.equal(cards[0]?.customTexts.length, 1);
  assert.equal(cards[0]?.customTexts[0]?.text, "VIP only");
  assert.equal(cards[0]?.contacts.address, "Sevilla");
  assert.deepEqual(cards[0]?.contacts.phones, ["123", "456"]);
  assert.equal(cards[0]?.showInChat, true);
});

test("mergeMerchantBusinessCardAssets preserves locally saved Google review links over older remote cards", () => {
  const [remoteCard] = normalizeMerchantBusinessCards([
    {
      id: "card-1",
      createdAt: "2026-06-04T10:00:00.000Z",
      mode: "link",
      name: "Haoyouduo",
      imageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
      shareImageUrl: "https://faolla.com/storage/v1/object/public/page-assets/card.png",
      contactPagePublicImageUrl: "https://faolla.com/storage/v1/object/public/page-assets/contact.png",
      shareKey: "luis-gpyv6u",
      targetUrl: "https://faolla.com",
      contacts: {
        contactName: "LUIS",
        phone: "679776548",
        phones: ["679776548"],
        email: "haoyouduo@ollamail.com",
        address: "C. Avenida de la prensa 44,41007 / Sevilla / Sevilla / Spain",
        wechat: "haoyouduo2024888",
        whatsapp: "+34634147455",
        twitter: "",
        weibo: "",
        telegram: "",
        linkedin: "",
        discord: "",
        facebook: "",
        instagram: "",
        tiktok: "",
        douyin: "",
        xiaohongshu: "",
        googleReview: "",
      },
    },
  ]);
  assert.ok(remoteCard);
  const localCard = normalizeMerchantBusinessCards([
    {
      ...remoteCard,
      contacts: {
        ...remoteCard.contacts,
        googleReview: "https://g.page/r/example/review",
      },
    },
  ])[0];
  assert.ok(localCard);

  const merged = mergeMerchantBusinessCardAssets(localCard, remoteCard, { prefer: "primary" });

  assert.equal(merged.contacts.googleReview, "https://g.page/r/example/review");
  assert.equal(merged.shareKey, "luis-gpyv6u");
  assert.equal(merged.contactPagePublicImageUrl, "https://faolla.com/storage/v1/object/public/page-assets/contact.png");
});

test("business card chat display defaults to the first card and can be reassigned", () => {
  const cards = normalizeMerchantBusinessCards([
    {
      id: "card-1",
      createdAt: "2026-03-17T09:00:00.000Z",
      name: "card 1",
      imageUrl: "data:image/png;base64,aaa",
      targetUrl: "https://a.example.com",
    },
    {
      id: "card-2",
      createdAt: "2026-03-18T09:00:00.000Z",
      name: "card 2",
      imageUrl: "data:image/png;base64,bbb",
      targetUrl: "https://b.example.com",
    },
  ]);

  assert.equal(resolveMerchantBusinessCardForChatDisplay(cards)?.id, "card-1");

  const reassigned = selectMerchantBusinessCardForChat(cards, "card-2");
  assert.equal(resolveMerchantBusinessCardForChatDisplay(reassigned)?.id, "card-2");
  assert.equal(reassigned[0]?.showInChat, false);
  assert.equal(reassigned[1]?.showInChat, true);
});

test("business card chat display can be manually disabled for all cards", () => {
  const cards = normalizeMerchantBusinessCards([
    {
      id: "card-1",
      createdAt: "2026-03-17T09:00:00.000Z",
      name: "card 1",
      imageUrl: "data:image/png;base64,aaa",
      targetUrl: "https://a.example.com",
    },
    {
      id: "card-2",
      createdAt: "2026-03-18T09:00:00.000Z",
      name: "card 2",
      imageUrl: "data:image/png;base64,bbb",
      targetUrl: "https://b.example.com",
    },
  ]);

  const disabled = disableMerchantBusinessCardChatDisplay(cards);
  assert.equal(resolveMerchantBusinessCardForChatDisplay(disabled), null);
  assert.equal(disabled.every((card) => card.chatDisplayDisabled === true), true);
});
