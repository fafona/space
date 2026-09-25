import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import * as customerTools from "@/lib/merchantCustomers";
import * as customerPagination from "@/lib/merchantCustomerPagination";

// Exercise the actual component handlers with a minimal hook/JSX harness. No
// browser, production API, authentication session or real spreadsheet is used.
const source = readFileSync(new URL("./MerchantCustomerManager.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
type Element = { type: string | ((props: unknown) => Element); props: Record<string, unknown> };
type Effect = { deps: unknown[]; layout: boolean; setup: () => void | (() => void); cleanup?: () => void };
type FetchPlan = { headers?: Promise<unknown>; body?: Promise<unknown>; status?: number };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness() {
  const slots: unknown[] = [];
  const effects = new Map<number, Effect>();
  const pending: Array<{ layout: boolean; run: () => void }> = [];
  const deferredPassive: Array<() => void> = [];
  const toasts: string[] = [];
  const downloads: string[] = [];
  let cursor = 0;
  let siteId = "10000000";
  let desktop = false;
  let mounted = true;
  let workbookLoads = 0;
  let parseCalls = 0;
  let templateCalls = 0;
  let writes = 0;
  let reads = 0;
  let stateUpdatesAfterUnmount = 0;
  let stateUpdates = 0;
  let workbookError = false;
  let workbookDelay: Promise<unknown> | null = null;
  let deferredQueryOverride: string | null = null;
  const customerRows = new Map<string, customerTools.MerchantCustomerDirectoryItem[]>();
  const mutations: Array<{ method: string; body: unknown }> = [];
  const requests: Array<{ siteId: string; method: string; signal?: AbortSignal }> = [];
  const readPlans: FetchPlan[] = [];
  const mutationPlans: FetchPlan[] = [];
  const timers = new Map<number, { action: () => void; delay: number }>();
  let timerId = 0;
  const workbook = {
    parseMerchantCustomerWorkbook: () => {
      parseCalls += 1;
      return { customers: [{ displayName: "Imported", email: "imported@example.test" }], rowCount: 1, skipped: 0, errors: [] };
    },
    buildMerchantCustomerImportTemplate: () => {
      templateCalls += 1;
      return new ArrayBuffer(4);
    },
  };
  const jsx = (type: Element["type"], props: Element["props"]) => ({ type, props });
  const fetchMock = async (url: string, options?: { method?: string; body?: string; signal?: AbortSignal }) => {
    if (options?.method) {
      writes += 1;
      mutations.push({ method: options.method, body: options.body ? JSON.parse(options.body) : null });
    } else reads += 1;
    const requestedSite = new URL(url, "https://fixture.invalid").searchParams.get("siteId") ?? siteId;
    requests.push({ siteId: requestedSite, method: options?.method ?? "GET", signal: options?.signal });
    const plan = (options?.method ? mutationPlans : readPlans).shift();
    const payload = { customers: customerRows.get(requestedSite) ?? [], version: "v1", created: 1 };
    // Intentionally permit a transport to finish after abort, so scope/request
    // identity guards, rather than the mock, must prevent stale acceptance.
    if (plan?.headers) await plan.headers;
    const status = plan?.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => plan?.body ? await plan.body : payload };
  };
  const memo = (compute: () => unknown, deps: unknown[]) => {
    const index = cursor++;
    const previous = slots[index] as { deps: unknown[]; value: unknown } | undefined;
    if (!previous || deps.length !== previous.deps.length || deps.some((value, i) => value !== previous.deps[i])) {
      slots[index] = { deps: [...deps], value: compute() };
    }
    return (slots[index] as { value: unknown }).value;
  };
  const registerEffect = (setup: () => void | (() => void), deps: unknown[], layout: boolean) => {
    const index = cursor++;
    const previous = effects.get(index);
    if (!previous || deps.some((dependency, i) => dependency !== previous.deps[i])) {
      pending.push({ layout, run: () => {
        previous?.cleanup?.();
        effects.set(index, { deps, layout, setup, cleanup: setup() || undefined });
      } });
    }
  };
  const react = {
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: unknown) => {
        stateUpdates += 1;
        if (!mounted) stateUpdatesAfterUnmount += 1;
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
      }];
    },
    useRef: (initial: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useDeferredValue: (value: unknown) => deferredQueryOverride ?? value,
    useSyncExternalStore: () => desktop,
    useEffect: (setup: () => void | (() => void), deps: unknown[]) => registerEffect(setup, deps, false),
    useLayoutEffect: (setup: () => void | (() => void), deps: unknown[]) => registerEffect(setup, deps, true),
  };
  const sandboxModule = { exports: {} as { default: (props: { siteId: string }) => Element } };
  new Script(compiled, { filename: "MerchantCustomerManager.cjs" }).runInNewContext({
    module: sandboxModule,
    exports: sandboxModule.exports,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@/lib/merchantCustomers") return customerTools;
      if (name === "@/lib/merchantCustomerPagination") return customerPagination;
      if (name === "@/lib/merchantCustomerListViewport") return {};
      if (name === "@/lib/performanceTelemetry") return {
        fetchJsonWithAdminPerformance: async (url: string, options?: { method?: string; signal?: AbortSignal }) => {
          const response = await fetchMock(url, options);
          return { response, data: await response.json().catch(() => null) };
        },
      };
      if (name === "@/lib/globalToast") return { showGlobalToast: (message: string) => toasts.push(message) };
      if (name === "@/lib/merchantOperationContext") return { runWithMerchantOperationContext: (_: unknown, action: () => unknown) => action() };
      if (name === "@/lib/merchantCustomerImport") {
        workbookLoads += 1;
        if (workbookError) throw new Error("chunk unavailable");
        return workbookDelay ? workbookDelay.then(() => workbook) : workbook;
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Blob,
    AbortController,
    DOMException,
    URL: { createObjectURL: () => "blob:customer-template", revokeObjectURL: () => {} },
    window: {
      setTimeout: (action: () => void, delay: number) => { const id = ++timerId; timers.set(id, { action, delay }); return id; },
      clearTimeout: (id: number) => { timers.delete(id); },
    },
    document: { createElement: () => ({ href: "", download: "", click() { downloads.push(this.download); } }) },
    fetch: fetchMock,
  });
  function render(flushPassive = true) {
    cursor = 0;
    const tree = sandboxModule.exports.default({ siteId });
    const work = pending.splice(0);
    work.filter((item) => item.layout).forEach((item) => item.run());
    work.filter((item) => !item.layout).forEach((item) => deferredPassive.push(item.run));
    if (flushPassive) deferredPassive.splice(0).forEach((run) => run());
    return tree;
  }
  function find(tree: unknown, predicate: (item: Element) => boolean): Element | undefined {
    if (!tree || typeof tree !== "object") return undefined;
    if (Array.isArray(tree)) {
      for (const child of tree) {
        const match = find(child, predicate);
        if (match) return match;
      }
      return undefined;
    }
    const item = tree as Element;
    return predicate(item) ? item : find(item.props?.children, predicate);
  }
  const action = (element: Element, name: string, ...args: unknown[]) => (element.props[name] as (...values: unknown[]) => unknown)(...args);
  const dialog = () => find(render(), (item) => typeof item.type === "function" && item.type.name === "CustomerImportDialog")!;
  function openImport() {
    const button = find(render(), (item) => item.type === "button" && item.props.children === "批量导入")!;
    action(button, "onClick");
    return dialog();
  }
  function chooseFile(promise = Promise.resolve(new ArrayBuffer(4))) {
    const input = find(render(), (item) => item.type === "input" && item.props.type === "file")!;
    action(input, "onChange", { target: { files: [{ name: "customers.xlsx", arrayBuffer: () => promise }], value: "customers.xlsx" } });
  }
  return {
    render, find, dialog, openImport, chooseFile, action, toasts, downloads, mutations, requests,
    counts: () => ({ workbookLoads, parseCalls, templateCalls, writes, reads, stateUpdatesAfterUnmount, stateUpdates }),
    setWorkbookError: (value: boolean) => { workbookError = value; },
    delayWorkbook: (value: Promise<unknown>) => { workbookDelay = value; },
    setDesktop: (value: boolean) => { desktop = value; },
    setCustomerRows: (rows: customerTools.MerchantCustomerDirectoryItem[], forSite = siteId) => { customerRows.set(forSite, rows); },
    setDeferredQuery: (value: string | null) => { deferredQueryOverride = value; },
    queueRead: (plan: FetchPlan) => { readPlans.push(plan); },
    queueMutation: (plan: FetchPlan) => { mutationPlans.push(plan); },
    readTimerCount: () => [...timers.values()].filter((timer) => timer.delay === 25000).length,
    expireReadTimers: () => {
      for (const [id, timer] of timers) if (timer.delay === 25000) { timers.delete(id); timer.action(); }
    },
    replayEffects: () => {
      effects.forEach((effect) => effect.cleanup?.());
      effects.forEach((effect) => { effect.cleanup = effect.setup() || undefined; });
    },
    switchSite: (nextSiteId = "20000000") => { siteId = nextSiteId; render(); },
    switchSiteBeforePassive: (nextSiteId: string) => { siteId = nextSiteId; render(false); },
    flushPassive: () => { deferredPassive.splice(0).forEach((run) => run()); },
    unmountBeforePassive: () => {
      mounted = false;
      effects.forEach((effect) => {
        if (effect.layout) effect.cleanup?.();
        else deferredPassive.push(() => effect.cleanup?.());
      });
    },
    unmount: () => { mounted = false; effects.forEach((effect) => effect.cleanup?.()); },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("actual customer template handler lazily loads once and rejects rapid duplicate actions", async () => {
  const app = harness();
  const dialog = app.openImport();
  assert.equal(app.counts().workbookLoads, 0);
  app.action(dialog, "onDownloadTemplate");
  app.action(dialog, "onDownloadTemplate");
  app.chooseFile();
  assert.equal(app.dialog().props.busy, true);
  await flush();
  assert.equal(app.counts().workbookLoads, 1);
  assert.equal(app.counts().templateCalls, 1);
  assert.equal(app.counts().parseCalls, 0);
  assert.deepEqual(app.downloads, ["FAOLLA-客户导入模板.xlsx"]);
  assert.equal(app.dialog().props.busy, false);
});

test("actual customer handlers unlock after lazy chunk failure and allow retry", async () => {
  const app = harness();
  app.openImport();
  app.setWorkbookError(true);
  app.action(app.dialog(), "onDownloadTemplate");
  await flush();
  assert.equal(app.dialog().props.busy, false);
  assert.ok(app.toasts.includes("模板下载失败，请稍后重试"));
  app.chooseFile();
  await flush();
  assert.equal(app.dialog().props.busy, false);
  assert.equal(app.dialog().props.parsed, null);
  assert.ok(app.toasts.includes("无法读取该文件，请检查格式后重试"));
  app.setWorkbookError(false);
  app.chooseFile();
  await flush();
  assert.equal(app.counts().parseCalls, 1);
  assert.equal(app.dialog().props.busy, false);
});

test("actual customer file parsing excludes template and POST actions until preparation completes", async () => {
  const app = harness();
  app.openImport();
  const file = deferred<ArrayBuffer>();
  app.chooseFile(file.promise);
  app.action(app.dialog(), "onDownloadTemplate");
  app.action(app.dialog(), "onImport");
  await flush();
  assert.equal(app.counts().writes, 0);
  assert.equal(app.counts().templateCalls, 0);
  assert.equal(app.dialog().props.busy, true);
  file.resolve(new ArrayBuffer(4));
  await flush();
  assert.equal(app.counts().parseCalls, 1);
  app.action(app.dialog(), "onImport");
  app.action(app.dialog(), "onImport");
  await flush();
  assert.equal(app.counts().writes, 1);
});

test("late template completion after unmount produces no download, toast or state update", async () => {
  const app = harness();
  app.openImport();
  await flush();
  const workbookChunk = deferred<void>();
  app.delayWorkbook(workbookChunk.promise);
  app.action(app.dialog(), "onDownloadTemplate");
  await flush();
  app.unmount();
  workbookChunk.resolve();
  await flush();
  assert.equal(app.counts().templateCalls, 0);
  assert.equal(app.counts().stateUpdatesAfterUnmount, 0);
  assert.deepEqual(app.downloads, []);
  assert.deepEqual(app.toasts, []);
});

for (const kind of ["file", "template"] as const) {
  for (const outcome of ["success", "failure"] as const) {
    test(`${kind} preparation ${outcome} between layout and passive unmount has no side effects`, async () => {
      const app = harness();
      app.openImport();
      await flush();
      const file = deferred<ArrayBuffer>();
      const chunk = deferred<void>();
      if (kind === "file") app.chooseFile(file.promise);
      else {
        app.delayWorkbook(chunk.promise);
        app.action(app.dialog(), "onDownloadTemplate");
      }
      await flush();
      assert.equal(app.dialog().props.busy, true);
      app.unmountBeforePassive();
      assert.equal(app.counts().stateUpdatesAfterUnmount, 0, "layout cleanup itself must not set state");
      if (kind === "file") {
        if (outcome === "success") file.resolve(new ArrayBuffer(4));
        else file.reject(new Error("late file failure"));
      } else if (outcome === "success") chunk.resolve();
      else chunk.reject(new Error("late chunk failure"));
      await flush();
      assert.equal(app.counts().parseCalls, 0);
      assert.equal(app.counts().templateCalls, 0);
      assert.equal(app.counts().stateUpdatesAfterUnmount, 0);
      assert.deepEqual(app.downloads, []);
      assert.deepEqual(app.toasts, []);
      app.flushPassive();
      assert.equal(app.counts().stateUpdatesAfterUnmount, 0, "later passive cleanup also does not write state");
      assert.equal(app.counts().writes, 0);
    });
  }
}

test("late file completion cannot populate another merchant or unlock its newer preparation", async () => {
  const app = harness();
  app.openImport();
  const oldFile = deferred<ArrayBuffer>();
  app.chooseFile(oldFile.promise);
  app.switchSite();
  const newFile = deferred<ArrayBuffer>();
  app.chooseFile(newFile.promise);
  oldFile.resolve(new ArrayBuffer(4));
  await flush();
  assert.equal(app.counts().parseCalls, 0);
  assert.equal(app.dialog().props.parsed, null);
  assert.equal(app.dialog().props.busy, true);
  app.action(app.dialog(), "onDownloadTemplate");
  await flush();
  assert.equal(app.counts().templateCalls, 0);
  newFile.resolve(new ArrayBuffer(4));
  await flush();
  assert.equal(app.counts().parseCalls, 1);
  assert.equal(app.dialog().props.busy, false);
});

for (const kind of ["file", "template"] as const) {
  test(`cancelled ${kind} preparation does not become busy again after returning to its original merchant`, async () => {
    const app = harness();
    app.openImport();
    const workbookChunk = deferred<void>();
    app.delayWorkbook(workbookChunk.promise);
    if (kind === "file") app.chooseFile();
    else app.action(app.dialog(), "onDownloadTemplate");
    assert.equal(app.dialog().props.busy, true);

    app.switchSite();
    workbookChunk.resolve();
    await flush();
    assert.equal(app.counts().parseCalls, 0);
    assert.equal(app.counts().templateCalls, 0);
    assert.equal(app.dialog().props.busy, false);

    app.switchSite("10000000");
    assert.equal(app.dialog().props.busy, false, "cancelled preparation must not revive on A -> B -> A");
    const input = app.find(app.render(), (item) => item.type === "input" && item.props.type === "file")!;
    assert.equal(input.props.disabled, false);
    app.action(app.dialog(), "onDownloadTemplate");
    await flush();
    assert.equal(app.counts().templateCalls, 1, "a fresh explicit action must still work");
    assert.equal(app.downloads.length, 1);
    assert.equal(app.dialog().props.busy, false);
  });
}

test("actual customer component constructs only the selected list layout", () => {
  const app = harness();
  const mobile = app.render();
  assert.ok(app.find(mobile, (item) => item.props?.["data-customer-list-layout"] === "mobile"));
  assert.equal(app.find(mobile, (item) => item.props?.["data-customer-list-layout"] === "desktop"), undefined);
  app.setDesktop(true);
  const desktop = app.render();
  assert.ok(app.find(desktop, (item) => item.props?.["data-customer-list-layout"] === "desktop"));
  assert.equal(app.find(desktop, (item) => item.props?.["data-customer-list-layout"] === "mobile"), undefined);
});

function fixtureCustomers(count: number, siteId = "10000000"): customerTools.MerchantCustomerDirectoryItem[] {
  return Array.from({ length: count }, (_, index) => ({
    ...customerTools.createEmptyMerchantCustomerProfile(siteId),
    id: `${siteId}-customer-${index}`,
    displayName: `Customer ${String(index).padStart(4, "0")}`,
    sources: [index % 2 === 0 ? "order" : "booking"],
    activity: {
      orderCount: index % 2 === 0 ? 1 : 0,
      bookingCount: index % 2 === 0 ? 0 : 1,
      firstActivityAt: null, lastActivityAt: null, lastOrderAt: null, lastBookingAt: null,
      lastOrderNote: "", lastBookingNote: "", orderTotals: [],
    },
    incomplete: index % 5 === 0,
  }));
}

function textContent(tree: unknown): string {
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(textContent).join("");
  return textContent((tree as Element).props?.children);
}

function findAll(tree: unknown, predicate: (element: Element) => boolean): Element[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => findAll(child, predicate));
  const element = tree as Element;
  return [...(predicate(element) ? [element] : []), ...findAll(element.props?.children, predicate)];
}

function paginationButton(app: ReturnType<typeof harness>, label: string) {
  const nav = app.find(app.render(), (item) => item.type === "nav" && item.props["aria-label"] === "客户列表分页");
  assert.ok(nav, "pagination controls exist when the filtered list exceeds 50");
  const button = app.find(nav, (item) => item.type === "button" && item.props.children === label);
  assert.ok(button);
  return button;
}

function visibleCustomerRows(app: ReturnType<typeof harness>) {
  const list = app.find(app.render(), (item) => Boolean(item.props?.["data-customer-list-layout"]));
  assert.ok(list);
  return findAll(list, (item) => item.type === "article" || (item.type === "tr" && item.props.className === "align-top hover:bg-slate-50/70"));
}

async function loadedCustomerApp(count: number, desktop = true) {
  const app = harness();
  const customers = fixtureCustomers(count);
  app.setCustomerRows(customers);
  app.setDesktop(desktop);
  app.render();
  await flush();
  return { app, customers };
}

test("actual customer lists page 50 records with accurate full-list stats and bounded desktop/mobile DOM", async () => {
  const { app, customers } = await loadedCustomerApp(151);
  const before = JSON.stringify(customers);
  const initialReads = app.counts().reads;
  assert.equal(visibleCustomerRows(app).length, 50);
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0000/);
  assert.match(textContent(app.render()), /客户总数151订单客户76预约客户75资料待补充31/);
  assert.equal(paginationButton(app, "首页").props.disabled, true);
  assert.equal(paginationButton(app, "上一页").props.disabled, true);
  app.action(paginationButton(app, "下一页"), "onClick");
  assert.equal(visibleCustomerRows(app).length, 50);
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0050/);
  app.setDesktop(false);
  assert.equal(visibleCustomerRows(app).length, 50);
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0050/);
  assert.equal(findAll(app.render(), (item) => Boolean(item.props["data-customer-list-layout"])).length, 1);
  app.action(paginationButton(app, "末页"), "onClick");
  assert.equal(visibleCustomerRows(app).length, 1);
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0150/);
  assert.equal(paginationButton(app, "下一页").props.disabled, true);
  assert.equal(paginationButton(app, "末页").props.disabled, true);
  assert.match(textContent(app.render()), /共 151 位客户 · 当前显示 151–151/);
  app.action(paginationButton(app, "首页"), "onClick");
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0000/);
  assert.equal(JSON.stringify(customers), before);
  assert.equal(app.counts().writes, 0);
  assert.equal(app.counts().reads, initialReads, "local paging and breakpoints must not make extra API requests");
});

test("ten thousand synthetic customers still construct only fifty customer rows at either breakpoint", async () => {
  const { app } = await loadedCustomerApp(10000);
  assert.equal(visibleCustomerRows(app).length, 50);
  assert.match(textContent(app.render()), /客户总数10000/);
  app.action(paginationButton(app, "末页"), "onClick");
  assert.equal(visibleCustomerRows(app).length, 50);
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 9950/);
  app.setDesktop(false);
  assert.equal(visibleCustomerRows(app).length, 50);
  assert.match(textContent(app.render()), /共 10000 位客户 · 当前显示 9951–10000/);
  assert.equal(app.counts().reads, 1);
  assert.equal(app.counts().writes, 0);
});

test("search spans the full directory, resets immediately through deferred query changes and never revives a stale page", async () => {
  const { app } = await loadedCustomerApp(151);
  app.action(paginationButton(app, "末页"), "onClick");
  const search = () => app.find(app.render(), (item) => item.type === "input" && item.props.placeholder === "名称 / 电话 / 邮箱 / 地址 / 税号 / 编号")!;
  app.setDeferredQuery("");
  app.action(search(), "onChange", { target: { value: "Customer 0149" } });
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0000/, "pending search immediately leaves the old last page");
  app.setDeferredQuery("Customer 0149");
  assert.equal(visibleCustomerRows(app).length, 1);
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0149/, "search includes records outside the first page");
  app.setDeferredQuery(null);
  app.action(search(), "onChange", { target: { value: "does-not-exist" } });
  assert.equal(visibleCustomerRows(app).length, 0);
  assert.match(textContent(app.render()), /没有符合当前筛选条件的客户/);
  app.action(search(), "onChange", { target: { value: "" } });
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0000/);
  assert.equal(paginationButton(app, "上一页").props.disabled, true);
  assert.match(textContent(app.render()), /客户总数151/, "search must not turn statistics into current-page counts");
});

test("source/status changes page the complete match set and retain full totals", async () => {
  const { app, customers } = await loadedCustomerApp(151);
  app.action(paginationButton(app, "末页"), "onClick");
  const source = app.find(app.render(), (item) => item.type === "select" && textContent(item).includes("全部来源"))!;
  app.action(source, "onChange", { target: { value: "booking" } });
  assert.equal(visibleCustomerRows(app).length, 50);
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0001/);
  app.action(paginationButton(app, "下一页"), "onClick");
  assert.equal(visibleCustomerRows(app).length, 25);
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0101/);
  app.action(source, "onChange", { target: { value: "all" } });
  const archived = customers.map((customer, index) => ({ ...customer, status: index >= 100 ? "archived" as const : "active" as const }));
  app.setCustomerRows(archived);
  app.action(app.find(app.render(), (item) => item.type === "button" && item.props.children === "刷新")!, "onClick");
  await flush();
  app.action(paginationButton(app, "下一页"), "onClick");
  const status = app.find(app.render(), (item) => item.type === "select" && textContent(item).includes("已归档"))!;
  app.action(status, "onChange", { target: { value: "archived" } });
  assert.equal(visibleCustomerRows(app).length, 50);
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0100/);
  assert.equal(paginationButton(app, "上一页").props.disabled, true);
  assert.match(textContent(app.render()), /客户总数151/);
});

test("refresh shrink clamps permanently, then site A-B-A returns to the first page without paging requests", async () => {
  const { app, customers } = await loadedCustomerApp(151);
  app.action(paginationButton(app, "末页"), "onClick");
  const refresh = () => app.action(app.find(app.render(), (item) => item.type === "button" && item.props.children === "刷新")!, "onClick");
  app.setCustomerRows(customers.slice(0, 53));
  refresh();
  await flush();
  assert.equal(visibleCustomerRows(app).length, 3);
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0050/);
  app.setCustomerRows(customers);
  refresh();
  await flush();
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0050/, "growing back must not revive old page four");
  app.setCustomerRows(fixtureCustomers(121, "20000000"), "20000000");
  app.switchSite();
  await flush();
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0000/);
  assert.equal(paginationButton(app, "上一页").props.disabled, true);
  app.action(paginationButton(app, "下一页"), "onClick");
  app.switchSite("10000000");
  await flush();
  assert.match(textContent(visibleCustomerRows(app)[0]), /Customer 0000/);
  assert.equal(paginationButton(app, "上一页").props.disabled, true);
  assert.equal(app.counts().writes, 0);
});

test("editing a later-page customer keeps its complete draft across paging and breakpoint and saves the same identity", async () => {
  const { app, customers } = await loadedCustomerApp(151);
  app.action(paginationButton(app, "下一页"), "onClick");
  const edit = app.find(visibleCustomerRows(app)[0], (item) => item.type === "button" && item.props.children === "编辑")!;
  app.action(edit, "onClick");
  const dialog = () => app.find(app.render(), (item) => typeof item.type === "function" && item.type.name === "CustomerDialog")!;
  const draft = dialog().props.customer as customerTools.MerchantCustomerProfile;
  assert.equal(draft.id, customers[50].id);
  assert.equal(JSON.stringify(draft.tax), JSON.stringify(customers[50].tax));
  assert.notEqual(draft, customers[50], "editing keeps its existing cloned draft");
  app.action(paginationButton(app, "末页"), "onClick");
  app.setDesktop(false);
  assert.equal((dialog().props.customer as customerTools.MerchantCustomerProfile).id, customers[50].id);
  app.action(dialog(), "onSave", { ...draft, notes: "synthetic edit" });
  await flush();
  assert.equal(app.mutations.length, 1);
  assert.equal(app.mutations[0].method, "PATCH");
  const body = app.mutations[0].body as { siteId: string; version: string; customer: customerTools.MerchantCustomerProfile };
  assert.equal(body.siteId, "10000000");
  assert.equal(body.version, "v1");
  assert.equal(body.customer.id, customers[50].id);
  assert.equal(body.customer.notes, "synthetic edit");
  assert.equal(customers[50].notes, "");
  assert.equal(visibleCustomerRows(app).length, 1);
});

test("later-page import still submits the complete parsed import, not a display page, and refreshes full totals", async () => {
  const { app, customers } = await loadedCustomerApp(151, false);
  app.action(paginationButton(app, "末页"), "onClick");
  app.openImport();
  app.chooseFile();
  await flush();
  app.setCustomerRows([...customers, ...fixtureCustomers(1).map((customer) => ({ ...customer, id: "new-synthetic", displayName: "Imported" }))]);
  app.action(app.dialog(), "onImport");
  await flush();
  assert.equal(app.mutations.length, 1);
  assert.equal(app.mutations[0].method, "POST");
  const body = app.mutations[0].body as { siteId: string; version: string; mode: string; customers: { displayName: string }[] };
  assert.equal(body.siteId, "10000000");
  assert.equal(body.version, "v1");
  assert.equal(body.mode, "import");
  assert.equal(body.customers.length, 1);
  assert.equal(body.customers[0].displayName, "Imported");
  assert.equal(visibleCustomerRows(app).length, 2);
  assert.match(textContent(app.render()), /客户总数152/);
});

function refreshButton(app: ReturnType<typeof harness>) {
  const button = app.find(app.render(), (item) => item.type === "button" &&
    (item.props.children === "刷新" || item.props.children === "刷新中..."));
  assert.ok(button);
  return button;
}
function editDialog(app: ReturnType<typeof harness>) {
  const dialog = app.find(app.render(), (item) => typeof item.type === "function" && item.type.name === "CustomerDialog");
  assert.ok(dialog);
  return dialog;
}
function startSave(app: ReturnType<typeof harness>, customer = fixtureCustomers(1)[0]) {
  const button = app.find(app.render(), (item) => item.type === "button" && item.props.children === "新增客户")!;
  app.action(button, "onClick");
  app.action(editDialog(app), "onSave", customer);
}
const listPayload = (name: string, version = "v1") => ({
  customers: fixtureCustomers(1).map((customer) => ({ ...customer, displayName: name })), version, warnings: [],
});

test("actual GETs singleflight synchronously through delayed headers and JSON, without a completed cache", async () => {
  const app = harness();
  const headers = deferred<unknown>();
  const body = deferred<unknown>();
  app.queueRead({ headers: headers.promise, body: body.promise });
  const button = refreshButton(app);
  app.action(button, "onClick");
  app.action(button, "onClick");
  assert.equal(app.counts().reads, 1);
  assert.equal(app.readTimerCount(), 1);
  assert.equal(refreshButton(app).props.disabled, true);
  headers.resolve(undefined);
  await flush();
  app.action(button, "onClick");
  assert.equal(app.counts().reads, 1, "body-in-progress belongs to the same read generation");
  body.resolve(listPayload("Fresh"));
  await flush();
  assert.match(textContent(app.render()), /Fresh/);
  assert.equal(app.readTimerCount(), 0);
  assert.equal(refreshButton(app).props.disabled, false);
  app.action(refreshButton(app), "onClick");
  await flush();
  assert.equal(app.counts().reads, 2, "completed reads are not cached across explicit refreshes");
});

test("actual delayed JSON cannot revive an older A scope after A-B-A, even when abort is ignored", async () => {
  const app = harness();
  const oldA = deferred<unknown>();
  const oldB = deferred<unknown>();
  const latestA = deferred<unknown>();
  app.queueRead({ body: oldA.promise });
  app.render();
  await flush();
  app.queueRead({ body: oldB.promise });
  app.switchSite("20000000");
  app.queueRead({ body: latestA.promise });
  app.switchSite("10000000");
  assert.equal(app.counts().reads, 3);
  assert.deepEqual(app.requests.map((request) => request.signal?.aborted), [true, true, false]);
  assert.equal(app.readTimerCount(), 1);
  latestA.resolve(listPayload("Current A", "a-new"));
  await flush();
  oldA.resolve(listPayload("Stale A", "a-old"));
  oldB.reject(new Error("Stale B failure"));
  await flush();
  assert.match(textContent(app.render()), /Current A/);
  assert.doesNotMatch(textContent(app.render()), /Stale A|Stale B/);
  startSave(app);
  await flush();
  assert.equal((app.mutations[0].body as { version: string }).version, "a-new");
  assert.equal(app.readTimerCount(), 0);
});

test("blank site and unmount invalidate reads and clear timers without late state updates", async () => {
  for (const action of ["blank", "unmount"] as const) {
    const app = harness();
    const body = deferred<unknown>();
    app.queueRead({ body: body.promise });
    app.render();
    await flush();
    if (action === "blank") app.switchSite(""); else app.unmount();
    assert.equal(app.requests[0].signal?.aborted, true);
    assert.equal(app.readTimerCount(), 0);
    body.resolve(listPayload("Stale result"));
    await flush();
    assert.equal(app.counts().reads, 1);
    assert.equal(app.counts().stateUpdatesAfterUnmount, 0);
    if (action === "blank") {
      assert.doesNotMatch(textContent(app.render()), /Stale result/);
      assert.match(textContent(app.render()), /当前商户尚未准备好客户资料/);
    }
  }
});

test("effect cleanup/setup creates a fresh read incarnation and cannot accept the first body", async () => {
  const app = harness();
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  app.queueRead({ body: first.promise });
  app.render();
  app.queueRead({ body: second.promise });
  app.replayEffects();
  assert.equal(app.requests[0].signal?.aborted, true);
  assert.equal(app.counts().reads, 2);
  first.resolve(listPayload("First incarnation"));
  await flush();
  assert.equal(refreshButton(app).props.disabled, true);
  assert.equal(app.readTimerCount(), 1);
  second.resolve(listPayload("Second incarnation"));
  await flush();
  assert.match(textContent(app.render()), /Second incarnation/);
  assert.doesNotMatch(textContent(app.render()), /First incarnation/);
});

test("site commit invalidates old JSON before passive effects and starts the new tenant read", async () => {
  const app = harness();
  const oldBody = deferred<unknown>();
  const newBody = deferred<unknown>();
  app.queueRead({ body: oldBody.promise });
  app.render();
  await flush();
  app.queueRead({ body: newBody.promise });
  app.switchSiteBeforePassive("20000000");
  assert.equal(app.requests[0].signal?.aborted, true, "layout cleanup invalidates before passive effects");
  assert.equal(app.counts().reads, 2);
  const updates = app.counts().stateUpdates;
  oldBody.resolve(listPayload("Old commit"));
  await flush();
  assert.equal(app.counts().stateUpdates, updates, "late old JSON/finally cannot write in the commit-to-passive gap");
  assert.equal(app.readTimerCount(), 1);
  app.flushPassive();
  newBody.resolve(listPayload("New commit"));
  await flush();
  assert.match(textContent(app.render()), /New commit/);
  assert.doesNotMatch(textContent(app.render()), /Old commit/);
});

test("body-stage timeout remains a timeout through the legacy JSON null fallback and can be retried", async () => {
  const app = harness();
  const body = deferred<unknown>();
  app.queueRead({ body: body.promise });
  app.render();
  await flush();
  app.expireReadTimers();
  assert.equal(app.requests[0].signal?.aborted, true);
  body.reject(new DOMException("aborted", "AbortError"));
  await flush();
  assert.match(textContent(app.render()), /客户资料加载超时，请稍后重试/);
  assert.equal(refreshButton(app).props.disabled, false);
  app.action(refreshButton(app), "onClick");
  await flush();
  assert.equal(app.counts().reads, 2);
  assert.doesNotMatch(textContent(app.render()), /客户资料加载超时/);
});

for (const mutationStatus of [200, 409]) {
 for (const method of ["PATCH", "POST"] as const) {
  test(`${method} ${mutationStatus} starts a fresh read after mutation instead of sharing prewrite JSON`, async () => {
    const { app } = await loadedCustomerApp(1);
    const oldBody = deferred<unknown>();
    const newBody = deferred<unknown>();
    app.queueRead({ body: oldBody.promise });
    app.action(refreshButton(app), "onClick");
    app.queueRead({ body: newBody.promise });
    app.queueMutation({ status: mutationStatus });
    if (method === "PATCH") startSave(app);
    else { app.openImport(); app.chooseFile(); await flush(); app.action(app.dialog(), "onImport"); }
    await flush();
    assert.equal(app.counts().reads, 3);
    assert.equal(app.requests.filter((request) => request.method === "GET")[1].signal?.aborted, true);
    app.action(refreshButton(app), "onClick");
    assert.equal(app.counts().reads, 3, "manual overlap shares the postwrite read, not another GET");
    oldBody.resolve(listPayload("Before write", "old"));
    await flush();
    assert.equal(refreshButton(app).props.disabled, true, "old finally cannot end the current read");
    assert.equal(app.readTimerCount(), 1);
    newBody.resolve(listPayload("After write", "new"));
    await flush();
    assert.match(textContent(app.render()), /After write/);
    assert.doesNotMatch(textContent(app.render()), /Before write/);
    assert.equal(app.readTimerCount(), 0);
    assert.equal(app.mutations[0].method, method);
    assert.equal((app.mutations[0].body as { siteId: string; version: string }).siteId, "10000000");
    assert.equal((app.mutations[0].body as { version: string }).version, "v1");
  });
 }
}

for (const method of ["PATCH", "POST"] as const) {
  for (const completion of ["success", "conflict", "failure"] as const) {
    test(`old ${method} ${completion} completion after A-B-A neither refreshes nor changes current UI`, async () => {
      const { app } = await loadedCustomerApp(1);
      const body = deferred<unknown>();
      app.queueMutation(completion === "failure" ? { headers: body.promise } :
        { body: body.promise, status: completion === "conflict" ? 409 : 200 });
      if (method === "PATCH") startSave(app);
      else {
        app.openImport(); app.chooseFile(); await flush();
        app.action(app.dialog(), "onImport");
      }
      await flush();
      app.switchSite("20000000");
      app.switchSite("10000000");
      await flush();
      const reads = app.counts().reads;
      const newDraftButton = app.find(app.render(), (item) => item.type === "button" && item.props.children === "新增客户")!;
      app.action(newDraftButton, "onClick");
      if (completion === "failure") body.reject(new Error("old body failure"));
      else body.resolve({ ok: completion === "success", created: 1, version: "old-completion" });
      await flush();
      assert.equal(app.counts().reads, reads);
      assert.equal(app.counts().writes, 1);
      assert.equal(app.requests.find((request) => request.method === method)?.signal, undefined, "sent mutation is not aborted");
      assert.deepEqual(app.toasts, []);
      assert.ok(editDialog(app), "old success cannot close a new draft");
      assert.equal(editDialog(app).props.saving, false);
    });
  }
}

test("pending PATCH and POST are allowed to finish after unmount without UI updates or follow-up GET", async () => {
  for (const method of ["PATCH", "POST"] as const) {
    const { app } = await loadedCustomerApp(1);
    const body = deferred<unknown>();
    app.queueMutation({ body: body.promise });
    if (method === "PATCH") startSave(app);
    else { app.openImport(); app.chooseFile(); await flush(); app.action(app.dialog(), "onImport"); }
    await flush();
    app.unmount();
    body.resolve({ ok: true, created: 1 });
    await flush();
    assert.equal(app.counts().writes, 1);
    assert.equal(app.counts().reads, 1);
    assert.equal(app.counts().stateUpdatesAfterUnmount, 0);
    assert.equal(app.readTimerCount(), 0);
    assert.deepEqual(app.toasts, []);
  }
});
