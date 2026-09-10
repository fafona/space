import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NFT_PIPE_PYTHON, runNftBatch } from "./production-maintenance-nft-transport.mjs";

const ERROR = /^Error: production_maintenance_nft_transport_unverified$/;
function fixture() {
  const calls = [];
  const proof = { target: { path: "/usr/libexec/platform-python3.6" } };
  const d = {
    capturePython() { calls.push("capture"); return proof; },
    verifyPython(value) { assert.equal(value, proof); calls.push("verify"); return true; },
    spawn(command, args, options) { calls.push({ command, args, options }); return { status: 0, signal: null, stdout: "", stderr: "" }; },
  };
  return { calls, d };
}

test("nft rules stay on stdin of a pre/post verified interpreter, never shell, argv, files or ambient env", () => {
  const f = fixture(), script = "create table inet FAOM_test\n";
  assert.deepEqual(runNftBatch(script, f.d), { stdout: "", stderr: "" });
  assert.equal(f.calls.length, 4);
  const call = f.calls[2];
  assert.equal(call.command, "/usr/libexec/platform-python3.6");
  assert.deepEqual(call.args, ["-I", "-S", "-B", "-c", NFT_PIPE_PYTHON]);
  assert.equal(call.args.some((item) => item.includes(script)), false);
  assert.deepEqual(call.options, { input: script, encoding: "utf8", shell: false, windowsHide: true,
    timeout: 15000, killSignal: "SIGKILL", maxBuffer: 2097152, stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" } });
  assert.match(NFT_PIPE_PYTHON, /subprocess\.run\(\["\/usr\/sbin\/nft", "-f", "-"\], input=payload/);
  assert.match(NFT_PIPE_PYTHON, /close_fds=True, timeout=10/);
  assert.doesNotMatch(NFT_PIPE_PYTHON, /tempfile|os\.system|shell=True|open\(/);
});

test("invalid payload refuses before interpreter capture or execution", () => {
  for (const input of [null, {}, "", "x\0y", "x".repeat(2097153)]) {
    const f = fixture(); assert.throws(() => runNftBatch(input, f.d), ERROR); assert.deepEqual(f.calls, []);
  }
});

test("interpreter drift, tool errors, signals, and timeouts are fixed failures without retries", () => {
  const first = fixture(); first.d.verifyPython = () => false;
  assert.throws(() => runNftBatch("script", first.d), ERROR);
  assert.equal(first.calls.some((item) => typeof item === "object"), false);
  for (const patch of [{ status: 1 }, { signal: "SIGKILL" }, { error: new Error("PRIVATE") },
    { stdout: null }, { stderr: "x\0y" }, { stdout: "x".repeat(2097153) }]) {
    const f = fixture(); let attempts = 0;
    f.d.spawn = () => { attempts++; return { status: 0, signal: null, stdout: "", stderr: "", ...patch }; };
    assert.throws(() => runNftBatch("script", f.d), ERROR); assert.equal(attempts, 1);
  }
  const last = fixture(); let checks = 0;
  last.d.verifyPython = () => ++checks === 1;
  assert.throws(() => runNftBatch("script", last.d), ERROR);
  assert.equal(last.calls.filter((item) => typeof item === "object").length, 1);
});

test("stderr is returned for the nft semantic validator, not silently dropped", () => {
  const f = fixture(); f.d.spawn = () => ({ status: 0, signal: null, stdout: "output", stderr: "warning" });
  assert.deepEqual(runNftBatch("script", f.d), { stdout: "output", stderr: "warning" });
});

test("override accessors, proxies and arbitrary options never execute", () => {
  let touched = false;
  for (const d of [{ get spawn() { touched = true; return () => {}; } }, new Proxy({}, {}), { other() {} }]) {
    assert.throws(() => runNftBatch("script", d), ERROR);
  }
  assert.equal(touched, false);
});

test("production ingress uses the same pipe transport only for its exact nft stdin operation", () => {
  const source = readFileSync(new URL("./production-maintenance-ingress.mjs", import.meta.url), "utf8");
  assert.match(source, /command !== "nft" \|\| !eq\(args, \["-f", "-"\]\)/);
  assert.match(source, /if \(options !== undefined\) return runNftBatch\(options\.input\)/);
  assert.doesNotMatch(source, /input: options\.input/);
});
