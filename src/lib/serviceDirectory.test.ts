import test from "node:test";
import assert from "node:assert/strict";
import type { Block } from "@/data/homeBlocks";
import { serviceDirectoryBlocks } from "./serviceDirectory";

test("service directory retains region/keyword search and merchant data, with mobile and desktop controls inside the available width", () => {
  const source = [{ id: "search", type: "search-bar", props: { blockOffsetX: 300, blockOffsetY: 500, defaultCountryCode: "ES" } },
    { id: "list", type: "merchant-list", props: { maxItems: 6, publishedMerchantSnapshot: [{ id: "99990001", merchantName: "Synthetic venue" }] } }] as unknown as Block[];
  const original = structuredClone(source);
  for (const width of [288, 358, 1100]) {
    const blocks = serviceDirectoryBlocks(source, width);
    assert.deepEqual(blocks.map(block => block.type), ["search-bar", "merchant-list"]);
    for (const block of blocks) {
      const props = block.props as Record<string,unknown>;
      const layout = (block.type === "search-bar" ? props.searchLayout : props.merchantCardLayout) as Record<string,{x:number;width:number}>;
      for (const entry of Object.values(layout)) assert.ok(entry.x + entry.width <= width - 32, JSON.stringify({width,entry}));
    }
  }
  assert.deepEqual(source, original, "display adaptation never changes the published template");
});
