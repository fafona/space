import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import { BUSINESS_CARD_QR_TEXT_FONTS, editableBusinessCardQrTexts, normalizeBusinessCardQrText } from "./merchantBusinessCardQrText";
import { embedBusinessCardQrTextPaths } from "./merchantBusinessCardQrTextPaths";
import { businessCardQrAspectRatio, renderBusinessCardQrSvg } from "./merchantBusinessCardQr";
import { normalizeMerchantBusinessCardDraft } from "./merchantBusinessCards";

const loadFont = async (file: string) => { const data = await readFile(new URL(`../../public/fonts/qr/${file}`, import.meta.url)); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer; };
const target = "https://faolla.com/card/caption-test";
const matrix = QRCode.create(target, { errorCorrectionLevel: "H" }).modules;

test("top and bottom text are bounded, independent and persisted; old captions remain unchanged", () => {
  const old = normalizeMerchantBusinessCardDraft({ qr: { showCaption: true, caption: "旧文字" } });
  assert.equal(Object.hasOwn(old.qr, "topText"), false);
  assert.equal(editableBusinessCardQrTexts(old.qr).bottomText.text, "旧文字");
  const topText = normalizeBusinessCardQrText({ enabled: true, text: "欢迎光临", font: "mashan", fontSize: 36, color: "#DC7D90" });
  const bottomText = normalizeBusinessCardQrText({ enabled: false, text: "内容保留", font: "xiaowei", fontSize: 14, color: "#1d4ed8" });
  const restored = normalizeMerchantBusinessCardDraft(JSON.parse(JSON.stringify({ qr: { topText, bottomText } })));
  assert.deepEqual(restored.qr.topText, topText);
  assert.deepEqual(restored.qr.bottomText, bottomText);
  const invalid = normalizeBusinessCardQrText({ text: "字".repeat(40), font: '"/><script>', fontSize: Infinity, color: 'red"/>' });
  assert.equal(Array.from(invalid.text).length, 24);
  assert.equal(invalid.font, "kuaile");
  assert.equal(invalid.fontSize, 22);
  assert.equal(invalid.color, "#000000");
  assert.equal(businessCardQrAspectRatio({ topText: { ...topText, text: " " }, bottomText }), 1);
});

for (const font of BUSINESS_CARD_QR_TEXT_FONTS) test(`bundled ${font.id} produces portable paths and decodable QR with independent text`, async () => {
  const options = {
    topText: normalizeBusinessCardQrText({ enabled: true, text: "欢迎 Welcome", font: font.id, fontSize: 36, color: "#9f1239" }),
    bottomText: normalizeBusinessCardQrText({ enabled: true, text: "扫码了解更多", font: "kuaile", fontSize: 18, color: "#1d4ed8" }),
    size: 2048,
  };
  const svg = await embedBusinessCardQrTextPaths(renderBusinessCardQrSvg(matrix, options), options, loadFont);
  assert.doesNotMatch(svg, /<text|@font-face|https?:\/\/[^w]|<script/);
  assert.match(svg, /data-qr-text="top"/);
  assert.match(svg, /fill="#9f1239"/);
  assert.match(svg, /fill="#1d4ed8"/);
  const { data, info } = await sharp(Buffer.from(svg)).resize({ width: 480 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, target);
  assert.equal(info.height, Math.round(480 * businessCardQrAspectRatio(options)));
});

test("framed text adds space outside the frame; maximum sizes/length remain decodable", async () => {
  for (const frame of ["none", "ring", "crafted-coffee"]) {
    const options = { frame, topText: normalizeBusinessCardQrText({ enabled: true, text: "扫码了解更多优惠欢迎光临".repeat(2), fontSize: 64 }), bottomText: normalizeBusinessCardQrText({ enabled: true, text: '<script>"& Welcome', font: "greatvibes", fontSize: 64 }), size: 2048 };
    const svg = await embedBusinessCardQrTextPaths(renderBusinessCardQrSvg(matrix, options), options, loadFont);
    assert.doesNotMatch(svg, /<script|<text/);
    const { data, info } = await sharp(Buffer.from(svg)).resize({ width: 768 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, target);
  }
});

test("unsupported glyphs fail explicitly instead of exporting missing boxes", async () => {
  const options = { topText: normalizeBusinessCardQrText({ enabled: true, text: "😀" }) };
  await assert.rejects(embedBusinessCardQrTextPaths(renderBusinessCardQrSvg(matrix, options), options, loadFont), /字体不支持/);
});
