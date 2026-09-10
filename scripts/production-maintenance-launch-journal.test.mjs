import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createMaintenanceLaunchJournal,
  validateMaintenanceLaunchJournal,
  planMaintenanceLaunch,
  transitionMaintenanceLaunch,
} from "./production-maintenance-launch-journal.mjs";

const invalid = /production_maintenance_launch_(?:journal_invalid|transition_invalid|binding_mismatch)$/;
const roles = ["paused-web", "resumed-web", "worker"];
const digest = (character) => character.repeat(64);
const identity = "1:2:3:4:5:1:0:33261";
const uuid = (number) => `12345678-1234-4123-8123-${String(number).padStart(12, "0")}`;
const bound = () => ({
  operationId: uuid(1), targetSha: "a".repeat(40), appName: "faolla", appPort: 3000,
  daemon: { pid: 100, uid: 0, startTicks: "123", bootId: "12345678-1234-1234-1234-123456789abc",
    executable: "/usr/bin/node", executableIdentity: identity },
  release: { path: "/srv/faolla.releases/aaaaaaaaaaaa-20260909120000", identity: "1:2:3:4:5:2:0:16877", buildDigest: digest("b") },
});
const request = (role = "paused-web") => ({ role, sequence: roles.indexOf(role) + 1,
  nonce: uuid(roles.indexOf(role) + 2), environmentDigest: digest("c") });
const event = (role, phase) => ({ role, sequence: roles.indexOf(role) + 1, nonce: request(role).nonce, phase });
const observedInstance = (binding, role) => ({
  pmId: roles.indexOf(role), pid: 200 + roles.indexOf(role), parentPid: binding.daemon.pid, uid: binding.daemon.uid,
  startTicks: "456", processIdentity: identity, cwd: binding.release.path, cwdIdentity: binding.release.identity,
  executable: binding.daemon.executable, executableIdentity: binding.daemon.executableIdentity,
  commandLineDigest: digest("d"), createdAt: 1788950000000, pmUptime: 1788950000001, restartTime: 0, metadataDigest: digest("e"),
});
const confirmation = (binding, role = "paused-web") => ({
  ...event(role, "confirmed"), observation: { ...structuredClone(binding), role, sequence: roles.indexOf(role) + 1,
    observedNonce: request(role).nonce, environmentDigest: request(role).environmentDigest, instance: observedInstance(binding, role) },
});
function at(phase = "planned") {
  const binding = bound();
  let journal = planMaintenanceLaunch(createMaintenanceLaunchJournal(binding), binding, request());
  if (phase !== "planned") journal = transitionMaintenanceLaunch(journal, binding, event("paused-web", "attempted"));
  if (phase === "unknown") journal = transitionMaintenanceLaunch(journal, binding, event("paused-web", "unknown"));
  if (phase === "confirmed") journal = transitionMaintenanceLaunch(journal, binding, confirmation(binding));
  return { binding, journal };
}
function accessor(value, key, touched) {
  const copy = { ...value };
  Object.defineProperty(copy, key, { enumerable: true, get() { touched.count++; throw new Error("secret-getter"); } });
  return copy;
}

test("empty journal binds one operation with only the three fixed roles", () => {
  const binding = bound();
  const journal = createMaintenanceLaunchJournal(binding);
  assert.deepEqual(journal.slots, { "paused-web": null, "resumed-web": null, worker: null });
  assert.deepEqual(validateMaintenanceLaunchJournal(journal, binding), journal);
  assert.ok(Object.isFrozen(journal) && Object.isFrozen(journal.slots) && Object.isFrozen(journal.daemon) && Object.isFrozen(journal.release));
  assert.notEqual(journal.daemon, binding.daemon);
});

test("three fixed role sequences progress planned attempted confirmed without changing earlier entries", () => {
  const binding = bound();
  let journal = createMaintenanceLaunchJournal(binding);
  for (const role of roles) {
    const previous = journal;
    journal = planMaintenanceLaunch(journal, binding, request(role));
    assert.equal(journal.slots[role].phase, "planned");
    assert.equal(previous.slots[role], null);
    journal = transitionMaintenanceLaunch(journal, binding, event(role, "attempted"));
    assert.equal(journal.slots[role].instance, null);
    journal = transitionMaintenanceLaunch(journal, binding, confirmation(binding, role));
    assert.deepEqual(journal.slots[role].instance, observedInstance(binding, role));
    assert.deepEqual(validateMaintenanceLaunchJournal(journal, binding), journal);
  }
});

test("planned cannot be confirmed or marked unknown without the attempted transition", () => {
  const { binding, journal } = at();
  for (const change of [event("paused-web", "unknown"), confirmation(binding)]) {
    assert.throws(() => transitionMaintenanceLaunch(journal, binding, change), invalid);
  }
});

test("attempted and unknown never permit another attempt or a new plan in the same role", () => {
  for (const phase of ["planned", "attempted", "unknown", "confirmed"]) {
    const { binding, journal } = at(phase);
    assert.throws(() => planMaintenanceLaunch(journal, binding, { ...request(), nonce: uuid(99) }), invalid);
    if (phase !== "planned") assert.throws(() => transitionMaintenanceLaunch(journal, binding, event("paused-web", "attempted")), invalid);
  }
});

test("unknown is sticky except for exact independently observed nonce and instance confirmation", () => {
  const { binding, journal } = at("unknown");
  assert.throws(() => transitionMaintenanceLaunch(journal, binding, event("paused-web", "unknown")), invalid);
  const change = confirmation(binding);
  for (const observedNonce of [undefined, "", uuid(99)]) {
    assert.throws(() => transitionMaintenanceLaunch(journal, binding, {
      ...change, observation: { ...change.observation, observedNonce },
    }), invalid);
  }
  const confirmed = transitionMaintenanceLaunch(journal, binding, change);
  assert.equal(confirmed.slots["paused-web"].phase, "confirmed");
  assert.equal(journal.slots["paused-web"].phase, "unknown");
});

test("later roles cannot bypass an empty planned attempted or unknown predecessor", () => {
  const binding = bound();
  const empty = createMaintenanceLaunchJournal(binding);
  for (const journal of [empty, ...["planned", "attempted", "unknown"].map((phase) => at(phase).journal)]) {
    for (const role of ["resumed-web", "worker"]) {
      assert.throws(() => planMaintenanceLaunch(journal, binding, request(role)), invalid);
    }
  }
});

test("role and sequence are fixed and launch nonces cannot be reused across roles", () => {
  const { binding, journal } = at("confirmed");
  for (const patch of [{ role: "other" }, { sequence: 1 }, { sequence: "2" }, { nonce: request().nonce }]) {
    assert.throws(() => planMaintenanceLaunch(journal, binding, { ...request("resumed-web"), ...patch }), invalid);
  }
  const resumed = planMaintenanceLaunch(journal, binding, request("resumed-web"));
  for (const patch of [{ role: "worker" }, { sequence: 1 }, { nonce: uuid(99) }]) {
    assert.throws(() => transitionMaintenanceLaunch(resumed, binding, { ...event("resumed-web", "attempted"), ...patch }), invalid);
  }
});

test("same confirmed observation is idempotent but replacement instances are rejected", () => {
  const { binding, journal } = at("confirmed");
  assert.deepEqual(transitionMaintenanceLaunch(journal, binding, confirmation(binding)), journal);
  const base = confirmation(binding);
  for (const patch of [{ pmId: 20 }, { pid: 999 }, { startTicks: "999" }, { processIdentity: "2:2:3:4:5:1:0:33261" },
    { restartTime: 1 }, { createdAt: 1788950000001 }, { pmUptime: 1788950000002 },
    { metadataDigest: digest("f") }, { commandLineDigest: digest("f") }]) {
    assert.throws(() => transitionMaintenanceLaunch(journal, binding, {
      ...base, observation: { ...base.observation, instance: { ...base.observation.instance, ...patch } },
    }), invalid);
  }
  assert.throws(() => transitionMaintenanceLaunch(journal, binding, event("paused-web", "unknown")), invalid);
});

test("confirmation binds the complete operation target application role sequence release daemon and environment", () => {
  const { binding, journal } = at("attempted");
  const base = confirmation(binding);
  for (const patch of [{ operationId: uuid(99) }, { targetSha: "b".repeat(40) }, { appName: "other-app" }, { appPort: 3001 },
    { role: "worker" }, { sequence: 2 },
    { environmentDigest: digest("f") }, { daemon: { ...binding.daemon, startTicks: "999" } },
    { release: { ...binding.release, buildDigest: digest("f") } }]) {
    assert.throws(() => transitionMaintenanceLaunch(journal, binding, { ...base, observation: { ...base.observation, ...patch } }), invalid);
  }
});

test("a confirmed instance must have the frozen daemon parent UID executable and release directory", () => {
  const { binding, journal } = at("attempted");
  const base = confirmation(binding);
  for (const patch of [{ pid: binding.daemon.pid }, { pid: 0 }, { parentPid: 999 }, { uid: 999 },
    { executable: "/other/node" }, { executableIdentity: "9:2:3:4:5:1:0:33261" },
    { cwd: "/other/release" }, { cwdIdentity: "9:2:3:4:5:2:0:16877" }, { createdAt: 0 }, { pmUptime: NaN }, { pmId: "1" }]) {
    assert.throws(() => transitionMaintenanceLaunch(journal, binding, {
      ...base, observation: { ...base.observation, instance: { ...base.observation.instance, ...patch } },
    }), invalid);
  }
});

test("every operation requires the trusted external binding, not merely a self-consistent stored journal", () => {
  const { binding, journal } = at("attempted");
  for (const changed of [{ ...binding, operationId: uuid(99) }, { ...binding, appName: "other-app" },
    { ...binding, appPort: 3001 }, { ...binding, daemon: { ...binding.daemon, pid: 999 } },
    { ...binding, release: { ...binding.release, identity: "9:2:3:4:5:2:0:16877" } }]) {
    assert.throws(() => validateMaintenanceLaunchJournal(journal, changed), invalid);
    assert.throws(() => planMaintenanceLaunch(journal, changed, request("resumed-web")), invalid);
    assert.throws(() => transitionMaintenanceLaunch(journal, changed, event("paused-web", "unknown")), invalid);
  }
  assert.throws(() => validateMaintenanceLaunchJournal(journal), invalid);
});

test("corrupt slots, missing sequence predecessors, and impossible phase payloads fail closed", () => {
  const { binding, journal } = at("planned");
  const original = structuredClone(journal);
  for (const phase of ["cancelled", "healthy", "held", "ended", "failed", ""]) {
    const changed = structuredClone(original);
    changed.slots["paused-web"].phase = phase;
    assert.throws(() => validateMaintenanceLaunchJournal(changed, binding), invalid);
  }
  for (const patch of [{ role: "worker" }, { sequence: 2 }, { phase: "confirmed" }, { instance: observedInstance(binding, "paused-web") }]) {
    assert.throws(() => validateMaintenanceLaunchJournal({ ...original, slots: {
      ...original.slots, "paused-web": { ...original.slots["paused-web"], ...patch },
    } }, binding), invalid);
  }
  const hole = structuredClone(original);
  hole.slots["resumed-web"] = { ...hole.slots["paused-web"], ...request("resumed-web") };
  hole.slots["paused-web"] = null;
  assert.throws(() => validateMaintenanceLaunchJournal(hole, binding), invalid);
});

test("all boundary records reject accessors without invoking them", () => {
  const { binding, journal } = at("attempted");
  const touched = { count: 0 };
  const base = confirmation(binding);
  for (const call of [
    () => createMaintenanceLaunchJournal(accessor(binding, "operationId", touched)),
    () => createMaintenanceLaunchJournal({ ...binding, daemon: accessor(binding.daemon, "pid", touched) }),
    () => createMaintenanceLaunchJournal({ ...binding, release: accessor(binding.release, "path", touched) }),
    () => validateMaintenanceLaunchJournal(accessor(journal, "slots", touched), binding),
    () => validateMaintenanceLaunchJournal({ ...journal, slots: accessor(journal.slots, "paused-web", touched) }, binding),
    () => validateMaintenanceLaunchJournal({ ...journal, slots: { ...journal.slots,
      "paused-web": accessor(journal.slots["paused-web"], "phase", touched) } }, binding),
    () => planMaintenanceLaunch(journal, binding, accessor(request(), "role", touched)),
    () => transitionMaintenanceLaunch(journal, binding, accessor(base, "phase", touched)),
    () => transitionMaintenanceLaunch(journal, binding, { ...base, observation: accessor(base.observation, "observedNonce", touched) }),
    () => transitionMaintenanceLaunch(journal, binding, { ...base, observation: { ...base.observation,
      instance: accessor(base.observation.instance, "pid", touched) } }),
  ]) assert.throws(call, invalid);
  assert.equal(touched.count, 0);
});

test("proxies are rejected without running traps at top-level or nested boundaries", () => {
  const { binding, journal } = at("attempted");
  let traps = 0;
  const proxy = (value) => new Proxy(value, {
    get() { traps++; throw new Error("secret"); }, ownKeys() { traps++; throw new Error("secret"); },
    getPrototypeOf() { traps++; throw new Error("secret"); }, getOwnPropertyDescriptor() { traps++; throw new Error("secret"); },
  });
  const base = confirmation(binding);
  for (const call of [() => createMaintenanceLaunchJournal(proxy(binding)),
    () => createMaintenanceLaunchJournal({ ...binding, daemon: proxy(binding.daemon) }),
    () => validateMaintenanceLaunchJournal(proxy(journal), binding),
    () => validateMaintenanceLaunchJournal({ ...journal, slots: proxy(journal.slots) }, binding),
    () => transitionMaintenanceLaunch(journal, binding, proxy(base)),
    () => transitionMaintenanceLaunch(journal, binding, { ...base, observation: proxy(base.observation) }),
  ]) assert.throws(call, invalid);
  assert.equal(traps, 0);
});

test("custom prototypes symbols hidden fields and toJSON are rejected; null prototypes normalize safely", () => {
  const binding = bound();
  for (const changed of [Object.assign(Object.create({}), binding), { ...binding, [Symbol("extra")]: true },
    { ...binding, toJSON() { throw new Error("must-never-run"); } }, Object.defineProperty({ ...binding }, "hidden", { value: true }),
    [], new Date(), null]) assert.throws(() => createMaintenanceLaunchJournal(changed), invalid);
  const safe = Object.assign(Object.create(null), binding);
  safe.daemon = Object.assign(Object.create(null), binding.daemon);
  const result = createMaintenanceLaunchJournal(safe);
  assert.equal(Object.getPrototypeOf(result.daemon), Object.prototype);
});

test("inputs cannot contain methods argv credentials arbitrary environment or outcome claims", () => {
  const { binding, journal } = at("attempted");
  const base = confirmation(binding);
  for (const secretField of ["method", "argv", "env", "credentials", "healthy", "held", "authorized"]) {
    for (const call of [() => createMaintenanceLaunchJournal({ ...binding, [secretField]: "must-never-disclose" }),
      () => planMaintenanceLaunch(journal, binding, { ...request(), [secretField]: "must-never-disclose" }),
      () => transitionMaintenanceLaunch(journal, binding, { ...base, [secretField]: "must-never-disclose" }),
      () => transitionMaintenanceLaunch(journal, binding, { ...base, observation: { ...base.observation, [secretField]: "must-never-disclose" } }),
    ]) assert.throws(call, (error) => invalid.test(error.message) && !error.message.includes("disclose"));
  }
});

test("noncanonical UUID SHA paths identities and numeric coercions are rejected", () => {
  const binding = bound();
  for (const patch of [{ operationId: uuid(1).replace("-4123-", "-1123-") }, { targetSha: "A".repeat(40) },
    ...["", "unsafe app", "x".repeat(101), null, 123].map((appName) => ({ appName })),
    ...[0, 65536, -1, 1.1, "3000", NaN, Infinity, true].map((appPort) => ({ appPort })),
    { daemon: { ...binding.daemon, pid: true } }, { daemon: { ...binding.daemon, uid: -1 } },
    { daemon: { ...binding.daemon, startTicks: "0123" } }, { daemon: { ...binding.daemon, bootId: "wrong" } },
    { daemon: { ...binding.daemon, executableIdentity: "1:2" } },
    ...["/", "/srv/../faolla", binding.release.path + "/", "/srv/faolla.releases/bbbbbbbbbbbb-20260909120000"].map((path) => ({ release: { ...binding.release, path } })),
  ]) assert.throws(() => createMaintenanceLaunchJournal({ ...binding, ...patch }), invalid);
});

test("application name and port are mandatory explicit context, never inferred from metadata", () => {
  const binding = bound();
  for (const key of ["appName", "appPort"]) {
    const incomplete = { ...binding };
    delete incomplete[key];
    assert.throws(() => createMaintenanceLaunchJournal(incomplete), invalid);
  }
  for (const appPort of [1, 65535]) {
    const expected = { ...binding, appName: "Faolla.app_1-web", appPort };
    const journal = createMaintenanceLaunchJournal(expected);
    assert.equal(journal.appName, expected.appName);
    assert.equal(journal.appPort, appPort);
  }
});

test("transition does not coerce attacker objects or allow arbitrary phase commands", () => {
  const { binding, journal } = at("attempted");
  let called = 0;
  const poison = { toString() { called++; throw new Error("secret"); } };
  for (const patch of [{ role: poison }, { sequence: poison }, { nonce: poison }, { phase: poison },
    { phase: "reset" }, { phase: "planned" }, { phase: "launch" }]) {
    assert.throws(() => transitionMaintenanceLaunch(journal, binding, { ...event("paused-web", "unknown"), ...patch }), invalid);
  }
  assert.equal(called, 0);
});

test("returned snapshots are deeply frozen detached values and failures never mutate prior input", () => {
  const { binding, journal } = at("attempted");
  const original = structuredClone(journal);
  const observation = confirmation(binding);
  const confirmed = transitionMaintenanceLaunch(journal, binding, observation);
  observation.observation.instance.pid = 999;
  binding.daemon.pid = 999;
  assert.equal(confirmed.daemon.pid, 100);
  assert.equal(confirmed.slots["paused-web"].instance.pid, 200);
  assert.throws(() => { confirmed.slots["paused-web"].instance.pid = 999; }, TypeError);
  assert.deepEqual(journal, original);
  assert.throws(() => transitionMaintenanceLaunch(journal, bound(), event("paused-web", "attempted")), invalid);
  assert.deepEqual(journal, original);
});

test("pure contract has no filesystem network clocks randomness or PM2 execution and states its integration limits", () => {
  const source = readFileSync(new URL("./production-maintenance-launch-journal.mjs", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]), ["node:path", "node:util/types"]);
  assert.doesNotMatch(source, /\b(?:spawn|spawnSync|execFile|readFile|writeFile|fetch|randomUUID|setTimeout)\s*\(|Date\.now|process\.env/);
  assert.match(source, /ONE durable journal slot/);
  assert.match(source, /PM2 server-side atomic CAS/);
  assert.match(source, /confirmed records identity only, NOT health/);
  // Deliberately demonstrate the pure boundary: callers must not replace a
  // durable attempted/unknown journal with a fresh constructor result.
  assert.equal(createMaintenanceLaunchJournal(bound()).slots["paused-web"], null);
});
