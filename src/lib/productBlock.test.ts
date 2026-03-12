import test from "node:test";
import assert from "node:assert/strict";
import { arrangeProductItemsByTag, groupArrangedProductItemsByTag } from "./productBlock";

test("groupArrangedProductItemsByTag keeps contiguous categories together", () => {
  const groups = groupArrangedProductItemsByTag([
    { id: "1", tag: "推荐" },
    { id: "2", tag: "推荐" },
    { id: "3", tag: "新品" },
    { id: "4", tag: "" },
  ]);

  assert.deepEqual(
    groups.map((group) => ({
      tag: group.tag,
      ids: group.items.map((item) => item.id),
    })),
    [
      { tag: "推荐", ids: ["1", "2"] },
      { tag: "新品", ids: ["3"] },
      { tag: "", ids: ["4"] },
    ],
  );
});

test("arrangeProductItemsByTag and grouping follow configured tag order", () => {
  const arranged = arrangeProductItemsByTag(
    [
      { id: "1", tag: "零售" },
      { id: "2", tag: "推荐" },
      { id: "3", tag: "零售" },
      { id: "4", tag: "服务" },
    ],
    ["推荐", "服务", "零售"],
    true,
  );

  const groups = groupArrangedProductItemsByTag(arranged);

  assert.deepEqual(
    groups.map((group) => ({
      tag: group.tag,
      ids: group.items.map((item) => item.id),
    })),
    [
      { tag: "推荐", ids: ["2"] },
      { tag: "服务", ids: ["4"] },
      { tag: "零售", ids: ["1", "3"] },
    ],
  );
});
