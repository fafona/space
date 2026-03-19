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
  assert.equal(draft.contacts.contactName, "felix");
  assert.equal(draft.contacts.phone, "0034633130577");
  assert.equal(draft.contacts.email, "caimin00x@gmail.com");
  assert.equal(draft.contacts.address, "C. Transporte, 12 / Sevilla / Sevilla / Spain");
  assert.ok(draft.websiteLabel.length > 0);
});

test("normalizeMerchantBusinessCardDraft preserves link mode", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    mode: "link",
    name: "fafona card",
  });

  assert.equal(draft.mode, "link");
  assert.equal(draft.name, "fafona card");
});

test("normalizeMerchantBusinessCardDraft allows empty website label", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    websiteLabel: "   ",
  });

  assert.equal(draft.websiteLabel, "");
});

test("normalizeMerchantBusinessCardDraft clamps background opacity", () => {
  const draft = normalizeMerchantBusinessCardDraft({
    backgroundImageOpacity: 2,
    backgroundColorOpacity: -1,
  });

  assert.equal(draft.backgroundImageOpacity, 1);
  assert.equal(draft.backgroundColorOpacity, 0);
});

test("normalizeMerchantBusinessCards keeps only valid generated card assets", () => {
  const cards = normalizeMerchantBusinessCards([
    {
      id: "card-1",
      createdAt: "2026-03-17T09:00:00.000Z",
      name: "fafona card",
      imageUrl: "data:image/png;base64,abc",
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
      contacts: {
        contactName: "felix",
        phone: "123",
        email: "a@example.com",
        address: "Sevilla",
        wechat: "",
        whatsapp: "",
        facebook: "",
        instagram: "",
        tiktok: "",
        xiaohongshu: "",
      },
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
  assert.equal(cards[0]?.backgroundColorOpacity, 0.72);
  assert.equal(cards[0]?.contacts.address, "Sevilla");
});
