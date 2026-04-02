import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommonCanvasLayout } from "./commonCanvasLayout";

test("keeps default canvas size when there are no boxes", () => {
  const layout = resolveCommonCanvasLayout([]);

  assert.equal(layout.bounds.width, 280);
  assert.equal(layout.bounds.height, 240);
  assert.equal(layout.scale, 1);
  assert.equal(layout.renderWidth, 280);
  assert.equal(layout.renderHeight, 240);
});

test("scales oversized content to the available viewport", () => {
  const layout = resolveCommonCanvasLayout(
    [
      { x: 0, y: 0, width: 600, height: 300 },
      { x: 620, y: 320, width: 180, height: 220 },
    ],
    { availableWidth: 400, availableHeight: 300, minCanvasWidth: 280, minCanvasHeight: 240 },
  );

  assert.equal(layout.bounds.width, 800);
  assert.equal(layout.bounds.height, 540);
  assert.equal(layout.scale, 0.5);
  assert.equal(layout.renderWidth, 400);
  assert.equal(layout.renderHeight, 270);
});

test("translates negative positioned content back into the viewport", () => {
  const layout = resolveCommonCanvasLayout(
    [{ x: -60, y: -40, width: 180, height: 120 }],
    { minCanvasWidth: 280, minCanvasHeight: 240 },
  );

  assert.equal(layout.bounds.minX, -60);
  assert.equal(layout.bounds.minY, -40);
  assert.equal(layout.translateX, 60);
  assert.equal(layout.translateY, 40);
});
