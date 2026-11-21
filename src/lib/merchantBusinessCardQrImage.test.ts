import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { BUSINESS_CARD_QR_IMAGE_MAX_BYTES, isBusinessCardQrUploadRaster, normalizeBusinessCardQrImage } from "./merchantBusinessCardQrImage";
import { prepareBusinessCardQrImage } from "./merchantBusinessCardQrImage.client";
import { BUSINESS_CARD_QR_STYLES, businessCardQrIconBox, renderBusinessCardQrSvg } from "./merchantBusinessCardQr";
import { createBlankMerchantBusinessCardDraft, normalizeMerchantBusinessCardDraft, normalizeMerchantBusinessCards } from "./merchantBusinessCards";
import { copyBusinessCardQrAppearance, createBusinessCardQrExportSession } from "./merchantBusinessCardQrExport";

async function logo() {
  return sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 28, g: 127, b: 177, alpha: 0.8 } } }).png().toBuffer();
}
test("only bounded PNG data can be saved or embedded; external URLs and SVG are rejected", async () => {
  const png = await logo();
  const valid = `data:image/png;base64,${png.toString("base64")}`;
  assert.equal(normalizeBusinessCardQrImage(valid), valid);
  for (const value of [undefined, null, {}, "https://example.com/logo.png", "javascript:alert(1)", "blob:example", `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString("base64")}`,
    `data:image/png;base64,${Buffer.from("<svg>fake image</svg>").toString("base64")}`, `${valid}" onload="alert(1)`, `data:image/png;base64,${"A".repeat(BUSINESS_CARD_QR_IMAGE_MAX_BYTES * 2)}`]) {
    assert.equal(normalizeBusinessCardQrImage(value), "");
  }
  const oversized = Buffer.from(png); oversized.writeUInt32BE(8192, 16);
  assert.equal(normalizeBusinessCardQrImage(`data:image/png;base64,${oversized.toString("base64")}`), "");
  assert.equal(isBusinessCardQrUploadRaster(png.subarray(0, 12)), true);
  assert.equal(isBusinessCardQrUploadRaster(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), false);
  const jpeg = await sharp(png).jpeg().toBuffer(), webp = await sharp(png).webp().toBuffer();
  assert.equal(isBusinessCardQrUploadRaster(jpeg.subarray(0, 12)), true);
  assert.equal(isBusinessCardQrUploadRaster(webp.subarray(0, 12)), true);
  await assert.rejects(prepareBusinessCardQrImage(new File(["<svg/>"], "bad.svg", { type: "image/png" })), /只支持/);
  await assert.rejects(prepareBusinessCardQrImage(new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png")), /8 MB/);
});

test("image and link cards preserve the upload through draft/save/reopen/export; clearing restores old settings", async () => {
  const image = `data:image/png;base64,${(await logo()).toString("base64")}`;
  for (const mode of ["image", "link"] as const) {
    const draft = createBlankMerchantBusinessCardDraft();
    draft.mode = mode;
    draft.qr = { ...draft.qr, icon: "none", iconImageDataUrl: image };
    const card = normalizeMerchantBusinessCards([{ ...draft, id: `synthetic-${mode}`, imageUrl: "https://example.com/card.png", targetUrl: "https://example.com/", shareKey: "synthetic" }])[0];
    const reopened = normalizeMerchantBusinessCardDraft(JSON.parse(JSON.stringify(card)));
    assert.equal(reopened.qr.iconImageDataUrl, image);
    const session = createBusinessCardQrExportSession(card, "https://example.com/", "https://faolla.com/card/synthetic");
    assert.equal(session.appearance.iconImageDataUrl, image);
    const before = JSON.stringify(card);
    const temporary = copyBusinessCardQrAppearance(session.appearance);
    temporary.iconImageDataUrl = "";
    assert.equal(JSON.stringify(card), before);
    assert.equal(normalizeMerchantBusinessCardDraft({ ...reopened, qr: { ...reopened.qr, iconImageDataUrl: "" } }).qr.iconImageDataUrl, undefined);
  }
});

test("uploaded centers decode at preview/export sizes across both destinations, styles and frames", { timeout: 60_000 }, async () => {
  const image = `data:image/png;base64,${(await logo()).toString("base64")}`;
  for (const target of ["https://shop.faolla.com/", "https://faolla.com/card/contact-synthetic-12345"]) {
    const matrix = QRCode.create(target, { errorCorrectionLevel: "H" }).modules;
    const box = businessCardQrIconBox(matrix)!;
    for (let y = box.row; y < box.row + box.size; y++) for (let x = box.col; x < box.col + box.size; x++) assert.equal(matrix.isReserved(y, x), 0);
    for (const style of BUSINESS_CARD_QR_STYLES) {
      for (const frame of ["none", "thin", "crafted-coffee"] as const) {
        const svg = renderBusinessCardQrSvg(matrix, { style: style.id, frame, iconImageDataUrl: image, icon: "coffee", size: 1024 });
        assert.match(svg, /data-qr-icon="uploaded"/);
        assert.match(svg, /<image href="data:image\/png;base64,/);
        assert.doesNotMatch(svg, /data-qr-icon="coffee"|onload=|<script|href="https?:/);
        const { data, info } = await sharp(Buffer.from(svg)).resize({ width: frame === "none" ? 256 : 512 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, target, `${target} ${style.id} ${frame}`);
      }
    }
  }
});

test("invalid image settings never clear QR modules or alter a legacy icon", () => {
  const matrix = QRCode.create("https://faolla.com", { errorCorrectionLevel: "H" }).modules;
  const original = renderBusinessCardQrSvg(matrix, { icon: "coffee" });
  assert.equal(renderBusinessCardQrSvg(matrix, { icon: "coffee", iconImageDataUrl: "https://attacker.invalid/logo.svg" }), original);
  assert.equal(renderBusinessCardQrSvg(matrix, { icon: "none", iconImageDataUrl: '<svg onload="bad"/>' }), renderBusinessCardQrSvg(matrix, { icon: "none" }));
});
