import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { captureNativeProcessProof, validateNativeProcessProof, verifyNativeProcessProof, verifyNativeFiles } from "./production-maintenance-native-proof.mjs";

const ERROR = "production_maintenance_native_unverified";
const BOOT = "12345678-1234-1234-1234-123456789abc";
const runtime = "/srv/faolla.releases/aaaaaaaaaaaa-20260910000000";
const FIELDS = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safeFailure = (error) => error instanceof Error && error.message === ERROR && error.cause === undefined;
function fixture(kind = "root_pair", direction = "platform", architecture = "x64") {
  const c = { runtime, owner: 1000, architecture }, files = new Map(), aliases = new Map();
  let inode = 10;
  function metadata(type, changes = {}) {
    const stat = { dev: 1, ino: ++inode, size: type === "directory" ? 4096 : 32, mtimeNs: 4, ctimeNs: 5,
      nlink: type === "directory" ? 2 : 1, uid: 0, mode: type === "directory" ? 0o040755 : type === "symlink" ? 0o120777 : 0o100755, ...changes };
    return { identity: FIELDS.map((field) => String(stat[field])).join(":"), uid: stat.uid, mode: stat.mode,
      size: stat.size, nlink: stat.nlink, type };
  }
  function put(path, type = "directory", changes = {}, content = "") {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (path !== "/" && !files.has(parent)) put(parent);
    const info = metadata(type, changes); files.set(path, { info, bytes: Buffer.from(content) }); return info;
  }
  function change(path, patch) {
    const row = files.get(path), parts = row.info.identity.split(":"), fields = Object.fromEntries(FIELDS.map((key, i) => [key, Number(parts[i])]));
    row.info = metadata(patch.type ?? row.info.type, { ...fields, ...patch });
  }
  function content(path, value) {
    const bytes = Buffer.from(value); files.get(path).bytes = bytes; change(path, { size: bytes.length });
  }
  const modules = runtime + "/node_modules", nested = modules + "/tsx/node_modules";
  const name = `@esbuild/linux-${architecture}`, platform = (kind.startsWith("nested") ? nested : modules) + "/" + name;
  const wrapper = (kind.startsWith("root") ? modules : nested) + "/esbuild", pair = kind.endsWith("pair");
  const binary = put(platform + "/bin/esbuild", "file", { ino: 500, uid: 1000, nlink: pair ? 2 : 1 });
  if (pair) put(wrapper + "/bin/esbuild", "file", { ino: 500, uid: 1000, nlink: 2 });
  const platformPackage = JSON.stringify({ name, version: "0.27.3", os: ["linux"] });
  put(platform + "/package.json", "file", { size: Buffer.byteLength(platformPackage), mode: 0o100644 }, platformPackage);
  if (pair) {
    const wrapperPackage = JSON.stringify({ name: "esbuild", version: "0.27.3", optionalDependencies: { [name]: "0.27.3" } });
    put(wrapper + "/package.json", "file", { size: Buffer.byteLength(wrapperPackage), mode: 0o100644 }, wrapperPackage);
  }
  const executable = (direction === "wrapper" ? wrapper : platform) + "/bin/esbuild";
  const commandLine = [executable, "--service=0.27.3", "--ping"];
  const fact = { pid: 301, parentPid: 300, startTicks: "123456", processIdentity: metadata("directory", { uid: c.owner }).identity,
    uid: c.owner, cwd: runtime, cwdIdentity: files.get(runtime).info.identity, executable,
    executableIdentity: binary.identity, commandLine, commandLineDigest: hash(Buffer.from(commandLine.join("\0") + "\0")) };
  const state = { c, files, aliases, fact, platform, wrapper, name, put, change, content, boot: BOOT,
    reads: [], packageReads: [], processReads: 0, bootReads: 0, beforePath: null, afterPackage: null, beforeProcess: null };
  state.d = {
    pathInfo(path) { state.reads.push(path); state.beforePath?.(path); return files.has(path) ? structuredClone(files.get(path).info) : null; },
    canonical(path) { return aliases.get(path) ?? path; },
    readRegular(path, limit, info) {
      assert.equal(limit, 8192); assert.ok(path.endsWith("/package.json")); state.packageReads.push(path);
      assert.deepEqual(files.get(path).info, info); const bytes = Buffer.from(files.get(path).bytes);
      state.afterPackage?.(path); return { bytes };
    },
    readProcess(pid) { state.processReads++; assert.equal(pid, 301); state.beforeProcess?.(); return structuredClone(fact); },
    boot() { state.bootReads++; return state.boot; },
  };
  state.input = () => ({ fact: structuredClone(fact), ...c });
  return state;
}

test("fixed single platform layouts capture full private generations and verify live and files", async () => {
  for (const kind of ["root_single", "nested_single"]) for (const arch of ["x64", "arm64"]) {
    const f = fixture(kind, "platform", arch), p = await captureNativeProcessProof(f.input(), f.d);
    assert.equal(p.layout, kind); assert.deepEqual(p.process, f.fact); assert.equal(p.bootId, BOOT);
    assert.equal(p.binaries.length, 1); assert.equal(p.packages.length, 1);
    assert.equal(p.packages[0].sha256, hash(f.files.get(f.platform + "/package.json").bytes));
    assert.deepEqual(validateNativeProcessProof(p, f.c), p);
    assert.equal(await verifyNativeProcessProof(p, f.c, f.d), true);
    assert.equal(await verifyNativeFiles(p, f.c, f.d), true);
    assert.ok(Object.isFrozen(p.process.commandLine)); assert.ok(Object.isFrozen(p.directories[0]));
    assert.ok(Buffer.byteLength(JSON.stringify(p)) < 65536);
  }
});

test("all three exact hardlink pairs work in both executable directions", async () => {
  for (const kind of ["root_pair", "nested_pair", "hoisted_pair"]) for (const direction of ["platform", "wrapper"]) {
    const f = fixture(kind, direction), p = await captureNativeProcessProof(f.input(), f.d);
    assert.equal(p.layout, kind); assert.equal(p.binaries.length, 2); assert.equal(p.packages.length, 2);
    assert.equal(p.binaries[0].identity, p.binaries[1].identity);
    assert.equal(p.packages[1].platformDependency, p.packages[0].version);
    assert.equal(await verifyNativeProcessProof(p, f.c, f.d), true);
  }
});

test("unknown executable or single wrapper never triggers arbitrary-path or package reads", async () => {
  for (const executable of ["/tmp/esbuild", runtime + "/node_modules/unknown/bin/esbuild", runtime + "/node_modules/esbuild/bin/esbuild"]) {
    const f = fixture("root_single"); f.fact.executable = executable; f.fact.commandLine[0] = executable;
    f.fact.commandLineDigest = hash(Buffer.from(f.fact.commandLine.join("\0") + "\0"));
    await assert.rejects(captureNativeProcessProof(f.input(), f.d), safeFailure);
    assert.equal(f.packageReads.length, 0);
    if (executable.startsWith("/tmp/")) assert.equal(f.reads.length, 0);
  }
});

test("full process generation, owner, runtime and exact argv are mandatory", async () => {
  for (const field of ["pid", "parentPid", "startTicks", "processIdentity", "uid", "cwd", "cwdIdentity", "executable", "executableIdentity", "commandLine", "commandLineDigest"]) {
    const f = fixture(), input = f.input(); delete input.fact[field];
    await assert.rejects(captureNativeProcessProof(input, f.d), safeFailure); assert.equal(f.reads.length, 0);
  }
  for (const alter of [(f) => { f.fact.uid = 99; }, (f) => { f.fact.cwd = "/srv/other"; },
    (f) => { f.fact.commandLine[2] = "--other"; }, (f) => { f.fact.commandLineDigest = "a".repeat(64); },
    (f) => { f.fact.commandLine[1] = "--service=0.27.03"; }, (f) => { f.fact.parentPid = f.fact.pid; }]) {
    const f = fixture(); alter(f); await assert.rejects(captureNativeProcessProof(f.input(), f.d), safeFailure); assert.equal(f.reads.length, 0);
  }
});

test("unsafe ancestors and binary attributes reject without package reads", async () => {
  for (const [pathKind, patch] of [["directory", { mode: 0o040775 }], ["directory", { uid: 99 }],
    ["binary", { uid: 99 }], ["binary", { nlink: 3 }], ["binary", { mode: 0o100777 }],
    ["binary", { mode: 0o100644 }], ["binary", { size: 0 }], ["binary", { size: 67108865 }], ["binary", { type: "symlink", mode: 0o120777 }]]) {
    const f = fixture(), path = pathKind === "directory" ? f.platform + "/bin" : f.fact.executable;
    f.change(path, patch);
    if (pathKind === "binary") f.fact.executableIdentity = f.files.get(path).info.identity;
    await assert.rejects(captureNativeProcessProof(f.input(), f.d), safeFailure); assert.equal(f.packageReads.length, 0);
  }
});

test("a pair must exist, share the entire identity and have exactly two links", async () => {
  for (const change of [(f) => { f.files.delete(f.wrapper + "/bin/esbuild"); },
    (f) => f.change(f.wrapper + "/bin/esbuild", { ino: 999 }),
    (f) => f.change(f.wrapper + "/bin/esbuild", { nlink: 1 }),
    (f) => f.change(f.wrapper + "/bin/esbuild", { mtimeNs: 9 }),
    (f) => f.aliases.set(f.wrapper + "/bin/esbuild", "/untrusted")]) {
    const f = fixture(); change(f); await assert.rejects(captureNativeProcessProof(f.input(), f.d), safeFailure);
    assert.equal(f.packageReads.length, 0);
  }
});

test("hoisted selection cannot be confused with a different or multiple matching wrapper", async () => {
  const f = fixture("hoisted_pair"), path = runtime + "/node_modules/esbuild/bin/esbuild";
  f.put(path, "file", { ino: 999, uid: 1000, nlink: 2 });
  assert.equal((await captureNativeProcessProof(f.input(), f.d)).layout, "hoisted_pair");
  f.files.get(path).info = structuredClone(f.files.get(f.fact.executable).info); f.packageReads.length = 0;
  await assert.rejects(captureNativeProcessProof(f.input(), f.d), safeFailure); assert.equal(f.packageReads.length, 0);
});

test("package bytes are bounded, unique JSON and bind both names, versions and exact optional dependency", async () => {
  for (const content of ["not json", "null", "[]", '{"name":"esbuild","name":"esbuild","version":"0.27.3"}',
    JSON.stringify({ name: "esbuild", version: "0.27.4", optionalDependencies: { "@esbuild/linux-x64": "0.27.4" } }),
    JSON.stringify({ name: "esbuild", version: "0.27.3", optionalDependencies: { "@esbuild/linux-x64": "^0.27.3" } }),
    JSON.stringify({ name: "esbuild", version: "0.27.3" }), " ".repeat(8193)]) {
    const f = fixture(); f.content(f.wrapper + "/package.json", content);
    await assert.rejects(captureNativeProcessProof(f.input(), f.d), safeFailure);
  }
  for (const patch of [{ nlink: 2 }, { uid: 99 }, { mode: 0o100666 }]) {
    const f = fixture(); f.change(f.platform + "/package.json", patch);
    await assert.rejects(captureNativeProcessProof(f.input(), f.d), safeFailure);
  }
});

test("live verification rejects replacement of every process generation field and boot", async () => {
  for (const change of [(f) => { f.fact.startTicks = "999"; }, (f) => { f.fact.parentPid++; },
    (f) => { f.fact.processIdentity = f.fact.processIdentity.replace(":4:5:", ":6:7:"); },
    (f) => { f.fact.commandLineDigest = "f".repeat(64); }, (f) => { f.boot = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; }]) {
    const f = fixture(), proof = await captureNativeProcessProof(f.input(), f.d); change(f);
    await assert.rejects(verifyNativeProcessProof(proof, f.c, f.d), safeFailure);
  }
});

test("files-only verification never reads boot or a process, and is not a stop acknowledgement", async () => {
  const f = fixture(), proof = await captureNativeProcessProof(f.input(), f.d);
  const reads = f.processReads, boots = f.bootReads;
  f.d.readProcess = () => assert.fail("no process read after stop"); f.d.boot = () => assert.fail("no boot read after stop");
  assert.equal(await verifyNativeFiles(proof, f.c, f.d), true);
  assert.equal(f.processReads, reads); assert.equal(f.bootReads, boots);
  f.change(f.wrapper + "/bin/esbuild", { ino: 999 });
  await assert.rejects(verifyNativeFiles(proof, f.c, f.d), safeFailure);
});

test("valid file, directory and package replacement or digest change invalidate prior proof", async () => {
  for (const part of ["binary", "wrapper", "directory", "platform_package", "wrapper_package", "digest"]) {
    const f = fixture(), proof = await captureNativeProcessProof(f.input(), f.d);
    const path = part === "binary" ? f.fact.executable : part === "wrapper" ? f.wrapper + "/bin/esbuild" :
      part === "directory" ? runtime : ["platform_package", "digest"].includes(part) ? f.platform + "/package.json" : f.wrapper + "/package.json";
    if (part === "digest") {
      // Same stat and parsed selected metadata still must not hide byte changes.
      const row = f.files.get(path); row.bytes = Buffer.from(row.bytes.toString().replace('"linux"', '"LINUX"'));
      assert.equal(row.bytes.length, row.info.size);
    } else f.change(path, { ino: 999 });
    await assert.rejects(verifyNativeFiles(proof, f.c, f.d), safeFailure);
  }
});

test("capture observes files and live generation twice and rejects changes inside either phase", async () => {
  for (const kind of ["binary", "directory", "package", "process", "boot"]) {
    const f = fixture(); let changed = false;
    f.afterPackage = () => {
      if (changed) return; changed = true;
      if (kind === "process") f.fact.startTicks = "777";
      else if (kind === "boot") f.boot = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      else f.change(kind === "binary" ? f.fact.executable : kind === "directory" ? runtime : f.platform + "/package.json", { ino: 999 });
    };
    await assert.rejects(captureNativeProcessProof(f.input(), f.d), safeFailure); assert.equal(changed, true);
  }
});

test("malformed and foreign proofs are rejected before any filesystem or process lookup", async () => {
  const f = fixture(), proof = await captureNativeProcessProof(f.input(), f.d);
  const variants = [null, { ...proof, extra: "secret" }];
  for (const alter of [(p) => { p.version = 2; }, (p) => { p.context.runtime = "/other"; },
    (p) => { p.layout = "other"; }, (p) => { p.binaries[0].path = "/tmp/esbuild"; },
    (p) => { p.packages[0].path = "/etc/shadow"; }, (p) => { p.packages[1].platformDependency = "*"; },
    (p) => { p.packages[1].sha256 = "secret"; }, (p) => { p.directories.reverse(); },
    (p) => { p.bootId = "bad"; }, (p) => { p.process.commandLine.push("--other"); }]) {
    const p = structuredClone(proof); alter(p); variants.push(p);
  }
  let calls = 0; const forbidden = () => { calls++; throw new Error("secret"); };
  const d = { pathInfo: forbidden, canonical: forbidden, readRegular: forbidden, readProcess: forbidden, boot: forbidden };
  for (const p of variants) {
    assert.throws(() => validateNativeProcessProof(p, f.c), safeFailure);
    await assert.rejects(verifyNativeProcessProof(p, f.c, d), safeFailure);
    await assert.rejects(verifyNativeFiles(p, f.c, d), safeFailure);
  }
  assert.equal(calls, 0);
});

test("accessors proxies hidden keys sparse arrays and coercion never run", async () => {
  const f = fixture(), proof = await captureNativeProcessProof(f.input(), f.d); let calls = 0;
  const variants = [new Proxy(proof, { ownKeys() { calls++; } })];
  for (const alter of [(p) => Object.defineProperty(p.process, "pid", { enumerable: true, get() { calls++; return 301; } }),
    (p) => { p.directories = new Proxy(p.directories, { get() { calls++; } }); },
    (p) => { p.packages[0].name = { toString() { calls++; return "@esbuild/linux-x64"; } }; },
    (p) => { delete p.binaries[0]; }, (p) => Object.defineProperty(p, "hidden", { value: 1 }),
    (p) => { p[Symbol("raw")] = true; }]) { const p = structuredClone(proof); alter(p); variants.push(p); }
  for (const p of variants) assert.throws(() => validateNativeProcessProof(p, f.c), safeFailure);
  await assert.rejects(captureNativeProcessProof(f.input(), { get pathInfo() { calls++; return f.d.pathInfo; } }), safeFailure);
  assert.equal(calls, 0);
});

test("captured input cannot be altered while the first process observation awaits", async () => {
  const f = fixture(), input = f.input(); const original = f.d.readProcess; let release;
  f.d.readProcess = async (pid) => { if (!release) await new Promise((resolve) => { release = resolve; }); return original(pid); };
  const pending = captureNativeProcessProof(input, f.d);
  input.fact.commandLine[0] = "/arbitrary"; input.runtime = "/arbitrary"; release();
  assert.equal((await pending).context.runtime, runtime);
});

test("exceptions are fixed and the module has no execution or termination capability", async () => {
  for (const key of ["pathInfo", "canonical", "readRegular", "readProcess", "boot"]) {
    const f = fixture(); f.d[key] = () => { throw new Error("private-path-and-password"); };
    await assert.rejects(captureNativeProcessProof(f.input(), f.d), safeFailure);
  }
  const source = readFileSync(new URL("./production-maintenance-native-proof.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:(?:child_process|net|http|https)|\b(?:kill|spawn|exec|fetch|unlink|writeFile|mkdir)\s*\(/);
  assert.match(source, /verifyFiles deliberately proves only files/);
  assert.match(source, /O_NOFOLLOW \| constants\.O_NONBLOCK/);
});

test("Linux real hardlinks and secure package fd reads reject a third link", { skip: process.platform !== "linux" }, async () => {
  const scripts = dirname(fileURLToPath(import.meta.url));
  for (const kind of ["root_pair", "nested_pair", "hoisted_pair"]) {
    const directory = mkdtempSync(join(scripts, ".native-proof-fs-"));
    try {
      const c = { runtime: directory, owner: process.getuid(), architecture: "x64" };
      const modules = join(directory, "node_modules"), nested = join(modules, "tsx/node_modules");
      const platform = join(kind === "nested_pair" ? nested : modules, "@esbuild/linux-x64");
      const wrapper = join(kind === "root_pair" ? modules : nested, "esbuild");
      mkdirSync(join(platform, "bin"), { recursive: true, mode: 0o755 });
      mkdirSync(join(wrapper, "bin"), { recursive: true, mode: 0o755 });
      const executable = join(platform, "bin/esbuild"), peer = join(wrapper, "bin/esbuild");
      writeFileSync(executable, "synthetic bytes; NEVER EXECUTE\n", { mode: 0o755 }); linkSync(executable, peer);
      writeFileSync(join(platform, "package.json"), JSON.stringify({ name: "@esbuild/linux-x64", version: "0.27.3" }), { mode: 0o644 });
      writeFileSync(join(wrapper, "package.json"), JSON.stringify({ name: "esbuild", version: "0.27.3",
        optionalDependencies: { "@esbuild/linux-x64": "0.27.3" } }), { mode: 0o644 });
      const readIdentity = (path) => { const stat = lstatSync(path, { bigint: true }); return FIELDS.map((key) => String(stat[key])).join(":"); };
      assert.equal(lstatSync(executable).nlink, 2); assert.equal(readIdentity(executable), readIdentity(peer));
      const commandLine = [executable, "--service=0.27.3", "--ping"];
      const current = { pid: 301, parentPid: 300, startTicks: "123456", processIdentity: readIdentity(directory), uid: c.owner,
        cwd: directory, cwdIdentity: readIdentity(directory), executable, executableIdentity: readIdentity(executable), commandLine,
        commandLineDigest: hash(Buffer.from(commandLine.join("\0") + "\0")) };
      // Only /proc is synthetic. Files use the actual default Linux lstat,
      // canonical paths, O_NOFOLLOW descriptors and pre/post package identities.
      const d = { readProcess: () => structuredClone(current), boot: () => BOOT };
      const proof = await captureNativeProcessProof({ fact: current, ...c }, d);
      assert.equal(proof.layout, kind); assert.equal(await verifyNativeFiles(proof, c), true);
      linkSync(executable, join(directory, "third-link"));
      await assert.rejects(verifyNativeFiles(proof, c), safeFailure);
    } finally {
      assert.equal(dirname(resolve(directory)), scripts); assert.ok(basename(directory).startsWith(".native-proof-fs-"));
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
