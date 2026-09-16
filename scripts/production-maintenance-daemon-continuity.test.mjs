import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assertMaintenanceDaemonContinuity } from "./production-maintenance-daemon-continuity.mjs";

const BOOT = "12345678-1234-1234-1234-123456789012";
const ERROR = { message: "production_maintenance_daemon_continuity_unverified" };
// Read-only incident projection: no environment, command text or private state.
// Its real canonical digest is tested without mocking crypto or reading a host.
const PINNED_BOOT = "e6531ec9-db4a-4216-b87a-7cc858197eaa";
const pinned = () => ({ pid: 1932, parentPid: 1, startTicks: "655",
  processIdentity: "5:1371412379:0:1789025006880928256:1789025006880928256:9:0:16749", uid: 0, cwd: "/",
  cwdIdentity: "64769:2:4096:1781053826232894895:1781053826232894895:22:0:16749", executable: "/usr/bin/node",
  executableIdentity: "64769:1490495:98927992:1772647009000000000:1773064763075191240:1:0:33261",
  commandLineDigest: "e828d12675121dacff0dd5b122c0f135cadd6a2fe03ddbbe1e8540f9ad1e4159" });
const fixture = () => ({ pid: 10, parentPid: 1, startTicks: "123", processIdentity: "1:2:0:4:5:5:0:16749",
  uid: 0, cwd: "/", cwdIdentity: "1:3:4096:4:5:3:0:16877", executable: "/usr/bin/node",
  executableIdentity: "1:4:1234:4:5:1:0:33261", commandLineDigest: "a".repeat(64) });
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const changeIdentity = (value, index) => {
  const parts = value.processIdentity.split(":"); parts[index] = String(BigInt(parts[index]) + 1n);
  return { ...value, processIdentity: parts.join(":") };
};

test("second explicitly authorized frozen tuple keeps the same boot and stable identity checks", () => {
  const original = { ...pinned(), processIdentity: "5:1455626046:0:1789549976568704851:1789549976568704851:9:0:16749" };
  assert.equal(digest(original), "331fb4c2909faa21f060bfcfd0325bac2655e2980fce703b349e01ad4749fa37");
  const bytes = JSON.stringify(original);
  for (const index of [1, 3, 4]) {
    const observed = changeIdentity(original, index);
    assert.equal(assertMaintenanceDaemonContinuity(original, observed, PINNED_BOOT), undefined);
    assert.throws(() => assertMaintenanceDaemonContinuity(original, observed, BOOT), ERROR);
    assert.throws(() => assertMaintenanceDaemonContinuity(observed, original, PINNED_BOOT), ERROR);
    for (const field of [0, 2, 5, 6, 7]) assert.throws(() => assertMaintenanceDaemonContinuity(original, changeIdentity(observed, field), PINNED_BOOT), ERROR);
    for (const patch of [{ pid: 1933 }, { startTicks: "656" }, { executable: "/usr/local/bin/node" }, { uid: 1 }, { cwd: "/other" }])
      assert.throws(() => assertMaintenanceDaemonContinuity(original, { ...observed, ...patch }, PINNED_BOOT), ERROR);
  }
  assert.equal(JSON.stringify(original), bytes);
});

test("unchanged ordinary daemon stays valid without the incident pin or object-order assumptions", () => {
  const frozen = fixture(), observed = Object.fromEntries(Object.entries(frozen).reverse());
  const before = digest(frozen);
  assert.equal(assertMaintenanceDaemonContinuity(frozen, observed, BOOT), undefined);
  assert.equal(digest(frozen), before);
  const nullPrototype = Object.assign(Object.create(null), observed);
  assert.equal(assertMaintenanceDaemonContinuity(frozen, nullPrototype, BOOT), undefined);
});

test("ordinary daemon does not gain historical inode or timestamp tolerance", () => {
  for (const index of [1, 3, 4]) {
    for (const boot of [BOOT, "e6531ec9-db4a-4216-b87a-7cc858197eaa"])
      assert.throws(() => assertMaintenanceDaemonContinuity(fixture(), changeIdentity(fixture(), index), boot), ERROR);
  }
});

test("real pinned digest permits only the three approved historical procfs components, without changing either proof", () => {
  assert.equal(digest(pinned()), "940d18ed1876a97c6523b56bc213be2c426c89348630527392d9d795dadef6c4");
  for (let mask = 1; mask < 8; mask++) {
    const original = Object.freeze(pinned()); let observed = pinned();
    for (const [bit, index] of [1, 3, 4].entries()) if (mask & (1 << bit)) observed = changeIdentity(observed, index);
    Object.freeze(observed); const bytes = [JSON.stringify(original), JSON.stringify(observed)];
    assert.equal(assertMaintenanceDaemonContinuity(original, observed, PINNED_BOOT), undefined);
    assert.deepEqual([JSON.stringify(original), JSON.stringify(observed)], bytes);
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    assert.equal(assertMaintenanceDaemonContinuity(reordered, observed, PINNED_BOOT), undefined);
  }
});

test("approved historical difference still rejects another boot, reversed arguments or a refreshed frozen tuple", () => {
  const observed = changeIdentity(pinned(), 1);
  assert.throws(() => assertMaintenanceDaemonContinuity(pinned(), observed, BOOT), ERROR);
  assert.throws(() => assertMaintenanceDaemonContinuity(observed, pinned(), PINNED_BOOT), ERROR);
  assert.throws(() => assertMaintenanceDaemonContinuity(observed, changeIdentity(observed, 3), PINNED_BOOT), ERROR);
});

test("all nine non-procfs fields and all five stable procfs components remain mandatory", () => {
  const patches = [{ pid: 1933 }, { parentPid: 2 }, { startTicks: "656" }, { uid: 1 }, { cwd: "/other" },
    { cwdIdentity: "1:2:3:4:5:1:0:16749" }, { executable: "/usr/local/bin/node" },
    { executableIdentity: "1:2:3:4:5:1:0:33261" }, { commandLineDigest: "b".repeat(64) }];
  for (const patch of patches) {
    assert.throws(() => assertMaintenanceDaemonContinuity(pinned(), { ...changeIdentity(pinned(), 1), ...patch }, PINNED_BOOT), ERROR);
    // A self-consistent different daemon cannot borrow the incident exception.
    assert.throws(() => assertMaintenanceDaemonContinuity({ ...pinned(), ...patch }, { ...changeIdentity(pinned(), 1), ...patch }, PINNED_BOOT), ERROR);
  }
  for (const index of [0, 2, 5, 6, 7])
    assert.throws(() => assertMaintenanceDaemonContinuity(pinned(), changeIdentity(changeIdentity(pinned(), 1), index), PINNED_BOOT), ERROR);
});

test("strict schemas reject malformed equal tuples rather than accepting equality first", () => {
  for (const patch of [{ pid: 0 }, { parentPid: -0 }, { uid: -1 }, { uid: 4294967296 }, { startTicks: "0" },
    { startTicks: "1".repeat(26) }, { processIdentity: "1:2:3" }, { processIdentity: "-1:2:3:4:5:1:0:16749" },
    { processIdentity: "1".repeat(26) + ":2:3:4:5:1:0:16749" }, { cwdIdentity: {} },
    { executableIdentity: "x" }, { cwd: "/srv/../" }, { cwd: "/srv/" }, { executable: "/" },
    { executable: "/usr/bin/node\0secret" }, { commandLineDigest: "A".repeat(64) }, { raw: "secret" }]) {
    const value = { ...fixture(), ...patch };
    assert.throws(() => assertMaintenanceDaemonContinuity(value, value, BOOT), ERROR);
  }
  for (const boot of [null, {}, "", "not-a-boot"]) {
    assert.throws(() => assertMaintenanceDaemonContinuity(fixture(), fixture(), boot), ERROR);
  }
  assert.throws(() => assertMaintenanceDaemonContinuity(fixture(), fixture(), "E6531ec9-db4a-4216-b87a-7cc858197eaa"), ERROR);
});

test("descriptor and proxy rejection invokes no accessor or proxy trap on either argument", () => {
  let calls = 0;
  const getter = fixture(); Object.defineProperty(getter, "pid", { enumerable: true, get() { calls++; return 10; } });
  const proxy = new Proxy(fixture(), { ownKeys() { calls++; return []; }, get() { calls++; return undefined; },
    getPrototypeOf() { calls++; return Object.prototype; }, getOwnPropertyDescriptor() { calls++; return undefined; } });
  const hidden = fixture(); Object.defineProperty(hidden, "pid", { enumerable: false, value: 10 });
  const symbol = fixture(); symbol[Symbol("secret")] = true;
  const inherited = Object.create(fixture());
  for (const bad of [getter, proxy, hidden, symbol, inherited, [], null]) {
    assert.throws(() => assertMaintenanceDaemonContinuity(bad, fixture(), BOOT), ERROR);
    assert.throws(() => assertMaintenanceDaemonContinuity(fixture(), bad, BOOT), ERROR);
  }
  assert.equal(calls, 0);
});

test("standalone helper import is inert from stdin and has no host process or transport dependency", () => {
  const url = new URL("./production-maintenance-daemon-continuity.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: `await import(${JSON.stringify(url)});`, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
});
