"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createPublicCatalogCoordinator } from "@/lib/publicCatalogCoordinator";
import type { PublicCatalogState, PublicCatalogViewport } from "@/lib/merchantPublicCatalog";

const LOADING: PublicCatalogState = Object.freeze({ status: "loading", catalog: null });
const EMPTY: ReadonlyMap<string, PublicCatalogState> = new Map();
type Scope = { siteId: string; viewport: PublicCatalogViewport; scopeKey: string; enabled: boolean };

/** Construction is pure: only a committed subscriber may start network work. */
function createCatalogStore({ siteId, viewport, enabled }: Scope) {
  const listeners = new Set<() => void>();
  let members = new Set<string>();
  let snapshot = EMPTY;
  let coordinator: ReturnType<typeof createPublicCatalogCoordinator> | null = null;

  function publish(changed: readonly string[]) {
    if (!coordinator) return;
    let next: Map<string, PublicCatalogState> | undefined;
    for (const id of changed) {
      const current = members.has(id) ? coordinator.getState(id) : undefined;
      // A missing key already means loading. Initial membership must not cause
      // another render merely to replace loading with an identical loading UI.
      const visible = current?.status === "loading" ? undefined : current;
      if (snapshot.get(id) === visible) continue;
      next ??= new Map(snapshot);
      if (visible) next.set(id, visible);
      else next.delete(id);
    }
    if (!next) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (enabled && !coordinator) {
        const next = createPublicCatalogCoordinator({
          siteId,
          viewport,
          onChange: (ids) => { if (coordinator === next) publish(ids); },
        });
        coordinator = next;
        if (members.size) next.setBlocks([...members]);
      }
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        if (listeners.size) return;
        const previous = coordinator;
        coordinator = null;
        previous?.dispose();
        snapshot = EMPTY;
      };
    },
    setBlocks(ids: readonly string[]) {
      members = new Set(ids.map((id) => id.trim()));
      coordinator?.setBlocks([...members]);
    },
  };
}

/** A visit owns requests, not persisted carts or an application-wide cache. */
export function usePublicCatalogBlocks(input: {
  siteId: string;
  viewport: PublicCatalogViewport;
  scopeKey: string;
  enabled: boolean;
  blockIds: readonly string[];
}) {
  const { siteId, viewport, scopeKey, enabled } = input;
  // useMemo retains only the current scope, not an A/B cache. A -> B -> A
  // creates a new store whose first render is loading, before any effects run.
  const store = useMemo(
    () => createCatalogStore({ siteId, viewport, scopeKey, enabled }),
    [enabled, siteId, viewport, scopeKey],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const membership = JSON.stringify([...new Set(input.blockIds.map((id) => id.trim()))].sort());

  useEffect(() => {
    store.setBlocks(JSON.parse(membership) as string[]);
  }, [store, membership]);

  return (blockId: string): PublicCatalogState | undefined => {
    if (!enabled) return undefined;
    return snapshot.get(blockId.trim()) ?? LOADING;
  };
}
