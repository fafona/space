import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { renderBusinessCardQrSvg } from "./merchantBusinessCardQr";
import { BUSINESS_CARD_QR_CRAFTED_FRAMES, businessCardQrCraftedSelection, businessCardQrCraftedFrameGeometry, renderBusinessCardQrCraftedFrame } from "./merchantBusinessCardQrCraftedFrames";
import { BUSINESS_CARD_QR_STUDIO_FRAMES } from "./merchantBusinessCardQrStudioAssets";
import { BUSINESS_CARD_QR_FRAMES, BUSINESS_CARD_QR_ICONS, normalizeBusinessCardQrDecoration } from "./merchantBusinessCardQrDecorations";

test("36 separately identified silhouettes; all 274 historical frames remain available", () => {
  assert.equal(BUSINESS_CARD_QR_CRAFTED_FRAMES.length, 36);
  assert.equal(BUSINESS_CARD_QR_FRAMES.filter(f => !f.id.startsWith("crafted-")).length, 274);
  for (const f of BUSINESS_CARD_QR_CRAFTED_FRAMES) {
    assert.equal(normalizeBusinessCardQrDecoration({ frame: f.id }).frame, f.id);
    assert.match(renderBusinessCardQrCraftedFrame(f.id, f.color, "#ffffff", 2)!, /<(path|rect|circle|ellipse)\b/, f.id);
    for (const padding of [8, 16, 32]) {
      const g = businessCardQrCraftedFrameGeometry(f.id, padding)!;
      assert.ok(g.side >= 320 && g.x >= 0 && g.y >= 0);
      assert.ok(g.x + g.side <= 1000 && g.y + g.side < g.captionY - 14);
      assert.ok(g.captionY < 1140);
    }
  }
});

test("six approved silhouettes retain exact authored shapes and complete palettes", () => {
  for (const f of BUSINESS_CARD_QR_STUDIO_FRAMES) {
    const expected = f.body.replace(/#[0-9a-f]{3,6}\b/gi, raw => (raw.length === 4 ? "#" + raw.slice(1).split("").map(c => c + c).join("") : raw).toLowerCase());
    assert.equal(renderBusinessCardQrCraftedFrame(f.id.replace("studio-", "crafted-"), f.color, "#ffffff", 2), `<g transform="translate(0 50) scale(2)">${expected}</g>`);
  }
});

test("selecting new artwork applies frame settings only; legacy and none never reset colors", () => {
  for (const f of BUSINESS_CARD_QR_CRAFTED_FRAMES) {
    assert.deepEqual(businessCardQrCraftedSelection(f.id), { frame: f.id, frameColor: f.color, frameBackgroundColor: "#ffffff", frameWidth: 2, framePadding: 16 });
    const recolored = renderBusinessCardQrCraftedFrame(f.id, "#166534", "#f0fdf4", 4)!;
    assert.notEqual(recolored, renderBusinessCardQrCraftedFrame(f.id, f.color, "#ffffff", 2));
    assert.doesNotMatch(recolored, /NaN|undefined|Infinity/);
  }
  for (const id of ["none", "medal", "studio-award", "theme-industry-coffee"]) assert.deepEqual(businessCardQrCraftedSelection(id), { frame: id });
  assert.equal(renderBusinessCardQrCraftedFrame("unknown", "#000000", "#ffffff", 2), null);
});

test("asymmetric truck centers both QR and caption in its cargo body", () => {
  for (const padding of [8, 16, 32]) {
    const geometry = businessCardQrCraftedFrameGeometry("crafted-truck", padding)!;
    assert.equal(geometry.x + geometry.side / 2, geometry.captionX);
    assert.ok(geometry.x + geometry.side < 668, "QR must not overlap the cab");
  }
});

test("camera and record keep the entire QR quiet-zone square inside their circular inset", () => {
  for (const [id, radius] of [["crafted-camera", 150], ["crafted-record", 163]] as const) {
    for (const padding of [8, 16, 32]) {
      const g = businessCardQrCraftedFrameGeometry(id, padding)!;
      for (const x of [g.x / 2, (g.x + g.side) / 2]) {
        for (const y of [g.y / 2, (g.y + g.side) / 2]) {
          assert.ok(Math.hypot(x - 250, y - 300) < radius, `${id}: quiet zone cuts into lens or disc rim`);
        }
      }
    }
  }
});

test("record long-link QR survives export resampling and all supported padding presets", async () => {
  const target = `https://faolla.com/card/example?ref=${"safe".repeat(35)}`;
  const matrix = QRCode.create(target, { errorCorrectionLevel: "H" }).modules;
  const index = BUSINESS_CARD_QR_FRAMES.findIndex(f => f.id === "crafted-record");
  for (const width of [640, 768, 1024, 2048]) {
    for (const framePadding of [8, 16, 32]) {
      const svg = renderBusinessCardQrSvg(matrix, {
        frame: "crafted-record", style: "classic", framePadding, size: 2048,
        icon: BUSINESS_CARD_QR_ICONS[index % BUSINESS_CARD_QR_ICONS.length].id,
        color: "#1e3a8a", backgroundColor: "#fff7ed", frameColor: "#9f1239", frameBackgroundColor: "#f0fdf4",
        iconFollowColor: false, iconColor: "#166534", showCaption: true, caption: "扫码了解更多",
      });
      const { data, info } = await sharp(Buffer.from(svg)).resize({ width }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, target, `${width}px / padding ${framePadding}`);
    }
  }
});

test("chef, icecream and paw captions sit on a light continuous surface", async () => {
  for (const id of ["crafted-chef", "crafted-icecream", "crafted-paw"]) {
    const frame = BUSINESS_CARD_QR_CRAFTED_FRAMES.find(f => f.id === id)!;
    const body = renderBusinessCardQrCraftedFrame(id, frame.color, "#ffffff", 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="570" viewBox="0 0 1000 1140">${body}</svg>`;
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = frame.caption.y / 2 - 16; y <= frame.caption.y / 2 + 1; y++) {
      for (let x = 168; x <= 332; x++) {
        const at = (y * info.width + x) * 4;
        assert.ok(data[at] >= 235 && data[at + 1] >= 235 && data[at + 2] >= 235 && data[at + 3] === 255, `${id}: caption crosses colored rim at ${x},${y}`);
      }
    }
  }
});

test("all new silhouettes and their details stay inside the exported canvas at maximum stroke", async () => {
  for (const frame of BUSINESS_CARD_QR_CRAFTED_FRAMES) {
    const body = renderBusinessCardQrCraftedFrame(frame.id, frame.color, "#ffffff", 4);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="570" viewBox="0 0 1000 1140">${body}</svg>`;
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let x = 0; x < info.width; x++) {
      assert.ok(data[x * 4 + 3] <= 8, `${frame.id}: clipped top`);
      assert.ok(data[((info.height - 1) * info.width + x) * 4 + 3] <= 8, `${frame.id}: clipped bottom`);
    }
    for (let y = 0; y < info.height; y++) {
      assert.ok(data[(y * info.width) * 4 + 3] <= 8, `${frame.id}: clipped left`);
      assert.ok(data[(y * info.width + info.width - 1) * 4 + 3] <= 8, `${frame.id}: clipped right`);
    }
  }
});
