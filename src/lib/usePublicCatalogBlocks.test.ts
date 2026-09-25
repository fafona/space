import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import type { PublicCatalogState } from "./merchantPublicCatalog";

// Run the actual hook with deterministic effect scheduling. Coordinator network
// and protocol cases are tested independently, not mocked as passing here.
const source = readFileSync(new URL("./usePublicCatalogBlocks.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
type Input = { siteId: string; viewport: "desktop" | "mobile"; scopeKey: string; enabled: boolean; blockIds: string[] };
type Effect = { deps: unknown[]; setup: () => void | (() => void); cleanup?: () => void };

function harness() {
  const slots: unknown[] = [];
  const effects = new Map<number, Effect>();
  const pending = new Map<number, Effect>();
  const coordinators: Array<{
    siteId: string; viewport: string; disposed: boolean;
    states: Map<string, PublicCatalogState>; memberships: string[][];
    complete: (id: string) => void;
  }> = [];
  let cursor = 0;
  let dirty = false;
  let stateUpdates = 0;
  let input: Input = { siteId: "10000000", viewport: "desktop", scopeKey: "plan/page-a", enabled: true, blockIds: ["a", "b"] };
  let getState: (id: string) => PublicCatalogState | undefined;
  let serverSnapshot: (() => ReadonlyMap<string, PublicCatalogState>) | undefined;
  const exported = { exports: {} as { usePublicCatalogBlocks: (input: Input) => typeof getState } };
  function effectAt(index: number, setup: Effect["setup"], deps: unknown[]) {
    const previous = effects.get(index);
    if (!previous || deps.length !== previous.deps.length || deps.some((value, i) => value !== previous.deps[i])) {
      pending.set(index, { deps: [...deps], setup });
    }
  }
  const react = {
    useMemo(factory: () => unknown, deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index] as { value: unknown; deps: unknown[] } | undefined;
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        slots[index] = { value: factory(), deps: [...deps] };
      }
      return (slots[index] as { value: unknown }).value;
    },
    useSyncExternalStore(
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => ReadonlyMap<string, PublicCatalogState>,
      getServerSnapshot: () => ReadonlyMap<string, PublicCatalogState>,
    ) {
      const index = cursor++;
      const snapshot = getSnapshot();
      assert.strictEqual(getSnapshot(), snapshot, "getSnapshot must remain cached between changes");
      serverSnapshot = getServerSnapshot;
      const slot = { snapshot, getSnapshot };
      slots[index] = slot;
      effectAt(index, () => {
        const check = () => {
          const current = slots[index] as typeof slot;
          if (current.getSnapshot !== getSnapshot) return;
          const next = getSnapshot();
          if (Object.is(next, current.snapshot)) return;
          current.snapshot = next;
          dirty = true;
          stateUpdates += 1;
        };
        const unsubscribe = subscribe(check);
        // React checks again after subscribing, including StrictMode replay.
        check();
        return unsubscribe;
      }, [subscribe, getSnapshot]);
      return snapshot;
    },
    useEffect(setup: Effect["setup"], deps: unknown[]) {
      effectAt(cursor++, setup, deps);
    },
  };
  new Script(compiled, { filename: "usePublicCatalogBlocks.cjs" }).runInNewContext({
    module: exported, exports: exported.exports,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "@/lib/publicCatalogCoordinator") return {
        createPublicCatalogCoordinator(options: { siteId: string; viewport: string; onChange: (ids: readonly string[]) => void }) {
          const fixture = {
            siteId: options.siteId, viewport: options.viewport, disposed: false,
            states: new Map<string, PublicCatalogState>(), memberships: [] as string[][],
            complete(id: string) {
              fixture.states.set(id, { status: "ready", catalog: null });
              options.onChange([id]);
            },
          };
          coordinators.push(fixture);
          return {
            setBlocks(ids: string[]) {
              if (fixture.disposed) return;
              fixture.memberships.push([...ids]);
              const changed: string[] = [];
              for (const id of fixture.states.keys()) if (!ids.includes(id)) {
                fixture.states.delete(id);
                changed.push(id);
              }
              for (const id of ids) if (!fixture.states.has(id)) {
                fixture.states.set(id, { status: "loading", catalog: null });
                changed.push(id);
              }
              if (changed.length) options.onChange(changed);
            },
            getState: (id: string) => fixture.states.get(id) ?? { status: "loading", catalog: null },
            dispose() { fixture.disposed = true; fixture.states.clear(); },
          };
        },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  function render(next: Partial<Input> = {}) {
    input = { ...input, ...next };
    for (let attempts = 0; attempts < 10; attempts += 1) {
      cursor = 0;
      dirty = false;
      pending.clear();
      getState = exported.exports.usePublicCatalogBlocks(input);
      if (!dirty) return;
    }
    throw new Error("hook render did not stabilize");
  }
  function flush() {
    for (let attempts = 0; attempts < 10; attempts += 1) {
      for (const [index, effect] of [...pending]) {
        pending.delete(index);
        effects.get(index)?.cleanup?.();
        effect.cleanup = effect.setup() || undefined;
        effects.set(index, effect);
      }
      if (!dirty) return;
      render();
    }
    throw new Error("hook effects did not stabilize");
  }
  return {
    render, flush, coordinators, state: (id: string) => getState(id), updates: () => stateUpdates,
    view: () => getState,
    serverSnapshot: () => serverSnapshot!(),
    strictReplay() {
      effects.forEach((effect) => effect.cleanup?.());
      effects.forEach((effect) => { effect.cleanup = effect.setup() || undefined; });
      render(); flush();
    },
    unmount() { effects.forEach((effect) => effect.cleanup?.()); },
  };
}

test("actual hook batches stable membership and preserves sibling state across modal membership", () => {
  const app = harness();
  app.render({ blockIds: [" b ", "a", "a"] });
  assert.equal(app.state("a")?.status, "loading");
  assert.equal(app.coordinators.length, 0);
  app.flush();
  const current = app.coordinators[0];
  assert.equal(app.coordinators.length, 1);
  assert.equal(JSON.stringify(current.memberships), JSON.stringify([["a", "b"]]));
  current.complete("a"); app.render(); app.flush();
  const readyA = app.state("a");
  app.render({ blockIds: ["a", "b"] }); app.flush();
  assert.equal(current.memberships.length, 1);
  app.render({ blockIds: ["a", "b", "modal"] }); app.flush();
  assert.equal(app.state("a"), readyA);
  assert.equal(app.state("modal")?.status, "loading");
  current.complete("modal"); app.render(); app.flush();
  app.render({ blockIds: ["a", "b"] }); app.flush();
  app.render({ blockIds: ["a", "b", "modal"] });
  assert.equal(app.state("modal")?.status, "loading");
  app.flush();
  assert.equal(app.state("a"), readyA);
  assert.equal(app.coordinators.length, 1);
});

test("actual hook invalidates A-B-A before effects and suppresses disposed callback updates", () => {
  const app = harness(); app.render(); app.flush();
  const original = app.coordinators[0];
  original.complete("a"); app.render(); app.flush();
  assert.equal(app.state("a")?.status, "ready");
  app.render({ scopeKey: "plan/page-b" });
  assert.equal(app.state("a")?.status, "loading");
  app.flush();
  assert.equal(original.disposed, true);
  app.coordinators[1].complete("a"); app.render(); app.flush();
  app.render({ scopeKey: "plan/page-a" });
  assert.equal(app.state("a")?.status, "loading");
  app.flush();
  const beforeLate = app.updates(); original.complete("a");
  assert.equal(app.updates(), beforeLate);
  assert.equal(app.state("a")?.status, "loading");
  assert.equal(app.coordinators.length, 3);
});

test("actual hook creates a fresh StrictMode setup and isolates mobile/site scopes", () => {
  const app = harness(); app.render(); app.flush();
  app.coordinators[0].complete("a"); app.render(); app.flush();
  app.strictReplay();
  assert.equal(app.coordinators[0].disposed, true);
  assert.equal(app.coordinators.length, 2);
  assert.equal(app.state("a")?.status, "loading");
  const afterReplay = app.updates();
  app.coordinators[0].complete("a");
  assert.equal(app.updates(), afterReplay);
  assert.equal(app.state("a")?.status, "loading");
  app.coordinators[1].complete("a"); app.render(); app.flush();
  app.render({ viewport: "mobile" });
  assert.equal(app.state("a")?.status, "loading"); app.flush();
  assert.equal(app.coordinators[2].viewport, "mobile");
  app.render({ siteId: "20000000" });
  assert.equal(app.state("a")?.status, "loading"); app.flush();
  assert.equal(app.coordinators[3].siteId, "20000000");
  app.unmount();
  const updates = app.updates(); app.coordinators[3].complete("a");
  assert.equal(app.updates(), updates);
});

test("actual hook leaves disabled/editor mode on the existing unbatched path", () => {
  const app = harness(); app.render({ enabled: false }); app.flush();
  assert.equal(app.state("a"), undefined);
  assert.equal(app.coordinators.length, 0);
  app.render({ enabled: true }); app.flush();
  assert.equal(app.coordinators.length, 1);
  app.render({ enabled: false });
  assert.equal(app.state("a"), undefined); app.flush();
  assert.equal(app.coordinators[0].disposed, true);
});

test("actual hook is pure before subscription and keeps a stable empty server snapshot", () => {
  const app = harness();
  app.render();
  const serverSnapshot = app.serverSnapshot();
  assert.equal(serverSnapshot.size, 0);
  assert.strictEqual(app.serverSnapshot(), serverSnapshot);
  app.render({ scopeKey: "abandoned-page" });
  app.render({ scopeKey: "committed-page", viewport: "mobile" });
  assert.equal(app.coordinators.length, 0);
  app.flush();
  assert.equal(app.coordinators.length, 1);
  assert.equal(app.coordinators[0].viewport, "mobile");
  assert.equal(app.updates(), 0, "initial loading does not require an extra binding/loading render");
  app.coordinators[0].complete("a"); app.render(); app.flush();
  assert.equal(app.state("a")?.status, "ready");
  assert.strictEqual(app.serverSnapshot(), serverSnapshot);
  assert.equal(serverSnapshot.size, 0);
  app.unmount();
});

test("actual hook publishes immutable snapshots without mutating prior renders or sibling values", () => {
  const app = harness(); app.render(); app.flush();
  app.coordinators[0].complete("a"); app.render(); app.flush();
  const previousView = app.view();
  const previousA = previousView("a");
  app.coordinators[0].complete("b"); app.render(); app.flush();
  assert.equal(app.state("b")?.status, "ready");
  assert.equal(previousView("b")?.status, "loading");
  assert.strictEqual(app.state("a"), previousA);
  app.render({ blockIds: ["a"] }); app.flush();
  assert.strictEqual(app.state("a"), previousA);
  assert.equal(previousView("a")?.status, "ready");
  app.unmount();
});
