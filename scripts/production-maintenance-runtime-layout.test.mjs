import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyPythonLayout, emptyNativeFileLinkEvidence, validatePythonLayout, validateNativeFileLinkEvidence,
  observePythonLayout, observeNativeFileLink } from "./production-maintenance-runtime-layout.mjs";

const SECRET = "LAYOUT_PRIVATE_DATA_NEVER_PUBLIC";
const DRIFT = Symbol("drift");
const runtime = "/srv/faolla.releases/aaaaaaaaaaaa-20260909120000";
const platformName = "@esbuild/linux-x64";
function fixture(pair = "root", direction = "platform") {
  const paths = new Map(); const aliases = new Map(); const reads = []; const regularReads = []; let inode = 100;
  const put = (path, type = "directory", changes = {}) => {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (path !== "/" && !paths.has(parent)) put(parent);
    const info = { type, uid: 0, mode: type === "directory" ? 0o40755 : 0o100755, size: 32, nlink: 1,
      identity: `1:${++inode}:32:4:5:1:0:33261`, ...changes };
    paths.set(path, { info, content: "" }); return info;
  };
  const modules = runtime + "/node_modules"; const nested = modules + "/tsx/node_modules";
  const platform = (pair === "nested" ? nested : modules) + "/" + platformName;
  const wrapper = (pair === "root" ? modules : nested) + "/esbuild";
  const identity = "1:500:32:4:5:2:1000:33261";
  put(platform + "/bin/esbuild", "file", { uid: 1000, nlink: 2, identity });
  put(wrapper + "/bin/esbuild", "file", { uid: 1000, nlink: 2, identity });
  for (const [root, pkg] of [[platform, { name: platformName, version: "0.27.3" }],
    [wrapper, { name: "esbuild", version: "0.27.3", optionalDependencies: { [platformName]: "0.27.3" } }]]) {
    put(root + "/package.json", "file"); paths.get(root + "/package.json").content = JSON.stringify(pkg);
  }
  put("/usr/bin/python3.12", "file"); put("/usr/local/bin/python3.12", "file");
  const executable = (direction === "platform" ? platform : wrapper) + "/bin/esbuild";
  const fact = { pid: 201, uid: 1000, cwd: runtime, parentPid: 200, startTicks: "123", executable,
    executableIdentity: identity, commandLine: [executable, "--service=0.27.3", "--ping"] };
  const d = { pathInfo: (path) => { reads.push(path); return paths.has(path) ? structuredClone(paths.get(path).info) : null; },
    canonical: (path) => aliases.get(path) ?? path,
    readRegular: (path, limit, info) => { regularReads.push(path); assert.ok(path.endsWith("/package.json")); assert.equal(limit, 8192);
      assert.deepEqual(paths.get(path).info, info); return { bytes: Buffer.from(paths.get(path).content) }; },
    readProcess: (pid) => { assert.equal(pid, 201); return structuredClone(fact); },
    drift: () => { const error = new Error("identity_changed"); error[DRIFT] = true; throw error; },
    rethrowDrift: (error) => { if (error?.[DRIFT]) throw error; },
    run: () => { throw new Error("NO_ACTUATION"); } };
  const input = () => ({ fact: structuredClone(fact), runtime, owner: 1000, architecture: "x64", binary: structuredClone(paths.get(executable).info) });
  return { d, paths, aliases, put, reads, regularReads, fact, platform, wrapper, executable, input };
}
const native = (f) => observeNativeFileLink(f.input(), f.d);
const publicNative = ({ linkCount, outcome }) => ({ linkCount, outcome });

test("Python only observes metadata under the two fixed canonical directories", () => {
  for (const [path, location] of [["/usr/bin/python3.12", "usr_bin"], ["/usr/local/bin/python3.12", "usr_local_bin"]]) {
    const f = fixture(); const observed = observePythonLayout(path, f.d);
    assert.deepEqual(observed.result, { location, pathSuffix: "3.12", assessment: "metadata_verified" });
    assert.deepEqual(validatePythonLayout(observed.result), observed.result); assert.equal(f.regularReads.length, 0);
  }
  for (const [path, location, pathSuffix] of [["/opt/runtime/python3.12", "opt", "3.12"], ["/private/" + SECRET, "other", null],
    ["/usr/bin/python3.012", "usr_bin", null], ["/usr/local/bin/python3.10000", "usr_local_bin", null], ["/usr/bin/../python3", "other", null]]) {
    const f = fixture(); const { result, witness } = observePythonLayout(path, f.d);
    assert.deepEqual(result, { location, pathSuffix, assessment: "out_of_scope" }); assert.deepEqual(witness, []);
    assert.deepEqual(f.reads, []); assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
  assert.deepEqual(observePythonLayout(null, fixture().d).result, emptyPythonLayout());
});

test("Python trust rejection is first-failure metadata, never permission to execute", () => {
  for (const [patch, assessment] of [[{ type: "symlink" }, "file_type"], [{ uid: 9 }, "file_owner"],
    [{ nlink: 2, mode: 0o100777 }, "file_links"], [{ mode: 0o100777 }, "file_writable"], [{ size: 0 }, "file_size"],
    [{ mode: 0o100644 }, "file_not_executable"]]) {
    const f = fixture(); Object.assign(f.paths.get("/usr/bin/python3.12").info, patch);
    assert.equal(observePythonLayout("/usr/bin/python3.12", f.d).result.assessment, assessment); assert.equal(f.regularReads.length, 0);
  }
  const f = fixture(); f.paths.delete("/usr/bin/python3.12"); assert.equal(observePythonLayout("/usr/bin/python3.12", f.d).result.assessment, "file_missing");
  const g = fixture(); g.paths.get("/usr/bin").info.mode = 0o40777;
  assert.equal(observePythonLayout("/usr/bin/python3.12", g.d).result.assessment, "directory_rejected");
  assert.equal(g.reads.includes("/usr/bin/python3.12"), false);
  const h = fixture(); h.d.pathInfo = () => { throw new Error(SECRET); };
  assert.equal(observePythonLayout("/usr/bin/python3.12", h.d).result.assessment, "unverified");
});

test("all three fixed root nested and hoisted hardlink layouts match in both directions", () => {
  for (const pair of ["root", "nested", "hoisted"]) for (const direction of ["platform", "wrapper"]) {
    const f = fixture(pair, direction); const result = native(f);
    assert.deepEqual(publicNative(result), { linkCount: "two", outcome: "matched" }, pair + direction);
    assert.deepEqual(f.regularReads, [f.platform + "/package.json", f.wrapper + "/package.json"]);
    assert.ok(result.witness.length > 0); assert.equal(JSON.stringify(publicNative(result)).includes("/"), false);
  }
});

test("hardlink counts and unsupported layouts do not lead to additional file probing", () => {
  for (const [binary, linkCount, outcome] of [[null, "unreadable", "unverified"], [{ nlink: 0 }, "invalid", "invalid_metadata"],
    [{ nlink: 2.5 }, "invalid", "invalid_metadata"], [{ nlink: 3 }, "greaterThanTwo", "not_double_linked"]]) {
    const f = fixture(); const result = observeNativeFileLink({ ...f.input(), binary }, f.d);
    assert.deepEqual(publicNative(result), { linkCount, outcome }); assert.deepEqual(f.reads, []); assert.deepEqual(f.regularReads, []);
  }
  const f = fixture(); const result = observeNativeFileLink({ ...f.input(), fact: { ...f.fact, executable: "/other/" + SECRET } }, f.d);
  assert.equal(result.outcome, "unsupported_layout"); assert.equal(f.reads.length, 0);
});

test("missing unsafe non-double and different-inode candidates cannot read packages or become matches", () => {
  for (const [change, expected] of [
    [(f) => { f.paths.delete(f.wrapper + "/bin/esbuild"); }, "pair_missing"],
    [(f) => { f.paths.get(f.wrapper + "/bin").info.mode = 0o40777; }, "untrusted_directory"],
    [(f) => { f.paths.get(f.wrapper + "/bin/esbuild").info.uid = 99; }, "invalid_metadata"],
    [(f) => { f.paths.get(f.wrapper + "/bin/esbuild").info.nlink = 1; }, "not_double_linked"],
    [(f) => { f.paths.get(f.wrapper + "/bin/esbuild").info.identity = "1:999:32:4:5:2:1000:33261"; }, "different_inode"],
  ]) {
    const f = fixture(); change(f); const result = native(f); assert.equal(result.outcome, expected);
    assert.equal(f.regularReads.length, 0); assert.ok(result.witness.length > 0);
  }
});

test("a different same-level inode does not hide the one valid fixed hoisted pair", () => {
  const f = fixture("hoisted"); const rootWrapper = runtime + "/node_modules/esbuild";
  f.put(rootWrapper + "/bin/esbuild", "file", { nlink: 2, identity: "1:999:32:4:5:2:0:33261" });
  assert.equal(native(f).outcome, "matched"); assert.equal(f.regularReads.includes(rootWrapper + "/package.json"), false);
  f.paths.get(rootWrapper + "/bin/esbuild").info.identity = f.fact.executableIdentity;
  f.regularReads.length = 0; assert.equal(native(f).outcome, "invalid_metadata"); assert.equal(f.regularReads.length, 0);
});

test("package names equal stable versions optional dependency and exact argv all bind a match", () => {
  for (const change of [
    (f) => { f.paths.get(f.platform + "/package.json").content = JSON.stringify({ name: "other", version: "0.27.3" }); },
    (f) => { f.paths.get(f.wrapper + "/package.json").content = JSON.stringify({ name: "esbuild", version: "0.27.3" }); },
    (f) => { f.paths.get(f.wrapper + "/package.json").content = JSON.stringify({ name: "esbuild", version: "0.27.3", optionalDependencies: { [platformName]: "^0.27.3" } }); },
    (f) => { f.paths.get(f.wrapper + "/package.json").content = SECRET; },
    (f) => { f.paths.get(f.wrapper + "/package.json").info.nlink = 2; },
  ]) { const f = fixture(); change(f); assert.equal(native(f).outcome, "package_mismatch"); }
  const f = fixture(); f.fact.commandLine.push(SECRET); assert.equal(native(f).outcome, "argv_mismatch");
  const g = fixture(); g.d.readRegular = () => { throw new Error(SECRET); }; assert.equal(native(g).outcome, "unverified");
});

test("file directory package and process identity drift propagate to invalidate the whole core report", () => {
  for (const kind of ["binary", "directory", "package", "process"]) {
    const f = fixture(); const read = f.d.readRegular;
    f.d.readRegular = (...args) => { const value = read(...args);
      if (kind === "process") f.fact.startTicks = "999";
      else f.paths.get(kind === "binary" ? f.executable : kind === "directory" ? f.wrapper + "/bin" : f.wrapper + "/package.json").info.identity += "changed";
      return value; };
    assert.throws(() => native(f), (error) => error[DRIFT] === true, kind);
  }
  const g = fixture(); const original = g.d.pathInfo; let n = 0;
  g.d.pathInfo = (path) => { const info = original(path); if (path === "/usr/bin/python3.12" && ++n > 1) info.identity += "changed"; return info; };
  assert.throws(() => observePythonLayout("/usr/bin/python3.12", g.d), (error) => error[DRIFT] === true);
});

test("strict evidence validators enforce exact sums fixed enums and detached bounded data", () => {
  const value = emptyNativeFileLinkEvidence(); value.linkCounts.two = 1; value.outcomes.matched = 1;
  assert.deepEqual(validateNativeFileLinkEvidence(value, 1), value); assert.ok(JSON.stringify(value).length < 1024);
  for (const change of [(v) => { v.linkCounts.two = 0; }, (v) => { v.outcomes.matched = 0; }, (v) => { v.linkCounts.two = "1"; },
    (v) => { v.linkCounts.two = 16385; }, (v) => { v.outcomes.raw = SECRET; }, (v) => { delete v.outcomes.unverified; },
    (v) => { v.linkCounts.two = 0; v.linkCounts.unreadable = 1; }]) {
    const copy = structuredClone(value); change(copy); assert.throws(() => validateNativeFileLinkEvidence(copy, 1));
  }
  for (const expected of [-1, 1.5, "1", 16385]) assert.throws(() => validateNativeFileLinkEvidence(value, expected));
  const python = { location: "usr_bin", pathSuffix: "3.12", assessment: "metadata_verified" };
  for (const patch of [{ location: SECRET }, { pathSuffix: "3.012" }, { assessment: "held" }, { location: "other" },
    { pathSuffix: null }, { raw: SECRET }, { assessment: "not_observed" }]) assert.throws(() => validatePythonLayout({ ...python, ...patch }));
  const copy = validateNativeFileLinkEvidence(value, 1); copy.linkCounts.two = 0; assert.equal(value.linkCounts.two, 1);
});

test("accessors proxies hidden properties and symbol keys are refused without running traps", () => {
  let invoked = 0;
  const python = emptyPythonLayout(); Object.defineProperty(python, "location", { enumerable: true, get() { invoked++; return SECRET; } });
  assert.throws(() => validatePythonLayout(python));
  const proxy = new Proxy(emptyNativeFileLinkEvidence(), { ownKeys() { invoked++; throw new Error(SECRET); } });
  assert.throws(() => validateNativeFileLinkEvidence(proxy, 0));
  const nested = emptyNativeFileLinkEvidence(); Object.defineProperty(nested.outcomes, "matched", { enumerable: true, get() { invoked++; return 0; } });
  assert.throws(() => validateNativeFileLinkEvidence(nested, 0));
  for (const value of [{ ...emptyPythonLayout(), [Symbol("raw")]: SECRET }, Object.defineProperty(emptyPythonLayout(), "raw", { value: SECRET })]) {
    assert.throws(() => validatePythonLayout(value));
  }
  assert.equal(invoked, 0);
});

test("helper has no filesystem execution network or nonce capability and never reads binary bytes", () => {
  const source = readFileSync(new URL("./production-maintenance-runtime-layout.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:(?:fs|child_process|net|http|https|crypto)|\b(?:run|exec|spawn|fetch|randomUUID)\s*\(/);
  assert.match(source, /root \+ "\/package\.json"/);
  assert.match(source, /never relaxes the core target_path\/file_links/);
});
