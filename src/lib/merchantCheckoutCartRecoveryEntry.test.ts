import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberCheckoutRecoveryLink } from "../components/checkout/MemberCheckoutRecoveryLink";
import { parseCheckoutEntryDiscovery } from "./merchantCheckoutEntry";

test("cart recovery is a fixed private-data-free navigation link in the three pilot languages, not an action or form", () => {
  for (const locale of ["zh-CN", "en-GB", "es-ES"]) {
    const html = renderToStaticMarkup(createElement(MemberCheckoutRecoveryLink, { siteId: "10909994", locale }));
    assert.match(html, new RegExp(`/member-checkout/10909994/resume\\?uiLocale=${locale}`));
    assert.match(html, /target="_blank"/); assert.match(html, /rel="noopener noreferrer"/);
    assert.equal((html.match(/<a /g) ?? []).length, 1); assert.doesNotMatch(html, /<(?:button|input|textarea|select|form)\b/);
    assert.doesNotMatch(html, /nonce=|accountId=|operationKey=|memberId=|customer=/);
  }
});

test("invalid site or language cannot render an arbitrary recovery target", () => {
  for (const props of [{ siteId: "//foreign.invalid", locale: "zh-CN" }, { siteId: "10909994", locale: "es&nonce=old" }, { siteId: "10909994", locale: "" }]) {
    assert.equal(renderToStaticMarkup(createElement(MemberCheckoutRecoveryLink, props)), "");
  }
});

test("public recovery visibility is neither owned account access nor purchase/draft capability", () => {
  const query = { siteId: "10909994", kind: "order" as const, blockId: "products", viewport: "mobile" as const };
  assert.deepEqual(parseCheckoutEntryDiscovery({ ok: true, entry: null, recovery: { siteId: query.siteId }, intent: true, ownedDraft: true }, query), { access: null, recoveryEnabled: true });
  for (const recovery of [{ siteId: "19999999" }, { siteId: query.siteId, nonce: "old" }, null]) {
    assert.throws(() => parseCheckoutEntryDiscovery({ ok: true, entry: null, recovery }, query));
  }
});
