import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import type { Block } from "@/data/homeBlocks";
import * as pagePlans from "@/lib/pagePlans";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";

// Run the actual component and touch hook with deterministic hook/effect/JSX
// adapters. Only browser IO and descendant rendering are replaced; there is no
// real network, browser storage, or public-site data in this test.
function compile(relativePath: string) {
  return ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
const componentCode = compile("../app/site/[siteId]/SitePageClient.tsx");
const pullCode = compile("../lib/usePullToRefresh.ts");
type Element = { type: string; props: Record<string, unknown> };
type Effect = { deps: unknown[]; cleanup?: () => void };
type ComponentProps = { forcedSiteId: string; initialPublishedBlocks?: Block[]; initialIsMobileViewport?: boolean };

function fixture(label = "original", mobile = true): Block[] {
  const makeBlocks = (name: string) => [{
    id: "products", type: "product", props: {
      title: name, pageBgColor: "#123456", blockOffsetY: 42,
      products: [{ id: "same-product-id", name, description: "Synthetic only", price: "12.00" }],
    },
  }] as unknown as Block[];
  const config = (viewport: string) => ({
    activePlanId: "plan-1", plans: [{
      id: "plan-1", name: "Synthetic plan", activePageId: "page-1", blocks: makeBlocks(`${label}-${viewport}-1`),
      pages: [1, 2].map((index) => ({ id: `page-${index}`, name: `Page ${index}`, blocks: makeBlocks(`${label}-${viewport}-${index}`) })),
    }],
  });
  return [{ id: "__plan_meta__", type: "common", props: {
    pagePlanConfig: config("desktop"), ...(mobile ? { pagePlanConfigMobile: config("mobile") } : {}),
  } }] as unknown as Block[];
}

function freezeTree<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function harness(options: { initial?: Block[]; local?: Block[]; hydrated?: boolean; width?: number; search?: string } = {}) {
  let props: ComponentProps = { forcedSiteId: "99990001", initialPublishedBlocks: options.initial, initialIsMobileViewport: (options.width ?? 400) <= 768 };
  const slots: unknown[] = [];
  const effects = new Map<number, Effect>();
  const pendingEffects: Array<() => void> = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const events = new Map<string, Set<(event?: unknown) => void>>();
  let cursor = 0;
  let expectedHookCount: number | undefined;
  let timerId = 0;
  let dirty = true;
  let hydrated = options.hydrated ?? true;
  let local = options.local ?? [];
  let platformCallback: (() => void) | undefined;
  let platform = { sites: [{ id: "99990001", name: "Synthetic merchant" }] };
  let tree: Element;
  let planReads = 0;
  let directClones = 0;
  const fetches: Array<{ resolve: (value: unknown) => void }> = [];
  const addEvent = (name: string, callback: (event?: unknown) => void) => {
    const listeners = events.get(name) ?? new Set(); listeners.add(callback); events.set(name, listeners);
  };
  const removeEvent = (name: string, callback: (event?: unknown) => void) => { events.get(name)?.delete(callback); };
  const fire = (name: string, event?: unknown) => { for (const callback of events.get(name) ?? []) callback(event); dirty = true; };
  const memo = (compute: () => unknown, deps: unknown[]) => {
    const index = cursor++;
    const previous = slots[index] as { deps: unknown[]; value: unknown } | undefined;
    if (!previous || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      slots[index] = { deps: [...deps], value: compute() };
    }
    return (slots[index] as { value: unknown }).value;
  };
  const react = {
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: unknown) => {
        const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
      }];
    },
    useRef: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo: memo,
    useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useEffect: (setup: () => void | (() => void), deps: unknown[]) => {
      const index = cursor++;
      const previous = effects.get(index);
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) pendingEffects.push(() => {
        previous?.cleanup?.(); effects.set(index, { deps: [...deps], cleanup: setup() || undefined });
      });
    },
  };
  class FakeElement { scrollTop = 0; dataset: Record<string, unknown> = {}; clientWidth = options.width ?? 400; }
  const documentElement = new FakeElement();
  const windowMock = {
    location: { search: options.search ?? "?appShell=faolla", href: "https://synthetic.invalid/?appShell=faolla" },
    innerWidth: options.width ?? 400, parent: null as unknown,
    addEventListener: addEvent, removeEventListener: removeEvent,
    visualViewport: { width: options.width ?? 400, addEventListener: addEvent, removeEventListener: removeEvent },
  };
  windowMock.parent = windowMock;
  const documentMock = { documentElement, scrollingElement: documentElement, body: new FakeElement(), visibilityState: "visible", addEventListener: addEvent, removeEventListener: removeEvent };
  const jsx = (type: string, elementProps: Record<string, unknown>) => ({ type, props: elementProps });
  const componentStubs = new Map([
    ["next/link", "Link"], ["@/components/PublicTrafficProvider", "PublicTrafficProvider"],
    ["@/components/FaollaPullRefreshIndicator", "FaollaPullRefreshIndicator"], ["@/components/FrontendAuthEntry", "FrontendAuthEntry"],
    ["@/components/LoadingProgressScreen", "LoadingProgressScreen"], ["@/components/MerchantMembershipEntry", "MerchantMembershipEntry"],
    ["@/components/ServiceMaintenancePage", "ServiceMaintenancePage"], ["@/components/blocks/BlockRenderer", "BlockRenderer"],
  ]);
  const requireMock = (name: string): unknown => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (componentStubs.has(name)) return { default: componentStubs.get(name) };
    if (name === "next/navigation") return { useParams: () => ({}) };
    if (name === "@/components/blocks/backgroundStyle") return { getBackgroundStyle: (value: unknown) => value };
    if (name === "@/data/blockStore") return { loadPublishedBlocksFromStorage: () => structuredClone(local), savePublishedBlocksToStorage: () => true };
    if (name === "@/data/platformControlStore") return { loadPlatformState: () => platform, subscribePlatformState: (callback: () => void) => { platformCallback = callback; return () => { platformCallback = undefined; }; } };
    if (name === "@/lib/blocksSanitizer") return { sanitizeBlocksForRuntime };
    if (name === "@/lib/deviceViewport") return { MOBILE_BREAKPOINT: 768 };
    if (name === "@/lib/faollaEntry") return { shouldRoutePublicSiteToGuestShell: () => false };
    if (name === "@/lib/pagePlans") return {
      getPagePlanConfigFromBlocks: (blocks: Block[]) => { planReads++; return pagePlans.getPagePlanConfigFromBlocks(blocks); },
      cloneBlocks: (blocks: Block[]) => { directClones++; return pagePlans.cloneBlocks(blocks); },
    };
    if (name === "@/lib/publishSync") return { PUBLISH_SYNC_STORAGE_KEY: "synthetic-publish", subscribePublishSync: () => () => undefined };
    if (name === "@/lib/siteRouting") return { buildSiteStoreScope: (siteId: string) => `site-${siteId}`, buildPlatformHomeHref: () => "/" };
    if (name === "@/lib/supabase") return { isSupabaseEnabled: false };
    if (name === "@/lib/useHydrated") return { useHydrated: () => hydrated };
    if (name === "@/lib/useMobileHorizontalScrollLock") return { useMobileHorizontalScrollLock: () => undefined };
    if (name === "@/lib/usePullToRefresh") return { default: pullHook };
    throw new Error(`Unexpected import: ${name}`);
  };
  const evaluate = (code: string) => {
    const sandboxModule = { exports: {} as Record<string, unknown> };
    new Script(code).runInNewContext({
      module: sandboxModule, exports: sandboxModule.exports, require: requireMock, window: windowMock, document: documentMock, HTMLElement: FakeElement,
      URL, URLSearchParams, AbortController,
      fetch: () => new Promise((resolve) => { fetches.push({ resolve }); }),
      setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; },
      clearTimeout: (id: number) => { timers.delete(id); },
    });
    return sandboxModule.exports;
  };
  const pullHook = evaluate(pullCode).default;
  const renderComponent = evaluate(componentCode).SitePageClient as (input: ComponentProps) => Element;
  const render = () => {
    dirty = true;
    for (let iteration = 0; dirty; iteration++) {
      assert.ok(iteration < 30, "component effects must settle");
      dirty = false; cursor = 0; tree = renderComponent(props);
      expectedHookCount ??= cursor;
      assert.equal(cursor, expectedHookCount, "hook order/count must survive every early return");
      while (pendingEffects.length) pendingEffects.shift()!();
    }
    return tree;
  };
  const find = (type: string): Element => {
    const walk = (value: unknown): Element | undefined => {
      if (Array.isArray(value)) { for (const child of value) { const match = walk(child); if (match) return match; } }
      else if (value && typeof value === "object") {
        const element = value as Element;
        if (element.type === type) return element;
        return walk(element.props?.children);
      }
      return undefined;
    };
    const result = walk(tree); assert.ok(result, `${type} is rendered`); return result;
  };
  return {
    render, find,
    counts: () => ({ planReads, directClones }),
    async settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); render(); },
    runTimers(delay: number) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } render(); },
    revalidate(blocks: Block[]) { const request = fetches.shift(); assert.ok(request); request.resolve({ ok: true, json: async () => ({ blocks, orderManagementEnabled: true }) }); },
    localPublish(blocks: Block[]) { local = blocks; fire("storage", { key: "merchant-space:homeBlocks:published:v1:site-99990001" }); render(); },
    unrelated() { platform = { sites: [{ id: "99990001", name: "Updated merchant label" }] }; platformCallback?.(); render(); },
    setViewport(width: number) { windowMock.innerWidth = width; windowMock.visualViewport.width = width; documentElement.clientWidth = width; fire("resize"); render(); },
    setHydrated(value: boolean) { hydrated = value; render(); },
    setSite(siteId: string) { props = { ...props, forcedSiteId: siteId }; render(); },
    touch(name: string, y = 0) { (find("main").props[name] as (event: unknown) => void)({ touches: [{ clientX: 0, clientY: y }], cancelable: true, preventDefault() {} }); render(); },
    unmount() { for (const effect of effects.values()) effect.cleanup?.(); timers.clear(); },
  };
}

function blocksOf(h: ReturnType<typeof harness>) { return h.find("BlockRenderer").props.blocks as Block[]; }
function titleOf(h: ReturnType<typeof harness>) { return (blocksOf(h)[0].props as { title: string }).title; }

test("actual pull touch frames and unrelated renders reuse full plans and current-page clones", () => {
  const source = freezeTree(fixture());
  const before = JSON.stringify(source);
  const h = harness({ initial: source }); h.render();
  assert.equal(titleOf(h), "original-mobile-1");
  const rendered = blocksOf(h); const initialCounts = h.counts();
  assert.equal(initialCounts.planReads, 2);
  h.touch("onTouchStart", 0);
  for (let y = 4; y <= 80; y += 4) h.touch("onTouchMove", y);
  assert.equal(h.find("FaollaPullRefreshIndicator").props.pullDistance, 40);
  h.touch("onTouchCancel"); h.unrelated(); h.render();
  assert.strictEqual(blocksOf(h), rendered);
  assert.deepEqual(h.counts(), initialCounts);
  assert.equal(JSON.stringify(source), before, "input graph stays untouched"); h.unmount();
});

test("page and viewport changes choose correct defensive clones without rebuilding the complete plans", () => {
  const h = harness({ initial: freezeTree(fixture()) }); h.render();
  const first = blocksOf(h); const counts = h.counts();
  (h.find("BlockRenderer").props.onNavigatePage as (id: string) => void)("page-2"); h.render();
  assert.equal(titleOf(h), "original-mobile-2"); assert.notStrictEqual(blocksOf(h), first);
  assert.equal(h.counts().planReads, counts.planReads); assert.equal(h.counts().directClones, counts.directClones + 1);
  h.setViewport(1200);
  assert.equal(titleOf(h), "original-desktop-2"); assert.equal(h.counts().planReads, counts.planReads);
  const desktop = blocksOf(h); h.setViewport(1100); assert.strictEqual(blocksOf(h), desktop);
  h.setViewport(400); assert.equal(titleOf(h), "original-mobile-2");
  (h.find("BlockRenderer").props.onNavigatePage as (id: string) => void)("missing-page"); h.render();
  assert.equal(titleOf(h), "original-mobile-2"); h.unmount();
});

test("server revalidation with the same block/product IDs invalidates by the new array and preserves sanitization", async () => {
  const h = harness({ initial: freezeTree(fixture("old")) }); h.render();
  const old = blocksOf(h); const counts = h.counts();
  h.runTimers(6000); h.revalidate(freezeTree(fixture("fresh"))); await h.settle();
  assert.equal(titleOf(h), "fresh-mobile-1"); assert.notStrictEqual(blocksOf(h), old);
  assert.equal(h.counts().planReads, counts.planReads + 2);
  const fresh = blocksOf(h); h.unrelated(); assert.strictEqual(blocksOf(h), fresh); h.unmount();
});

test("local published storage replacements invalidate while loading-to-content keeps hook ordering", () => {
  const h = harness({ local: freezeTree(fixture("local")), hydrated: false }); h.render();
  assert.equal(h.find("LoadingProgressScreen").type, "LoadingProgressScreen");
  h.setHydrated(true); h.runTimers(0); assert.equal(titleOf(h), "local-mobile-1");
  const old = blocksOf(h); const counts = h.counts();
  h.localPublish(freezeTree(fixture("republished")));
  assert.equal(titleOf(h), "republished-mobile-1"); assert.notStrictEqual(blocksOf(h), old);
  assert.equal(h.counts().planReads, counts.planReads + 2);
  h.unmount();
});

test("waiting with a published source defers the active-page clone until content can render", () => {
  const h = harness({ local: freezeTree(fixture("waiting", false)), hydrated: false }); h.render();
  assert.equal(h.find("LoadingProgressScreen").type, "LoadingProgressScreen");
  assert.equal(h.counts().directClones, 0);
  h.unrelated(); assert.equal(h.counts().directClones, 0);
  h.setHydrated(true); h.runTimers(0);
  assert.equal(titleOf(h), "waiting-desktop-1");
  assert.equal(h.counts().directClones, 1);
  h.unrelated(); assert.equal(h.counts().directClones, 1); h.unmount();
});

test("desktop fallback, URL-selected page, source deep equality and remount isolation remain unchanged", () => {
  const source = freezeTree(fixture("fallback", false));
  const h = harness({ initial: source, search: "?pageId=page-2&appShell=faolla" }); h.render();
  const expected = pagePlans.getPagePlanConfigFromBlocks(source).plans[0].pages[1].blocks;
  assert.deepEqual(blocksOf(h), expected);
  assert.notStrictEqual(blocksOf(h), expected);
  const first = blocksOf(h); h.setViewport(1200); assert.strictEqual(blocksOf(h), first);
  assert.equal(h.counts().planReads, 1); h.unmount();
  const other = harness({ initial: freezeTree(fixture("other")) }); other.render();
  assert.equal(titleOf(other), "other-mobile-1"); assert.notStrictEqual(blocksOf(other), first); other.unmount();
});

test("empty/loading/maintenance states retain unconditional hook order", () => {
  const h = harness({ local: [], hydrated: false }); h.render();
  h.setHydrated(true); h.runTimers(0); h.runTimers(60000);
  assert.equal(h.find("ServiceMaintenancePage").type, "ServiceMaintenancePage");
  h.localPublish(freezeTree(fixture("now-ready")));
  assert.equal(titleOf(h), "now-ready-mobile-1"); h.unmount();
});
