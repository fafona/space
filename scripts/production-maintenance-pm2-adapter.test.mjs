import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { controlPm2, inspectPm2Registry, validatePm2Registry, PM2_CONTROL_BRIDGE_SOURCE,
  capturePm2DumpTarget, persistPm2Dump, verifyPm2Dump, validatePm2DumpReceipt, pm2RegistryDigest } from "./production-maintenance-pm2-adapter.mjs";

const BOOT = "12345678-1234-1234-1234-123456789012";
const id = "1:2:3:4:5:1:0:33261";
const daemon = { pid: 10, parentPid: 1, uid: 0, startTicks: "123", processIdentity: id, cwd: "/", cwdIdentity: id,
  executable: "/usr/bin/node", executableIdentity: id, commandLineDigest: "a".repeat(64) };
// Nonsecret original daemon projection; every transport test below uses real
// adapter logic and only substitutes its host I/O, never the continuity helper.
const PINNED_BOOT = "e6531ec9-db4a-4216-b87a-7cc858197eaa";
const pinnedDaemon = () => ({ pid: 1932, parentPid: 1, startTicks: "655",
  processIdentity: "5:1371412379:0:1789025006880928256:1789025006880928256:9:0:16749", uid: 0, cwd: "/",
  cwdIdentity: "64769:2:4096:1781053826232894895:1781053826232894895:22:0:16749", executable: "/usr/bin/node",
  executableIdentity: "64769:1490495:98927992:1772647009000000000:1773064763075191240:1:0:33261",
  commandLineDigest: "e828d12675121dacff0dd5b122c0f135cadd6a2fe03ddbbe1e8540f9ad1e4159" });
const changeProc = (value, index = 1) => {
  const parts = value.processIdentity.split(":"); parts[index] = String(BigInt(parts[index]) + 1n);
  value.processIdentity = parts.join(":");
};
const row = () => ({ name: "faolla", pid: 20, pm_id: 0, pm2_env: { name: "faolla", pm_id: 0, status: "online",
  created_at: 123, pm_uptime: 234, restart_time: 0, pm_cwd: "/srv/faolla.releases/aaaaaaaaaaaa-20260909000000",
  pm_exec_path: "/srv/faolla.releases/aaaaaaaaaaaa-20260909000000/node_modules/next/dist/bin/next",
  args: ["start", "-p", "3000"], node_args: [], exec_mode: "fork_mode", exec_interpreter: "/usr/bin/node",
  watch: false, cron_restart: null, autorestart: true, FAOLLA_BACKGROUND_JOBS_PAUSED: null, nonce: null, envDigest: null } });
const request = () => ({ action: "delete", expected: row(), expectedProcess: { pid: 20, uid: 0, startTicks: "200",
  bootId: BOOT, executable: "/usr/bin/node", executableIdentity: id } });
function fixture() {
  const calls = [];
  const f = { calls, current: { ...daemon, commandLine: ["PM2 v6.0.14: God Daemon (/root/.pm2)"] }, boot: BOOT,
    helper: "fixed-helper", python: { target: { path: "/usr/libexec/platform-python3.6" } }, rows: [row()], after: null };
  f.d = { boot: () => f.boot, readProcess: () => structuredClone(f.current), canonical: (path) => path, daemonEnvironment: () => true,
    python: () => structuredClone(f.python), verifyPython: (proof) => { assert.deepEqual(proof, f.python); }, helperProof: () => f.helper,
    invoke(python, payload) {
      calls.push(structuredClone({ python, payload }));
      const answer = { version: 1, pm2Version: "6.0.14", peerVerified: true, registry: f.rows,
        ...(payload.request === null ? {} : { acknowledged: true }) };
      f.after?.();
      return { status: 0, stderr: "", stdout: JSON.stringify(answer) };
    } };
  return f;
}
function pinnedFixture() {
  const f = fixture(); f.boot = PINNED_BOOT;
  f.current = { ...pinnedDaemon(), commandLine: ["PM2 v6.0.14: God Daemon (/root/.pm2)"] };
  for (const index of [1, 3, 4]) changeProc(f.current, index);
  return f;
}
test("registry transport freezes daemon, root cwd, boot and fixed Python without CLI", async () => {
  const f = fixture(); assert.deepEqual(await inspectPm2Registry(daemon, BOOT, f.d), [row()]);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].payload.socketPath, "/root/.pm2/rpc.sock");
  assert.equal(f.calls[0].payload.request, null); assert.equal(f.calls[0].payload.daemon.bootId, BOOT);
  assert.equal(Object.keys(f.calls[0].payload.daemon).length, 6);
});
test("one fixed control invocation returns bounded filtered evidence, not authority", async () => {
  const f = fixture(); const result = await controlPm2(daemon, BOOT, request(), f.d);
  assert.equal(f.calls.length, 1); assert.equal(result.acknowledged, true); assert.deepEqual(result.registry, [row()]);
});
test("malformed daemon or arbitrary action never reaches Python or filesystem dependencies", async () => {
  for (const input of [{ ...daemon, raw: "private" }, { ...daemon, cwd: "/root/../" }, { ...daemon, startTicks: "0" }]) {
    const f = fixture(); await assert.rejects(inspectPm2Registry(input, BOOT, f.d)); assert.equal(f.calls.length, 0);
  }
  for (const action of [{ action: "save" }, { action: "prepare", launch: {}, arbitrary: true }, { action: "restart", expected: row(), expectedProcess: null }]) {
    const f = fixture(); await assert.rejects(controlPm2(daemon, BOOT, action, f.d)); assert.equal(f.calls.length, 0);
  }
});
test("input accessor, proxy, sparse array and unknown registry keys cannot be invoked or returned", async () => {
  let called = 0;
  const getter = { ...daemon }; Object.defineProperty(getter, "pid", { enumerable: true, get() { called++; return 10; } });
  const proxy = new Proxy(daemon, { get() { called++; }, ownKeys() { called++; return []; } });
  for (const input of [getter, proxy]) await assert.rejects(inspectPm2Registry(input, BOOT, fixture().d));
  assert.equal(called, 0);
  const rows = [row()]; delete rows[0]; assert.throws(() => validatePm2Registry(rows));
  assert.throws(() => validatePm2Registry([{ ...row(), environment: "private" }]));
  assert.throws(() => validatePm2Registry([{ ...row(), pm2_env: { ...row().pm2_env, private: "private" } }]));
});
test("different daemon generation, version, boot or aliased home prevents sending", async () => {
  for (const change of [(f) => { f.current.startTicks = "124"; }, (f) => { f.boot = "b".repeat(36); },
    (f) => { f.current.commandLine = ["PM2 v6.0.15: God Daemon (/root/.pm2)"]; },
    (f) => { f.d.canonical = () => "/different"; }, (f) => { f.d.daemonEnvironment = () => false; },
    (f) => { f.d.verifyPython = () => { throw new Error("secret"); }; }]) {
    const f = fixture(); change(f); await assert.rejects(controlPm2(daemon, BOOT, request(), f.d), { message: "production_maintenance_pm2_unverified" });
    assert.equal(f.calls.length, 0);
  }
});
test("post-send drift and lost acknowledgements remain unknown with no repeat", async () => {
  for (const change of [(f) => { f.helper = "changed"; }, (f) => { f.boot = "changed"; },
    (f) => { f.current.startTicks = "125"; }, (f) => { f.python = { target: { path: "/different" } }; }]) {
    const f = fixture(); f.after = () => change(f);
    await assert.rejects(controlPm2(daemon, BOOT, request(), f.d), { message: "production_maintenance_pm2_outcome_unknown" });
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(); const original = f.d.invoke;
  f.d.invoke = (...args) => { original(...args); throw new Error("raw password"); };
  await assert.rejects(controlPm2(daemon, BOOT, request(), f.d), { message: "production_maintenance_pm2_outcome_unknown" });
  assert.equal(f.calls.length, 1);
});
test("read-only failure and malformed replies do not reveal raw private output", async () => {
  for (const result of [{ status: 1, stderr: "secret", stdout: "secret" }, { status: 0, stderr: "", stdout: "secret" },
    { status: 0, stderr: "", stdout: JSON.stringify({ version: 1, pm2Version: "6.0.14", peerVerified: true, registry: [], raw: "secret" }) }]) {
    const f = fixture(); f.d.invoke = () => result;
    await assert.rejects(inspectPm2Registry(daemon, BOOT, f.d), { message: "production_maintenance_pm2_unverified" });
  }
});
test("bridge is isolated, bounded and has no dynamic method or ambient environment", () => {
  const source = readFileSync(new URL("./production-maintenance-pm2-adapter.mjs", import.meta.url), "utf8");
  assert.match(PM2_CONTROL_BRIDGE_SOURCE, /read\(65537\)/);
  assert.match(PM2_CONTROL_BRIDGE_SOURCE, /inspect_pm2_registry/); assert.match(PM2_CONTROL_BRIDGE_SOURCE, /control_pm2_process/);
  assert.doesNotMatch(source, /process\.env|spawnSync\("pm2"|getattr\(|shell: true/);
  assert.match(source, /\["-I", "-S", "-B", "-c"/);
});
test("import from stdin is inert", () => {
  const url = new URL("./production-maintenance-pm2-adapter.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], { input: `await import(${JSON.stringify(url)});`, encoding: "utf8" });
  assert.equal(result.status, 0); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
});
const target = () => ({ version: 1, socketPath: "/root/.pm2/rpc.sock",
  daemon: { pid: daemon.pid, uid: daemon.uid, startTicks: daemon.startTicks, bootId: BOOT,
    executable: daemon.executable, executableIdentity: daemon.executableIdentity },
  chain: [["1", "2", "16832", "0", "0"], ["1", "3", "16832", "0", "0"]], dump: null, backup: null });
const receipt = () => ({ version: 1, pm2Version: "6.0.14", peerVerified: true, saved: true, processCount: 1,
  registryHash: pm2RegistryDigest([row()]), target: { ...target(), dump: { identity: id, sha256: "b".repeat(64) } } });
test("fixed dump actions bind full target/receipt and registry without returning raw environments", async () => {
  const f = fixture();
  f.d.invokeDump = (_python, payload) => {
    f.calls.push(payload);
    return { status: 0, stderr: "", stdout: JSON.stringify(payload.request.action === "capture" ? target()
      : payload.request.action === "persist" ? receipt() : true) };
  };
  assert.deepEqual(await capturePm2DumpTarget(daemon, BOOT, f.d), target());
  assert.deepEqual(await persistPm2Dump(daemon, BOOT, [row()], target(), f.d), receipt());
  assert.equal(await verifyPm2Dump(daemon, BOOT, [row()], receipt(), f.d), true);
  assert.deepEqual(f.calls.map((call) => call.request.action), ["capture", "persist", "verify"]);
  assert.doesNotMatch(JSON.stringify(f.calls), /anonKey|password/);
});
test("dump recursive registry hash is stable across property and registry ordering", () => {
  const original = row(), reordered = Object.fromEntries(Object.entries(original).reverse());
  reordered.pm2_env = Object.fromEntries(Object.entries(original.pm2_env).reverse());
  assert.equal(pm2RegistryDigest([original]), pm2RegistryDigest([reordered]));
  const second = { ...row(), name: "other", pm_id: 8, pm2_env: { ...row().pm2_env, name: "other", pm_id: 8 } };
  assert.equal(pm2RegistryDigest([original, second]), pm2RegistryDigest([second, reordered]));
  assert.notEqual(pm2RegistryDigest([original]), pm2RegistryDigest([{ ...original, pid: 44 }]));
});
test("dump wrong peer, home, hash, identity and extra fields reject before persistence", async () => {
  for (const change of [(t) => { t.daemon.pid++; }, (t) => { t.socketPath = "/other/rpc.sock"; },
    (t) => { t.chain[0][0] = "-1"; }, (t) => { t.dump = { identity: "bad", sha256: "b".repeat(64) }; },
    (t) => { t.rawEnvironment = "secret"; }]) {
    const f = fixture(), t = target(); change(t); let invoked = false;
    f.d.invokeDump = () => { invoked = true; };
    await assert.rejects(persistPm2Dump(daemon, BOOT, [row()], t, f.d)); assert.equal(invoked, false);
  }
  for (const change of [(r) => { r.registryHash = "c".repeat(64); }, (r) => { r.target.dump = null; },
    (r) => { r.processCount = 2; }, (r) => { r.raw = "secret"; }]) {
    const r = receipt(); change(r); assert.throws(() => validatePm2DumpReceipt(r, daemon, BOOT, [row()]));
  }
});
test("lost dump save response is unknown once only; verify is strictly read-only failure", async () => {
  for (const action of ["persist", "verify"]) {
    const f = fixture(); let calls = 0;
    f.d.invokeDump = () => { calls++; throw new Error("private bytes"); };
    await assert.rejects(action === "persist" ? persistPm2Dump(daemon, BOOT, [row()], target(), f.d)
      : verifyPm2Dump(daemon, BOOT, [row()], receipt(), f.d),
    { message: action === "persist" ? "production_maintenance_pm2_outcome_unknown" : "production_maintenance_pm2_unverified" });
    assert.equal(calls, 1);
  }
});

test("ordinary daemon historical proc instantiation changes preserve exact authenticated peer on any bound boot", async () => {
  for (const mutation of [false, true]) {
    const f = fixture(); changeProc(f.current, 1); changeProc(f.current, 3); changeProc(f.current, 4);
    const original = JSON.stringify(daemon);
    if (mutation) await controlPm2(daemon, BOOT, request(), f.d);
    else assert.deepEqual(await inspectPm2Registry(daemon, BOOT, f.d), [row()]);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].payload.daemon.pid, daemon.pid);
    assert.equal(f.calls[0].payload.daemon.startTicks, daemon.startTicks);
    assert.equal(f.calls[0].payload.daemon.bootId, BOOT);
    assert.equal(JSON.stringify(daemon), original);
  }
});

test("pinned historical drift permits one exchange while the immutable original daemon and peer tuple stay bound", async () => {
  const frozen = pinnedDaemon(), originalBytes = JSON.stringify(frozen);
  assert.equal(createHash("sha256").update(originalBytes).digest("hex"), "940d18ed1876a97c6523b56bc213be2c426c89348630527392d9d795dadef6c4");
  for (const mutation of [false, true]) {
    const f = pinnedFixture(); const expected = request(); expected.expectedProcess.bootId = PINNED_BOOT;
    if (mutation) await controlPm2(frozen, PINNED_BOOT, expected, f.d);
    else assert.deepEqual(await inspectPm2Registry(frozen, PINNED_BOOT, f.d), [row()]);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].payload.daemon, { pid: frozen.pid, uid: frozen.uid, startTicks: frozen.startTicks,
      bootId: PINNED_BOOT, executable: frozen.executable, executableIdentity: frozen.executableIdentity });
    assert.equal(Object.hasOwn(f.calls[0].payload.daemon, "processIdentity"), false);
    assert.equal(JSON.stringify(frozen), originalBytes);
  }
});

test("a second fresh procfs change anywhere before send is refused even for the approved daemon", async () => {
  for (const stage of ["first-pair", "python-capture", "helper-capture", "python-verify"]) {
    for (const index of [1, 3, 4]) {
      const f = pinnedFixture();
      if (stage === "first-pair") {
        const read = f.d.readProcess; let reads = 0;
        f.d.readProcess = (...args) => { if (++reads === 2) changeProc(f.current, index); return read(...args); };
      } else if (stage === "python-capture") {
        const capture = f.d.python; f.d.python = () => { changeProc(f.current, index); return capture(); };
      } else if (stage === "helper-capture") {
        const capture = f.d.helperProof; f.d.helperProof = () => { changeProc(f.current, index); return capture(); };
      } else {
        const verify = f.d.verifyPython; f.d.verifyPython = (proof) => { verify(proof); changeProc(f.current, index); };
      }
      await assert.rejects(controlPm2(pinnedDaemon(), PINNED_BOOT, request(), f.d), { message: "production_maintenance_pm2_unverified" });
      assert.equal(f.calls.length, 0, stage);
    }
  }
});

test("post-send historical-looking procfs changes are unknown for mutations and never retried", async () => {
  for (const mutation of [false, true]) for (const index of [1, 3, 4]) {
    const f = pinnedFixture(); f.after = () => changeProc(f.current, index);
    await assert.rejects(mutation ? controlPm2(pinnedDaemon(), PINNED_BOOT, request(), f.d)
      : inspectPm2Registry(pinnedDaemon(), PINNED_BOOT, f.d),
    { message: mutation ? "production_maintenance_pm2_outcome_unknown" : "production_maintenance_pm2_unverified" });
    assert.equal(f.calls.length, 1);
  }
});

test("historical exception does not relax daemon generation, home, title, boot, or private environment gates", async () => {
  for (const change of [(f) => { f.current.pid++; }, (f) => { f.current.parentPid++; }, (f) => { f.current.startTicks = "656"; },
    (f) => { f.current.uid++; }, (f) => { f.current.cwd = "/other"; }, (f) => { f.current.executableIdentity = id; },
    (f) => { f.current.commandLineDigest = "f".repeat(64); }, (f) => { changeProc(f.current, 0); },
    (f) => { f.boot = BOOT; }, (f) => { f.current.commandLine = ["PM2 v6.0.15: God Daemon (/root/.pm2)"]; },
    (f) => { f.d.canonical = () => "/different"; }, (f) => { f.d.daemonEnvironment = () => false; }]) {
    const f = pinnedFixture(); change(f);
    await assert.rejects(inspectPm2Registry(pinnedDaemon(), PINNED_BOOT, f.d), { message: "production_maintenance_pm2_unverified" });
    assert.equal(f.calls.length, 0);
  }
});

test("dump capture, persistence and verification share the same pinned continuity and strict fresh observation boundary", async () => {
  const frozen = pinnedDaemon(), peer = { pid: frozen.pid, uid: frozen.uid, startTicks: frozen.startTicks,
    bootId: PINNED_BOOT, executable: frozen.executable, executableIdentity: frozen.executableIdentity };
  const dumpTarget = { ...target(), daemon: peer }, dumpReceipt = { ...receipt(), target: { ...dumpTarget, dump: receipt().target.dump } };
  for (const action of ["capture", "persist", "verify"]) for (const drift of [false, true]) {
    const f = pinnedFixture();
    f.d.invokeDump = (_python, payload) => {
      f.calls.push(payload); if (drift) changeProc(f.current);
      return { status: 0, stderr: "", stdout: JSON.stringify(action === "capture" ? dumpTarget : action === "persist" ? dumpReceipt : true) };
    };
    const result = action === "capture" ? capturePm2DumpTarget(frozen, PINNED_BOOT, f.d)
      : action === "persist" ? persistPm2Dump(frozen, PINNED_BOOT, [row()], dumpTarget, f.d)
        : verifyPm2Dump(frozen, PINNED_BOOT, [row()], dumpReceipt, f.d);
    if (drift) await assert.rejects(result, { message: action === "persist" ? "production_maintenance_pm2_outcome_unknown" : "production_maintenance_pm2_unverified" });
    else assert.deepEqual(await result, action === "capture" ? dumpTarget : action === "persist" ? dumpReceipt : true);
    assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].daemon, peer);
  }
});
