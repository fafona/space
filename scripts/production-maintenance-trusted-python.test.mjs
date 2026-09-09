import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captureTrustedPython, isTrustedPythonTarget, verifyTrustedPython } from "./production-maintenance-trusted-python.mjs";

const ENTRY = "/usr/bin/python3";
const ERROR = "maintenance_trusted_python_unverified";
const FIELDS = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"];
function info(type, ino, changes = {}) {
  const values = { dev: 1, ino, size: type === "file" ? 4096 : 20, mtimeNs: 123456789,
    ctimeNs: 223456789, nlink: type === "directory" ? 2 : 1, uid: 0,
    mode: { file: 0o100755, symlink: 0o120777, directory: 0o040755, other: 0o010600 }[type], ...changes };
  return { identity: FIELDS.map((key) => String(values[key])).join(":"), uid: values.uid, mode: values.mode,
    size: values.size, nlink: values.nlink, type };
}
function fixture(target = "/usr/bin/python3.12") {
  const files = new Map([...["/", "/usr", "/usr/bin"].map((path, i) => [path, info("directory", i + 1)]),
    [ENTRY, info(target === ENTRY ? "file" : "symlink", 4)], [target, info("file", 5)]]);
  const calls = [], reads = new Map();
  const state = { files, calls, reads, target, beforeRead: null, canonicalOverride: null };
  state.d = {
    pathInfo(path) {
      calls.push(path); reads.set(path, (reads.get(path) ?? 0) + 1);
      state.beforeRead?.(path, reads.get(path));
      if (!files.has(path)) throw new Error("private-secret-unreadable");
      return files.get(path);
    },
    canonical(path) { return state.canonicalOverride?.(path) ?? (path === ENTRY ? state.target : path); },
  };
  return state;
}
function rejects(fn) {
  assert.throws(fn, (error) => error instanceof Error && error.message === ERROR && error.cause === undefined);
}
const clone = (value) => JSON.parse(JSON.stringify(value));

test("static target allowlist is exact, pure, and keeps future /usr/local layouts rejected", () => {
  for (const target of [ENTRY, `${ENTRY}.0`, `${ENTRY}.9`, `${ENTRY}.9999`]) assert.equal(isTrustedPythonTarget(target), true);
  for (const target of [null, {}, new String(ENTRY), `${ENTRY}.01`, `${ENTRY}.10000`, `${ENTRY}.1.2`, `${ENTRY}.`,
    `${ENTRY}\n`, `${ENTRY}\r`, `${ENTRY}\0`, "/usr/bin/../bin/python3.12", "/usr/local/bin/python3.12", "/usr/bin/python3.12/", "x".repeat(100000)]) {
    assert.equal(isTrustedPythonTarget(target), false);
  }
});

test("capture returns a bounded frozen private version 1 proof and verify freshly recaptures", () => {
  const f = fixture(), proof = captureTrustedPython(f.d), count = f.calls.length;
  assert.equal(proof.version, 1); assert.equal(proof.target.path, f.target);
  assert.deepEqual(proof.entryDirectories.map((item) => item.path), ["/", "/usr", "/usr/bin"]);
  assert.deepEqual(proof.targetDirectories, proof.entryDirectories);
  assert.ok(JSON.stringify(proof).length < 4096);
  for (const value of [proof, proof.entry, proof.target, proof.entryDirectories, proof.targetDirectories,
    ...proof.entryDirectories, ...proof.targetDirectories]) assert.equal(Object.isFrozen(value), true);
  assert.equal(verifyTrustedPython(clone(proof), f.d), true);
  assert.ok(f.calls.length > count);
  assert.ok(f.calls.every((path) => ["/", "/usr", "/usr/bin", ENTRY, f.target].includes(path)));
});

test("ordinary fixed entry and canonical version boundary targets are supported", () => {
  for (const target of [ENTRY, `${ENTRY}.0`, `${ENTRY}.9999`]) {
    const f = fixture(target), proof = captureTrustedPython(f.d);
    assert.equal(proof.target.path, target);
    assert.equal(proof.entry.type, target === ENTRY ? "file" : "symlink");
    assert.equal(verifyTrustedPython(proof, f.d), true);
  }
});

test("unapproved canonical targets are rejected before probing their metadata", () => {
  for (const path of ["/usr/local/bin/python3.12", "/opt/python3.12", `${ENTRY}.01`, `${ENTRY}.10000`, `${ENTRY}\n`]) {
    const f = fixture(); f.target = path;
    rejects(() => captureTrustedPython(f.d)); assert.equal(f.calls.includes(path), false);
  }
});

test("every directory must be canonical, root owned, a real directory, and not writable", () => {
  for (const path of ["/", "/usr", "/usr/bin"]) {
    for (const bad of [info("symlink", 9), info("file", 9), info("directory", 9, { uid: 1000 }),
      info("directory", 9, { mode: 0o040775 }), info("directory", 9, { mode: 0o040757 }), null]) {
      const f = fixture(); f.files.set(path, bad); rejects(() => captureTrustedPython(f.d));
    }
    const f = fixture(); f.canonicalOverride = (input) => input === path ? "/untrusted-alias" : undefined;
    rejects(() => captureTrustedPython(f.d));
  }
});

test("entry cannot be missing, non-root, FIFO, directory, or an unreadable source", () => {
  for (const bad of [null, info("symlink", 4, { uid: 1000 }), info("other", 4), info("directory", 4)]) {
    const f = fixture(); f.files.set(ENTRY, bad); rejects(() => captureTrustedPython(f.d));
  }
  const f = fixture(); f.files.delete(ENTRY); rejects(() => captureTrustedPython(f.d));
});

test("target requires regular single-link controlled executable with bounded size", () => {
  for (const bad of [info("symlink", 5), info("directory", 5), info("other", 5), info("file", 5, { uid: 1000 }),
    info("file", 5, { nlink: 2 }), info("file", 5, { nlink: 0 }), info("file", 5, { mode: 0o100775 }),
    info("file", 5, { mode: 0o100757 }), info("file", 5, { mode: 0o100644 }), info("file", 5, { size: 0 }),
    info("file", 5, { size: 67108865 }), null]) {
    const f = fixture(); f.files.set(f.target, bad); rejects(() => captureTrustedPython(f.d));
  }
  for (const size of [1, 67108864]) {
    const f = fixture(); f.files.set(f.target, info("file", 5, { size })); assert.ok(captureTrustedPython(f.d));
  }
  const f = fixture(); f.canonicalOverride = (path) => path === f.target ? "/untrusted-target" : undefined;
  rejects(() => captureTrustedPython(f.d));
});

test("each of the eight identity fields is captured and compared, not only inode", () => {
  for (const field of FIELDS) {
    const f = fixture(), proof = captureTrustedPython(f.d);
    const parts = f.files.get(f.target).identity.split(":"), i = FIELDS.indexOf(field);
    const changes = { [field]: Number(parts[i]) + 1 };
    f.files.set(f.target, info("file", 5, changes));
    rejects(() => verifyTrustedPython(proof, f.d));
  }
});

test("entry, target and either directory chain drift invalidate the complete capture", () => {
  for (const path of [ENTRY, "/usr/bin/python3.12", "/", "/usr", "/usr/bin"]) {
    const f = fixture();
    f.beforeRead = (input, n) => {
      if (input === path && n === 2) {
        const old = f.files.get(path); f.files.set(path, info(old.type, 999));
      }
    };
    rejects(() => captureTrustedPython(f.d));
  }
  const f = fixture(); let seen = 0;
  f.canonicalOverride = (path) => path === ENTRY && ++seen > 1 ? `${ENTRY}.13` : undefined;
  rejects(() => captureTrustedPython(f.d));
});

test("metadata must match the exact eight-field identity, including type bits", () => {
  const variants = ["1:2:3", "1:02:3:4:5:1:0:33261", "-1:2:3:4:5:1:0:33261", "1:2:3:-0:5:1:0:33261",
    "1:2:3:4:5:1:0:65536", "1:2:3:4:5:1:4294967296:33261", "9".repeat(1000), "raw-secret"];
  for (const identity of variants) {
    const f = fixture(); f.files.set(f.target, { ...f.files.get(f.target), identity }); rejects(() => captureTrustedPython(f.d));
  }
  for (const changes of [{ uid: 1 }, { size: 0 }, { nlink: 2 }, { mode: 0o100777 }, { type: "directory" }, { raw: "secret" }]) {
    const f = fixture(); f.files.set(f.target, { ...f.files.get(f.target), ...changes }); rejects(() => captureTrustedPython(f.d));
  }
});

test("malformed or foreign proofs fail before any filesystem lookup", () => {
  const good = captureTrustedPython(fixture().d);
  const variants = [null, [], { ...good, version: 2 }, { ...good, raw: "secret" }, { ...good, executable: "/arbitrary" }];
  for (const alter of [(p) => { p.entry.path = "/arbitrary"; }, (p) => { p.target.path = "/usr/local/bin/python3.12"; },
    (p) => { p.target.identity = "secret"; }, (p) => { p.entryDirectories[0].path = "/tmp"; },
    (p) => { p.targetDirectories.pop(); }, (p) => { p.entryDirectories[0].raw = "secret"; },
    (p) => { p.targetDirectories[1].identity = info("directory", 999).identity; },
    (p) => { p.entryDirectories[0] = p.entryDirectories[1]; },
    (p) => { p.entry.type = "file"; p.entry.identity = p.target.identity; }]) {
    const p = clone(good); alter(p); variants.push(p);
  }
  for (const proof of variants) {
    let calls = 0;
    rejects(() => verifyTrustedPython(proof, { pathInfo() { calls++; throw new Error("private"); }, canonical() { calls++; } }));
    assert.equal(calls, 0);
  }
});

test("proof rejects getters, proxies, symbols, hidden fields and sparse/custom arrays without invoking traps", () => {
  const good = captureTrustedPython(fixture().d); let traps = 0;
  const proxy = (value) => new Proxy(value, { ownKeys() { traps++; throw new Error("secret"); }, get() { traps++; } });
  const variants = [proxy(good), { ...good, target: proxy(good.target) }, { ...good, entryDirectories: proxy(good.entryDirectories) }];
  for (const alter of [(p) => Object.defineProperty(p.target, "path", { enumerable: true, get() { traps++; return ENTRY; } }),
    (p) => Object.defineProperty(p, "hidden", { value: "secret" }), (p) => { p[Symbol("secret")] = 1; },
    (p) => { delete p.entryDirectories[1]; }, (p) => { p.entryDirectories.extra = "secret"; },
    (p) => { Object.setPrototypeOf(p, { attacker: true }); },
    (p) => { Object.setPrototypeOf(p.targetDirectories, null); },
    (p) => Object.defineProperty(p.entryDirectories, "0", { enumerable: true, get() { traps++; } })]) {
    const p = clone(good); alter(p); variants.push(p);
  }
  for (const p of variants) rejects(() => verifyTrustedPython(p, fixture().d));
  assert.equal(traps, 0);
});

test("DI is metadata-only, does not invoke getters/proxies, and never leaks raw exceptions", () => {
  let invoked = 0;
  const variants = [{ run() { invoked++; } }, { executable: "/usr/local/bin/python3" },
    Object.defineProperty({}, "pathInfo", { enumerable: true, get() { invoked++; } }),
    new Proxy({}, { ownKeys() { invoked++; throw new Error("private-secret"); } }),
    { pathInfo: new Proxy(() => {}, { apply() { invoked++; } }) }];
  for (const d of variants) rejects(() => captureTrustedPython(d));
  assert.equal(invoked, 0);
  for (const key of ["pathInfo", "canonical"]) {
    const f = fixture(); f.d[key] = () => { throw new Error("private-password-and-path"); };
    rejects(() => captureTrustedPython(f.d));
  }
  const f = fixture(); f.files.set(f.target, new Proxy({}, { get() { invoked++; } }));
  rejects(() => captureTrustedPython(f.d)); assert.equal(invoked, 0);
  const typed = fixture();
  typed.files.set(typed.target, { ...typed.files.get(typed.target), type: { [Symbol.toPrimitive]() { invoked++; return "file"; } } });
  rejects(() => captureTrustedPython(typed.d)); assert.equal(invoked, 0);
});

test("source is import-inert metadata only: no subprocess, environment, file reads or PM2 operations", () => {
  const source = readFileSync(new URL("./production-maintenance-trusted-python.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:(?:child_process|net|http|https)|process\.env|readFile|openSync|execFile|spawnSync|import\s*\(/);
  assert.match(source, /import \{ lstatSync, realpathSync \} from "node:fs"/);
  assert.match(source, /const expected = captureProof\(proof\);/);
  assert.doesNotMatch(source, /d\.(?:pathInfo|canonical)\(proof\./);
});
