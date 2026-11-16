import assert from "node:assert/strict";
import test from "node:test";
import * as editorSystemDefaultsModule from "./editorSystemDefaults";
import type { Block } from "@/data/homeBlocks";
import { normalizeDomLocale } from "./domTranslations";

const editorSystemDefaults =
  (editorSystemDefaultsModule as { default?: typeof editorSystemDefaultsModule }).default ?? editorSystemDefaultsModule;
type TextBlock = Extract<Block, { type: "text" }>;

test("repeated draft text retains scalar canonicalization/localization results without mutating drafts", () => {
  const values = ["Page 2", "Variant 1", "front page", "Country", "商户自己填写的正文", "", "  Authored copy  ", "Faolla"];
  const blocks: TextBlock[] = Array.from({ length: 120 }, (_, index) => ({
    id: `draft-${index}`,
    type: "text",
    props: { heading: values[index % values.length], text: values[(index + 1) % values.length], bgOpacity: 0.7 },
  }));
  const original = structuredClone(blocks);
  const canonical = editorSystemDefaults.canonicalizeEditorBlocksSystemDefaults(blocks);
  const localized = editorSystemDefaults.localizeEditorBlocksSystemDefaults(blocks, "zh-CN");
  for (let index = 0; index < blocks.length; index += 1) {
    const canonicalBlock = canonical[index];
    const localizedBlock = localized[index];
    assert.equal(canonicalBlock.type, "text");
    assert.equal(localizedBlock.type, "text");
    if (canonicalBlock.type !== "text" || localizedBlock.type !== "text") throw new Error("block_type_changed");
    for (const key of ["heading", "text"] as const) {
      const value = blocks[index].props[key] as string;
      assert.equal(canonicalBlock.props[key], editorSystemDefaults.canonicalizeSystemDefaultText(value));
      // The scalar helper also normalizes page/plan names, so use known aliases
      // and authored text here to compare the unchanged localization policy.
      if (!/^(Page|Variant) /.test(value)) {
        assert.equal(localizedBlock.props[key], editorSystemDefaults.localizeSystemDefaultText(value, "zh-CN"));
      }
    }
    assert.equal(canonicalBlock.props.bgOpacity, 0.7);
  }
  assert.deepEqual(blocks, original);
});

test("default traversal preserves unchanged authored object identity and separate call results", () => {
  const blocks: TextBlock[] = [{ id: "authored", type: "text", props: { heading: "Unmatched authored title 48291", text: "用户自写内容 48291" } }];
  assert.equal(editorSystemDefaults.canonicalizeEditorBlocksSystemDefaults(blocks), blocks);
  assert.equal(editorSystemDefaults.localizeEditorBlocksSystemDefaults(blocks, "zh-CN"), blocks);
  const mutable: TextBlock[] = [{ id: "editable", type: "text", props: { heading: "front page", text: "" } }];
  const first = editorSystemDefaults.canonicalizeEditorBlocksSystemDefaults(mutable)[0];
  assert.equal(first.type === "text" && first.props.heading, "首页");
  mutable[0].props.heading = "Country";
  const second = editorSystemDefaults.canonicalizeEditorBlocksSystemDefaults(mutable)[0];
  assert.equal(second.type === "text" && second.props.heading, "国家");
});

test("a new traversal sees a translation cache loaded after an earlier negative lookup", () => {
  const blocks: TextBlock[] = [{ id: "late-cache", type: "text", props: { heading: "Fixture translated default 83921", text: "" } }];
  assert.equal(editorSystemDefaults.canonicalizeEditorBlocksSystemDefaults(blocks), blocks);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem: (key: string) => key === `merchant-space:dom-i18n-cache:v4:${normalizeDomLocale("en")}`
      ? JSON.stringify({ "新的音乐区块": "Fixture translated default 83921" }) : null },
  } });
  try {
    const next = editorSystemDefaults.canonicalizeEditorBlocksSystemDefaults(blocks)[0];
    assert.equal(next.type === "text" && next.props.heading, "新的音乐区块");
    assert.equal(blocks[0].props.heading, "Fixture translated default 83921");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("canonicalizeSystemDefaultText normalizes translated default page and plan names", () => {
  assert.equal(editorSystemDefaults.canonicalizeSystemDefaultText("\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 2"), "\u9875\u97622");
  assert.equal(editorSystemDefaults.canonicalizeSystemDefaultText("\u0412\u0430\u0440\u0438\u0430\u043d\u0442 1"), "\u65b9\u6848\u4e00");
  assert.equal(editorSystemDefaults.canonicalizeSystemDefaultText("\u7f16\u8f91\u0412\u0430\u0440\u0438\u0430\u043d\u0442 1"), "\u65b9\u6848\u4e00");
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

test("localizeSystemDefaultText restores translated editor defaults back to Chinese", () => {
  assert.equal(editorSystemDefaults.localizeSystemDefaultText("front page", "zh-CN"), "\u9996\u9875");
  assert.equal(editorSystemDefaults.localizeSystemDefaultText("Page navigation", "zh-CN"), "\u9875\u9762\u5bfc\u822a");
  assert.equal(editorSystemDefaults.resolveLocalizedSystemDefaultText(undefined, "\u56fd\u5bb6", "en"), "Country");
  assert.equal(editorSystemDefaults.resolveLocalizedSystemDefaultText(undefined, "\u4e0a\u4e00\u9875", "en"), "Previous page");
});
