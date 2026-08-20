import assert from "node:assert/strict";
import test from "node:test";
import type { ButtonProps } from "../data/homeBlocks";
import {
  buildButtonLabelPatch,
  DEFAULT_BUTTON_LABEL,
  getButtonHoverAnimationClassName,
  normalizeButtonNavigationTarget,
  normalizeButtonHoverAnimation,
  resolveButtonJumpBlockId,
  resolveButtonJumpPageId,
  resolveButtonLabel,
} from "./buttonBlock";

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

test("resolveButtonJumpBlockId matches block ids and public ids", () => {
  const blocks = [
    { id: "product-abc", publicId: "0102", label: "产品" },
    { id: "coupon-def", publicId: "0103", label: "优惠券" },
  ];
  assert.equal(resolveButtonJumpBlockId("product-abc", blocks), "product-abc");
  assert.equal(resolveButtonJumpBlockId("#0103", blocks), "coupon-def");
  assert.equal(resolveButtonJumpBlockId("block:0102", blocks), "product-abc");
  assert.equal(resolveButtonJumpBlockId("block:missing", blocks), null);
});

test("button hover animation values are normalized for legacy data", () => {
  assert.equal(normalizeButtonHoverAnimation("grow"), "grow");
  assert.equal(normalizeButtonHoverAnimation("unknown"), "none");
  assert.equal(
    getButtonHoverAnimationClassName("glow"),
    "faolla-button-hover-target faolla-button-hover-glow",
  );
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

test("resolveButtonLabel keeps an explicitly empty dedicated label empty", () => {
  assert.equal(resolveButtonLabel(makeButtonProps({ buttonLabel: "" })), "");
  assert.equal(resolveButtonLabel(makeButtonProps({ buttonLabel: "<div><br></div>" })), "<div><br></div>");
});

test("resolveButtonLabel falls back to default label only without dedicated or legacy content", () => {
  assert.equal(resolveButtonLabel(makeButtonProps()), DEFAULT_BUTTON_LABEL);
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

test("button navigation target rejects executable and malformed schemes", () => {
  for (const target of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.com/id",
    "file:///tmp/test",
    "vbscript:msgbox(1)",
    "//attacker.example/path",
    "/\\attacker.example/path",
    "https:\\attacker.example/path",
    '#x\"] [onclick="alert(1)',
  ]) {
    assert.equal(normalizeButtonNavigationTarget(target), "", target);
  }
});

test("button navigation target permits safe anchors, paths, and HTTP links", () => {
  assert.equal(normalizeButtonNavigationTarget("#section-1"), "#section-1");
  assert.equal(normalizeButtonNavigationTarget("/booking?step=1"), "/booking?step=1");
  assert.equal(normalizeButtonNavigationTarget("https://example.com/path"), "https://example.com/path");
});
