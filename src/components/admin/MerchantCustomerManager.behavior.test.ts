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
type Effect = { deps: unknown[]; cleanup?: () => void };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const slots: unknown[] = [];
  const effects = new Map<number, Effect>();
  const pending: Array<() => void> = [];
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
  let workbookError = false;
  let workbookDelay: Promise<unknown> | null = null;
  let deferredQueryOverride: string | null = null;
  const customerRows = new Map<string, customerTools.MerchantCustomerDirectoryItem[]>();
  const mutations: Array<{ method: string; body: unknown }> = [];
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
  const fetchMock = async (url: string, options?: { method?: string; body?: string }) => {
    if (options?.method) {
      writes += 1;
      mutations.push({ method: options.method, body: options.body ? JSON.parse(options.body) : null });
    } else reads += 1;
    const requestedSite = new URL(url, "https://fixture.invalid").searchParams.get("siteId") ?? siteId;
    return { ok: true, json: async () => ({ customers: customerRows.get(requestedSite) ?? [], version: "v1", created: 1 }) };
  };
  const memo = (compute: () => unknown, deps: unknown[]) => {
    const index = cursor++;
    const previous = slots[index] as { deps: unknown[]; value: unknown } | undefined;
    if (!previous || deps.length !== previous.deps.length || deps.some((value, i) => value !== previous.deps[i])) {
      slots[index] = { deps: [...deps], value: compute() };
    }
    return (slots[index] as { value: unknown }).value;
  };
  const react = {
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: unknown) => {
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
    useEffect: (setup: () => void | (() => void), deps: unknown[]) => {
      const index = cursor++;
      const previous = effects.get(index);
      if (!previous || deps.some((dependency, i) => dependency !== previous.deps[i])) {
        pending.push(() => {
          previous?.cleanup?.();
          effects.set(index, { deps, cleanup: setup() || undefined });
        });
      }
    },
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
        fetchJsonWithAdminPerformance: async (url: string, options?: { method?: string }) => {
          const response = await fetchMock(url, options);
          return { response, data: await response.json() };
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
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    document: { createElement: () => ({ href: "", download: "", click() { downloads.push(this.download); } }) },
    fetch: fetchMock,
  });
  function render() {
    cursor = 0;
    const tree = sandboxModule.exports.default({ siteId });
    pending.splice(0).forEach((run) => run());
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
    render, find, dialog, openImport, chooseFile, action, toasts, downloads, mutations,
    counts: () => ({ workbookLoads, parseCalls, templateCalls, writes, reads, stateUpdatesAfterUnmount }),
    setWorkbookError: (value: boolean) => { workbookError = value; },
    delayWorkbook: (value: Promise<unknown>) => { workbookDelay = value; },
    setDesktop: (value: boolean) => { desktop = value; },
    setCustomerRows: (rows: customerTools.MerchantCustomerDirectoryItem[], forSite = siteId) => { customerRows.set(forSite, rows); },
    setDeferredQuery: (value: string | null) => { deferredQueryOverride = value; },
    switchSite: (nextSiteId = "20000000") => { siteId = nextSiteId; render(); },
    unmount: () => { effects.forEach((effect) => effect.cleanup?.()); mounted = false; },
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
