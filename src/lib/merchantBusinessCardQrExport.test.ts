import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import { createDefaultMerchantBusinessCardDraft, type MerchantBusinessCardAsset } from "./merchantBusinessCards";
import { copyBusinessCardQrAppearance, createBusinessCardQrExportSession } from "./merchantBusinessCardQrExport";
import { renderBusinessCardQrSvg } from "./merchantBusinessCardQr";

const assigned = "https://shop.faolla.com";
const contact = "https://faolla.com/card/shop-example";
const card = (patch: Partial<MerchantBusinessCardAsset> = {}): MerchantBusinessCardAsset => ({
  ...createDefaultMerchantBusinessCardDraft({}), id: "test-card", name: "测试名片",
  mode: "link", createdAt: "2026-09-23T00:00:00Z", imageUrl: "https://example.com/card.png",
  targetUrl: assigned, shareKey: "shop-example", showInChat: true, ...patch,
});

test("export appearance detaches text and excludes card position, size and metadata", () => {
  const source = card();
  source.qr.topText = { enabled: true, text: "欢迎", font: "kuaile", fontSize: 22, color: "#000000", offsetX: 5 };
  source.qr.bottomText = { ...source.qr.topText, text: "扫码" };
  const before = JSON.stringify(source);
  const session = createBusinessCardQrExportSession(source, assigned, contact);
  session.appearance.topText!.text = "导出专用";
  session.appearance.bottomText!.offsetY = 60;
  session.appearance.color = "#1e3a8a";
  session.appearance.frame = "crafted-coffee";
  assert.equal(JSON.stringify(source), before);
  for (const key of ["x", "y", "size", "id", "imageUrl", "shareKey", "showInChat"]) assert.equal(Object.hasOwn(session.appearance, key), false);
});

test("closing/reopening and resetting start with fresh copies of the saved style", () => {
  const source = card();
  const initial = createBusinessCardQrExportSession(source, assigned, contact);
  const edited = copyBusinessCardQrAppearance(initial.appearance);
  edited.color = "#581c87";
  edited.caption = "临时文字";
  assert.deepEqual(createBusinessCardQrExportSession(source, assigned, contact), initial);
  assert.deepEqual(copyBusinessCardQrAppearance(initial.appearance), initial.appearance);
  assert.notDeepEqual(edited, initial.appearance);
});

test("image exports retain custom websites; link exports retain contact URL regardless of website button", () => {
  for (const mode of ["image", "link"] as const) {
    const session = createBusinessCardQrExportSession(card({ mode, websiteAddress: "custom.example.com/offers?src=qr#today" }), assigned, contact);
    assert.equal(session.targetUrl, mode === "image" ? "https://custom.example.com/offers?src=qr#today" : contact);
    assert.equal(session.disabledReason, "");
  }
  assert.equal(createBusinessCardQrExportSession(card({ mode: "image", websiteAddress: "" }), "https://new.faolla.com", contact).targetUrl, assigned);
  assert.equal(createBusinessCardQrExportSession(card({ mode: "image", targetUrl: "", websiteAddress: "" }), assigned, contact).targetUrl, assigned);
});

test("missing contact URL and invalid explicit website never fall back to a different destination", () => {
  for (const source of [card(), card({ mode: "image", websiteAddress: "javascript:alert(1)" })]) {
    const session = createBusinessCardQrExportSession(source, assigned, "");
    assert.equal(session.targetUrl, "");
    assert.ok(session.disabledReason);
  }
});

test("legacy captions remain legacy; hidden in-card QR can still be exported independently", () => {
  const source = card({ showQr: false });
  source.qr.showCaption = true;
  source.qr.caption = "旧文字";
  delete source.qr.topText;
  delete source.qr.bottomText;
  const session = createBusinessCardQrExportSession(source, assigned, contact);
  assert.equal(session.appearance.caption, "旧文字");
  assert.equal(Object.hasOwn(session.appearance, "topText"), false);
  assert.equal(Object.hasOwn(session.appearance, "bottomText"), false);
  assert.equal(session.disabledReason, "");
  assert.equal(source.showQr, false);
});

test("changed export styles still encode the original mode-specific destination", async () => {
  for (const mode of ["image", "link"] as const) {
    const source = card({ mode, websiteAddress: "https://example.com/offers" });
    const before = JSON.stringify(source);
    const session = createBusinessCardQrExportSession(source, assigned, contact);
    const svg = renderBusinessCardQrSvg(QRCode.create(session.targetUrl, { errorCorrectionLevel: "H" }).modules,
      { ...session.appearance, style: "finder-rounded", color: "#1e3a8a", size: 1024 });
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, session.targetUrl);
    assert.equal(JSON.stringify(source), before);
  }
});

test("standalone dialog has no save/upload/persistence capability and manager only opens a snapshot", async () => {
  const dialog = await readFile(new URL("../components/admin/BusinessCardQrExportDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /<BusinessCardQrControls/);
  assert.match(dialog, /copyBusinessCardQrAppearance\(session.appearance\)/);
  assert.doesNotMatch(dialog, /onCardsChange|persistBusinessCard|saveCard\(|fetch\(|localStorage|sessionStorage|uploadFile|onSave/);
  const manager = await readFile(new URL("../components/admin/MerchantBusinessCardManager.tsx", import.meta.url), "utf8");
  assert.match(manager, /onClick=\{\(\) => setQrExportSession\(createBusinessCardQrExportSession\(card, websiteUrl, resolveCardShortLink\(card\)\)\)\}/);
  assert.match(manager, /qrExportSession \? <BusinessCardQrExportDialog/);
  // Above the folder overlay, below the shared colour-picker portal.
  assert.match(dialog, /z-\[2147483200\]/);
  const picker = await readFile(new URL("../components/admin/ColorOrGradientPicker.tsx", import.meta.url), "utf8");
  assert.match(picker, /z-\[2147483250\]/);
});
