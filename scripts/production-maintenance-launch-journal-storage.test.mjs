import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { constants, readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch, validateMaintenanceLaunchJournal } from "./production-maintenance-launch-journal.mjs";
import { createMaintenanceLaunchJournalStorage } from "./production-maintenance-launch-journal-storage.mjs";

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
  const initial = { version: 1, operationId: bound.operationId, targetSha: bound.targetSha, revision: 7, launchJournal: journal };
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
    assert.equal(value.version, 1); assert.equal(value.operationId, expected.operationId); assert.equal(value.targetSha, expected.targetSha); return value;
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
