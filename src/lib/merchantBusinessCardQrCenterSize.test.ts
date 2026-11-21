import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import { businessCardQrCenterScale, normalizeBusinessCardQrCenterScale } from "./merchantBusinessCardQrCenterSize";
import { normalizeBusinessCardQrDecoration } from "./merchantBusinessCardQrSettings";
import { businessCardQrIconBox, businessCardQrScaledIconBox, BUSINESS_CARD_QR_STYLES, renderBusinessCardQrSvg } from "./merchantBusinessCardQr";
import { createBlankMerchantBusinessCardDraft, normalizeMerchantBusinessCardDraft } from "./merchantBusinessCards";
import { copyBusinessCardQrAppearance } from "./merchantBusinessCardQrExport";
import { BUSINESS_CARD_QR_ICONS } from "./merchantBusinessCardQrDecorations";

const industryIcon = BUSINESS_CARD_QR_ICONS.find(row => /^(studio|industry)-/.test(row.id))!.id;

async function uploadedLogo() {
  const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="white"/><path d="M4 80L48 4l44 76H4Z" fill="#b18054"/><circle cx="48" cy="50" r="17" fill="#101827"/><path d="M0 90L96 6M0 6l96 84" stroke="#d6a653" stroke-width="8"/></svg>')).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

test("center size is optional, bounded, and defaults uploaded logos to a larger 130%", () => {
  for (const invalid of [undefined, null, "130", {}, NaN, Infinity, -Infinity]) assert.equal(normalizeBusinessCardQrCenterScale(invalid), undefined);
  assert.equal(normalizeBusinessCardQrCenterScale(-1), 50);
  assert.equal(normalizeBusinessCardQrCenterScale(900), 150);
  assert.equal(normalizeBusinessCardQrCenterScale(125.6), 126);
  assert.equal(businessCardQrCenterScale(undefined), 100);
  assert.equal(businessCardQrCenterScale(undefined, true), 130);
  assert.equal(businessCardQrCenterScale(75, true), 75);
  assert.equal("iconScale" in normalizeBusinessCardQrDecoration(), false, "do not change old draft fingerprints");
  assert.equal("iconScale" in normalizeBusinessCardQrDecoration({ iconScale: NaN }), false);
});

test("both modes save/reopen/export the selected scale without changing the original image or card size", async () => {
  const image = await uploadedLogo();
  for (const mode of ["image", "link"] as const) {
    const draft = createBlankMerchantBusinessCardDraft();
    draft.mode = mode;
    draft.qr = { ...draft.qr, iconImageDataUrl: image, iconScale: 150 };
    const reopened = normalizeMerchantBusinessCardDraft(JSON.parse(JSON.stringify(draft)));
    assert.equal(reopened.qr.iconScale, 150);
    assert.equal(reopened.qr.iconImageDataUrl, image);
    const appearance = copyBusinessCardQrAppearance(reopened.qr);
    assert.equal(appearance.iconScale, 150);
    appearance.iconScale = 50;
    assert.equal(reopened.qr.iconScale, 150);
    assert.equal(reopened.qr.size, draft.qr.size);
  }
});

test("all slider sizes avoid every reserved module in all 40 QR versions", () => {
  for (let version = 1; version <= 40; version++) {
    const matrix = QRCode.create("A", { version, errorCorrectionLevel: "H" }).modules;
    for (const expanded of [false, true]) for (const scale of [50, 75, 100, 130, 150]) {
      const box = businessCardQrScaledIconBox(matrix, expanded, scale)!;
      assert.ok(box);
      assert.ok(box.artworkSize > 0 && box.artworkSize <= box.size - 0.9 + 1e-9);
      assert.ok(box.size <= Math.max(businessCardQrIconBox(matrix, expanded)!.size, Math.min(15, Math.floor(matrix.size * 0.26))));
      for (let y = box.row; y < box.row + box.size; y++) for (let x = box.col; x < box.col + box.size; x++) assert.equal(matrix.isReserved(y, x), 0, `${version}/${expanded}/${scale}: ${y},${x}`);
      if (scale === 100) {
        const { artworkSize, ...geometry } = box;
        assert.deepEqual(geometry, businessCardQrIconBox(matrix, expanded));
        assert.equal(artworkSize, box.size - 0.9);
      }
    }
  }
});

test("default uploaded artwork is visibly larger; builtin defaults and 100% layout stay unchanged", async () => {
  const image = await uploadedLogo();
  for (const target of ["https://shop.faolla.com/", "https://faolla.com/card/synthetic-card"]) {
    const matrix = QRCode.create(target, { errorCorrectionLevel: "H" }).modules;
    const old = businessCardQrScaledIconBox(matrix, false, 100)!;
    const larger = businessCardQrScaledIconBox(matrix, false, 130)!;
    assert.ok(larger.artworkSize > old.artworkSize * 1.2);
    assert.match(renderBusinessCardQrSvg(matrix, { iconImageDataUrl: image }), /data-qr-icon-scale="130"/);
    for (const icon of ["coffee", industryIcon] as const) {
      assert.equal(renderBusinessCardQrSvg(matrix, { icon }), renderBusinessCardQrSvg(matrix, { icon, iconScale: 100 }));
    }
  }
});

test("small, recommended and largest centers decode in every style and both card destinations", { timeout: 120_000 }, async () => {
  const image = await uploadedLogo();
  for (const target of ["https://shop.faolla.com/", "https://faolla.com/card/synthetic-card"]) {
    const matrix = QRCode.create(target, { errorCorrectionLevel: "H" }).modules;
    for (const style of BUSINESS_CARD_QR_STYLES) for (const frame of ["none", "thin", "crafted-coffee"] as const) for (const iconScale of [50, 130, 150]) {
      const svg = renderBusinessCardQrSvg(matrix, { style: style.id, frame, iconImageDataUrl: image, iconScale, color: "#1e3a8a", backgroundColor: "#fff7ed", size: 1024 });
      const { data, info } = await sharp(Buffer.from(svg)).resize({ width: frame === "none" ? 256 : 512 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, target, `${target}/${style.id}/${frame}/${iconScale}`);
    }
  }
  for (const icon of ["coffee", industryIcon] as const) for (const iconScale of [50, 130, 150]) {
    const target = "https://faolla.com/card/longer-destination-12345678?ref=" + "safe".repeat(35);
    const matrix = QRCode.create(target, { errorCorrectionLevel: "H" }).modules;
    const svg = renderBusinessCardQrSvg(matrix, { icon, iconScale, size: 1024 });
    const { data, info } = await sharp(Buffer.from(svg)).resize(512).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, target, `${icon}/${iconScale}/dense`);
  }
});
