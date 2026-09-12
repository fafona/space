import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { POSTGREST_ROOT_IMAGE, postgrestRootCreateArgs, validatePostgrestRootContainer,
  postgrestRootCurlArgs, parsePostgrestRootResponse, runPostgrestRootAcceptance } from "./maintenance-postgrest-root-acceptance.mjs";

const DB = "a".repeat(64), ID = "b".repeat(64), IMAGE = "sha256:" + "c".repeat(64);
const NONCE = "12345678-1234-4123-8123-123456789abc", NAME = `faolla-postgrest-root-${NONCE}`;
const expected = { id: ID, databaseId: DB, imageId: IMAGE, name: NAME, nonce: NONCE };
const args = postgrestRootCreateArgs(DB, NAME, NONCE);
const env = args.flatMap((value, i) => value === "--env" ? [args[i + 1]] : []);
function container(status = "running", overrides = expected) {
  return [{ Id: overrides.id, Image: IMAGE, Name: `/${overrides.name}`, Config: {
    Image: POSTGREST_ROOT_IMAGE, User: "1000", Labels: { "com.faolla.postgrest-root-acceptance": overrides.nonce },
    Entrypoint: null, Cmd: ["/bin/postgrest"], Env: [...env],
  }, HostConfig: { NetworkMode: `container:${DB}`, ReadonlyRootfs: true, Privileged: false, Binds: null, Devices: [],
    PortBindings: {}, PublishAllPorts: false, Tmpfs: null, CapDrop: ["ALL"], CapAdd: [], SecurityOpt: ["no-new-privileges"],
    PidMode: "", IpcMode: "private", UTSMode: "", PidsLimit: 128, Memory: 268435456 },
  Mounts: [], NetworkSettings: { Networks: {} }, State: { Status: status, Running: status === "running" } }];
}
test("launch uses only frozen DB netns, fixed image/binary and the synthetic loopback URI", () => {
  assert.ok(args.includes(`container:${DB}`));
  assert.deepEqual(args.slice(-2), [POSTGREST_ROOT_IMAGE, "/bin/postgrest"]);
  assert.ok(args.includes("--read-only")); assert.ok(args.includes("no-new-privileges"));
  assert.ok(!args.includes("--publish") && !args.includes("--volume"));
  assert.match(env.find(value => value.startsWith("PGRST_DB_URI=")), /^PGRST_DB_URI=postgresql:\/\/supabase_admin:faolla-ci-only-disposable-scheduler@127\.0\.0\.1:5432\/postgres$/);
  assert.throws(() => postgrestRootCreateArgs("host", NAME, NONCE));
  assert.throws(() => postgrestRootCreateArgs(DB, "unrelated", NONCE));
});
test("inspect binds both IDs, image, launch env and every isolation prerequisite", () => {
  assert.equal(validatePostgrestRootContainer(container(), expected, "running"), true);
  for (const mutate of [
    r => r.Id = DB, r => r.Image = "sha256:" + "d".repeat(64), r => r.Name = "/other",
    r => r.Config.Labels = {}, r => r.Config.User = "0", r => r.Config.Cmd = ["sh"],
    r => r.Config.Entrypoint = ["sh"], r => r.Config.Env.push("PGRST_DB_URI=postgresql://secret@production/db"),
    r => r.Config.Env.push("PGRST_DB_PRE_REQUEST=unsafe"), r => r.HostConfig.NetworkMode = "host",
    r => r.HostConfig.NetworkMode = "container:" + "d".repeat(64), r => r.HostConfig.ReadonlyRootfs = false,
    r => r.HostConfig.Privileged = true, r => r.Mounts.push({ Type: "bind" }), r => r.HostConfig.Binds = ["/tmp:/tmp"],
    r => r.HostConfig.PortBindings = { "3001/tcp": [{ HostPort: "3001" }] },
    r => r.HostConfig.PublishAllPorts = true, r => r.HostConfig.Devices = [{}],
    r => r.NetworkSettings.Networks.bridge = {}, r => r.HostConfig.Tmpfs = { "/tmp": "rw" },
    r => r.HostConfig.CapAdd = ["SYS_ADMIN"], r => r.HostConfig.CapDrop = [],
    r => r.HostConfig.SecurityOpt = [], r => r.HostConfig.PidMode = "host", r => r.HostConfig.IpcMode = "host",
    r => r.HostConfig.UTSMode = "host", r => r.HostConfig.Memory = 0, r => r.State.Running = false,
  ]) {
    const row = container(); mutate(row[0]);
    assert.throws(() => validatePostgrestRootContainer(row, expected, "running"));
  }
});
test("curl has no proxy/curlrc/redirect/cookie credentials and restricts exact GET root grammar", () => {
  const value = postgrestRootCurlArgs(DB, `http://127.0.0.1:3001/?faolla_maintenance_probe=eq.${NONCE}`);
  assert.deepEqual(value.slice(0, 6), ["exec", DB, "/usr/bin/curl", "-q", "--noproxy", "*"]);
  assert.ok(value.includes("cache-control: no-cache, no-store")); assert.ok(value.includes("pragma: no-cache"));
  assert.equal(value[value.indexOf("--max-time") + 1], "8");
  assert.equal(value[value.indexOf("--request") + 1], "GET");
  assert.ok(!value.includes("--location") && !value.includes("--cookie") && !value.includes("--user"));
  for (const url of ["http://localhost:3001/", "http://127.0.0.1:3000/", "http://127.0.0.1:3001/table",
    `http://127.0.0.1:3001/?faolla_maintenance_probe=eq.${NONCE}&extra=1`, `http://secret@127.0.0.1:3001/?faolla_maintenance_probe=${NONCE}`]) {
    assert.throws(() => postgrestRootCurlArgs(DB, url));
  }
});
test("response framing rejects redirects, oversized or malformed JSON/headers", () => {
  assert.deepEqual(parsePostgrestRootResponse('{"code":"PGRST100"}\n400\napplication/json; charset=utf-8'),
    { status: 400, body: { code: "PGRST100" } });
  for (const raw of ["{}", "{}\n200\ntext/html", "{}\n200\napplication/json\nsecret", "[]\n200\napplication/json", "x".repeat(1048577)]) {
    assert.throws(() => parsePostgrestRootResponse(raw));
  }
});

function fixture(change = () => {}) {
  let row = null, elapsed = 0, queries = 0, checks = 0, removed = false;
  const calls = [], urls = [];
  const docker = (call) => {
    calls.push(call);
    if (call[0] === "pull") return "pulled";
    if (call[0] === "image") return JSON.stringify([{ Id: IMAGE, Architecture: "amd64", Os: "linux",
      RepoTags: [POSTGREST_ROOT_IMAGE], Config: { Entrypoint: null, Cmd: ["/bin/postgrest"] } }]);
    if (call[0] === "create") {
      const name = call[call.indexOf("--name") + 1], nonce = call[call.indexOf("--label") + 1].split("=")[1];
      row = container("created", { ...expected, name, nonce }); return ID;
    }
    if (call[0] === "inspect") { assert.equal(call[1], ID); return JSON.stringify(row); }
    if (call[0] === "start") { row[0].State = { Status: "running", Running: true }; return ID; }
    if (call[0] === "exec") {
      assert.equal(call[1], DB);
      const url = call.at(-1); urls.push(url); queries++;
      const eq = new URL(url).searchParams.get("faolla_maintenance_probe").startsWith("eq.");
      const response = { status: eq ? 200 : 400, body: eq ? { swagger: "2.0", paths: {} } : { code: "PGRST100" } };
      change({ row, response, queries });
      return JSON.stringify(response.body) + `\n${response.status}\napplication/json`;
    }
    if (call[0] === "rm") { assert.deepEqual(call, ["rm", "--force", ID]); removed = true; return ID; }
    assert.fail("unexpected command");
  };
  const input = { databaseId: DB, assertDatabase: () => { checks++; }, docker };
  return { input, calls, urls, timing: { now: () => elapsed, pause: async ms => { elapsed += ms; } },
    get removed() { return removed; }, get checks() { return checks; } };
}
test("real-image orchestration requires legacy rejection and three fresh successes before exact cleanup", async () => {
  const f = fixture();
  const result = await runPostgrestRootAcceptance(f.input, f.timing);
  assert.deepEqual(result, { image: POSTGREST_ROOT_IMAGE, groups: 2, freshSuccessfulRequests: 3,
    network: "shared_disposable_none", evidence: "real_postgrest_root_not_gateway" });
  assert.equal(f.urls.length, 5); assert.equal(new Set(f.urls).size, 5);
  assert.equal(f.removed, true); assert.ok(f.checks >= 14);
  assert.equal(f.calls.at(-1)[0], "rm");
});
test("legacy false-positive, malformed success and later transient failure are fatal without replay", async () => {
  for (const failure of ["legacy", "body", "unavailable"]) {
    const f = fixture(({ response, queries }) => {
      if (failure === "legacy" && queries === 2) response.status = 200;
      if (failure === "body" && queries === 3) response.body = { cached: true };
      if (failure === "unavailable" && queries === 3) throw Error("SECRET_SENTINEL");
    });
    await assert.rejects(runPostgrestRootAcceptance(f.input, f.timing),
      { message: `postgrest_root_acceptance_${failure === "legacy" ? "legacy_nonce" : "valid_nonce"}_failed` });
    assert.equal(f.urls.length, failure === "legacy" ? 2 : 3); assert.equal(f.removed, true);
  }
});
test("readiness is bounded and ownership changes never authorize reading or deleting another container", async () => {
  const cold = fixture(({ response }) => { response.status = 503; });
  await assert.rejects(runPostgrestRootAcceptance(cold.input, cold.timing), /_ready_failed$/);
  assert.equal(cold.removed, true);
  const changed = fixture(({ row }) => { row[0].Id = DB; });
  await assert.rejects(runPostgrestRootAcceptance(changed.input, changed.timing), /_cleanup_failed$/);
  assert.equal(changed.urls.length, 1); assert.equal(changed.removed, false);
});
test("DB identity failure blocks create, cleanup failure cannot return success", async () => {
  const f = fixture();
  await assert.rejects(runPostgrestRootAcceptance({ ...f.input, assertDatabase: () => { throw Error("SECRET_SENTINEL"); } }),
    { message: "postgrest_root_acceptance_image_failed" });
  assert.equal(f.calls.length, 0);
  const broken = fixture(), original = broken.input.docker;
  broken.input.docker = args => { if (args[0] === "rm") throw Error("SECRET_SENTINEL"); return original(args); };
  await assert.rejects(runPostgrestRootAcceptance(broken.input, broken.timing), { message: "postgrest_root_acceptance_cleanup_failed" });
});
test("module is inert without explicit parent transport and has no standalone/host fetch or env channel", async () => {
  await assert.rejects(runPostgrestRootAcceptance({ databaseId: DB }));
  const source = readFileSync(new URL("./maintenance-postgrest-root-acceptance.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /spawnSync|fetch\(|process\.env|process\.argv|docker\(\["(?:system|volume|container)", "prune"/);
  assert.match(source, /createIngressProbeUrl\(BASE, "rest"\)/);
});
