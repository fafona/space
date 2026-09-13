import assert from "node:assert/strict";
import crypto, { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { constants, readFileSync } from "node:fs";
import { URL } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch, validateMaintenanceLaunchJournal } from "./production-maintenance-launch-journal.mjs";
import { createMaintenanceLaunchJournalStorage } from "./production-maintenance-launch-journal-storage.mjs";
import { createMaintenanceRecoveryInspection, buildMaintenanceRecoveredState, validateMaintenanceRecoveryState } from "./production-maintenance-recovery.mjs";
import { MAINTENANCE_CONTINUATION_INCIDENT, createMaintenanceContinuationInspection, buildMaintenanceContinuedState,
  validateMaintenanceContinuationState } from "./production-maintenance-continuation.mjs";
import { MAINTENANCE_BUILD_RECOVERY_INCIDENT, createMaintenanceBuildRecoveryInspection, buildMaintenanceBuildRecoveredState,
  validateMaintenanceBuildRecoveryState } from "./production-maintenance-build-recovery.mjs";

const SECRET = "PRIVATE_STATE_MUST_NOT_APPEAR_IN_ERROR";
const ROOT = "/var/lib/faolla-maintenance/faolla";
const FILE = ROOT + "/state.json";
const TEMP = ROOT + "/state.launch-journal.tmp";
const uuid = (n) => `12345678-1234-4123-8123-${String(n).padStart(12, "0")}`;
const binding = () => ({ operationId: uuid(1), targetSha: "a".repeat(40), appName: "faolla", appPort: 3000,
  daemon: { pid: 100, uid: 0, startTicks: "123", bootId: "12345678-1234-1234-1234-123456789abc",
    executable: "/usr/bin/node", executableIdentity: "1:2:3:4:5:1:0:33261" },
  release: { path: "/srv/faolla.releases/aaaaaaaaaaaa-20260909120000", identity: "1:2:3:4:5:2:0:16877", buildDigest: "b".repeat(64) } });
const planned = () => ({ role: "paused-web", sequence: 1, nonce: uuid(2), environmentDigest: "c".repeat(64) });
const attempt = () => ({ type: "transition", value: { role: "paused-web", sequence: 1, nonce: uuid(2), phase: "attempted" } });
const safeError = (error) => /^production_maintenance_launch_storage_(?:invalid|conflict|unconfirmed)$/.test(error.message) && !error.message.includes(SECRET);

function fixture(phase = "planned") {
  const bound = binding(); let journal = planMaintenanceLaunch(createMaintenanceLaunchJournal(bound), bound, planned());
  if (phase !== "planned") journal = transitionMaintenanceLaunch(journal, bound, attempt().value);
  if (phase === "unknown") journal = transitionMaintenanceLaunch(journal, bound, { ...attempt().value, phase: "unknown" });
  const initial = { version: 2, operationId: bound.operationId, targetSha: bound.targetSha, revision: 7, launchJournal: journal };
  const events = []; const files = new Map(); const fds = new Map(); let inode = 0; let nextFd = 10; let locked = false;
  const put = (path, type, bytes = Buffer.alloc(0), patch = {}) => {
    const entry = { type, bytes: Buffer.from(bytes), dev: 1n, ino: BigInt(++inode), mode: type === "directory" ? 0o40700n : 0o100600n,
      uid: 0n, nlink: 1n, mtimeNs: 1n, ctimeNs: 1n, ...patch };
    files.set(path, entry); return entry;
  };
  for (const path of ["/", "/var", "/var/lib", "/var/lib/faolla-maintenance", ROOT]) put(path, "directory");
  put(FILE, "file", JSON.stringify(initial));
  const get = (path) => { if (!files.has(path)) throw new Error(SECRET); return files.get(path); };
  const stat = (entry) => ({ ...entry, size: BigInt(entry.bytes.length), isDirectory: () => entry.type === "directory",
    isFile: () => entry.type === "file", isSymbolicLink: () => entry.type === "symlink" });
  const effect = (name, fn) => (...args) => { assert.equal(locked, true, name + " outside existing lock"); events.push(name); return fn(...args); };
  const io = {
    lstatSync: effect("lstat", (path) => stat(get(path))), realpathSync: effect("realpath", (path) => path),
    openSync: effect("open", (path, flags) => {
      if (path === TEMP) {
        assert.ok(flags & constants.O_EXCL);
        if (constants.O_NOFOLLOW !== undefined) assert.ok(flags & constants.O_NOFOLLOW);
        if (files.has(path)) throw new Error(SECRET); put(path, "file");
      }
      const id = ++nextFd; fds.set(id, { entry: get(path), offset: 0, path }); return id;
    }),
    fstatSync: effect("fstat", (fd) => stat(fds.get(fd).entry)),
    readSync: effect("read", (fd, output, offset, length) => { const handle = fds.get(fd); const n = Math.min(length, handle.entry.bytes.length - handle.offset);
      handle.entry.bytes.copy(output, offset, handle.offset, handle.offset + n); handle.offset += n; return n; }),
    writeSync: effect("write", (fd, bytes, offset, length) => { const handle = fds.get(fd); handle.entry.bytes = Buffer.concat([handle.entry.bytes, bytes.subarray(offset, offset + length)]); return length; }),
    fsyncSync: effect("fsync", (fd) => { events.push(fds.get(fd).entry.type === "directory" ? "sync:directory" : "sync:file"); }),
    closeSync: effect("close", (fd) => { fds.delete(fd); }),
    renameSync: effect("rename", (source, target) => { files.set(target, get(source)); files.delete(source); }),
  };
  let queue = Promise.resolve();
  const options = { appName: "faolla", captureState: (value, expected) => {
    assert.deepEqual(Object.keys(value), ["version", "operationId", "targetSha", "revision", "launchJournal"]);
    assert.equal(value.version, 2); assert.equal(value.operationId, expected.operationId); assert.equal(value.targetSha, expected.targetSha); return value;
  }, withExistingOperationLock: async (callback) => {
    const previous = queue; let release; queue = new Promise((resolve) => { release = resolve; }); await previous;
    assert.equal(locked, false); locked = true; events.push("lock");
    try { return await callback(); } finally { events.push("unlock"); locked = false; release(); }
  } };
  const store = () => createMaintenanceLaunchJournalStorage(options, io);
  const saved = () => JSON.parse(get(FILE).bytes.toString("utf8"));
  const request = () => ({ expectedRevision: saved().revision, expectedDigest: createHash("sha256").update(get(FILE).bytes).digest("hex"), binding: bound, change: attempt() });
  return { io, options, files, fds, events, bound, initial, store, put, saved, request };
}

test("one existing state is CAS-updated only after file sync, rename, parent sync and strict readback", async () => {
  const f = fixture(); const store = f.store(); const before = await store.readUnderExistingOperationLock(f.bound);
  assert.equal(before.revision, 7); assert.equal(before.digest, f.request().expectedDigest); assert.ok(Object.isFrozen(before.state.launchJournal));
  f.events.length = 0; const saved = await store.applyUnderExistingOperationLock(f.request());
  assert.equal(saved.revision, 8); assert.equal(saved.state.launchJournal.slots["paused-web"].phase, "attempted");
  assert.equal(f.files.has(TEMP), false); assert.equal(f.fds.size, 0);
  assert.ok(f.events.indexOf("sync:file") < f.events.indexOf("rename"));
  assert.ok(f.events.indexOf("rename") < f.events.indexOf("sync:directory"));
  assert.ok(f.events.lastIndexOf("read") > f.events.indexOf("sync:directory"));
  assert.equal(f.events.at(-1), "unlock");
});

test("concurrent callers using one real expected revision and digest have exactly one successful CAS", async () => {
  const f = fixture(); const request = f.request(); const store = f.store(); let sends = 0;
  const results = await Promise.allSettled([1, 2].map(async () => { await store.applyUnderExistingOperationLock(request); sends++; }));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(sends, 1);
  assert.match(results.find((r) => r.status === "rejected").reason.message, /storage_conflict$/);
  assert.equal(f.events.filter((e) => e === "rename").length, 1); assert.equal(f.saved().revision, 8);
});

test("stale revision or actual-byte digest refuses before creating a temporary file", async () => {
  for (const patch of [{ expectedRevision: 6 }, { expectedDigest: "f".repeat(64) }]) {
    const f = fixture(); await assert.rejects(f.store().applyUnderExistingOperationLock({ ...f.request(), ...patch }), /storage_conflict$/);
    assert.equal(f.files.has(TEMP), false); assert.equal(f.events.includes("write"), false);
  }
});

test("every write-stage exception, including post-rename ambiguity, returns no send success", async () => {
  for (const stage of ["openTemporary", "write", "fileSync", "fileClose", "renameBefore", "renameAfter", "directoryOpen", "directorySync", "directoryClose", "readback"]) {
    const f = fixture(); const original = { ...f.io }; let renamed = false; let sends = 0;
    f.io.openSync = (path, ...args) => { if ((stage === "openTemporary" && path === TEMP) || (stage === "directoryOpen" && path === ROOT) || (stage === "readback" && renamed && path === FILE)) throw new Error(SECRET); return original.openSync(path, ...args); };
    f.io.writeSync = (...args) => { if (stage === "write") throw new Error(SECRET); return original.writeSync(...args); };
    f.io.fsyncSync = (fd) => { const path = f.fds.get(fd).path; if ((stage === "fileSync" && path === TEMP) || (stage === "directorySync" && path === ROOT)) throw new Error(SECRET); return original.fsyncSync(fd); };
    f.io.closeSync = (fd) => { const path = f.fds.get(fd).path; original.closeSync(fd); if ((stage === "fileClose" && path === TEMP) || (stage === "directoryClose" && path === ROOT)) throw new Error(SECRET); };
    f.io.renameSync = (...args) => { if (stage === "renameBefore") throw new Error(SECRET); original.renameSync(...args); renamed = true; if (stage === "renameAfter") throw new Error(SECRET); };
    await assert.rejects(async () => { await f.store().applyUnderExistingOperationLock(f.request()); sends++; }, safeError, stage);
    assert.equal(sends, 0, stage); assert.equal(f.saved().revision, renamed ? 8 : 7, stage);
    assert.equal(f.saved().launchJournal.slots["paused-web"].phase, renamed ? "attempted" : "planned", stage);
  }
});

test("ambiguous persisted attempt cannot be rebuilt as empty or resent even after a fresh read", async () => {
  const f = fixture(); const sync = f.io.fsyncSync;
  f.io.fsyncSync = (fd) => { if (f.fds.get(fd).path === ROOT) throw new Error(SECRET); return sync(fd); };
  await assert.rejects(f.store().applyUnderExistingOperationLock(f.request()), safeError);
  f.io.fsyncSync = sync;
  const snapshot = await f.store().readUnderExistingOperationLock(f.bound);
  assert.equal(snapshot.state.launchJournal.slots["paused-web"].phase, "attempted");
  for (const change of [attempt(), { type: "plan", value: { ...planned(), nonce: uuid(99) } }, { type: "reset", value: null }]) {
    await assert.rejects(async () => f.store().applyUnderExistingOperationLock({ ...f.request(), change }), safeError);
  }
  assert.equal(f.saved().revision, 8);
});

test("unknown journals only accept existing pure transitions, never another launch attempt", async () => {
  const f = fixture("unknown"); await assert.rejects(f.store().applyUnderExistingOperationLock(f.request()), safeError);
  assert.equal(f.events.includes("write"), false); assert.equal(f.saved().launchJournal.slots["paused-web"].phase, "unknown");
});

test("missing corrupt duplicated or untrusted state is never replaced by an empty journal", async () => {
  for (const change of [
    (f) => { f.files.delete(FILE); }, (f) => { f.files.get(FILE).bytes = Buffer.from("{}"); },
    (f) => { f.files.get(FILE).bytes = Buffer.from('{"version":1,"version":2}'); },
    (f) => { f.files.get(FILE).bytes = Buffer.from(SECRET); },
    (f) => { f.files.get(FILE).type = "symlink"; }, (f) => { f.files.get(FILE).type = "fifo"; },
    (f) => { f.files.get(FILE).nlink = 2n; }, (f) => { f.files.get(FILE).uid = 5n; },
    (f) => { f.files.get(FILE).mode = 0o100644n; }, (f) => { f.files.get(ROOT).mode = 0o40777n; },
    (f) => { f.put(TEMP, "file", SECRET); },
  ]) {
    const f = fixture(); const request = f.request(); change(f);
    await assert.rejects(f.store().applyUnderExistingOperationLock(request), safeError);
    assert.equal(f.events.includes("write"), false); assert.equal(f.events.includes("rename"), false);
  }
});

test("a changed state or parent before rename and malformed readback never acknowledge persistence", async () => {
  for (const stage of ["state", "parent", "readback"]) {
    const f = fixture(); const write = f.io.writeSync; const rename = f.io.renameSync;
    f.io.writeSync = (...args) => { const n = write(...args); if (stage === "state") f.files.get(FILE).ino += 1n;
      if (stage === "parent") f.files.get(ROOT).ino += 1n; return n; };
    f.io.renameSync = (...args) => { rename(...args); if (stage === "readback") f.files.get(FILE).bytes = Buffer.from(SECRET); };
    await assert.rejects(f.store().applyUnderExistingOperationLock(f.request()), safeError);
    if (stage !== "readback") assert.equal(f.events.includes("rename"), false);
  }
});

test("binding, normalizing state validators and mutation during lock wait cannot change captured intent", async () => {
  const f = fixture(); const request = f.request(); const pending = f.store().applyUnderExistingOperationLock(request);
  request.change.value.phase = "unknown"; request.binding.appPort = 99;
  assert.equal((await pending).state.launchJournal.slots["paused-web"].phase, "attempted");
  const g = fixture(); g.options.captureState = (state) => ({ ...state, revision: 0 });
  await assert.rejects(g.store().applyUnderExistingOperationLock(g.request()), safeError); assert.equal(g.events.includes("write"), false);
  const h = fixture(); const bad = h.request(); bad.binding.appPort = 3001;
  await assert.rejects(h.store().applyUnderExistingOperationLock(bad), safeError); assert.equal(h.events.includes("write"), false);
  const foreign = fixture(); foreign.bound.appName = "another-app";
  const changed = foreign.saved(); changed.launchJournal.appName = "another-app";
  foreign.files.get(FILE).bytes = Buffer.from(JSON.stringify(changed));
  await assert.rejects(foreign.store().readUnderExistingOperationLock(foreign.bound), safeError);
  await assert.rejects(foreign.store().applyUnderExistingOperationLock(foreign.request()), safeError);
  assert.equal(foreign.events.includes("write"), false);
});

test("getter proxy hidden fields and coercion are rejected without side effects", async () => {
  const f = fixture(); let invoked = 0;
  const bad = f.request(); Object.defineProperty(bad, "expectedDigest", { enumerable: true, get() { invoked++; return SECRET; } });
  const proxy = new Proxy(f.request(), { ownKeys() { invoked++; throw new Error(SECRET); } });
  for (const value of [bad, proxy, { ...f.request(), toJSON() { invoked++; return {}; } }, { ...f.request(), expectedRevision: "7" }]) {
    await assert.rejects(async () => f.store().applyUnderExistingOperationLock(value), safeError);
  }
  assert.equal(invoked, 0); assert.equal(f.events.length, 0);
});

test("lock failures and a callback never entered cannot yield a saved result", async () => {
  for (const lock of [async () => { throw new Error(SECRET); }, async () => ({})]) {
    const f = fixture(); f.options.withExistingOperationLock = lock;
    await assert.rejects(f.store().applyUnderExistingOperationLock(f.request()), safeError);
    assert.equal(f.events.length, 0);
  }
});

test("offline adapter has no launch network nonce or standalone journal creation path", () => {
  const source = readFileSync(new URL("./production-maintenance-launch-journal-storage.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:spawn|spawnSync|execFile|fetch|randomUUID|randomBytes|mkdirSync|unlinkSync)\s*\(/);
  assert.doesNotMatch(source, /createMaintenanceLaunchJournal\s*\(/);
  assert.match(source, /existing operation lock/); assert.match(source, /not kernel CAS/);
  assert.match(source, /Failed temporary files are intentionally retained/);
});

function operationFixture(phase = null) {
  const f = fixture(phase ?? "planned");
  const state = { version: 2, appName: "faolla", operationId: f.bound.operationId, targetSha: f.bound.targetSha,
    revision: 7, phase: "held", launchDisk: phase === null ? null : { path: f.bound.release.path },
    launchJournal: phase === null ? null : f.saved().launchJournal, private: SECRET };
  f.put(FILE, "file", JSON.stringify(state));
  f.options.captureState = (value, externalBinding) => {
    assert.equal(externalBinding, null);
    assert.deepEqual(Object.keys(value), Object.keys(state));
    assert.equal(value.version, 2); assert.equal(value.appName, state.appName);
    assert.equal(value.operationId, state.operationId); assert.equal(value.targetSha, state.targetSha);
    assert.equal(value.private, SECRET); assert.ok(["held", "candidate", "failed-unknown"].includes(value.phase));
    assert.equal(value.launchDisk === null, value.launchJournal === null);
    if (value.launchJournal !== null) validateMaintenanceLaunchJournal(value.launchJournal, f.bound);
    return value;
  };
  const replace = async (change, baseline = null) => {
    const store = f.store(), previous = baseline ?? await store.readOperationUnderExistingOperationLock();
    return store.replaceOperationUnderExistingOperationLock({ expectedRevision: previous.revision,
      expectedDigest: previous.digest, next: { ...previous.state, revision: previous.revision + 1, ...change } });
  };
  return { ...f, replace };
}

test("all operation phase saves share the same real revision, raw-byte CAS and durable readback", async () => {
  const f = operationFixture("unknown"), before = await f.store().readOperationUnderExistingOperationLock();
  const saved = await f.replace({ phase: "failed-unknown" }, before);
  assert.equal(saved.revision, 8); assert.deepEqual(saved.state.launchJournal, before.state.launchJournal);
  assert.ok(f.events.indexOf("sync:file") < f.events.indexOf("rename"));
  assert.ok(f.events.indexOf("rename") < f.events.indexOf("sync:directory"));
  await assert.rejects(f.replace({ phase: "held" }, before), /storage_conflict$/);
  assert.equal(f.saved().phase, "failed-unknown");
});

test("one empty journal must be saved separately before planned and attempted saves", async () => {
  const f = operationFixture(), bound = f.bound;
  const empty = createMaintenanceLaunchJournal(bound), plannedJournal = planMaintenanceLaunch(empty, bound, planned());
  await assert.rejects(f.replace({ launchDisk: { path: bound.release.path }, launchJournal: plannedJournal }), /storage_invalid$/);
  assert.equal(f.events.includes("write"), false);
  const initialized = await f.replace({ launchDisk: { path: bound.release.path }, launchJournal: empty });
  const plannedState = await f.replace({ launchJournal: plannedJournal }, initialized);
  const attempted = transitionMaintenanceLaunch(plannedJournal, bound, attempt().value);
  const saved = await f.replace({ launchJournal: attempted }, plannedState);
  assert.equal(saved.revision, 10); assert.equal(saved.state.launchJournal.slots["paused-web"].phase, "attempted");
  assert.equal(f.events.filter((event) => event === "rename").length, 3);
});

test("generic operation writers cannot erase unknown slots, replace binding or change frozen release", async () => {
  for (const mutation of [
    () => ({ launchJournal: null, launchDisk: null }),
    (f) => ({ launchJournal: createMaintenanceLaunchJournal(f.bound) }),
    (f) => ({ launchJournal: planMaintenanceLaunch(createMaintenanceLaunchJournal(f.bound), f.bound, planned()) }),
    () => ({ launchDisk: { path: "/srv/replaced" } }),
    () => ({ operationId: uuid(88) }),
    () => ({ appName: "another" }),
  ]) {
    const f = operationFixture("unknown"), original = f.files.get(FILE).bytes.toString();
    await assert.rejects(f.replace(mutation(f)), safeError);
    assert.equal(f.files.get(FILE).bytes.toString(), original); assert.equal(f.events.includes("write"), false);
  }
});

test("generic state replacement rejects caller-revision jumps and captures intent before lock wait", async () => {
  for (const revision of [7, 9, "8", Number.MAX_SAFE_INTEGER]) {
    const f = operationFixture(); await assert.rejects(f.replace({ revision }), safeError);
    assert.equal(f.events.includes("write"), false);
  }
  const f = operationFixture(), store = f.store(), previous = await store.readOperationUnderExistingOperationLock();
  const next = { ...previous.state, revision: 8, phase: "failed-unknown" };
  const pending = store.replaceOperationUnderExistingOperationLock({ expectedRevision: previous.revision, expectedDigest: previous.digest, next });
  next.phase = "candidate";
  assert.equal((await pending).state.phase, "failed-unknown");
});

test("a generic write whose rename succeeds but directory fsync fails cannot return durable success", async () => {
  const f = operationFixture("attempted"), before = await f.store().readOperationUnderExistingOperationLock();
  const original = f.io.fsyncSync;
  f.io.fsyncSync = (fd) => { if (f.fds.get(fd).path === ROOT) throw new Error(SECRET); original(fd); };
  let acknowledged = 0;
  await assert.rejects(async () => { await f.replace({ phase: "failed-unknown" }, before); acknowledged++; }, safeError);
  assert.equal(acknowledged, 0); assert.equal(f.saved().revision, 8);
  assert.equal(f.saved().launchJournal.slots["paused-web"].phase, "attempted");
  await assert.rejects(f.replace({ phase: "held" }, before), /storage_conflict$/);
});

function recoveryStorageFixture() {
  const f = fixture(), bootId = "12345678-1234-1234-1234-123456789abc";
  const state = { version: 2, revision: 7, operationId: f.bound.operationId, targetSha: "a".repeat(40), expectedOldSha: "b".repeat(40),
    appDir: "/srv/faolla", appName: "faolla", appPort: 3000, bootId, createdAt: 100, phase: "failed-held",
    runtime: { frozen: true }, ingress: { original: true }, database: { id: "c".repeat(64) },
    publicSupabaseUrl: "https://faolla.com/", tokenHash: "d".repeat(64), candidate: null, resumed: null,
    launchDisk: null, launchJournal: null, finalDump: null };
  f.put(FILE, "file", JSON.stringify(state));
  // The real control validator also validates every subordinate proof. This
  // isolated store fixture focuses on durable audit/CAS and never runs control.
  f.options.captureState = value => {
    assert.equal(value.appName, "faolla"); assert.ok([2, 3].includes(value.version));
    if (value.version === 3) validateMaintenanceRecoveryState(value, { bootId, now: 200 });
    return value;
  };
  const store = f.store();
  const prepare = async () => {
    const snapshot = await store.readOperationUnderExistingOperationLock();
    const context = { operationId: state.operationId, previousTargetSha: state.targetSha, targetSha: "e".repeat(40), expectedOldSha: state.expectedOldSha,
      expectedRevision: snapshot.revision, expectedDigest: snapshot.digest, bootId, now: 200,
      sourceDiffDigest: "f".repeat(64), migrationDigest: "1".repeat(64) };
    const evidence = { ...createMaintenanceRecoveryInspection(snapshot.state, context), toolsSha: context.targetSha,
      recoveryRunId: "123", recoveryRunAttempt: 1, mainCIrunId: "124", historyDigest: "2".repeat(64), historyCheckedAt: 199 };
    const next = buildMaintenanceRecoveredState(snapshot.state, evidence, context);
    return { snapshot, next };
  };
  const replace = (snapshot, next) => store.replaceOperationUnderExistingOperationLock({ expectedRevision: snapshot.revision, expectedDigest: snapshot.digest, next });
  return { ...f, store, prepare, replace };
}

test("recovery changes only the bound target and version once with durable original snapshot CAS", async () => {
  const f = recoveryStorageFixture(), { snapshot, next } = await f.prepare();
  const saved = await f.replace(snapshot, next);
  assert.equal(saved.revision, 8); assert.deepEqual(saved.state, next);
  assert.equal(saved.state.createdAt, 100); assert.equal(saved.state.recovery.evidence.stateDigest, snapshot.digest);
  assert.ok(f.events.indexOf("sync:file") < f.events.indexOf("rename"));
  assert.ok(f.events.indexOf("rename") < f.events.indexOf("sync:directory"));
  await assert.rejects(f.replace(snapshot, next), /storage_conflict$/);
  assert.equal(f.events.filter(value => value === "rename").length, 1);
  const later = await f.replace(saved, { ...saved.state, revision: 9, phase: "failed-held", ingress: { original: true, retiringWorkers: [] } });
  assert.deepEqual(later.state.recovery, saved.state.recovery);
});

test("storage rejects altered recovery, arbitrary upgrade, audit deletion and downgrade before opening temp", async () => {
  for (const mutate of [value => { value.runtime.frozen = false; }, value => { value.createdAt++; },
    value => { value.ingress = { replaced: true }; }, value => { value.recovery.evidence.stateDigest = "3".repeat(64); },
    value => { value.phase = "candidate"; }, value => { value.revision++; }]) {
    const f = recoveryStorageFixture(), { snapshot, next } = await f.prepare(), invalid = structuredClone(next);
    mutate(invalid); await assert.rejects(f.replace(snapshot, invalid), safeError);
    assert.equal(f.events.includes("write"), false); assert.equal(f.saved().version, 2);
  }
  for (const mutate of [value => { Reflect.deleteProperty(value, "recovery"); }, value => { value.version = 2; Reflect.deleteProperty(value, "recovery"); },
    value => { value.recovery.evidence.historyDigest = "3".repeat(64); }, value => { value.targetSha = "f".repeat(40); },
    value => { value.database = { changed: true }; }, value => { value.tokenHash = "4".repeat(64); }]) {
    const f = recoveryStorageFixture(), { snapshot, next } = await f.prepare(), saved = await f.replace(snapshot, next);
    const invalid = structuredClone(saved.state); invalid.revision++; mutate(invalid); f.events.length = 0;
    await assert.rejects(f.replace(saved, invalid), safeError); assert.equal(f.events.includes("write"), false);
    assert.deepEqual(f.saved(), saved.state);
  }
});

test("ambiguous recovery rename is not replayed, and journal-only writes also enforce immutable recovery audit", async () => {
  const f = recoveryStorageFixture(), { snapshot, next } = await f.prepare();
  const sync = f.io.fsyncSync;
  f.io.fsyncSync = fd => { if (f.fds.get(fd).path === ROOT) throw new Error(SECRET); sync(fd); };
  await assert.rejects(f.replace(snapshot, next), safeError);
  assert.equal(f.saved().version, 3); assert.equal(f.saved().revision, 8);
  await assert.rejects(f.replace(snapshot, next), /storage_conflict$/);
  assert.equal(f.events.filter(value => value === "rename").length, 1);
  const source = readFileSync(new URL("./production-maintenance-launch-journal-storage.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function persist("), source.indexOf("return Object.freeze({"));
  assert.match(source, /import \{ assertMaintenanceBuildRecoveryProgress \} from "\.\/production-maintenance-build-recovery\.mjs"/);
  assert.match(body, /assertMaintenanceBuildRecoveryProgress\(previous.state, next\)/);
  assert.ok(body.indexOf("assertMaintenanceBuildRecoveryProgress(previous.state, next)") < body.indexOf("io.openSync(temporary"));
  assert.match(source, /applyUnderExistingOperationLock[\s\S]+return persist\(previous, next/);
});

function continuationStorageFixture(continuation = {}) {
  const f = fixture(), incident = MAINTENANCE_CONTINUATION_INCIDENT, bootId = f.bound.daemon.bootId;
  const now = Date.parse("2026-09-12T22:00:00.000Z"), targetSha = continuation.targetSha ?? "e".repeat(40);
  const original = { version: 2, revision: 3, operationId: incident.operationId, targetSha: incident.originalTargetSha,
    expectedOldSha: incident.expectedOldSha, appDir: "/srv/faolla", appName: "faolla", appPort: 3000, bootId,
    createdAt: incident.createdAt, phase: "failed-held", runtime: { frozen: true }, ingress: { original: true }, database: { id: "c".repeat(64) },
    publicSupabaseUrl: "https://faolla.com/", tokenHash: "d".repeat(64), candidate: null, resumed: null, launchDisk: null, launchJournal: null, finalDump: null };
  const recoveryContext = { operationId: original.operationId, previousTargetSha: original.targetSha, targetSha: incident.previousTargetSha,
    expectedOldSha: original.expectedOldSha, expectedRevision: original.revision, expectedDigest: createHash("sha256").update(JSON.stringify(original)).digest("hex"),
    bootId, now: incident.createdAt + 1000, sourceDiffDigest: "1".repeat(64), migrationDigest: "2".repeat(64) };
  const recovered = buildMaintenanceRecoveredState(original, { ...createMaintenanceRecoveryInspection(original, recoveryContext),
    toolsSha: recoveryContext.targetSha, recoveryRunId: "34715768455", recoveryRunAttempt: 1, mainCIrunId: "34715352249",
    historyDigest: "3".repeat(64), historyCheckedAt: incident.createdAt + 999 }, recoveryContext);
  f.put(FILE, "file", JSON.stringify(recovered));
  f.options.captureState = value => {
    assert.equal(value.appName, "faolla"); assert.ok([3, 4].includes(value.version));
    if (value.version === 3) validateMaintenanceRecoveryState(value, { bootId, now });
    else validateMaintenanceContinuationState(value, { bootId, now });
    return value;
  };
  const store = f.store(), bound = { ...f.bound, operationId: incident.operationId, targetSha,
    release: { ...f.bound.release, path: "/srv/faolla.releases/" + targetSha.slice(0, 12) + "-20260909120000" } };
  const prepare = async () => {
    const snapshot = await store.readOperationUnderExistingOperationLock();
    const context = { operationId: incident.operationId, previousTargetSha: incident.previousTargetSha, targetSha,
      expectedOldSha: incident.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest, bootId, now,
      sourceDiffDigest: "4".repeat(64), migrationDigest: "5".repeat(64) };
    const evidence = { ...createMaintenanceContinuationInspection(snapshot.state, context), toolsSha: targetSha,
      continuationRunId: continuation.runId ?? "34730000000", continuationRunAttempt: 1,
      mainCIrunId: continuation.mainCIrunId ?? "34729999999", historyDigest: "6".repeat(64), historyCheckedAt: now - 1 };
    return { snapshot, next: buildMaintenanceContinuedState(snapshot.state, evidence, context) };
  };
  const replace = (snapshot, next) => store.replaceOperationUnderExistingOperationLock({ expectedRevision: snapshot.revision, expectedDigest: snapshot.digest, next });
  return { ...f, store, bound, prepare, replace };
}

test("incident continuation persists one v3 to v4 CAS and both audits survive later legitimate state bookkeeping", async () => {
  const f = continuationStorageFixture(), { snapshot, next } = await f.prepare(), saved = await f.replace(snapshot, next);
  assert.equal(saved.revision, 5); assert.equal(saved.state.version, 4); assert.deepEqual(saved.state.recovery, snapshot.state.recovery);
  assert.deepEqual(saved.state.continuation, next.continuation);
  assert.equal(saved.state.createdAt, snapshot.state.createdAt);
  assert.ok(f.events.indexOf("sync:file") < f.events.indexOf("rename")); assert.ok(f.events.indexOf("rename") < f.events.indexOf("sync:directory"));
  await assert.rejects(f.replace(snapshot, next), /storage_conflict$/); assert.equal(f.events.filter(v => v === "rename").length, 1);
  const later = await f.replace(saved, { ...saved.state, revision: 6, phase: "failed-held", ingress: { original: true, retiringWorkers: [] } });
  assert.deepEqual(later.state.recovery, saved.state.recovery); assert.deepEqual(later.state.continuation, saved.state.continuation);
});
test("continuation store rejects arbitrary changes and audit loss or downgrade before opening a temporary file", async () => {
  for (const mutate of [v => { v.runtime.frozen = false; }, v => { v.createdAt++; }, v => { v.ingress = { replaced: true }; },
    v => { v.recovery.evidence.historyDigest = "a".repeat(64); }, v => { v.continuation.evidence.stateDigest = "b".repeat(64); },
    v => { v.phase = "candidate"; }, v => { v.revision++; }, v => { v.launchJournal = {}; }]) {
    const f = continuationStorageFixture(), { snapshot, next } = await f.prepare(), changed = structuredClone(next);
    mutate(changed); await assert.rejects(f.replace(snapshot, changed), safeError);
    assert.equal(f.events.includes("write"), false); assert.equal(f.saved().version, 3);
  }
  for (const mutate of [v => { Reflect.deleteProperty(v, "continuation"); }, v => { v.version = 3; Reflect.deleteProperty(v, "continuation"); },
    v => { Reflect.deleteProperty(v, "recovery"); }, v => { v.recovery.evidence.historyDigest = "a".repeat(64); },
    v => { v.continuation.evidence.migrationDigest = "b".repeat(64); }, v => { v.targetSha = "f".repeat(40); },
    v => { v.database = { changed: true }; }, v => { v.tokenHash = "c".repeat(64); }]) {
    const f = continuationStorageFixture(), { snapshot, next } = await f.prepare(), saved = await f.replace(snapshot, next);
    const changed = structuredClone(saved.state); changed.revision++; mutate(changed); f.events.length = 0;
    await assert.rejects(f.replace(saved, changed), safeError); assert.equal(f.events.includes("write"), false);
    assert.deepEqual(f.saved(), saved.state);
  }
});
test("ambiguous continuation rename never acknowledges success and cannot replay the original snapshot", async () => {
  const f = continuationStorageFixture(), { snapshot, next } = await f.prepare(), sync = f.io.fsyncSync;
  f.io.fsyncSync = fd => { if (f.fds.get(fd).path === ROOT) throw new Error(SECRET); sync(fd); };
  await assert.rejects(f.replace(snapshot, next), safeError);
  assert.equal(f.saved().version, 4); assert.equal(f.saved().revision, 5);
  await assert.rejects(f.replace(snapshot, next), /storage_conflict$/);
  assert.equal(f.events.filter(v => v === "rename").length, 1);
});
test("v4 journal initialization and ordinary apply paths retain the immutable continuation and original recovery", async () => {
  const f = continuationStorageFixture(), { snapshot, next } = await f.prepare(), saved = await f.replace(snapshot, next);
  const initialized = await f.replace(saved, { ...saved.state, revision: 6, launchDisk: { path: f.bound.release.path },
    launchJournal: createMaintenanceLaunchJournal(f.bound) });
  const plannedState = await f.store.applyUnderExistingOperationLock({ expectedRevision: initialized.revision, expectedDigest: initialized.digest,
    binding: f.bound, change: { type: "plan", value: planned() } });
  const attempted = await f.store.applyUnderExistingOperationLock({ expectedRevision: plannedState.revision, expectedDigest: plannedState.digest,
    binding: f.bound, change: attempt() });
  assert.equal(attempted.revision, 8); assert.equal(attempted.state.launchJournal.slots["paused-web"].phase, "attempted");
  assert.deepEqual(attempted.state.continuation, saved.state.continuation); assert.deepEqual(attempted.state.recovery, saved.state.recovery);
  await assert.rejects(f.replace(attempted, { ...attempted.state, revision: 9, launchDisk: null, launchJournal: null }), safeError);
});

async function buildRecoveryStorageFixture() {
  const incident = MAINTENANCE_BUILD_RECOVERY_INCIDENT, now = incident.createdAt + 8 * 3600000, targetSha = "f".repeat(40);
  const f = continuationStorageFixture({ targetSha: incident.previousTargetSha, runId: "34724808528", mainCIrunId: "34724337523" });
  const continued = await f.prepare(), initial = { ...structuredClone(continued.next), revision: 7, phase: "failed-held" };
  f.put(FILE, "file", JSON.stringify(initial)); f.events.length = 0;
  f.options.captureState = value => {
    assert.equal(value.appName, "faolla"); assert.ok([4, 5].includes(value.version));
    const validate = value.version === 4 ? validateMaintenanceContinuationState : validateMaintenanceBuildRecoveryState;
    validate(value, { bootId: initial.bootId, now }); return value;
  };
  const store = createMaintenanceLaunchJournalStorage(f.options, f.io), bound = { ...f.bound, targetSha,
    release: { ...f.bound.release, path: "/srv/faolla.releases/" + targetSha.slice(0, 12) + "-20260909120000" } };
  const prepare = async () => {
    const snapshot = await store.readOperationUnderExistingOperationLock();
    const context = { operationId: incident.operationId, previousTargetSha: incident.previousTargetSha, targetSha,
      expectedOldSha: incident.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest,
      bootId: initial.bootId, now, sourceDiffDigest: "7".repeat(64), migrationDigest: "8".repeat(64) };
    const evidence = { ...createMaintenanceBuildRecoveryInspection(snapshot.state, context), toolsSha: targetSha,
      buildRecoveryRunId: "34740000001", buildRecoveryRunAttempt: 1, mainCIrunId: "34740000000", historyDigest: "9".repeat(64), historyCheckedAt: now - 1 };
    return { snapshot, next: buildMaintenanceBuildRecoveredState(snapshot.state, evidence, context) };
  };
  const replace = (snapshot, next) => store.replaceOperationUnderExistingOperationLock({ expectedRevision: snapshot.revision, expectedDigest: snapshot.digest, next });
  return { ...f, store, bound, initial, prepare, replace };
}

test("v5 storage build-recovery audit and durability contract", { concurrency: false }, async t => {
  const seed = await buildRecoveryStorageFixture(), bytes = Buffer.from(JSON.stringify(seed.initial));
  const pin = "56d5c39c287ec24ce96fb40943d283bee19a950462e7c384934b6461b42c5ffa", originalCreateHash = crypto.createHash;
  assert.equal(MAINTENANCE_BUILD_RECOVERY_INCIDENT.stateDigest, pin);
  assert.notEqual(originalCreateHash("sha256").update(bytes).digest("hex"), pin);
  // Test-only, exact synthetic full-state bytes mapping. Never embed a private
  // state or add a production override; every other hash remains genuine SHA256.
  t.mock.method(crypto, "createHash", (algorithm, options) => {
    const result = originalCreateHash(algorithm, options), chunks = [], update = result.update.bind(result), digest = result.digest.bind(result);
    result.update = (data, encoding) => { chunks.push(Buffer.from(data, encoding)); update(data, encoding); return result; };
    result.digest = encoding => { const actual = digest(encoding);
      return algorithm === "sha256" && encoding === "hex" && Buffer.concat(chunks).equals(bytes) ? pin : actual; };
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); assert.equal(crypto.createHash, originalCreateHash);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), originalCreateHash("sha256").update(bytes).digest("hex")); });

  await t.test("exact predecessor CAS has one winner and preserves all three audits through later bookkeeping", async () => {
    const f = await buildRecoveryStorageFixture(), { snapshot, next } = await f.prepare();
    assert.equal(snapshot.digest, pin);
    const results = await Promise.allSettled([f.replace(snapshot, next), f.replace(snapshot, next)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.match(results.find(result => result.status === "rejected").reason.message, /storage_conflict$/);
    const saved = results.find(result => result.status === "fulfilled").value;
    assert.equal(saved.revision, 8); assert.equal(saved.state.version, 5); assert.deepEqual(saved.state, next);
    assert.equal(f.events.filter(event => event === "rename").length, 1);
    assert.ok(f.events.indexOf("sync:file") < f.events.indexOf("rename")); assert.ok(f.events.indexOf("rename") < f.events.indexOf("sync:directory"));
    const later = await f.replace(saved, { ...saved.state, revision: 9, phase: "failed-held", ingress: { original: true, retiringWorkers: [] } });
    for (const key of ["recovery", "continuation", "buildRecovery"]) assert.deepEqual(later.state[key], saved.state[key]);
    assert.equal(later.state.createdAt, snapshot.state.createdAt);
  });

  await t.test("simultaneous proof change is rejected before temp open, and v5 audit deletion/downgrade never writes", async () => {
    for (const mutate of [v => { v.runtime.frozen = false; }, v => { v.ingress = { replaced: true }; }, v => { v.createdAt++; },
      v => { v.buildRecovery.evidence.stateDigest = "0".repeat(64); }, v => { v.recovery.evidence.historyDigest = "0".repeat(64); },
      v => { v.continuation.evidence.historyDigest = "0".repeat(64); }, v => { v.launchJournal = {}; }]) {
      const f = await buildRecoveryStorageFixture(), { snapshot, next } = await f.prepare(), changed = structuredClone(next); mutate(changed);
      await assert.rejects(f.replace(snapshot, changed), safeError); assert.equal(f.files.has(TEMP), false); assert.equal(f.events.includes("write"), false);
      assert.deepEqual(f.saved(), snapshot.state);
    }
    for (const mutate of [v => { delete v.buildRecovery; }, v => { delete v.continuation; }, v => { delete v.recovery; },
      v => { v.version = 4; delete v.buildRecovery; }, v => { v.version = 3; delete v.buildRecovery; delete v.continuation; },
      v => { v.buildRecovery.recoveredAt++; }, v => { v.recovery.evidence.historyDigest = "0".repeat(64); },
      v => { v.continuation.evidence.migrationDigest = "0".repeat(64); }, v => { v.targetSha = "0".repeat(40); },
      v => { v.database = { changed: true }; }, v => { v.tokenHash = "0".repeat(64); }]) {
      const f = await buildRecoveryStorageFixture(), { snapshot, next } = await f.prepare(), saved = await f.replace(snapshot, next);
      const changed = structuredClone(saved.state); changed.revision++; mutate(changed); f.events.length = 0;
      await assert.rejects(f.replace(saved, changed), safeError); assert.equal(f.files.has(TEMP), false); assert.equal(f.events.includes("write"), false);
      assert.deepEqual(f.saved(), saved.state);
    }
  });

  await t.test("post-rename ambiguity produces no acknowledgement or automatic repeat, even after a fresh read", async () => {
    const f = await buildRecoveryStorageFixture(), { snapshot, next } = await f.prepare(), sync = f.io.fsyncSync; let acknowledged = 0;
    f.io.fsyncSync = fd => { if (f.fds.get(fd).path === ROOT) throw new Error(SECRET); sync(fd); };
    await assert.rejects(async () => { await f.replace(snapshot, next); acknowledged++; }, safeError);
    assert.equal(acknowledged, 0); assert.equal(f.saved().version, 5); assert.equal(f.saved().revision, 8);
    assert.equal(f.events.filter(event => event === "rename").length, 1);
    f.io.fsyncSync = sync; const fresh = await f.store.readOperationUnderExistingOperationLock();
    assert.deepEqual(fresh.state.buildRecovery, next.buildRecovery);
    await assert.rejects(f.replace(snapshot, next), /storage_conflict$/);
    await assert.rejects(f.prepare(), /maintenance_build_recovery_invalid/);
    assert.equal(f.events.filter(event => event === "rename").length, 1);
  });

  await t.test("v5 journal initialization, plan and attempted writes retain all audits and real T4", async () => {
    const f = await buildRecoveryStorageFixture(), { snapshot, next } = await f.prepare(), saved = await f.replace(snapshot, next);
    const initialized = await f.replace(saved, { ...saved.state, revision: 9, launchDisk: { path: f.bound.release.path },
      launchJournal: createMaintenanceLaunchJournal(f.bound) });
    const plannedState = await f.store.applyUnderExistingOperationLock({ expectedRevision: initialized.revision, expectedDigest: initialized.digest,
      binding: f.bound, change: { type: "plan", value: planned() } });
    const attempted = await f.store.applyUnderExistingOperationLock({ expectedRevision: plannedState.revision, expectedDigest: plannedState.digest,
      binding: f.bound, change: attempt() });
    assert.equal(attempted.revision, 11); assert.equal(attempted.state.launchJournal.slots["paused-web"].phase, "attempted");
    assert.equal(attempted.state.launchJournal.targetSha, f.bound.targetSha); assert.equal(attempted.state.targetSha, f.bound.targetSha);
    for (const key of ["recovery", "continuation", "buildRecovery"]) assert.deepEqual(attempted.state[key], saved.state[key]);
    await assert.rejects(f.replace(attempted, { ...attempted.state, revision: 12, launchDisk: null, launchJournal: null }), safeError);
  });

  await t.test("changed predecessor compact bytes fail the fixed production pin, with zero file writes", async () => {
    const f = await buildRecoveryStorageFixture(), changed = structuredClone(f.initial); changed.runtime.extra = true;
    f.put(FILE, "file", JSON.stringify(changed));
    const current = await f.store.readOperationUnderExistingOperationLock(); assert.notEqual(current.digest, pin);
    assert.equal(current.digest, originalCreateHash("sha256").update(JSON.stringify(changed)).digest("hex"));
    await assert.rejects(f.prepare(), /maintenance_build_recovery_invalid/); assert.equal(f.events.includes("write"), false);
  });
});
