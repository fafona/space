import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import {
  BUSINESS_CARD_QR_COLORS, BUSINESS_CARD_QR_STYLES, BUSINESS_CARD_QR_BACKGROUNDS, isBusinessCardQrColorReadable,
  businessCardQrAspectRatio, normalizeBusinessCardQrBackground, normalizeBusinessCardQrCaption,
  normalizeBusinessCardQrColor, normalizeBusinessCardQrStyle, renderBusinessCardQrSvg,
} from "./merchantBusinessCardQr";
import { createBusinessCardQrSvg } from "./merchantBusinessCardQrRender";
import { normalizeBusinessCardQrDecoration } from "./merchantBusinessCardQrDecorations";
import { createBlankMerchantBusinessCardDraft, normalizeMerchantBusinessCardDraft } from "./merchantBusinessCards";

test("QR settings preserve old cards and survive save/reopen normalization", () => {
  const old = normalizeMerchantBusinessCardDraft({ qr: { x: 6, y: 1, size: 300 } });
  assert.deepEqual(old.qr, { ...normalizeBusinessCardQrDecoration(), x: 6, y: 1, size: 300, style: "classic", color: "#000000", backgroundColor: "#ffffff", showCaption: false, caption: "扫码了解更多" });
  for (const style of BUSINESS_CARD_QR_STYLES) {
    const draft = createBlankMerchantBusinessCardDraft();
    draft.qr = { ...draft.qr, style: style.id, color: "#1D4ED8", backgroundColor: "#FFF7ED", showCaption: true, caption: "扫码进入官网" };
    const restored = normalizeMerchantBusinessCardDraft(JSON.parse(JSON.stringify(draft)));
    assert.equal(restored.qr.style, style.id);
    assert.equal(restored.qr.color, "#1d4ed8");
    assert.equal(restored.qr.backgroundColor, "#fff7ed");
    assert.equal(restored.qr.showCaption, true);
    assert.equal(restored.qr.caption, "扫码进入官网");
    assert.equal(restored.qr.x, draft.qr.x);
    assert.equal(restored.qr.size, draft.qr.size);
  }
});

test("QR options are bounded and cannot inject SVG markup", () => {
  assert.equal(BUSINESS_CARD_QR_STYLES.length, 16);
  assert.equal(new Set(BUSINESS_CARD_QR_STYLES.map((style) => style.id)).size, BUSINESS_CARD_QR_STYLES.length);
  assert.equal(normalizeBusinessCardQrStyle("unknown"), "classic");
  assert.equal(normalizeBusinessCardQrColor('red\"/><script/>'), "#000000");
  assert.equal(isBusinessCardQrColorReadable("#ffffff"), false);
  assert.equal(isBusinessCardQrColorReadable("#dddddd"), false);
  for (const color of BUSINESS_CARD_QR_COLORS) assert.equal(isBusinessCardQrColorReadable(color), true);
  const code = QRCode.create("https://faolla.com");
  const svg = renderBusinessCardQrSvg(code.modules, { color: 'red\"/><script/>', size: 99999 });
  assert.match(svg, /width="4096" height="4096"/);
  assert.doesNotMatch(svg, /<script|href=|onload=/);
  assert.match(svg, new RegExp(`viewBox="0 0 ${code.modules.size + 8} ${code.modules.size + 8}"`));
});

for (const style of BUSINESS_CARD_QR_STYLES) {
  test(`QR style ${style.id} decodes website and card URLs at preview/export resolutions`, async () => {
    for (const target of ["https://haoyouduo.faolla.com/", "https://faolla.com/card/contact-12345", `https://faolla.com/card/contact-12345?ref=${"sample".repeat(25)}`]) {
      const svg = await createBusinessCardQrSvg(target, { style: style.id, color: "#1d4ed8", size: 4096 });
      for (const size of [256, 768]) {
        const { data, info } = await sharp(Buffer.from(svg)).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
        assert.equal(result?.data, target, `${style.id} failed at ${size}px`);
      }
    }
  });
}

test("QR structural modules remain square for every style", () => {
  const matrix = { size: 1, get: () => 1, isReserved: () => 1 };
  for (const style of BUSINESS_CARD_QR_STYLES) {
    assert.match(renderBusinessCardQrSvg(matrix, { style: style.id }), /<path d="M4 4h1v1h-1Z"\/>/);
  }
  const dataMatrix = QRCode.create("https://faolla.com").modules;
  const designs = BUSINESS_CARD_QR_STYLES.map((style) => renderBusinessCardQrSvg(dataMatrix, { style: style.id }));
  assert.equal(new Set(designs).size, BUSINESS_CARD_QR_STYLES.length);
});

test("QR backgrounds and captions enforce contrast, safe text and stable dimensions", async () => {
  assert.equal(normalizeBusinessCardQrBackground('red\"/><script/>'), "#ffffff");
  assert.equal(isBusinessCardQrColorReadable("#ffffff", "#000000"), false);
  assert.equal(isBusinessCardQrColorReadable("#1d4ed8", "#334155"), false);
  for (const background of BUSINESS_CARD_QR_BACKGROUNDS) assert.equal(isBusinessCardQrColorReadable("#000000", background), true);
  assert.equal(normalizeBusinessCardQrCaption("  扫码\n  了解更多\u0001 "), "扫码 了解更多");
  assert.equal(Array.from(normalizeBusinessCardQrCaption("😀".repeat(50))).length, 24);
  assert.equal(businessCardQrAspectRatio({ showCaption: true, caption: " " }), 1);
  assert.equal(businessCardQrAspectRatio({ showCaption: false, caption: "hello" }), 1);
  const svg = await createBusinessCardQrSvg("https://faolla.com", { backgroundColor: "#fff7ed", showCaption: true, caption: '<script>"&你好', size: 2048 });
  assert.match(svg, /width="2048" height="2376"/);
  assert.match(svg, /fill="#fff7ed"/);
  assert.match(svg, /&lt;script&gt;&quot;&amp;你好/);
  assert.doesNotMatch(svg, /<script>/);
  const hidden = await createBusinessCardQrSvg("https://faolla.com", { showCaption: false, caption: "keep me" });
  assert.doesNotMatch(hidden, /<text|keep me/);
  assert.equal(normalizeMerchantBusinessCardDraft({ qr: { showCaption: "false" } }).qr.showCaption, false);
});

test("all QR styles decode with tinted backgrounds and captions without shrinking the code", async () => {
  const target = "https://haoyouduo.faolla.com/";
  for (const style of BUSINESS_CARD_QR_STYLES) {
    for (const backgroundColor of ["#fff7ed", "#dbeafe", "#f0fdf4"]) {
      const svg = await createBusinessCardQrSvg(target, { style: style.id, color: "#000000", backgroundColor, showCaption: true, caption: "Scan to learn more", size: 4096 });
      const { data, info } = await sharp(Buffer.from(svg)).resize({ width: 384 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.height, Math.round(384 * 1.16));
      assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, target, `${style.id} / ${backgroundColor}`);
      assert.deepEqual(Array.from(data.subarray(0, 4)), [parseInt(backgroundColor.slice(1, 3), 16), parseInt(backgroundColor.slice(3, 5), 16), parseInt(backgroundColor.slice(5, 7), 16), 255]);
    }
  }
});
