import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIngressProbeUrl } from "./production-maintenance-ingress.mjs";

// CI-only companion to the scheduler's already verified NEW synthetic DB.
// The shared namespace is network-none: neither container can reach a host
// listener or the Internet. Image pulling is the parent runner's fixed Docker
// transport. No production URL, credential, mount or alternate DB is accepted.
// Official amd64 layout: PostgREST v14.5 nix/tools/docker/default.nix.
export const POSTGREST_ROOT_IMAGE = "postgrest/postgrest:v14.5";
const LABEL = "com.faolla.postgrest-root-acceptance";
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE = "http://127.0.0.1:3001/";
const ENV = Object.freeze([
  "PGRST_DB_URI=postgresql://supabase_admin:faolla-ci-only-disposable-scheduler@127.0.0.1:5432/postgres",
  "PGRST_DB_ANON_ROLE=supabase_admin", "PGRST_DB_SCHEMAS=public",
  "PGRST_SERVER_HOST=127.0.0.1", "PGRST_SERVER_PORT=3001", "PGRST_DB_POOL=1",
]);
const fail = () => { throw new Error("postgrest_root_acceptance_unverified"); };
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
const empty = value => value === null || value === undefined || Array.isArray(value) && value.length === 0;

export function postgrestRootCreateArgs(databaseId, name, nonce) {
  if (!HEX.test(databaseId) || !UUID.test(nonce) || name !== `faolla-postgrest-root-${nonce}`) fail();
  return ["create", "--platform", "linux/amd64", "--name", name, "--label", `${LABEL}=${nonce}`,
    "--network", `container:${databaseId}`, "--read-only", "--user", "1000",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "256m",
    ...ENV.flatMap(value => ["--env", value]), POSTGREST_ROOT_IMAGE, "/bin/postgrest"];
}

export function validatePostgrestRootContainer(value, expected, status) {
  const row = Array.isArray(value) && value.length === 1 ? value[0] : null;
  const config = row?.Config, host = row?.HostConfig;
  if (!row || !HEX.test(expected.id) || !HEX.test(expected.databaseId) || row.Id !== expected.id ||
      !/^sha256:[0-9a-f]{64}$/.test(expected.imageId) || row.Image !== expected.imageId ||
      row.Name !== `/${expected.name}` || !UUID.test(expected.nonce) || expected.name !== `faolla-postgrest-root-${expected.nonce}` ||
      config?.Image !== POSTGREST_ROOT_IMAGE || config.User !== "1000" || config.Labels?.[LABEL] !== expected.nonce ||
      !empty(config.Entrypoint) || JSON.stringify(config.Cmd) !== JSON.stringify(["/bin/postgrest"]) ||
      !Array.isArray(config.Env) || JSON.stringify(config.Env.filter(item => item.startsWith("PGRST_")).sort()) !== JSON.stringify([...ENV].sort()) ||
      host?.NetworkMode !== `container:${expected.databaseId}` || host.ReadonlyRootfs !== true || host.Privileged !== false ||
      !Array.isArray(row.Mounts) || row.Mounts.length !== 0 || !empty(host.Binds) || !empty(host.Devices) ||
      Object.keys(host.PortBindings ?? {}).length !== 0 || host.PublishAllPorts !== false ||
      Object.keys(row.NetworkSettings?.Networks ?? {}).length !== 0 || Object.keys(host.Tmpfs ?? {}).length !== 0 ||
      JSON.stringify(host.CapDrop) !== JSON.stringify(["ALL"]) || !empty(host.CapAdd) ||
      !host.SecurityOpt?.includes("no-new-privileges") || host.PidMode || host.IpcMode === "host" || host.UTSMode === "host" ||
      host.PidsLimit !== 128 || host.Memory !== 268435456 ||
      row.State?.Status !== status || (status === "running" && row.State.Running !== true)) fail();
  return true;
}

export function postgrestRootCurlArgs(databaseId, url) {
  if (!HEX.test(databaseId)) fail();
  const parsed = new URL(url);
  if (parsed.origin !== "http://127.0.0.1:3001" || parsed.pathname !== "/" || parsed.hash || parsed.username || parsed.password ||
      parsed.searchParams.size !== 1 || !parsed.searchParams.has("faolla_maintenance_probe") ||
      !/^(?:eq\.)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parsed.searchParams.get("faolla_maintenance_probe"))) fail();
  return ["exec", databaseId, "/usr/bin/curl", "-q", "--noproxy", "*", "--silent", "--show-error",
    "--request", "GET", "--connect-timeout", "2", "--max-time", "8", "--max-filesize", "1048576",
    "--header", "cache-control: no-cache, no-store", "--header", "pragma: no-cache",
    "--output", "-", "--write-out", "\n%{http_code}\n%{content_type}", "--url", parsed.href];
}

export function parsePostgrestRootResponse(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 1048576) fail();
  const last = raw.lastIndexOf("\n"), before = raw.lastIndexOf("\n", last - 1);
  const status = raw.slice(before + 1, last), type = raw.slice(last + 1);
  if (before < 0 || !/^[1-5][0-9]{2}$/.test(status) ||
      !/^(?:application\/json|application\/openapi\+json)(?:;[^\r\n]*)?$/i.test(type)) fail();
  const body = JSON.parse(raw.slice(0, before));
  if (!body || typeof body !== "object" || Array.isArray(body)) fail();
  return { status: Number(status), body };
}

// The parent must first verify empty cluster identity and setup its fixture.
// assertDatabase rechecks exact ID/image/isolation before AND after each GET.
// This helper has no default transport, standalone CLI, or host-network path.
export async function runPostgrestRootAcceptance({ databaseId, assertDatabase, docker }, timing = {}) {
  if (!HEX.test(databaseId) || typeof assertDatabase !== "function" || typeof docker !== "function") fail();
  const now = timing.now ?? Date.now, wait = timing.pause ?? pause;
  const nonce = randomUUID(), name = `faolla-postgrest-root-${nonce}`;
  let owned = null, phase = "image", failed = null, result;
  const inspect = status => validatePostgrestRootContainer(JSON.parse(docker(["inspect", owned.id])), owned, status);
  const get = url => {
    assertDatabase(); inspect("running");
    const value = parsePostgrestRootResponse(docker(postgrestRootCurlArgs(databaseId, url), undefined, 10000));
    assertDatabase(); inspect("running");
    return value;
  };
  try {
    assertDatabase();
    docker(["pull", "--platform", "linux/amd64", POSTGREST_ROOT_IMAGE], undefined, 240000);
    const image = JSON.parse(docker(["image", "inspect", POSTGREST_ROOT_IMAGE]));
    if (!Array.isArray(image) || image.length !== 1 || !/^sha256:[0-9a-f]{64}$/.test(image[0]?.Id) ||
        image[0].Architecture !== "amd64" || image[0].Os !== "linux" || !image[0].RepoTags?.includes(POSTGREST_ROOT_IMAGE) ||
        !empty(image[0].Config?.Entrypoint) || JSON.stringify(image[0].Config?.Cmd) !== JSON.stringify(["/bin/postgrest"]) ||
        Object.keys(image[0].Config?.Volumes ?? {}).length !== 0) fail();
    phase = "create"; assertDatabase();
    const id = docker(postgrestRootCreateArgs(databaseId, name, nonce));
    if (!HEX.test(id)) fail();
    owned = { id, databaseId, name, nonce, imageId: image[0].Id };
    inspect("created"); phase = "start"; docker(["start", id]);
    // Only startup readiness may repeat. Each attempt has a NEW URL; neither
    // the negative regression nor any acceptance request is retried.
    phase = "ready";
    const deadline = now() + 30000;
    while (true) {
      assertDatabase(); inspect("running");
      try {
        const response = get(createIngressProbeUrl(BASE, "rest"));
        if (response.status === 200) break;
      } catch { /* Recheck ownership below; never treat transport failure as a pass. */ }
      assertDatabase(); inspect("running");
      if (now() >= deadline) fail();
      await wait(100);
    }
    phase = "legacy_nonce";
    const legacy = get(createIngressProbeUrl(BASE, "blocked"));
    assert.equal(legacy.status, 400); assert.equal(legacy.body.code, "PGRST100");
    phase = "valid_nonce";
    const urls = new Set();
    for (let i = 0; i < 3; i++) {
      const url = createIngressProbeUrl(BASE, "rest"); assert.equal(urls.has(url), false); urls.add(url);
      const response = get(url);
      assert.equal(response.status, 200); assert.equal(response.body.swagger, "2.0");
      assert.ok(response.body.paths && typeof response.body.paths === "object" && !Array.isArray(response.body.paths));
    }
    result = { image: POSTGREST_ROOT_IMAGE, groups: 2, freshSuccessfulRequests: urls.size,
      network: "shared_disposable_none", evidence: "real_postgrest_root_not_gateway" };
  } catch { failed = phase; }
  finally {
    try {
      if (owned) {
        assertDatabase();
        const value = JSON.parse(docker(["inspect", owned.id]));
        const status = value?.[0]?.State?.Status;
        if (!["created", "running", "exited"].includes(status)) fail();
        validatePostgrestRootContainer(value, owned, status);
        docker(["rm", "--force", owned.id], undefined, 15000);
        assertDatabase();
      }
    } catch { failed = "cleanup"; }
  }
  if (failed) throw new Error(`postgrest_root_acceptance_${failed}_failed`);
  return result;
}
