import assert from "node:assert/strict";
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { captureTrustedPython, verifyTrustedPython } from "./production-maintenance-trusted-python.mjs";

// Only private synthetic files are touched. Device/inode/link/mode/size/times
// come from lstat. After checking actual ownership by this test's UID, DI maps
// that owner to logical root in both uid and identity. This is NOT proof of a
// real root-owned interpreter installation, nor a real Python execution test.
const scriptsDirectory = realpathSync(dirname(fileURLToPath(import.meta.url)));
const ENTRY = "/usr/bin/python3", TARGET = "/usr/libexec/platform-python3.6", PAIR = TARGET + "m";
const FIELDS = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"];
const linuxOnly = { skip: process.platform !== "linux" };
const rejects = (fn) => assert.throws(fn, { message: "maintenance_trusted_python_unverified" });

function fixture(t) {
  const directory = mkdtempSync(join(scriptsDirectory, ".trusted-python-files-")); chmodSync(directory, 0o700);
  t.after(() => {
    const exact = realpathSync(directory);
    assert.equal(exact, directory); assert.equal(dirname(exact), scriptsDirectory);
    assert.ok(basename(exact).startsWith(".trusted-python-files-")); assert.equal(lstatSync(exact).isSymbolicLink(), false);
    rmSync(exact, { recursive: true });
  });
  const logical = ["/", "/usr", "/usr/bin", "/usr/libexec", ENTRY, TARGET, PAIR];
  const mapped = new Map(logical.map((path) => [path, path === "/" ? directory : join(directory, path.slice(1))]));
  for (const path of ["/usr", "/usr/bin", "/usr/libexec"]) mkdirSync(mapped.get(path), { mode: 0o755 });
  writeFileSync(mapped.get(TARGET), "synthetic interpreter bytes: never execute\n", { flag: "wx", mode: 0o755 });
  linkSync(mapped.get(TARGET), mapped.get(PAIR));
  symlinkSync("../libexec/platform-python3.6", mapped.get(ENTRY));
  const owner = BigInt(process.getuid()), reads = [];
  const f = { directory, mapped, reads, beforeRead: null, executionCount: 0 };
  f.d = {
    pathInfo(path) {
      assert.ok(mapped.has(path), "only explicitly mapped private fixture paths may be inspected");
      reads.push(path); f.beforeRead?.(path);
      const stat = lstatSync(mapped.get(path), { bigint: true });
      assert.equal(stat.uid, owner, "synthetic file must remain owned by this test user");
      const values = { ...stat, uid: 0n };
      return { identity: FIELDS.map((key) => String(values[key])).join(":"), uid: 0, mode: Number(stat.mode),
        size: Number(stat.size), nlink: Number(stat.nlink),
        type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other" };
    },
    canonical(path) {
      assert.ok(mapped.has(path));
      const resolved = realpathSync(mapped.get(path));
      const result = [...mapped].find(([, actual]) => actual === resolved)?.[0];
      assert.ok(result, "resolution may not escape the fixture's fixed mapping"); return result;
    },
  };
  f.replacePair = () => {
    unlinkSync(mapped.get(PAIR)); unlinkSync(mapped.get(TARGET));
    writeFileSync(mapped.get(TARGET), "replacement synthetic interpreter, never execute\n", { flag: "wx", mode: 0o755 });
    linkSync(mapped.get(TARGET), mapped.get(PAIR));
  };
  f.replaceEntry = () => {
    unlinkSync(mapped.get(ENTRY)); symlinkSync("../libexec/platform-python3.6", mapped.get(ENTRY));
  };
  f.guardedCounter = (proof, before = () => {}, after = () => {}) => {
    before(); verifyTrustedPython(proof, f.d);
    f.executionCount++; // A counter only: never spawn or read interpreter bytes.
    after(); verifyTrustedPython(proof, f.d);
  };
  return f;
}

test("Linux real double link captures matching eight-field identities in the exact private layout", linuxOnly, (t) => {
  const f = fixture(t), target = lstatSync(f.mapped.get(TARGET), { bigint: true }), pair = lstatSync(f.mapped.get(PAIR), { bigint: true });
  assert.equal(target.dev, pair.dev); assert.equal(target.ino, pair.ino); assert.equal(target.nlink, 2n); assert.equal(pair.nlink, 2n);
  const proof = captureTrustedPython(f.d);
  assert.equal(proof.layout, "el8_platform_python36_pair"); assert.equal(proof.target.identity, proof.pair.identity);
  assert.equal(proof.target.identity.split(":")[0], String(target.dev)); assert.equal(proof.target.identity.split(":")[1], String(target.ino));
  assert.equal(verifyTrustedPython(proof, f.d), true); assert.equal(f.executionCount, 0);
});

test("Linux third hardlink, missing pair, and distinct double-linked inode are rejected", linuxOnly, (t) => {
  for (const kind of ["third", "missing", "different"]) {
    const f = fixture(t);
    if (kind === "third") linkSync(f.mapped.get(TARGET), join(f.directory, "third-link"));
    if (kind === "missing") renameSync(f.mapped.get(PAIR), join(f.directory, "unmapped-original-pair"));
    if (kind === "different") {
      renameSync(f.mapped.get(PAIR), join(f.directory, "unmapped-original-pair"));
      writeFileSync(f.mapped.get(PAIR), "separate inode, never execute\n", { flag: "wx", mode: 0o755 });
      linkSync(f.mapped.get(PAIR), join(f.directory, "separate-inode-alias"));
      assert.equal(lstatSync(f.mapped.get(TARGET)).nlink, 2); assert.equal(lstatSync(f.mapped.get(PAIR)).nlink, 2);
      assert.notEqual(lstatSync(f.mapped.get(TARGET)).ino, lstatSync(f.mapped.get(PAIR)).ino);
    }
    rejects(() => captureTrustedPython(f.d)); assert.equal(f.executionCount, 0);
  }
});

test("Linux symlink pair and actual unsafe permissions, noexec, and zero size never pass", linuxOnly, (t) => {
  for (const kind of ["symlink", "writable", "directory", "noexec", "empty"]) {
    const f = fixture(t);
    if (kind === "symlink") {
      renameSync(f.mapped.get(PAIR), join(f.directory, "unmapped-original-pair"));
      symlinkSync("platform-python3.6", f.mapped.get(PAIR));
      assert.equal(lstatSync(f.mapped.get(TARGET)).nlink, 2);
    }
    if (kind === "writable") chmodSync(f.mapped.get(TARGET), 0o777);
    if (kind === "directory") chmodSync(f.mapped.get("/usr/libexec"), 0o775);
    if (kind === "noexec") chmodSync(f.mapped.get(TARGET), 0o644);
    if (kind === "empty") writeFileSync(f.mapped.get(TARGET), "");
    rejects(() => captureTrustedPython(f.d)); assert.equal(f.executionCount, 0);
  }
});

test("Linux capture discards an otherwise valid replacement between its two observations", linuxOnly, (t) => {
  const f = fixture(t); let entryReads = 0;
  f.beforeRead = (path) => { if (path === ENTRY && ++entryReads === 2) f.replacePair(); };
  rejects(() => captureTrustedPython(f.d)); assert.equal(f.executionCount, 0);
});

test("Linux real entry, paired-file and ancestor drift before a guarded counter cause zero invocations", linuxOnly, (t) => {
  for (const kind of ["entry", "pair", "ancestor"]) {
    const f = fixture(t), proof = captureTrustedPython(f.d);
    const change = kind === "entry" ? f.replaceEntry : kind === "pair" ? f.replacePair
      : () => chmodSync(f.mapped.get("/usr/libexec"), 0o750);
    rejects(() => f.guardedCounter(proof, change)); assert.equal(f.executionCount, 0);
  }
});

test("Linux real entry, paired-file and ancestor drift after a guarded counter cause one invocation with no retry", linuxOnly, (t) => {
  for (const kind of ["entry", "pair", "ancestor"]) {
    const f = fixture(t), proof = captureTrustedPython(f.d);
    const change = kind === "entry" ? f.replaceEntry : kind === "pair" ? f.replacePair
      : () => chmodSync(f.mapped.get("/usr/libexec"), 0o750);
    rejects(() => f.guardedCounter(proof, undefined, change)); assert.equal(f.executionCount, 1);
  }
});
