import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as cards from "./merchantBusinessCards";
import * as share from "./merchantBusinessCardShare";
import * as destination from "./merchantBusinessCardDestination";

const route = readFileSync(new URL("../app/card/[card]/route.ts", import.meta.url), "utf8");
const downloadRoute = readFileSync(new URL("../app/card/[card]/contact/route.ts", import.meta.url), "utf8");

// Execute the actual route's pure rendering and snapshot functions, without
// importing its database, storage repair, or production service dependencies.
function loadFunctions(source: string, names: string[]) {
  const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const functions = names.map(name => {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `route function ${name} exists`);
    return declaration.getText(ast);
  }).join("\n");
  const compiled = ts.transpileModule(`${functions}\nresult = { ${names.join(", ")} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = {
    ...cards, ...share, ...destination, URL, URLSearchParams,
    // Unrelated language chrome only; all destination/HTML code runs verbatim.
    buildInlineI18nScript: () => "",
    buildLanguageSwitcherHtml: () => "",
    result: {} as Record<string, (input: unknown, origin?: string) => unknown>,
  };
  runInNewContext(compiled, context);
  return context.result;
}

const renderFunctions = loadFunctions(route, ["escapeHtml", "serializeInlineScriptValue", "buildShareCardHtml"]);
const snapshotFunctions = loadFunctions(route, ["normalizeText", "normalizeSnapshotPhoneList", "buildSharePayloadFromSnapshotMatch"]);
const downloadFunctions = loadFunctions(downloadRoute, ["normalizeText", "buildContactDownloadPayloadFromSnapshot"]);
const assigned = "https://haoyouduo.faolla.com/";
const fast = "https://www.faolla.com/site/12345678";
const custom = "https://www.haoyouduosevilla.com/";

function render(websiteUrl?: string, extra = {}) {
  return String(renderFunctions.buildShareCardHtml({
    title: "QA", description: "QA", merchantName: "QA", summaryHtml: "",
    targetUrl: assigned, openTargetUrl: fast, websiteUrl,
    shareUrl: "https://www.faolla.com/card/qa", ...extra,
  }));
}

test("real short-card HTML uses the custom website for both browser and WeChat click targets", () => {
  const html = render(custom);
  assert.ok(html.includes(`href="${custom}" data-open-target-url="${custom}"`));
  assert.ok(!html.includes(`class="button secondary" href="${fast}"`));
  // The GET route must supply the manifest's website field to this renderer.
  assert.match(route, /openTargetUrl: fastOpenTargetUrl,\s+websiteUrl,/);
});

test("late legacy manifests and cached HTML cannot replace an explicit saved website", () => {
  for (const stored of [assigned, undefined, "https://old.example.com/"]) {
    assert.equal(destination.resolveBusinessCardContactWebsite({ websiteAddress: custom }, assigned, stored), custom);
    assert.equal(destination.resolveBusinessCardContactWebsite({ websiteAddress: "" }, assigned, stored), assigned);
  }
  assert.equal(destination.resolveBusinessCardContactWebsite(undefined, assigned, custom), custom);
  assert.equal(destination.resolveBusinessCardContactWebsite({}, assigned, custom), custom);
  assert.equal(destination.resolveBusinessCardContactWebsite({ websiteAddress: "javascript:alert(1)" }, assigned, custom), "");
  assert.match(route, /resolveContactCardSnapshotMatch\(shareKey, payload\.ownerMerchantId \|\| snapshotMatch\?\.siteId\)/);
  assert.match(route, /readCachedContactCardHtml\(shareKey, requestOrigin, htmlVersion\)/);
  assert.match(route, /writeCachedContactCardHtml\(shareKey, requestOrigin, htmlVersion, html\)/);
  assert.match(route, /website:\$\{websiteUrl\}/);
  assert.match(downloadRoute, /resolveBusinessCardContactWebsite\(currentCard, payload\.targetUrl, payload\.contact\?\.websiteUrl\)/);
  assert.match(downloadRoute, /buildMerchantBusinessCardVCard\(downloadPayload\)/);
});

test("legacy, blank and canonical assigned URLs retain the existing fast merchant navigation", () => {
  for (const website of [undefined, "", assigned, assigned.slice(0, -1)]) {
    assert.ok(render(website).includes(`class="button secondary" href="${fast}"`));
  }
});

test("custom paths, queries and fragments are not replaced by the merchant root", () => {
  const website = `${assigned}offers?a=1&b=2#today`;
  const escaped = website.replaceAll("&", "&amp;");
  assert.ok(render(website).includes(`href="${escaped}" data-open-target-url="${escaped}"`));
  assert.equal(destination.resolveBusinessCardWebsiteNavigation("haoyouduosevilla.com", assigned, fast), "https://haoyouduosevilla.com/");
});

test("invalid explicit URLs and hidden website actions cannot produce a navigable button", () => {
  for (const website of ["javascript:alert(1)", "https://user:pass@example.com", "https://exa mple.com"]) {
    assert.ok(!render(website).includes('class="button secondary"'));
  }
  assert.ok(!render(custom, { showContactWebsiteButton: false }).includes('class="button secondary"'));
});

test("website selection does not change the independent contact-image link", () => {
  const html = render(custom, { contentImageUrl: "https://example.com/card.png", contentImageLinkUrl: "https://example.com/image-target" });
  assert.ok(html.includes('class="card contact-image-card" href="https://example.com/image-target"'));
});

test("snapshot fallback and vCard download both preserve custom website without changing merchant identity", () => {
  for (const websiteAddress of [undefined, "", custom]) {
    const card = { ...cards.createDefaultMerchantBusinessCardDraft({}), name: "QA", targetUrl: assigned, websiteAddress };
    const match = { siteId: "12345678", allowIntroVideo: false, card };
    for (const build of [snapshotFunctions.buildSharePayloadFromSnapshotMatch, downloadFunctions.buildContactDownloadPayloadFromSnapshot]) {
      const payload = build(match, "https://www.faolla.com") as share.MerchantBusinessCardSharePayload;
      assert.ok(payload);
      assert.equal(payload.targetUrl, assigned);
      assert.equal(payload.ownerMerchantId, "12345678");
      assert.equal(payload.contact?.websiteUrl, websiteAddress || assigned);
      assert.ok(share.buildMerchantBusinessCardVCard(payload).includes(`URL:${websiteAddress || assigned}`));
      assert.ok(render(payload.contact?.websiteUrl).includes(`class="button secondary" href="${websiteAddress || fast}"`));
    }
  }
});
