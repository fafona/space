import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  captureMaintenanceTopologyArguments, collectMaintenanceTopology, readMaintenanceRuntimeVersion,
  summarizeMaintenanceDocker, summarizeMaintenanceNginx, validateMaintenanceTopologyReport,
  validateMaintenanceTopologyReportFile,
} from "./check-production-maintenance-topology.mjs";

const BUILD = "c".repeat(40);
const OTHER_BUILD = "d".repeat(40);
const ID = "1".repeat(64);
const script = fileURLToPath(new URL("./check-production-maintenance-topology.mjs", import.meta.url));
const args = () => ["/srv/faolla", "faolla", "3000", BUILD];
const version = () => ({ ok: true, buildId: BUILD, releasedAt: "2026-09-09T10:00:00.000Z" });
const record = () => ({ id: ID, name: "supabase-kong" });
const detail = () => ({ id: ID, name: "/supabase-kong", state: "running", networkMode: "bridge",
  ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "8000" }] } });
const nginx = `# SECRET_COMMENT server_name ignored.example;
server { listen 80; listen [::]:443 ssl; server_name faolla.com www.faolla.com launch.faolla.com;
  proxy_pass http://127.0.0.1:3000/private-path; add_header X-Secret SECRET_HEADER;
}
server { listen unix:/private.sock; proxy_pass http://localhost:8000; }
server { proxy_pass http://private-upstream.internal:9999; }
`;
function dependencies(overrides = {}) {
  const calls = [];
  return { calls, getVersion: async () => version(), run(command, parameters) {
    calls.push([command, parameters]);
    if (command === "nginx") return nginx;
    if (parameters.includes("ps")) return `${JSON.stringify(record())}\n${JSON.stringify({ id: "2".repeat(64), name: "private-other-container" })}\n`;
    if (parameters.includes("inspect")) return JSON.stringify(detail());
    throw new Error("unexpected command");
  }, ...overrides };
}
async function report() { return collectMaintenanceTopology(args(), dependencies()); }
function withReportFile(text, callback) {
  const directory = mkdtempSync(path.join(tmpdir(), "faolla-maintenance-report-test-"));
  const file = path.join(directory, "report.json");
  try { writeFileSync(file, text); return callback(file); }
  finally { rmSync(directory, { recursive: true }); }
}

test("argument capture rejects invalid inputs before any diagnostics", async () => {
  assert.deepEqual(captureMaintenanceTopologyArguments(args()), { appDir: "/srv/faolla", appName: "faolla", port: 3000, expectedRuntimeBuildId: BUILD });
  for (const invalid of [[], ["/", "faolla", "3000", BUILD], ["/srv/../private", "faolla", "3000", BUILD],
    ["/srv/faolla", "faolla;echo", "3000", BUILD], ["/srv/faolla", "faolla", "03000", BUILD],
    ["/srv/faolla", "faolla", "65536", BUILD], ["/srv/faolla", "faolla", "3000", "C".repeat(40)]]) {
    const deps = dependencies({ getVersion: () => assert.fail("no HTTP"), run: () => assert.fail("no commands") });
    await assert.rejects(collectMaintenanceTopology(invalid, deps), /maintenance_topology_arguments_invalid/);
  }
});

test("collector uses bounded fixed roles and does not imply maintenance readiness", async () => {
  const deps = dependencies(); const result = await collectMaintenanceTopology(args(), deps);
  assert.equal(result.maintenanceState, "not_verified");
  assert.equal(result.runtime.status, "verified");
  assert.equal(result.pm2.code, "pm2_inventory_not_collected");
  assert.deepEqual(result.cron, { status: "unknown", code: "cron_not_inspected" });
  assert.deepEqual(deps.calls.map(([command, parameters]) => [command, parameters[2]]), [["docker", "ps"], ["docker", "inspect"], ["nginx", undefined]]);
  assert.deepEqual(deps.calls[0][1].slice(0, 3), ["--host", "unix:///var/run/docker.sock", "ps"]);
  assert.equal(deps.calls[1][1].at(-1), ID);
  assert.deepEqual(deps.calls[2], ["nginx", ["-T"]]);
  assert.equal(result.docker.data.otherContainerCount, 1);
  assert.equal(result.docker.data.roles[0].networkReachability, "not_inspected");
  assert.deepEqual(result.docker.data.roles[0].publishedHostPorts, [8000]);
  for (const raw of ["SECRET_COMMENT", "SECRET_HEADER", "/private-path", "private-upstream", "private-other-container", ID, "127.0.0.1"])
    assert.equal(JSON.stringify(result).includes(raw), false);
});

test("command failures are unavailable with fixed codes and no stderr", async () => {
  const result = await collectMaintenanceTopology(args(), dependencies({ run: () => { throw new Error("private password marker"); } }));
  assert.deepEqual(result.docker, { status: "unavailable", code: "docker_topology_unavailable", data: null });
  assert.deepEqual(result.nginx, { status: "unavailable", code: "nginx_topology_unavailable", data: null });
  assert.equal(JSON.stringify(result).includes("password"), false);
});

test("live build mismatch remains a fact but cannot become verified", async () => {
  const result = await collectMaintenanceTopology(args(), dependencies({ getVersion: async () => ({ ...version(), buildId: OTHER_BUILD }) }));
  assert.deepEqual(result.runtime, { status: "mismatch", code: "runtime_build_mismatch", buildId: OTHER_BUILD });
  assert.throws(() => validateMaintenanceTopologyReport({ ...result, runtime: { ...result.runtime, status: "verified", code: null } }, BUILD));
  assert.throws(() => validateMaintenanceTopologyReport(result, OTHER_BUILD));
});

test("invalid or unavailable version responses never become verified", async () => {
  for (const value of [null, { ...version(), token: "private" }, { ...version(), ok: false }, { ...version(), buildId: "bad" }]) {
    const result = await collectMaintenanceTopology(args(), dependencies({ getVersion: async () => value }));
    assert.equal(result.runtime.status, "unavailable");
  }
});

test("argument binding is captured before awaiting the version response", async () => {
  const input = args();
  const result = await collectMaintenanceTopology(input, dependencies({ getVersion: async () => { input[3] = OTHER_BUILD; input[2] = "1234"; return version(); } }));
  assert.equal(result.expectedRuntimeBuildId, BUILD);
  assert.equal(result.nginx.data.upstreams.appLoopback, true);
});

test("Docker classifies exposure without reporting raw addresses", () => {
  const row = detail();
  row.ports["8000/tcp"] = [
    { HostIp: "127.0.0.1", HostPort: "8000" }, { HostIp: "0.0.0.0", HostPort: "8000" },
    { HostIp: "192.0.2.12", HostPort: "9000" }, { HostIp: "invalid-address", HostPort: "9001" },
  ];
  const result = summarizeMaintenanceDocker([record()], [row]);
  assert.deepEqual(result.roles[0].publishedPortExposure, ["all_interfaces", "loopback", "non_loopback", "unknown"]);
  assert.deepEqual(result.roles[0].publishedHostPorts, [8000, 9000, 9001]);
  assert.equal(JSON.stringify(result).includes("192.0.2.12"), false);
});

test("host or shared-container networks without bindings remain reachability unknown", () => {
  for (const mode of ["host", `container:${"a".repeat(64)}`]) {
    const result = summarizeMaintenanceDocker([record()], [{ ...detail(), networkMode: mode, ports: { "8000/tcp": null } }]);
    assert.deepEqual(result.roles[0].publishedPortExposure, ["unknown"]);
    assert.deepEqual(result.roles[0].publishedHostPorts, []);
    assert.equal(result.roles[0].networkReachability, "not_inspected");
  }
  const result = summarizeMaintenanceDocker([record()], [{ ...detail(), networkMode: "private-network-name" }]);
  assert.equal(result.roles[0].networkMode, "custom");
  assert.equal(JSON.stringify(result).includes("private-network-name"), false);
});

test("Docker rejects duplicated identities, mismatched inspect and malformed port data", () => {
  assert.throws(() => summarizeMaintenanceDocker([record(), record()], [detail(), detail()]));
  assert.throws(() => summarizeMaintenanceDocker([record()], [{ ...detail(), name: "/other" }]));
  assert.throws(() => summarizeMaintenanceDocker([record()], [{ ...detail(), id: "2".repeat(64) }]));
  for (const port of ["0", "65536", "08000", "8000;private"]) {
    const row = detail(); row.ports["8000/tcp"][0].HostPort = port;
    assert.throws(() => summarizeMaintenanceDocker([record()], [row]));
  }
});

test("nonfixed Docker service names only contribute to other count", () => {
  const result = summarizeMaintenanceDocker([{ id: ID, name: "supabase-kong-custom" }], []);
  assert.equal(result.otherContainerCount, 1);
  assert.ok(result.roles.every((row) => row.count === 0));
});

test("duplicate Docker JSON keys fail closed before inspect", async () => {
  const calls = [];
  const result = await collectMaintenanceTopology(args(), dependencies({ run: (command, parameters) => {
    calls.push(parameters); if (command === "nginx") return nginx;
    return `{"id":"${ID}","name":"other","na\\u006de":"supabase-kong"}`;
  } }));
  assert.equal(result.docker.status, "unavailable");
  assert.equal(calls.some((parameters) => parameters.includes("inspect")), false);
});

test("Nginx emits only domain, listen and upstream classifications plus digest", () => {
  const result = summarizeMaintenanceNginx(nginx, 3000);
  assert.deepEqual(result.configuredDomains, { faolla: true, www: true, launch: true });
  assert.deepEqual(result.listenPorts, [80, 443]);
  assert.equal(result.unknownListenCount, 1);
  assert.deepEqual(result.upstreams, { appLoopback: true, supabaseLoopback: true, otherUpstreamCount: 1 });
  assert.match(result.configHash, /^[0-9a-f]{64}$/);
  assert.throws(() => summarizeMaintenanceNginx("x".repeat(1_048_577), 3000));
});

test("report validator rejects unknown fields, calendar errors and readiness promotion", async () => {
  const valid = await report();
  for (const mutate of [
    (copy) => { copy.private = "secret"; },
    (copy) => { copy.observedAt = "2026-02-30T00:00:00.000Z"; },
    (copy) => { copy.maintenanceState = "verified"; },
    (copy) => { copy.docker.data.roles[0].networkReachability = "safe"; },
    (copy) => { copy.docker.data.roles[0].publishedHostPorts = [0]; },
    (copy) => { copy.docker.data.roles[0].networkMode = "private-name"; },
    (copy) => { copy.nginx.data.upstreams.private = "secret"; },
    (copy) => { copy.nginx.data.configHash = "x".repeat(64); },
  ]) {
    const copy = structuredClone(valid); mutate(copy);
    assert.throws(() => validateMaintenanceTopologyReport(copy, BUILD), /maintenance_topology_report_invalid/);
  }
});

test("report capture rejects accessors and returns a detached copy", async () => {
  const valid = await report(); let reads = 0;
  const invalid = structuredClone(valid);
  Object.defineProperty(invalid.docker.data.roles, "0", { enumerable: true, get() { reads++; return valid.docker.data.roles[0]; } });
  assert.throws(() => validateMaintenanceTopologyReport(invalid, BUILD));
  assert.equal(reads, 0);
  const captured = validateMaintenanceTopologyReport(valid, BUILD);
  valid.nginx.data.listenPorts.push(9999);
  assert.deepEqual(captured.nginx.data.listenPorts, [80, 443]);
});

test("report file rejects duplicate keys, overlarge content and invalid UTF-8", async () => {
  const valid = await report(); const encoded = JSON.stringify(valid);
  withReportFile(encoded, (file) => assert.deepEqual(validateMaintenanceTopologyReportFile(file, BUILD), valid));
  for (const raw of [encoded.replace('"version":1', '"version":1,"version":1'), " ".repeat(32769), Buffer.from([0xff])])
    withReportFile(raw, (file) => assert.throws(() => validateMaintenanceTopologyReportFile(file, BUILD)));
});

test("CLI validate prints only approved report and strongly binds expected build", async () => {
  const valid = await report();
  withReportFile(JSON.stringify(valid), (file) => {
    const result = spawnSync(process.execPath, [script, "--validate-report", file, BUILD], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0); assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), valid);
    const wrong = spawnSync(process.execPath, [script, "--validate-report", file, OTHER_BUILD], { encoding: "utf8", timeout: 5000 });
    assert.equal(wrong.status, 23); assert.equal(wrong.stdout, "");
    assert.equal(wrong.stderr, "[maintenance-topology] maintenance_topology_report_invalid\n");
  });
});

test("CLI mismatch exits nonzero and malformed reports never leak raw data", async () => {
  const valid = await report(); valid.runtime = { status: "mismatch", code: "runtime_build_mismatch", buildId: OTHER_BUILD };
  withReportFile(JSON.stringify(valid), (file) => {
    const result = spawnSync(process.execPath, [script, "--validate-report", file, BUILD], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 20); assert.equal(JSON.parse(result.stdout).runtime.status, "mismatch");
  });
  withReportFile('{"secret":"DO_NOT_OUTPUT_RAW"}', (file) => {
    const result = spawnSync(process.execPath, [script, "--validate-report", file, BUILD], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 23); assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes("DO_NOT_OUTPUT_RAW"), false);
  });
});

test("SSH stdin entrypoint accepts the same bounded validator protocol", async () => {
  const valid = await report();
  withReportFile(JSON.stringify(valid), (file) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-", "--validate-report", file, BUILD],
      { input: readFileSync(script, "utf8"), encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), valid);
  });
});

test("loopback HTTP uses one fixed GET without cookies, proxy or redirect following", async () => {
  const original = http.get; const calls = [];
  try {
    http.get = (options, callback) => {
      calls.push(options); const request = new EventEmitter(); request.destroy = () => {};
      queueMicrotask(() => {
        const response = new EventEmitter(); response.statusCode = 302; response.destroy = () => {};
        callback(response);
      });
      return request;
    };
    assert.equal(await readMaintenanceRuntimeVersion(3000), null);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { host: "127.0.0.1", port: 3000, path: "/api/app-web-version", method: "GET", agent: false,
      timeout: 3000, headers: { accept: "application/json" } });
    assert.equal(await readMaintenanceRuntimeVersion("https://private"), null); assert.equal(calls.length, 1);
  } finally { http.get = original; }
});

test("loopback body is bounded and rejects duplicate identity JSON", async () => {
  const original = http.get;
  try {
    for (const body of [JSON.stringify(version()), "x".repeat(16385), `{"ok":true,"buildId":"${BUILD}","buildId":"${OTHER_BUILD}","releasedAt":"now"}`]) {
      http.get = (_options, callback) => {
        const request = new EventEmitter(); request.destroy = () => {};
        queueMicrotask(() => {
          const response = new EventEmitter(); response.statusCode = 200; response.destroy = () => {};
          callback(response); response.emit("data", Buffer.from(body)); response.emit("end");
        });
        return request;
      };
      assert.deepEqual(await readMaintenanceRuntimeVersion(3000), body === JSON.stringify(version()) ? version() : null);
    }
  } finally { http.get = original; }
});
