import test from "node:test";
import assert from "node:assert/strict";
import { serviceSheetViewport } from "./serviceSheetViewport";

test("keyboard-only viewport shrink and browser panning keep the real visible bounds", () => {
  assert.deepEqual(serviceSheetViewport(390, 120, 800), { height: 390, top: 120, keyboardOpen: true });
  assert.deepEqual(serviceSheetViewport(800, 0, 800), { height: 800, top: 0, keyboardOpen: false });
  assert.deepEqual(serviceSheetViewport(340, 0, 340), { height: 340, top: 0, keyboardOpen: false });
  assert.deepEqual(serviceSheetViewport(780.4, -2, 800), { height: 780, top: 0, keyboardOpen: false });
});
test("transient unavailable viewport dimensions never emit invalid CSS", () => {
  for (const height of [0, -1, NaN, Infinity]) assert.equal(serviceSheetViewport(height, 0, 800), null);
  assert.equal(serviceSheetViewport(300, 0, NaN), null);
  assert.equal(serviceSheetViewport(300, NaN, 800)?.top, 0);
});
