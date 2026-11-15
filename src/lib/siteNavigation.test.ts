import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import type { NavProps } from "../data/homeBlocks";
import { getSiteNavigationItems, getSiteNavigationSubItems, siteNavigationColor } from "./siteNavigation";
import { sanitizeBlocksForRuntime } from "./blocksSanitizer";

const value: NavProps = {
  navItems: [{ id: "home", label: "Home", pageId: "home" }, { id: "games", label: "Games", pageId: "games" }, { id: "visit", label: "Visit", pageId: "visit" }],
  navCtaPageId: "visit",
  navSubItems: [{ id: "a", label: "View games", parentPageId: "games", pageId: "games" }, { id: "b", label: "Book", parentPageId: "games", pageId: "visit" }],
};
test("brand navigation is opt-in and does not create, reorder or mutate pages", () => {
  const copy = structuredClone(value);
  assert.equal(value.navLayout, undefined);
  assert.deepEqual(getSiteNavigationItems(value).map(item => item.pageId), ["home", "games", "visit"]);
  assert.deepEqual(getSiteNavigationSubItems(value), value.navSubItems);
  assert.deepEqual(value, copy);
});
test("submenus reject removed/unknown pages, duplicate IDs and children of the CTA", () => {
  assert.deepEqual(getSiteNavigationSubItems({ ...value, navSubItems: [...value.navSubItems!,
    { id: "a", label: "Duplicate", parentPageId: "home", pageId: "visit" },
    { id: "c", label: "Missing", parentPageId: "games", pageId: "deleted" },
    { id: "d", label: "Missing parent", parentPageId: "deleted", pageId: "visit" },
    { id: "e", label: "CTA child", parentPageId: "visit", pageId: "home" },
  ] }), value.navSubItems);
});
test("malformed imported navigation is bounded and colors cannot inject styles", () => {
  assert.equal(getSiteNavigationItems({ navItems: [null, { pageId: "" }, { pageId: "bad", label: {} }, ...value.navItems!, value.navItems![0]] as never }).length, 3);
  assert.equal(getSiteNavigationSubItems({ ...value, navSubItems: Array.from({ length: 40 }, (_, n) => ({ id: `s-${n}`, parentPageId: "games", label: "Child", pageId: "home" })) }).length, 32);
  assert.equal(siteNavigationColor("red;position:fixed", "#ffffff"), "#ffffff");
  assert.equal(siteNavigationColor("#f5888e", "#ffffff"), "#f5888e");
});
test("native draft sanitization preserves configured navigation and independent copies", () => {
  const nav = { id: "nav", type: "nav" as const, props: { ...structuredClone(value), schemaVersion: 3, navLayout: "brand-header" as const, navSticky: true, navLogoUrl: "https://example.com/logo.webp" } };
  const result = sanitizeBlocksForRuntime([nav]);
  assert.equal(result.removed, 0);
  assert.deepEqual(result.blocks[0], nav);
  assert.notEqual(result.blocks[0].props, nav.props);
});

test("public sticky overflow correction is opt-in and never overrides vertical modal locking", () => {
  const css = postcss.parse(readFileSync(new URL("../components/blocks/siteNavigation.css", import.meta.url), "utf8"));
  const rootRules: string[][] = [];
  css.walkRules(rule => {
    if (!rule.selectors.some(selector => /^(?:html|body|main)[.:]/.test(selector))) return;
    rootRules.push(rule.selectors);
    assert.deepEqual(rule.selectors, [
      "html:has(main.faolla-public-site-shell [data-site-navigation])",
      "body:has(main.faolla-public-site-shell [data-site-navigation])",
      "main.faolla-public-site-shell:has([data-site-navigation])",
    ]);
    assert.equal(rule.nodes.length, 1);
    rule.walkDecls(declaration => {
      assert.equal(declaration.prop, "overflow-x");
      assert.equal(declaration.value, "clip");
      assert.equal(declaration.important, true);
    });
  });
  assert.equal(rootRules.length, 1);
});
