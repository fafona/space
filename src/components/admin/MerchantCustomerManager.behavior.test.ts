import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import * as customerTools from "@/lib/merchantCustomers";

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
  let stateUpdatesAfterUnmount = 0;
  let workbookError = false;
  let workbookDelay: Promise<unknown> | null = null;
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
  const fetchMock = async (_url: string, options?: { method?: string }) => {
    if (options?.method) writes += 1;
    return { ok: true, json: async () => ({ customers: [], version: "v1", created: 1 }) };
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
    useMemo: (compute: () => unknown) => compute(),
    useCallback: (callback: unknown) => callback,
    useDeferredValue: (value: unknown) => value,
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
    render, find, dialog, openImport, chooseFile, action, toasts, downloads,
    counts: () => ({ workbookLoads, parseCalls, templateCalls, writes, stateUpdatesAfterUnmount }),
    setWorkbookError: (value: boolean) => { workbookError = value; },
    delayWorkbook: (value: Promise<unknown>) => { workbookDelay = value; },
    setDesktop: (value: boolean) => { desktop = value; },
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
