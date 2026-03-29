import assert from "node:assert/strict";
import test from "node:test";
import * as editorSystemDefaultsModule from "./editorSystemDefaults";

const editorSystemDefaults =
  (editorSystemDefaultsModule as { default?: typeof editorSystemDefaultsModule }).default ?? editorSystemDefaultsModule;

test("canonicalizeSystemDefaultText normalizes translated default page and plan names", () => {
  assert.equal(editorSystemDefaults.canonicalizeSystemDefaultText("\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 2"), "\u9875\u97622");
  assert.equal(editorSystemDefaults.canonicalizeSystemDefaultText("\u0412\u0430\u0440\u0438\u0430\u043d\u0442 1"), "\u65b9\u6848\u4e00");
  assert.equal(editorSystemDefaults.canonicalizeSystemDefaultText("\u7f16\u8f91\u0412\u0430\u0440\u0438\u0430\u043d\u0442 1"), "\u65b9\u6848\u4e00");
  assert.equal(editorSystemDefaults.canonicalizeSystemDefaultText("\u56fd\u5bb6"), "\u56fd\u5bb6");
  assert.equal(editorSystemDefaults.canonicalizeSystemDefaultText("\u7701\u4efd"), "\u7701\u4efd");
  assert.equal(editorSystemDefaults.canonicalizeSystemDefaultText("\u4e0a\u4e00\u9875"), "\u4e0a\u4e00\u9875");
  assert.equal(editorSystemDefaults.canonicalizeSystemDefaultText("\u4e0b\u4e00\u9875"), "\u4e0b\u4e00\u9875");
});

test("canonicalizePagePlanConfigSystemDefaults repairs translated page and plan names inside plan config", () => {
  const repaired = editorSystemDefaults.canonicalizePagePlanConfigSystemDefaults({
    activePlanId: "plan-1",
    plans: [
      {
        id: "plan-1",
        name: "\u0412\u0430\u0440\u0438\u0430\u043d\u0442 1",
        blocks: [],
        pages: [
          { id: "page-1", name: "\u9875\u97621", blocks: [] },
          { id: "page-2", name: "\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 2", blocks: [] },
          { id: "page-3", name: "\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 3", blocks: [] },
        ],
        activePageId: "page-1",
      },
    ],
  });

  assert.equal(repaired.plans[0]?.name, "\u65b9\u6848\u4e00");
  assert.deepEqual(
    repaired.plans[0]?.pages.map((page) => page.name),
    ["\u9875\u97621", "\u9875\u97622", "\u9875\u97623"],
  );
});
