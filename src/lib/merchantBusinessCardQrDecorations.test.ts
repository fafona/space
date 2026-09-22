import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import { BUSINESS_CARD_QR_STYLES, businessCardQrIconBox, businessCardQrAspectRatio, renderBusinessCardQrSvg } from "./merchantBusinessCardQr";
import { BUSINESS_CARD_QR_ICONS, BUSINESS_CARD_QR_FRAMES, normalizeBusinessCardQrDecoration, renderBusinessCardQrIcon, renderBusinessCardQrFrame } from "./merchantBusinessCardQrDecorations";
import { normalizeMerchantBusinessCardDraft } from "./merchantBusinessCards";

test("200+ unique vector icons and frames; safe bounded persistent settings", () => {
  assert.ok(BUSINESS_CARD_QR_ICONS.length > 200);
  assert.ok(BUSINESS_CARD_QR_FRAMES.length > 200);
  assert.equal(new Set(BUSINESS_CARD_QR_ICONS.map(i => i.id)).size, BUSINESS_CARD_QR_ICONS.length);
  assert.equal(new Set(BUSINESS_CARD_QR_ICONS.map(i => renderBusinessCardQrIcon(i.id, "#000000"))).size, BUSINESS_CARD_QR_ICONS.length);
  assert.equal(new Set(BUSINESS_CARD_QR_FRAMES.map(i => renderBusinessCardQrFrame(normalizeBusinessCardQrDecoration({ frame: i.id })))).size, BUSINESS_CARD_QR_FRAMES.length);
  const bad = normalizeBusinessCardQrDecoration({ icon: "<script>" as never, frame: "arbitrary" as never, iconColor: 'red"/>', frameColor: "url(https://bad)", frameWidth: Infinity, framePadding: -100 });
  assert.equal(bad.icon, "none"); assert.equal(bad.frame, "none"); assert.equal(bad.iconColor, "#000000"); assert.equal(bad.frameColor, "#1e3a8a"); assert.equal(bad.frameWidth, 2); assert.equal(bad.framePadding, 8);
  assert.equal(normalizeBusinessCardQrDecoration(null).frame, "none");
  for (const [i, frame] of BUSINESS_CARD_QR_FRAMES.entries()) {
    const settings = normalizeBusinessCardQrDecoration({ icon: BUSINESS_CARD_QR_ICONS[i % BUSINESS_CARD_QR_ICONS.length].id, frame: frame.id, iconFollowColor: false, iconColor: "#9F1239", frameColor: "#166534", frameBackgroundColor: "#FFF7ED", frameWidth: 4, framePadding: 32 });
    const qr = normalizeMerchantBusinessCardDraft({ qr: settings }).qr;
    for (const key of Object.keys(settings) as (keyof typeof settings)[]) assert.equal(qr[key], settings[key]);
    assert.deepEqual(normalizeMerchantBusinessCardDraft(JSON.parse(JSON.stringify({ qr }))).qr, qr);
  }
});

test("legacy rendering remains byte-identical when decoration is absent or explicitly disabled", () => {
  const matrix = QRCode.create("https://faolla.com", { errorCorrectionLevel: "H" }).modules;
  for (const style of BUSINESS_CARD_QR_STYLES) for (const showCaption of [false, true]) {
    const legacy = renderBusinessCardQrSvg(matrix, { style: style.id, showCaption, caption: "hello" });
    assert.equal(renderBusinessCardQrSvg(matrix, { style: style.id, showCaption, caption: "hello", ...normalizeBusinessCardQrDecoration() }), legacy);
  }
});

test("icon badge does not cover reserved modules for ANY QR version", () => {
  for (let version = 1; version <= 40; version++) {
    const matrix = QRCode.create("A", { version, errorCorrectionLevel: "H" }).modules;
    const box = businessCardQrIconBox(matrix);
    assert.ok(box, `missing icon space version ${version}`);
    assert.ok(box.size <= 11 && box.size ** 2 / matrix.size ** 2 < 0.06);
    for (let row: number = box.row; row < box.row + box.size; row++) for (let col: number = box.col; col < box.col + box.size; col++) assert.equal(matrix.isReserved(row, col), 0, `reserved module ${version}:${row},${col}`);
  }
});

test("decorated SVG escapes captions and colors, keeps bounded geometry", () => {
  const matrix = QRCode.create("https://faolla.com", { errorCorrectionLevel: "H" }).modules;
  for (const frame of BUSINESS_CARD_QR_FRAMES) {
    const svg = renderBusinessCardQrSvg(matrix, { frame: frame.id, icon: "coffee", iconColor: '" onload="bad', frameColor: "url(https://bad)", showCaption: true, caption: '<script>&"', size: 4096 });
    assert.doesNotMatch(svg, /onload=|<script>|https:\/\/bad/);
    assert.match(svg, /&lt;script&gt;&amp;&quot;/);
    assert.match(svg, /width="4096" height="4669"/);
    assert.equal(businessCardQrAspectRatio({ frame: frame.id }), 1.14);
    const hidden = renderBusinessCardQrSvg(matrix, { frame: frame.id, showCaption: false, caption: "keep me" });
    assert.doesNotMatch(hidden, /keep me|<text/);
  }
});

for (const [index, frame] of BUSINESS_CARD_QR_FRAMES.entries()) {
  test(`frame ${frame.id}: all styles plus rotating industry icons decode`, async () => {
    for (const [styleIndex, style] of BUSINESS_CARD_QR_STYLES.entries()) {
      const target = styleIndex % 3 === 0 ? `https://faolla.com/card/example?ref=${"safe".repeat(35)}` : "https://haoyouduo.faolla.com/";
      const matrix = QRCode.create(target, { errorCorrectionLevel: "H" }).modules;
      const svg = renderBusinessCardQrSvg(matrix, { frame: frame.id, icon: BUSINESS_CARD_QR_ICONS[(index + styleIndex) % BUSINESS_CARD_QR_ICONS.length].id, style: style.id, color: "#1e3a8a", backgroundColor: "#fff7ed", frameColor: "#9f1239", frameBackgroundColor: "#f0fdf4", iconFollowColor: false, iconColor: "#166534", showCaption: true, caption: "扫码了解更多", framePadding: styleIndex % 2 ? 8 : 32, size: 2048 });
      const { data, info } = await sharp(Buffer.from(svg)).resize({ width: 768 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, target, `${frame.id} / ${style.id}`);
    }
  });
}

test("all icons decode without a frame at small preview size", async () => {
  for (const icon of BUSINESS_CARD_QR_ICONS) {
    const target = "https://haoyouduo.faolla.com/";
    const matrix = QRCode.create(target, { errorCorrectionLevel: "H" }).modules;
    const svg = renderBusinessCardQrSvg(matrix, { icon: icon.id, size: 256 });
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, target, icon.id);
  }
});

test("framed exports are opaque at rounded dimensions and dark bars use light captions", async () => {
  const matrix = QRCode.create("https://faolla.com", { errorCorrectionLevel: "H" }).modules;
  for (const frame of ["phone", "ribbon", "business", "car"] as const) {
    const svg = renderBusinessCardQrSvg(matrix, { frame, showCaption: true, caption: "Read more", size: 2048 });
    assert.match(svg, /viewBox="0 0 1000 1140" preserveAspectRatio="none"/);
    assert.match(svg, /fill="#ffffff">Read more<\/text>/);
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const pixel of [0, info.width - 1, info.width * (info.height - 1), info.width * info.height - 1]) assert.equal(data[pixel * 4 + 3], 255);
  }
});
