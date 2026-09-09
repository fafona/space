import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, linkSync, lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createNativeUnknownReasonCounts, diagnoseRuntimeCompatibility, validateRuntimeCompatibilityDiagnostic } from "./production-maintenance-runtime-diagnostic.mjs";

// Real files only in this test's own private directory. The process, directory
// and endpoint views are synthetic; neither /usr, /proc nor PM2 is accessed.
const scriptsDirectory = realpathSync(dirname(fileURLToPath(import.meta.url)));
const unixModes = process.platform === "linux";
const identity = (stat) => ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"].map((key) => String(stat[key])).join(":");
function realInfo(path) {
  const stat = lstatSync(path, { bigint: true });
  return { identity: identity(stat), uid: Number(stat.uid), mode: Number(stat.mode), size: Number(stat.size), nlink: Number(stat.nlink),
    type: stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "other" };
}
function fixture(t) {
  const directory = mkdtempSync(join(scriptsDirectory, ".runtime-rejection-files-"));
  chmodSync(directory, 0o700);
  t.after(() => {
    const exact = realpathSync(directory);
    assert.equal(exact, directory); assert.equal(dirname(exact), scriptsDirectory);
    assert.ok(basename(exact).startsWith(".runtime-rejection-files-"));
    assert.equal(lstatSync(directory).isSymbolicLink(), false);
    rmSync(exact, { recursive: true });
  });
  const binaryPath = join(directory, "synthetic-esbuild"); const packagePath = join(directory, "package.json");
  writeFileSync(binaryPath, "fixture bytes, never execute\n", { flag: "wx", mode: 0o755 });
  writeFileSync(packagePath, JSON.stringify({ name: "@esbuild/linux-x64", version: "0.27.3" }), { flag: "wx", mode: 0o644 });
  const uid = typeof process.getuid === "function" ? process.getuid() : realInfo(binaryPath).uid;
  const runtime = "/srv/faolla.releases/aaaaaaaaaaaa-20260909120000"; const node = "/opt/node/bin/node";
  const base = runtime + "/node_modules/@esbuild/linux-x64"; const executable = base + "/bin/esbuild";
  const mapped = new Map([[executable, binaryPath], [base + "/package.json", packagePath]]);
  const fact = (pid, parentPid, cwd = runtime, entry = node) => ({ pid, parentPid, uid, cwd, executable: entry,
    startTicks: String(pid * 10), commandLineDigest: "b".repeat(64), commandLine: ["node"] });
  const daemon = { ...fact(10, 1, "/"), commandLine: ["PM2 v6.0.14: God Daemon (/srv/pm2)"] };
  const web = fact(100, 10); const worker = fact(200, 10);
  const child = { ...fact(201, 200, runtime, executable), executableIdentity: realInfo(binaryPath).identity,
    commandLine: [executable, "--service=0.27.3", "--ping"] };
  const facts = new Map([daemon, web, worker, child].map((entry) => [entry.pid, entry]));
  const values = (name, entry, args) => ({ name, pm_cwd: runtime, pm_exec_path: entry, args,
    exec_interpreter: node, exec_mode: "fork_mode", node_args: "", pm_id: "0", PM2_HOME: null });
  const disk = { runtime, environmentIdentity: "synthetic", environmentDigest: "synthetic", nextEntryPath: runtime + "/node_modules/next/dist/bin/next" };
  const environments = new Map([[10, { PM2_HOME: "/srv/pm2" }], [100, values("faolla", disk.nextEntryPath, "start,-p,3000")],
    [200, values("faolla-enterprise-automation-worker", runtime + "/node_modules/tsx/dist/cli.mjs", runtime + "/scripts/run-merchant-enterprise-automation-worker.ts")]]);
  let executionAttempts = 0; let diskReads = 0; const regularReads = [];
  const result = { directory, binaryPath, packagePath, child, beforeSecondObservation: () => {} };
  const forbidExecution = () => { executionAttempts++; throw new Error("test_execution_forbidden"); };
  const deps = {
    disk: () => { if (++diskReads === 2) result.beforeSecondObservation(); return structuredClone(disk); },
    supervision: async () => ({ listener: { state: "single", pid: 100, chain: structuredClone([web, daemon]) },
      ownership: { state: "owned", mode: "direct", pid: 100, daemonPid: 10 }, healthVerified: true }),
    classify: () => "runtime_supervision_direct_next_owned", boot: () => "synthetic-boot", nodePath: () => node,
    canonical: (path) => path, arch: () => "x64",
    readProcess: (pid) => { assert.ok(facts.has(pid)); return structuredClone(facts.get(pid)); },
    readSelected: (pid) => { assert.ok(environments.has(pid)); return structuredClone(environments.get(pid)); },
    scan: () => ({ index: [...facts.values()].map(({ pid, parentPid }) => ({ pid, parentPid })), runtimePids: [100, 200, 201] }),
    readRollback: () => { throw new Error("synthetic_environment_unavailable"); },
    readProcessEnvironment: () => { throw new Error("unexpected_environment_read"); },
    cliEnvironment: () => ({ home: "/srv/pm2", overridesPresent: false }),
    pathInfo: (path) => mapped.has(path) ? realInfo(mapped.get(path))
      : path.startsWith("/usr") || path.startsWith("/srv/pm2") ? null
        : { type: "directory", identity: "synthetic-directory:" + path, uid: 0, mode: 0o40755, size: 0, nlink: 1 },
    readRegular: (path, limit, expected) => {
      assert.ok(mapped.has(path), "only the two synthetic files may be read"); regularReads.push(path);
      const actual = mapped.get(path); assert.equal(realInfo(actual).identity, expected.identity);
      const bytes = readFileSync(actual); assert.ok(bytes.length <= limit); assert.equal(realInfo(actual).identity, expected.identity);
      return { bytes, digest: createHash("sha256").update(bytes).digest("hex") };
    },
    run: forbidExecution, runPython: forbidExecution,
  };
  result.diagnose = async () => {
    const report = await diagnoseRuntimeCompatibility({ appDir: "/srv/faolla", appName: "faolla", appPort: 3000, expectedOldSha: "a".repeat(40) }, deps);
    assert.equal(executionAttempts, 0); assert.equal(report.version, 3); assert.equal(report.maintenance, "not_verified");
    assert.equal(report.pm2Connection, "not_checked"); assert.deepEqual(validateRuntimeCompatibilityDiagnostic(report), report);
    assert.equal(JSON.stringify(report).includes(directory), false);
    return report;
  };
  result.regularReads = regularReads;
  return result;
}
function assertOneReason(report, reason) {
  assert.equal(report.stability, "stable");
  assert.deepEqual(report.workerNative, { esbuildCount: 0, otherCount: 0, unknownCount: 1, controlledIdentityVerified: null,
    unknownReasons: { ...createNativeUnknownReasonCounts(), [reason]: 1 } });
}

test("real same-inode hardlink reports file_links without running or reading native bytes", async (t) => {
  const f = fixture(t); const alias = join(f.directory, "same-inode-alias"); linkSync(f.binaryPath, alias);
  const original = lstatSync(f.binaryPath, { bigint: true }); const linked = lstatSync(alias, { bigint: true });
  assert.equal(original.dev, linked.dev); assert.equal(original.ino, linked.ino); assert.equal(original.nlink, 2n);
  f.child.executableIdentity = realInfo(f.binaryPath).identity;
  assertOneReason(await f.diagnose(), "file_links"); assert.deepEqual(f.regularReads, []);
});

test("Linux actual mode and size obey the first-rejection order, with a valid real-package baseline", { skip: !unixModes }, async (t) => {
  const valid = fixture(t); const baseline = await valid.diagnose();
  assert.equal(baseline.workerNative.esbuildCount, 1); assert.ok(valid.regularReads.length > 0);
  for (const [mode, empty, reason] of [[0o666, true, "file_writable"], [0o644, true, "file_size"], [0o644, false, "file_not_executable"]]) {
    const f = fixture(t); if (empty) writeFileSync(f.binaryPath, ""); chmodSync(f.binaryPath, mode);
    assert.equal(lstatSync(f.binaryPath).mode & 0o777, mode);
    if (empty) assert.equal(lstatSync(f.binaryPath).size, 0);
    f.child.executableIdentity = realInfo(f.binaryPath).identity;
    assertOneReason(await f.diagnose(), reason); assert.deepEqual(f.regularReads, []);
  }
});

test("real binary replacement, package replacement and Linux mode drift discard the complete observation", async (t) => {
  const changes = ["binary-replacement", ...(unixModes ? ["package-replacement", "binary-mode"] : [])];
  for (const change of changes) {
    const f = fixture(t);
    f.beforeSecondObservation = () => {
      const target = change === "package-replacement" ? f.packagePath : f.binaryPath;
      const before = realInfo(target);
      if (change === "binary-mode") chmodSync(target, 0o644);
      else {
        const bytes = readFileSync(target); renameSync(target, join(f.directory, "retained-original"));
        writeFileSync(target, bytes, { flag: "wx", mode: before.mode & 0o777 });
      }
      assert.notEqual(realInfo(target).identity, before.identity);
    };
    const report = await f.diagnose();
    assert.equal(report.stability, "unverified"); assert.equal(report.disk, "unverified"); assert.equal(report.supervision, null);
    assert.equal(report.worker.state, "unverified"); assert.equal(report.workerNative.unknownReasons, null);
    assert.equal(report.workerNative.esbuildCount, null); assert.equal(report.python.rejectionReason, null);
  }
});
