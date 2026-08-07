import assert from "node:assert/strict";
import test from "node:test";
import { homeBlocks, type Block } from "./homeBlocks";
import {
  flushScheduledBlocksToStorage,
  loadBlocksFromStorage,
  readLatestDraftSnapshot,
  saveBlocksToStorage,
  saveLatestDraftSnapshot,
  scheduleBlocksToStorage,
} from "./blockStore";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function createBlockSet(id: string, text: string): Block[] {
  const blocks = [
    {
      ...homeBlocks[0],
      id,
      props: {
        ...homeBlocks[0].props,
        commonTextBoxes: [{ id: `${id}-text`, text }],
      },
    } as unknown as Block,
  ];
  return JSON.parse(JSON.stringify(blocks)) as Block[];
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withWindowHarness(run: () => Promise<void> | void, storage: Storage = createMemoryStorage()) {
  const globalTarget = globalThis as typeof globalThis & {
    localStorage?: Storage;
    window?: Window & typeof globalThis;
  };
  const previousWindow = globalTarget.window;
  const previousLocalStorage = globalTarget.localStorage;
  const mockWindow = new EventTarget() as Window & typeof globalThis;
  Object.assign(mockWindow, {
    ...globalThis,
    localStorage: storage,
    setTimeout,
    clearTimeout,
  });

  globalTarget.window = mockWindow;
  globalTarget.localStorage = storage;

  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (typeof previousWindow === "undefined") {
        Reflect.deleteProperty(globalTarget, "window");
      } else {
        globalTarget.window = previousWindow;
      }
      if (typeof previousLocalStorage === "undefined") {
        Reflect.deleteProperty(globalTarget, "localStorage");
      } else {
        globalTarget.localStorage = previousLocalStorage;
      }
    });
}

test("scheduled draft storage writes are deferred until the timer fires", async () => {
  await withWindowHarness(async () => {
    const scope = "site-10000000";
    const blocks = createBlockSet("scheduled", "first");
    scheduleBlocksToStorage(blocks, scope, 20);

    assert.deepEqual(loadBlocksFromStorage([], scope), []);

    await delay(35);

    assert.deepEqual(loadBlocksFromStorage([], scope), blocks);
  });
});

test("flushing scheduled draft storage persists immediately", async () => {
  await withWindowHarness(async () => {
    const scope = "site-10000001";
    const blocks = createBlockSet("flush", "now");
    scheduleBlocksToStorage(blocks, scope, 500);

    flushScheduledBlocksToStorage(scope);

    assert.deepEqual(loadBlocksFromStorage([], scope), blocks);
  });
});

test("immediate draft saves override older scheduled snapshots", async () => {
  await withWindowHarness(async () => {
    const scope = "site-10000002";
    const previous = createBlockSet("previous", "older");
    const latest = createBlockSet("latest", "newer");

    scheduleBlocksToStorage(previous, scope, 40);
    saveBlocksToStorage(latest, scope);

    await delay(60);

    assert.deepEqual(loadBlocksFromStorage([], scope), latest);
  });
});

test("latest saved draft snapshots round-trip independently by scope", async () => {
  await withWindowHarness(() => {
    const firstScope = "site-10000003";
    const secondScope = "site-10000004";
    const first = createBlockSet("first-snapshot", "first");
    const second = createBlockSet("second-snapshot", "second");

    assert.equal(saveLatestDraftSnapshot(first, firstScope), true);
    assert.equal(saveLatestDraftSnapshot(second, secondScope), true);
    assert.deepEqual(readLatestDraftSnapshot(firstScope)?.blocks, first);
    assert.deepEqual(readLatestDraftSnapshot(secondScope)?.blocks, second);
  });
});

test("remote hydration never overwrites a manual recovery point", async () => {
  await withWindowHarness(() => {
    const scope = "site-10000006";
    const manual = createBlockSet("manual-snapshot", "manual edit");
    const remote = createBlockSet("remote-snapshot", "remote publish backup");

    assert.equal(saveLatestDraftSnapshot(manual, scope), true);
    assert.equal(
      saveLatestDraftSnapshot(remote, scope, {
        source: "remote",
        sourceUpdatedAt: "2026-08-07T12:00:00.000Z",
      }),
      true,
    );
    assert.equal(readLatestDraftSnapshot(scope)?.source, "manual");
    assert.deepEqual(readLatestDraftSnapshot(scope)?.blocks, manual);
  });
});

test("failed browser storage writes are reported while the current-tab recovery point remains readable", async () => {
  const unavailableStorage = createMemoryStorage();
  unavailableStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };

  await withWindowHarness(() => {
    const scope = "site-10000005";
    const blocks = createBlockSet("memory-snapshot", "recoverable in this tab");

    assert.equal(saveBlocksToStorage(blocks, scope), false);
    assert.equal(saveLatestDraftSnapshot(blocks, scope), false);
    assert.deepEqual(readLatestDraftSnapshot(scope)?.blocks, blocks);
  }, unavailableStorage);
});
