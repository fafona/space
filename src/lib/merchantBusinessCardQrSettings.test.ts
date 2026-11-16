import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { BUSINESS_CARD_QR_FRAMES, BUSINESS_CARD_QR_ICONS, normalizeBusinessCardQrDecoration as legacyDecoration } from "./merchantBusinessCardQrDecorations";
import { normalizeBusinessCardQrBackground as legacyBackground, normalizeBusinessCardQrCaption as legacyCaption,
  normalizeBusinessCardQrColor as legacyColor, normalizeBusinessCardQrStyle as legacyStyle } from "./merchantBusinessCardQr";
import { BUSINESS_CARD_QR_FRAME_IDS, BUSINESS_CARD_QR_ICON_IDS } from "./merchantBusinessCardQrPresetIds";
import { normalizeBusinessCardQrBackground, normalizeBusinessCardQrCaption, normalizeBusinessCardQrColor,
  normalizeBusinessCardQrDecoration, normalizeBusinessCardQrFrame, normalizeBusinessCardQrIcon, normalizeBusinessCardQrStyle } from "./merchantBusinessCardQrSettings";
import { normalizeMerchantBusinessCardDraft } from "./merchantBusinessCards";

test("lightweight preset index exactly matches all renderer IDs in their existing order", () => {
  assert.deepEqual(BUSINESS_CARD_QR_ICON_IDS, BUSINESS_CARD_QR_ICONS.map(row => row.id));
  assert.deepEqual(BUSINESS_CARD_QR_FRAME_IDS, BUSINESS_CARD_QR_FRAMES.map(row => row.id));
  assert.equal(new Set(BUSINESS_CARD_QR_ICON_IDS).size, BUSINESS_CARD_QR_ICON_IDS.length);
  assert.equal(new Set(BUSINESS_CARD_QR_FRAME_IDS).size, BUSINESS_CARD_QR_FRAME_IDS.length);
  for (const icon of BUSINESS_CARD_QR_ICONS) assert.equal(normalizeBusinessCardQrIcon(icon.id), icon.id);
  for (const frame of BUSINESS_CARD_QR_FRAMES) assert.equal(normalizeBusinessCardQrFrame(frame.id), frame.id);
  for (const input of [undefined, null, "none", "", "constructor", "__proto__", "unknown", 0, {}, true]) {
    assert.equal(normalizeBusinessCardQrIcon(input), "none");
    assert.equal(normalizeBusinessCardQrFrame(input), "none");
  }
});

test("old rendering exports remain aliases of the one lightweight normalization implementation", () => {
  assert.equal(legacyDecoration, normalizeBusinessCardQrDecoration);
  assert.equal(legacyBackground, normalizeBusinessCardQrBackground);
  assert.equal(legacyCaption, normalizeBusinessCardQrCaption);
  assert.equal(legacyColor, normalizeBusinessCardQrColor);
  assert.equal(legacyStyle, normalizeBusinessCardQrStyle);
});

test("all saved decoration and draft QR results retain their exact pre-split fingerprints", () => {
  // Captured before the split, without any production/user content or timestamps.
  const inputs = [
    ...BUSINESS_CARD_QR_ICONS.map(icon => ({ icon: icon.id })),
    ...BUSINESS_CARD_QR_FRAMES.map(frame => ({ frame: frame.id })),
    undefined, null, {}, true, 1, "unknown",
  ];
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(digest(inputs.map(input => normalizeBusinessCardQrDecoration(input as never))),
    "41b6be803e207a26c449e514716a782d034c69284e28b964e0a559e2b5e98a79");
  assert.equal(digest(inputs.map(input => normalizeMerchantBusinessCardDraft({ qr: input } as never).qr)),
    "f5f42717cb303cd801e36981c72fc458f88ec92c859af4a9bb4343b8873b7550");
});
