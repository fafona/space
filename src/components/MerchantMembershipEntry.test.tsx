import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MerchantMembershipEntry from "@/components/MerchantMembershipEntry";

test("merchant membership renders unresolved visitors as a native top-level personal login link", () => {
  const markup = renderToStaticMarkup(
    createElement(MerchantMembershipEntry, {
      siteId: "10909094",
      siteName: "Example",
    }),
  );

  assert.match(markup, /<a\b[^>]*href="\/login\?accountType=personal"/);
  assert.match(markup, /<a\b[^>]*target="_top"/);
  assert.doesNotMatch(markup, /window\.top|location\.assign/);
});

test("merchant membership does not render an auth entry for non-merchant site ids", () => {
  assert.equal(renderToStaticMarkup(createElement(MerchantMembershipEntry, { siteId: "site-main" })), "");
});
