import assert from "node:assert/strict";
import test from "node:test";
import { homeBlocks, type Block } from "./homeBlocks";
import {
  flushScheduledBlocksToStorage,
  loadBlocksFromStorage,
  saveBlocksToStorage,
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
  return [
    {
      ...homeBlocks[0],
      id,
      props: {
        ...homeBlocks[0].props,
        commonTextBoxes: [{ id: `${id}-text`, text }],
      },
    } as Block,
  ];
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withWindowHarness(run: () => Promise<void> | void) {
  const globalTarget = globalThis as typeof globalThis & {
    localStorage?: Storage;
    window?: Window & typeof globalThis;
  };
  const previousWindow = globalTarget.window;
  const previousLocalStorage = globalTarget.localStorage;
  const localStorage = createMemoryStorage();
  const mockWindow = new EventTarget() as Window & typeof globalThis;
  Object.assign(mockWindow, {
    ...globalThis,
    localStorage,
    setTimeout,
    clearTimeout,
  });

  globalTarget.window = mockWindow;
  globalTarget.localStorage = localStorage;

  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (typeof previousWindow === "undefined") {
        delete globalTarget.window;
      } else {
        globalTarget.window = previousWindow;
      }
      if (typeof previousLocalStorage === "undefined") {
        delete globalTarget.localStorage;
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
