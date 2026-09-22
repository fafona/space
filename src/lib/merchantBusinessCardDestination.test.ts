import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import { normalizeBusinessCardWebsiteAddress, resolveBusinessCardWebsiteAddress, resolveBusinessCardScanTarget, businessCardUsesContactPage } from "./merchantBusinessCardDestination";
import { createDefaultMerchantBusinessCardDraft, normalizeMerchantBusinessCardDraft, normalizeMerchantBusinessCards } from "./merchantBusinessCards";
import { renderBusinessCardQrSvg } from "./merchantBusinessCardQr";
import { buildMerchantBusinessCardShareUrl, normalizeMerchantBusinessCardSharePayload, parseMerchantBusinessCardShareParams } from "./merchantBusinessCardShare";

const assigned = "https://fafona.faolla.com";
const contact = buildMerchantBusinessCardShareUrl({ targetUrl: assigned, shareKey: "destination-abc234" });

test("legacy image cards keep their assigned destination and legacy link cards keep their contact page", () => {
  const image = normalizeMerchantBusinessCardDraft({ mode: "image", websiteLabel: "Visit us" });
  assert.equal(image.websiteAddress, undefined);
  assert.equal(Object.hasOwn(image, "qrDestination"), false);
  assert.equal(image.websiteLabel, "Visit us");
  assert.equal(resolveBusinessCardScanTarget(image, assigned, contact), assigned);
  assert.equal(resolveBusinessCardScanTarget({ ...image, mode: "link" }, assigned, contact), contact);
  assert.equal(resolveBusinessCardWebsiteAddress({ mode: "link", websiteAddress: "https://example.com" }, assigned), "https://example.com/");
});

test("image website choice goes directly to the supplied URL and blank restores assigned merchant site", () => {
  assert.equal(resolveBusinessCardScanTarget({ mode: "image", websiteAddress: "shop.example.com/offers?src=qr#today" }, assigned, contact), "https://shop.example.com/offers?src=qr#today");
  for (const websiteAddress of [undefined, "", "  "]) assert.equal(resolveBusinessCardScanTarget({ mode: "image", websiteAddress }, assigned, contact), assigned);
  assert.equal(normalizeBusinessCardWebsiteAddress("https://example.com/offers?src=qr"), "https://example.com/offers?src=qr");
  assert.equal(normalizeBusinessCardWebsiteAddress("example.com:8443/offers"), "https://example.com:8443/offers");
  assert.equal(normalizeBusinessCardWebsiteAddress("//example.com/a"), "https://example.com/a");
});

test("unsafe or unfinished addresses fail closed, without redirecting to the assigned site", () => {
  for (const websiteAddress of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/foo", "/relative", "incomplete", "https://name:password@example.com", "https://example.com\\@evil.test", "https://exa mple.com", "https://example.com/\nnext", `https://example.com/${"x".repeat(2048)}`]) {
    assert.equal(normalizeBusinessCardWebsiteAddress(websiteAddress), "", websiteAddress);
    assert.equal(resolveBusinessCardScanTarget({ mode: "image", websiteAddress }, assigned, contact), "", websiteAddress);
  }
});

test("mode alone determines destination and a stale draft choice cannot override it", () => {
  const settings = { mode: "image", qrDestination: "contact", websiteAddress: "https://example.com/offer" } as const;
  assert.equal(businessCardUsesContactPage(settings), false);
  assert.equal(resolveBusinessCardScanTarget(settings, assigned, contact), settings.websiteAddress);
  const normalized = normalizeMerchantBusinessCardDraft(settings);
  assert.equal(Object.hasOwn(normalized, "qrDestination"), false);
  const link = { ...settings, mode: "link", qrDestination: "website" } as const;
  assert.equal(businessCardUsesContactPage(link), true);
  assert.equal(resolveBusinessCardScanTarget(link, assigned, contact), contact);
  assert.equal(resolveBusinessCardScanTarget(link, assigned, ""), "");
});

test("destination settings survive draft/card persistence without replacing merchant identity", () => {
  for (const mode of ["image", "link"] as const) {
    const input = { ...createDefaultMerchantBusinessCardDraft({}), mode, websiteAddress: "https://example.com/offer", id: "card-test", createdAt: "2026-09-22T10:00:00Z", imageUrl: "data:image/png;base64,test", targetUrl: assigned };
    const [card] = normalizeMerchantBusinessCards(JSON.parse(JSON.stringify([input])));
    assert.equal(card.websiteAddress, input.websiteAddress);
    assert.equal(Object.hasOwn(card, "qrDestination"), false);
    assert.equal(card.mode, mode);
    assert.equal(card.targetUrl, assigned);
  }
});

test("actual QR renderer encodes direct website or contact target, never a mixture", async () => {
  for (const mode of ["image", "link"] as const) {
    const target = resolveBusinessCardScanTarget({ mode, websiteAddress: "https://example.com/special?a=1#offer" }, assigned, contact);
    const svg = renderBusinessCardQrSvg(QRCode.create(target, { errorCorrectionLevel: "H" }).modules, { size: 1024, style: "finder-rounded" });
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, target);
    assert.equal(target, mode === "image" ? "https://example.com/special?a=1#offer" : contact);
  }
});

test("link-mode website button uses the custom address while QR and merchant identity remain on Faolla", () => {
  const settings = { mode: "link", websiteAddress: "https://example.com/offer?src=contact#today" } as const;
  const websiteUrl = resolveBusinessCardWebsiteAddress(settings, assigned);
  const payload = normalizeMerchantBusinessCardSharePayload({ name: "QA", targetUrl: assigned, contact: { websiteUrl } });
  assert.ok(payload);
  assert.equal(payload.targetUrl, new URL(assigned).href);
  assert.equal(payload.contact?.websiteUrl, settings.websiteAddress);
  assert.equal(resolveBusinessCardScanTarget(settings, assigned, contact), contact);
  const legacyUrl = buildMerchantBusinessCardShareUrl(payload);
  const restored = parseMerchantBusinessCardShareParams(new URL(legacyUrl).searchParams);
  assert.equal(restored?.contact?.websiteUrl, settings.websiteAddress);
  assert.equal(restored?.targetUrl, new URL(assigned).href);
  assert.equal(resolveBusinessCardWebsiteAddress({ mode: "link" }, assigned), assigned);
  assert.equal(resolveBusinessCardWebsiteAddress({ mode: "link", websiteAddress: "" }, assigned), assigned);
  assert.equal(resolveBusinessCardWebsiteAddress({ mode: "link", websiteAddress: "javascript:alert(1)" }, assigned), "");
});
