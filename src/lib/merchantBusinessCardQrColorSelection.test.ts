import assert from "node:assert/strict";
import test from "node:test";
import { businessCardQrColorPatch, businessCardQrTargetColor, businessCardQrBackgroundPatch, businessCardQrBackgroundTargetColor, type BusinessCardQrColorTarget, type BusinessCardQrBackgroundTarget } from "./merchantBusinessCardQrColorSelection";
import { normalizeMerchantBusinessCardDraft } from "./merchantBusinessCards";
import { businessCardQrIconBox } from "./merchantBusinessCardQr";
import QRCode from "qrcode";

test("all seven target combinations preserve unselected effective colors, including old follow-color cards", () => {
  const targets: BusinessCardQrColorTarget[] = ["qr", "icon", "frame"];
  for (const iconFollowColor of [true, false]) for (let mask = 1; mask < 8; mask++) {
    const value = { color: "#000000", iconColor: "#166534", frameColor: "#9f1239", iconFollowColor };
    const picked = targets.filter((_, i) => mask & 1 << i);
    const result = businessCardQrColorPatch(value, picked, "#1d4ed8");
    assert.equal(result.error, undefined);
    const next = { ...value, ...result.patch };
    const saved = normalizeMerchantBusinessCardDraft(JSON.parse(JSON.stringify({ qr: next }))).qr;
    for (const target of targets) {
      assert.equal(businessCardQrTargetColor(next, target), picked.includes(target) ? "#1d4ed8" : businessCardQrTargetColor(value, target));
      assert.equal(businessCardQrTargetColor(saved, target), businessCardQrTargetColor(next, target));
    }
  }
});

test("low contrast is rejected atomically only when QR is selected", () => {
  const value = { color: "#000000", backgroundColor: "#ffffff" };
  for (const targets of [["qr"], ["qr", "icon"], ["qr", "frame"], ["qr", "icon", "frame"]] as BusinessCardQrColorTarget[][]) {
    const result = businessCardQrColorPatch(value, targets, "#ffffff");
    assert.ok(result.error); assert.equal(result.patch, undefined);
  }
  assert.deepEqual(businessCardQrColorPatch(value, ["icon", "frame"], "#DC7D90").patch, { iconColor: "#dc7d90", iconFollowColor: false, frameColor: "#dc7d90" });
  assert.ok(businessCardQrColorPatch(value, [], "#000000").error);
  assert.ok(businessCardQrColorPatch(value, ["frame"], 'url("bad")').error);
});

test("background palette changes only selected backgrounds and survives save/reopen", () => {
  const value = { color: "#000000", backgroundColor: "#ffffff", frameBackgroundColor: "#ecfeff", frameColor: "#1d4ed8", iconColor: "#9f1239" };
  const targets: BusinessCardQrBackgroundTarget[] = ["background", "frameBackground"];
  for (let mask = 1; mask < 4; mask++) {
    const selected = targets.filter((_, index) => mask & (1 << index));
    const result = businessCardQrBackgroundPatch(value, selected, "#FFF7ED");
    assert.equal(result.error, undefined);
    const next = { ...value, ...result.patch };
    const saved = normalizeMerchantBusinessCardDraft(JSON.parse(JSON.stringify({ qr: next }))).qr;
    for (const target of targets) {
      assert.equal(businessCardQrBackgroundTargetColor(saved, target), selected.includes(target) ? "#fff7ed" : businessCardQrBackgroundTargetColor(value, target));
    }
    assert.equal(next.color, value.color);
    assert.equal(next.frameColor, value.frameColor);
    assert.equal(next.iconColor, value.iconColor);
  }
});

test("background multi-selection rejects unreadable colors atomically, frame-only remains independent", () => {
  const value = { color: "#000000", backgroundColor: "#ffffff" };
  for (const targets of [["background"], ["background", "frameBackground"]] as BusinessCardQrBackgroundTarget[][]) {
    const result = businessCardQrBackgroundPatch(value, targets, "#000000");
    assert.ok(result.error);
    assert.equal(result.patch, undefined);
  }
  assert.deepEqual(businessCardQrBackgroundPatch(value, ["frameBackground"], "#000000").patch, { frameBackgroundColor: "#000000" });
  assert.ok(businessCardQrBackgroundPatch(value, [], "#ffffff").error);
  assert.ok(businessCardQrBackgroundPatch(value, ["background"], 'url("bad")').error);
});

test("larger new badges avoid all reserved modules in versions 1 to 40", () => {
  for (let version = 1; version <= 40; version++) {
    const matrix = QRCode.create("A", { version, errorCorrectionLevel: "H" }).modules;
    const box = businessCardQrIconBox(matrix, true);
    assert.ok(box); assert.ok(box.size <= 11 && box.size ** 2 / matrix.size ** 2 < 0.1);
    for (let row: number = box.row; row < box.row + box.size; row++) {
      for (let col: number = box.col; col < box.col + box.size; col++) {
        assert.equal(matrix.isReserved(row, col), 0);
      }
    }
  }
});
