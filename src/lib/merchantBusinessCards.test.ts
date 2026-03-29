import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultMerchantBusinessCardDraft,
  getMerchantBusinessCardRequiredFields,
  normalizeMerchantBusinessCardDraft,
  normalizeMerchantBusinessCards,
} from "./merchantBusinessCards";

test("business card generation requires complete merchant profile", () => {
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

  assert.equal(missing.length, 10);
  assert.ok(missing.every((item) => typeof item === "string" && item.length > 0));
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
  assert.equal(draft.contacts.contactName, "felix");
  assert.equal(draft.contacts.phone, "0034633130577");
  assert.deepEqual(draft.contacts.phones, ["0034633130577"]);
  assert.equal(draft.contacts.email, "caimin00x@gmail.com");
  assert.equal(draft.contacts.address, "C. Transporte, 12 / Sevilla / Sevilla / Spain");
  assert.equal(draft.fieldTypography.merchantName.fontSize, 36);
  assert.equal(draft.fieldTypography.contactName.fontSize, 14);
  assert.equal(draft.websiteLabel, "");
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

test("normalizeMerchantBusinessCardDraft allows empty website label", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    websiteLabel: "   ",
  });

  assert.equal(draft.websiteLabel, "");
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

test("normalizeMerchantBusinessCards keeps only valid generated card assets", () => {
  const cards = normalizeMerchantBusinessCards([
    {
      id: "card-1",
      createdAt: "2026-03-17T09:00:00.000Z",
      name: "fafona card",
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
  assert.equal(cards[0]?.shareImageUrl, "https://faolla.com/storage/v1/object/public/page-assets/card.png");
  assert.equal(cards[0]?.shareKey, "card-share-abc123");
  assert.equal(cards[0]?.backgroundColorOpacity, 0.72);
  assert.equal(cards[0]?.customTexts.length, 1);
  assert.equal(cards[0]?.customTexts[0]?.text, "VIP only");
  assert.equal(cards[0]?.contacts.address, "Sevilla");
  assert.deepEqual(cards[0]?.contacts.phones, ["123", "456"]);
});
