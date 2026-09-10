import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { bindMaintenancePublicSupabaseUrl, selectMaintenancePublicGateway } from "./maintenance-effective-public-gateway.mjs";

const ERROR = /^maintenance_public_gateway_unverified$/;
const raw = "http://8.8.8.8:8000";
const gateway = "https://faolla.com/";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const rejects = (callback) => assert.throws(callback, (error) => ERROR.test(error.message));

test("only the observed canonical public IPv4 HTTP 8000 root selects the fixed candidate", () => {
  assert.equal(selectMaintenancePublicGateway(raw), gateway);
  assert.equal(selectMaintenancePublicGateway(raw + "/"), gateway);
  assert.equal(selectMaintenancePublicGateway("http://1.1.1.1:8000/"), gateway);
});

test("existing HTTPS values are retained byte for byte rather than rewritten", () => {
  for (const value of ["https://database.example", "https://database.example/", "https://database.example/supabase", "https://faolla.com:443/"]) {
    assert.equal(selectMaintenancePublicGateway(value), value);
    assert.equal(bindMaintenancePublicSupabaseUrl(value, value), value);
  }
});

test("no arbitrary HTTP hostname, scheme, port, subpath or proxy fallback is accepted", () => {
  for (const value of ["http://faolla.com:8000", "http://other.example:8000/", "http://8.8.8.8", "http://8.8.8.8:8443/",
    raw + "/supabase", raw + "/api/supabase-proxy", "https://faolla.com/api/supabase-proxy", "ftp://8.8.8.8:8000/",
    "http://8.8.8.8:8000/?", raw + "#", raw + "?secret=sentinel", "http://user:sentinel@8.8.8.8:8000/"]) rejects(() => selectMaintenancePublicGateway(value));
});

test("private, loopback, link-local, multicast, reserved and documentation IPv4 are not the observed public layout", () => {
  for (const host of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "100.64.0.1", "100.127.255.254", "169.254.2.3",
    "172.16.0.1", "172.31.255.254", "192.168.1.2", "192.0.0.9", "192.0.2.1", "198.18.0.1", "198.19.0.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255"]) rejects(() => selectMaintenancePublicGateway(`http://${host}:8000/`));
});

test("URL normalization cannot admit shorthand, nondecimal IPv4, IPv6 or path traversal", () => {
  for (const value of ["http://134744072:8000/", "http://0x08080808:8000/", "http://010.010.010.010:8000/",
    "http://8.8.2056:8000/", "http://[::1]:8000/", raw + "/x/../", raw + "//", "HTTP://8.8.8.8:8000/"]) rejects(() => selectMaintenancePublicGateway(value));
});

test("bounded scalar inputs reject without invoking object accessors or revealing errors", () => {
  let touched = 0;
  const hostile = { toString() { touched++; throw new Error("secret-sentinel"); } };
  for (const value of [null, undefined, 0, {}, hostile, new Proxy({}, { get() { touched++; throw new Error("secret-sentinel"); } }),
    "https://" + "a".repeat(1001), " " + raw, raw + "\n", raw + "\0", "https://example.com\\other"]) rejects(() => selectMaintenancePublicGateway(value));
  assert.equal(touched, 0);
});

test("an inactive context preserves the exact original value and performs no gateway selection", () => {
  for (const value of [raw, "http://127.0.0.1:8000", "https://database.example", "https://database.example/"]) {
    assert.equal(bindMaintenancePublicSupabaseUrl(value, null), value);
  }
});

test("active consumers require the exact selected state gateway, never a caller override", () => {
  assert.equal(bindMaintenancePublicSupabaseUrl(raw, gateway), gateway);
  for (const target of [undefined, {}, raw, "http://faolla.com/", "https://other.example/", "https://www.faolla.com/", "https://faolla.com"]) {
    rejects(() => bindMaintenancePublicSupabaseUrl(raw, target));
  }
});

const deploy = readFileSync(new URL("./deploy.production.sh", import.meta.url), "utf8");
const start = deploy.indexOf('let publicBase = process.env.FAOLLA_NEXT_PUBLIC_SUPABASE_URL ?? "";');
const end = deploy.indexOf("const expectedProbes = [", start);
assert.ok(start > 0 && end > start);
const consumer = deploy.slice(start, end).replaceAll("await import(", "await importModule(") + "\nreturn {publicBase,publicBaseSha};";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const executeConsumer = new AsyncFunction("process", "realpathSync", "pathToFileURL", "importModule", "fail", "sha256", "normalizeBase", consumer);
async function marker(rawPublic, mode, context) {
  const calls = [], environment = { FAOLLA_NEXT_PUBLIC_SUPABASE_URL: rawPublic };
  const result = await executeConsumer({ env: environment, argv: ["node", "-", "marker", "request", mode, "/approved/scripts"] },
    (path) => { calls.push("canonical"); assert.equal(path, "/approved/scripts"); return path; }, pathToFileURL,
    async (url) => {
      calls.push(url);
      if (url.endsWith("/production-maintenance-control.mjs")) return { readMaintenanceProbeContext(received) { assert.equal(received, environment); return context; } };
      if (url.endsWith("/maintenance-effective-public-gateway.mjs")) return { bindMaintenancePublicSupabaseUrl };
      assert.fail("unexpected import");
    }, () => { throw new Error("marker_rejected"); }, hash, (value) => new URL(value).href);
  return { ...result, calls };
}

test("the actual deployment marker consumer retains off-mode raw hash with no imports or state reads", async () => {
  const result = await marker(raw, "off", null);
  assert.equal(result.publicBase, raw);
  assert.equal(result.publicBaseSha, hash(raw + "/"));
  assert.deepEqual(result.calls, []);
});

test("the actual deployment marker consumer uses the same active gateway selection for its evidence hash", async () => {
  const result = await marker(raw, "maintenance", { publicSupabaseUrl: gateway });
  assert.equal(result.publicBase, gateway);
  assert.equal(result.publicBaseSha, hash(gateway));
  assert.equal(result.calls.length, 3);
  assert.notEqual(result.publicBaseSha, hash(raw + "/"));
});

test("the deployment marker rejects missing context, mismatched gateway and invalid mode", async () => {
  await assert.rejects(marker(raw, "maintenance", null), /marker_rejected/);
  await assert.rejects(marker(raw, "maintenance", { publicSupabaseUrl: "https://other.example/" }), /maintenance_public_gateway_unverified/);
  await assert.rejects(marker(raw, "invalid", null), /marker_rejected/);
});

test("Bash binds source path and mode while preserving marker argv and raw runtime identities", () => {
  assert.match(deploy, /"\$READINESS_FENCE_MARKER" "\$READINESS_FENCE_RELEASE_REQUEST" \\\n\s+"\$PRODUCTION_MAINTENANCE_MODE" "\$APP_DIR\/scripts" <<'NODE'/);
  assert.match(deploy, /const markerPath = process\.argv\[2\]/);
  assert.match(deploy, /const releaseRequestPath = process\.argv\[3\]/);
  assert.match(deploy, /FAOLLA_NEXT_PUBLIC_SUPABASE_URL="\$FINAL_NEXT_PUBLIC_SUPABASE_URL"/);
  assert.match(deploy, /entry\.baseEndpointSha256 !== baseSha/);
  assert.doesNotMatch(consumer, /writeFile|spawn|fetch\(|exec\(|SUPABASE_ANON/);
});
