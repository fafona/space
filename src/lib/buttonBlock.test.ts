import assert from "node:assert/strict";
import test from "node:test";
import type { ButtonProps } from "../data/homeBlocks";
import { buildButtonLabelPatch, resolveButtonJumpPageId, resolveButtonLabel } from "./buttonBlock";

function makeButtonProps(props: Partial<ButtonProps> = {}): ButtonProps {
  return {
    buttonJumpTarget: "",
    ...props,
  };
}

test("resolveButtonLabel prefers dedicated button label", () => {
  assert.equal(resolveButtonLabel(makeButtonProps({ buttonLabel: "立即预约" })), "立即预约");
});

test("resolveButtonJumpPageId accepts shorthand page numbers", () => {
  assert.equal(
    resolveButtonJumpPageId("page2", [
      { id: "page-1", name: "front page" },
      { id: "page-177", name: "Page 2" },
      { id: "page-288", name: "Page 3" },
    ]),
    "page-177",
  );
});

test("resolveButtonJumpPageId matches page names and front page aliases", () => {
  const pages = [
    { id: "page-1", name: "Home" },
    { id: "page-177", name: "Offers" },
  ];
  assert.equal(resolveButtonJumpPageId("front page", pages), "page-1");
  assert.equal(resolveButtonJumpPageId("page:Offers", pages), "page-177");
});

test("resolveButtonLabel falls back to legacy button text boxes", () => {
  assert.equal(
    resolveButtonLabel(
      makeButtonProps({
        commonTextBoxes: [
          {
            id: "legacy-1",
            html: "<strong>查看详情</strong>",
            x: 24,
            y: 14,
            width: 96,
            height: 28,
          },
        ],
      }),
    ),
    "<strong>查看详情</strong>",
  );
});

test("resolveButtonLabel falls back to default label when content is empty", () => {
  assert.equal(resolveButtonLabel(makeButtonProps({ buttonLabel: "<div><br></div>" })), "按钮");
});

test("buildButtonLabelPatch clears legacy content fields", () => {
  assert.deepEqual(buildButtonLabelPatch("去看看"), {
    buttonLabel: "去看看",
    commonTextBoxes: undefined,
    commonItems: undefined,
    heading: undefined,
    text: undefined,
  });
});
