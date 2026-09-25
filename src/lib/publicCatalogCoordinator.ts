import {
  decodePublicCatalogBatch,
  MAX_PUBLIC_CATALOG_BATCH_SIZE,
  type PublicCatalogState,
  type PublicCatalogViewport,
} from "./merchantPublicCatalog";

type CatalogResponse = Pick<Response, "ok" | "json">;
export type PublicCatalogFetcher = (
  input: string,
  init: RequestInit,
) => Promise<CatalogResponse>;

export type PublicCatalogCoordinatorOptions = {
  siteId: string;
  viewport: PublicCatalogViewport;
  fetcher?: PublicCatalogFetcher;
  onChange: (blockIds: readonly string[]) => void;
};

export type PublicCatalogCoordinator = {
  setBlocks: (blockIds: readonly string[]) => void;
  getState: (blockId: string) => PublicCatalogState;
  refresh: (blockIds?: readonly string[]) => void;
  dispose: () => void;
};

type Entry = { generation: number; state: PublicCatalogState };
type PendingEntry = { blockId: string; generation: number };
type Batch = { controller: AbortController; entries: PendingEntry[] };

const LOADING: PublicCatalogState = Object.freeze({ status: "loading", catalog: null });
const ERROR: PublicCatalogState = Object.freeze({ status: "error", catalog: null });
const MAX_CONCURRENT_BATCHES = 2;

/** One instance belongs to one page/plan/site/viewport visit, never a reusable cache key. */
export function createPublicCatalogCoordinator({
  siteId,
  viewport,
  fetcher = (input, init) => fetch(input, init),
  onChange,
}: PublicCatalogCoordinatorOptions): PublicCatalogCoordinator {
  const entries = new Map<string, Entry>();
  const queue: PendingEntry[] = [];
  const active = new Set<Batch>();
  let generation = 0;
  let disposed = false;

  const isValidId = (blockId: string) => blockId.length > 0 && blockId.length <= 200;
  const isCurrent = (pending: PendingEntry) => {
    const current = entries.get(pending.blockId);
    return !disposed && current?.generation === pending.generation && current.state.status === "loading";
  };
  const isNeeded = (batch: Batch) => !batch.controller.signal.aborted && batch.entries.some(isCurrent);
  const notify = (ids: string[]) => {
    if (!disposed && ids.length) onChange(ids);
  };

  function commit(batch: Batch, states?: Map<string, PublicCatalogState>) {
    if (!isNeeded(batch)) return;
    const changed: string[] = [];
    for (const pending of batch.entries) {
      if (!isCurrent(pending)) continue;
      const result = states?.get(pending.blockId);
      entries.set(pending.blockId, {
        generation: pending.generation,
        // Only an explicit decoded ready result can enable legacy or catalog ordering.
        state: result?.status === "ready" ? result : ERROR,
      });
      changed.push(pending.blockId);
    }
    notify(changed);
  }

  async function run(batch: Batch) {
    const blockIds = batch.entries.map((entry) => entry.blockId);
    try {
      const response = await fetcher("/api/orders/catalog/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: batch.controller.signal,
        body: JSON.stringify({ siteId, viewport, blockIds }),
      });
      if (!isNeeded(batch)) return;
      if (!response.ok) throw new Error("public_catalog_request_failed");
      const body: unknown = await response.json();
      // Aborting fetch does not guarantee an already-started body decode was cancelled.
      if (!isNeeded(batch)) return;
      commit(batch, decodePublicCatalogBatch(body, { siteId, viewport, blockIds }));
    } catch {
      // Fail closed, without a GET retry or a manufactured legacy/null result.
      commit(batch);
    } finally {
      active.delete(batch);
      pump();
    }
  }

  function pump() {
    if (disposed) return;
    while (active.size < MAX_CONCURRENT_BATCHES && queue.length) {
      const pending: PendingEntry[] = [];
      while (pending.length < MAX_PUBLIC_CATALOG_BATCH_SIZE && queue.length) {
        const next = queue.shift()!;
        if (isCurrent(next)) pending.push(next);
      }
      if (!pending.length) continue;
      const batch: Batch = { controller: new AbortController(), entries: pending };
      active.add(batch);
      void run(batch);
    }
  }

  function abortUnneededBatches() {
    for (const batch of active) {
      if (isNeeded(batch)) continue;
      batch.controller.abort();
      // Orphaned body promises may settle late: they must not hold a new visit's work.
      active.delete(batch);
    }
  }

  function enqueue(blockId: string) {
    const nextGeneration = ++generation;
    entries.set(blockId, {
      generation: nextGeneration,
      state: isValidId(blockId) ? LOADING : ERROR,
    });
    if (isValidId(blockId)) queue.push({ blockId, generation: nextGeneration });
  }

  return {
    setBlocks(blockIds) {
      if (disposed) return;
      const nextIds = new Set(blockIds.map((id) => id.trim()));
      const changed: string[] = [];
      for (const id of entries.keys()) {
        if (nextIds.has(id)) continue;
        entries.delete(id);
        changed.push(id);
      }
      for (const id of nextIds) {
        if (entries.has(id)) continue;
        enqueue(id);
        changed.push(id);
      }
      abortUnneededBatches();
      notify(changed);
      pump();
    },
    getState(blockId) {
      return entries.get(blockId.trim())?.state ?? LOADING;
    },
    refresh(blockIds) {
      if (disposed) return;
      const selected = blockIds === undefined
        ? [...entries.keys()]
        : [...new Set(blockIds.map((id) => id.trim()))];
      const changed: string[] = [];
      for (const id of selected) {
        if (!entries.has(id) || !isValidId(id)) continue;
        enqueue(id);
        changed.push(id);
      }
      abortUnneededBatches();
      notify(changed);
      pump();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      entries.clear();
      queue.length = 0;
      for (const batch of active) batch.controller.abort();
      active.clear();
    },
  };
}
