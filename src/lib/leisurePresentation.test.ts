import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "../data/homeBlocks";
import { getLeisurePresentation, getLeisureRole, getLeisureBlockStyle } from "./leisurePresentation";
import { sanitizeBlocksForRuntime } from "./blocksSanitizer";

const block = (props: Record<string, unknown> = {}, type: Block["type"] = "text"): Block => ({ id: "synthetic", type, props } as Block);

test("only an explicit own, whitelisted presentation activates the layout", () => {
  assert.equal(getLeisurePresentation([]), null);
  assert.equal(getLeisurePresentation([block({ heading: "Ordinary merchant" })]), null);
  for (const invalid of ["leisure", "__proto__", "leisure-home-v1 injected", {}, true]) {
    assert.equal(getLeisurePresentation([block({ pagePresentation: invalid })]), null);
  }
  assert.equal(getLeisurePresentation([block(Object.create({ pagePresentation: "leisure-home-v1" }))]), null);
  for (const theme of ["leisure-home-v1", "leisure-games-v1", "leisure-visit-v1"] as const) {
    assert.equal(getLeisurePresentation([block({ pagePresentation: theme })]), theme);
  }
});

test("presentation roles are own whitelisted strings with matching native block types", () => {
  assert.equal(getLeisureRole(block({ leisureRole: "booking" }, "booking")), "booking");
  assert.equal(getLeisureRole(block({ leisureRole: "booking" })), undefined);
  assert.equal(getLeisureRole(block({ leisureRole: "hero" }, "gallery")), "hero");
  for (const invalid of ["__proto__", "constructor", "hero injected", {}, true]) {
    assert.equal(getLeisureRole(block({ leisureRole: invalid })), undefined);
  }
  assert.equal(getLeisureRole(block(Object.create({ leisureRole: "intro" }))), undefined);
});

test("unassigned or invalid-role blocks remain visible after the designed sections", () => {
  assert.deepEqual(getLeisureBlockStyle(block(), 7), { gridColumn: "1 / -1", gridRow: 47 });
  assert.deepEqual(getLeisureBlockStyle(block({ leisureRole: "booking" }), 2), { gridColumn: "1 / -1", gridRow: 42 });
  assert.equal(getLeisureBlockStyle(block({ leisureRole: "intro" }), 2), undefined);
});

test("native sanitization round-trips the inert metadata without changing booking identity or configuration", () => {
  const original = block({ schemaVersion: 3, pagePresentation: "leisure-visit-v1", leisureRole: "booking", bookingHeading: "Synthetic visit", bookingStores: ["Synthetic store"], bookingItems: ["Synthetic activity"] }, "booking");
  const clean = sanitizeBlocksForRuntime([original]);
  assert.equal(clean.removed, 0);
  assert.deepEqual(clean.blocks, [original]);
});
