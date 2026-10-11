import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as cards from "./merchantBusinessCards";
import * as share from "./merchantBusinessCardShare";
import * as destination from "./merchantBusinessCardDestination";
import * as i18n from "./i18n";

const route = readFileSync(new URL("../app/card/[card]/route.ts", import.meta.url), "utf8");
const downloadRoute = readFileSync(new URL("../app/card/[card]/contact/route.ts", import.meta.url), "utf8");

// Execute the actual route's pure rendering and snapshot functions, without
// importing its database, storage repair, or production service dependencies.
function loadFunctions(source: string, names: string[], globals: Record<string, unknown> = {}) {
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
    // Most HTML tests omit language chrome; guidance runtime tests load the
    // actual inline function and its locale constants explicitly below.
    buildInlineI18nScript: () => "",
    buildLanguageSwitcherHtml: () => "",
    ...globals,
    result: {} as Record<string, (input: unknown, origin?: string) => unknown>,
  };
  runInNewContext(compiled, context);
  return context.result;
}

const renderFunctions = loadFunctions(route, ["escapeHtml", "serializeInlineScriptValue", "buildShareCardHtml"]);
const snapshotFunctions = loadFunctions(route, ["normalizeText", "normalizeSnapshotPhoneList", "buildSharePayloadFromSnapshotMatch"]);
const downloadFunctions = loadFunctions(downloadRoute, ["normalizeText", "buildContactDownloadPayloadFromSnapshot"]);
const inlineFunctions = loadFunctions(route, ["serializeInlineScriptValue", "buildInlineI18nScript"], {
  ...i18n, GOOGLE_REVIEW_DISPLAY_TEXT: "欢迎评价", GOOGLE_REVIEW_DISPLAY_TRANSLATIONS: {},
});
const inlineScript = String(inlineFunctions.buildInlineI18nScript(undefined));
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

function assertWebsiteAction(html: string, expectedUrl: string) {
  // Analytics added an attribute between class and href; attribute order is not
  // navigation behavior. Assert all actual destinations and the tracking marker
  // on the one website action instead of weakening the destination checks.
  const actions = [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])),
  ).filter(attributes => attributes.class === "button secondary");
  assert.equal(actions.length, 1);
  const expected = expectedUrl.replaceAll("&", "&amp;");
  assert.equal(actions[0].href, expected);
  assert.equal(actions[0]["data-open-target-url"], expected);
  assert.equal(actions[0]["data-original-target-url"], expected);
  assert.equal(actions[0]["data-traffic-action"], "website_click");
}

// Small DOM/event harness: run the complete generated production script without
// importing server dependencies, making network calls, or relying on a browser
// installation. Unprevented anchor clicks model their native default navigation.
function contactGuideRuntime(userAgent: string, locale = "zh-CN", href = "https://www.faolla.com/card/qa/contact?a=1&b=2") {
  const navigations: string[] = [];
  type GuideEvent = {
    currentTarget: Element; target: Element; defaultPrevented: boolean;
    key?: string; shiftKey?: boolean; detail?: number; preventDefault(): void;
  };
  class Element {
    nodeType = 1;
    tagName: string;
    id = "";
    className = "";
    textContent = "";
    style: Record<string, string> = { overflow: "scroll" };
    childNodes: Element[] = [];
    parentElement: Element | null = null;
    attributes = new Map<string, string>();
    listeners = new Map<string, Array<(event: GuideEvent) => void>>();
    constructor(tag = "div") { this.tagName = tag.toUpperCase(); }
    setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    matches(selector: string) {
      const match = selector.match(/^(a)?\[([\w-]+)(?:=["']([^"']*)["'])?\]$/);
      return Boolean(match && (!match[1] || this.tagName === "A") && this.attributes.has(match[2]) &&
        (match[3] === undefined || this.getAttribute(match[2]) === match[3]));
    }
    closest(selector: string): Element | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
    descendants(): Element[] { return this.childNodes.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll(selector: string) { return this.descendants().filter(child => child.matches(selector)); }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
    appendChild(child: Element) { child.parentElement = this; this.childNodes.push(child); return child; }
    remove() {
      if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this);
      this.parentElement = null;
    }
    addEventListener(type: string, listener: (event: GuideEvent) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    focus() { document.activeElement = this; }
    dispatch(type: string, extra: { key?: string; shiftKey?: boolean; target?: Element; detail?: number } = {}): GuideEvent {
      const event: GuideEvent = {
        currentTarget: this, target: this, defaultPrevented: false, ...extra,
        preventDefault() { this.defaultPrevented = true; },
      };
      for (const listener of this.listeners.get(type) ?? []) listener(event);
      return event;
    }
    click(extra: { detail?: number } = {}) {
      const event = this.dispatch("click", extra);
      if (this.tagName === "A" && !event.defaultPrevented) navigations.push(this.getAttribute("href") || "");
      return event;
    }
  }
  class Anchor extends Element { constructor() { super("a"); } }
  class Input extends Element {}
  class Textarea extends Element {}
  class Select extends Element {}
  const body = new Element("body");
  const root = new Element("html");
  root.appendChild(body);
  const source = new Anchor();
  source.setAttribute("data-traffic-action", "contact_download_click");
  source.setAttribute("href", href);
  body.appendChild(source);
  const document = {
    body, documentElement: root, cookie: "", activeElement: source,
    createElement: (tag: string) => tag === "a" ? new Anchor() : new Element(tag),
    getElementById: (id: string) => root.descendants().find(element => element.id === id) ?? null,
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    querySelector: (selector: string) => root.querySelector(selector),
  };
  const navigator = { userAgent, language: locale, languages: [locale] };
  const window = {
    navigator, location: { search: "", assign: (url: string) => navigations.push(url) },
    localStorage: { getItem: () => null }, setTimeout: () => 1, clearTimeout: () => {},
  };
  runInNewContext(inlineScript, {
    window, document, navigator, URLSearchParams,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, HTMLElement: Element, HTMLAnchorElement: Anchor,
    HTMLInputElement: Input, HTMLTextAreaElement: Textarea, HTMLSelectElement: Select,
  });
  return { document, source, navigations, guide: () => document.getElementById("wechat-contact-guide") };
}

test("contact-save HTML retains its exact native anchor, target and visibility; guide UI is not added to page layout", () => {
  const href = "https://www.faolla.com/card/qa/contact?a=1&b=2";
  const html = render(custom, { contactUrl: href });
  assert.ok(html.includes('<a class="button" data-traffic-action="contact_download_click" href="https://www.faolla.com/card/qa/contact?a=1&amp;b=2">一键保存到通讯录</a>'));
  assert.ok(!html.includes('id="wechat-contact-guide"'));
  assert.ok(!render(custom, { contactUrl: href, showContactSaveButton: false }).includes('data-traffic-action="contact_download_click"'));
  assert.match(route, /const htmlVersion = .*\|contact-guide:v1/);
});

test("system-browser contact clicks remain native and never open the WeChat guide", () => {
  for (const ua of ["Mozilla iPhone Mobile Safari", "Mozilla Android Chrome"]) {
    const runtime = contactGuideRuntime(ua);
    assert.equal(runtime.source.click().defaultPrevented, false);
    assert.deepEqual(runtime.navigations, [runtime.source.getAttribute("href")]);
    assert.equal(runtime.guide(), null);
  }
});

test("WeChat touch/keyboard clicks show one clear guide; all cancellation paths preserve the page and do not download", () => {
  const runtime = contactGuideRuntime("Mozilla iPhone Mobile MicroMessenger");
  assert.equal(runtime.source.click({ detail: 0 }).defaultPrevented, true);
  const guide = runtime.guide();
  assert.ok(guide);
  assert.equal(guide.getAttribute("role"), "dialog");
  assert.equal(guide.getAttribute("aria-modal"), "true");
  const contents = guide.descendants().map(element => element.textContent).join(" ");
  assert.match(contents, /不能自动切换到系统浏览器/);
  assert.match(contents, /右上角.*在浏览器中打开.*再次点击/);
  assert.doesNotMatch(contents, /已保存|保存成功/);
  runtime.source.click({ detail: 1 });
  assert.equal(runtime.guide(), guide);
  const close = guide.querySelector("[data-wechat-contact-close]");
  const download = guide.querySelector("[data-wechat-contact-download]");
  assert.ok(close && download);
  assert.equal(runtime.document.activeElement, close);
  assert.equal(guide.dispatch("keydown", { key: "Tab" }).defaultPrevented, true);
  assert.equal(runtime.document.activeElement, download);
  guide.dispatch("keydown", { key: "Tab", shiftKey: true });
  assert.equal(runtime.document.activeElement, close);
  guide.dispatch("click", { target: guide.childNodes[0] });
  assert.equal(runtime.guide(), guide);
  close.click();
  assert.equal(runtime.guide(), null);
  assert.equal(runtime.document.activeElement, runtime.source);
  assert.equal(runtime.document.body.style.overflow, "scroll");
  runtime.source.click();
  runtime.guide()?.dispatch("keydown", { key: "Escape" });
  assert.equal(runtime.guide(), null);
  runtime.source.click();
  runtime.guide()?.dispatch("click");
  assert.equal(runtime.guide(), null);
  assert.deepEqual(runtime.navigations, []);
});

test("continue-in-WeChat uses the exact original URL once without reopening the guide", () => {
  const runtime = contactGuideRuntime("Mozilla Android MicroMessenger");
  runtime.source.click();
  const download = runtime.guide()?.querySelector("[data-wechat-contact-download]");
  assert.ok(download);
  assert.equal(download.getAttribute("href"), runtime.source.getAttribute("href"));
  assert.equal(download.getAttribute("data-traffic-action"), null);
  download.click({ detail: 0 });
  assert.deepEqual(runtime.navigations, [runtime.source.getAttribute("href")]);
  assert.equal(runtime.guide(), null);
  assert.equal(runtime.document.body.style.overflow, "scroll");
  runtime.source.click();
  assert.ok(runtime.guide());
  assert.equal(runtime.navigations.length, 1);
});

test("guide copy uses the current locale with built-in Chinese, Spanish and English fallback", () => {
  for (const [locale, expected] of [["zh-TW", "請在瀏覽器中儲存聯絡人"], ["es-ES", "Guarda el contacto"], ["en-GB", "Save the contact"], ["fr-FR", "Save the contact"]]) {
    const runtime = contactGuideRuntime("MicroMessenger", locale);
    runtime.source.click();
    assert.ok(runtime.document.getElementById("wechat-contact-guide-title")?.textContent.includes(expected));
    assert.deepEqual(runtime.navigations, []);
  }
});

test("real short-card HTML uses the custom website for both browser and WeChat click targets", () => {
  const html = render(custom);
  assertWebsiteAction(html, custom);
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
    assertWebsiteAction(render(website), fast);
  }
});

test("custom paths, queries and fragments are not replaced by the merchant root", () => {
  const website = `${assigned}offers?a=1&b=2#today`;
  assertWebsiteAction(render(website), website);
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
      assertWebsiteAction(render(payload.contact?.websiteUrl), websiteAddress || fast);
    }
  }
});
