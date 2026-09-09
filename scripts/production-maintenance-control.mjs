import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { diagnoseRuntimeCompatibility, validateRuntimeCompatibilityDiagnostic } from "./production-maintenance-runtime-diagnostic.mjs";

const ROOT = "/var/lib/faolla-maintenance";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const APP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const PHASES = ["preparing", "held", "candidate", "resuming", "ended", "failed-held", "failed-unknown"];
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const failure = (code) => { throw new Error(code); };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function parseMaintenanceRequest(argv) {
  const [action, ...values] = argv;
  if (!["diagnose-runtime", "plan", "prepare", "check-held", "check-runtime-held", "runtime-handoff", "register-candidate", "check-candidate", "end", "fail-held"].includes(action)) failure("maintenance_arguments_invalid");
  const flags = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (flags.has(key)) failure("maintenance_arguments_invalid");
    if (key === "--json") { flags.set(key, true); continue; }
    if (!["--app-dir", "--app-name", "--app-port", "--target-sha", "--expected-old-sha", "--expected-operation-id"].includes(key)) failure("maintenance_arguments_invalid");
    const value = values[++index];
    if (typeof value !== "string" || value.startsWith("--")) failure("maintenance_arguments_invalid");
    flags.set(key, value);
  }
  const request = { action, appDir: flags.get("--app-dir"), appName: flags.get("--app-name"), appPort: Number(flags.get("--app-port")),
    targetSha: flags.get("--target-sha"), expectedOldSha: flags.get("--expected-old-sha"), operationId: flags.get("--expected-operation-id") ?? null };
  if (!flags.get("--json") || typeof request.appDir !== "string" || !/^\/[A-Za-z0-9._/-]+$/.test(request.appDir) || request.appDir === "/" ||
      path.posix.normalize(request.appDir) !== request.appDir || request.appDir.endsWith("/") || !APP.test(request.appName ?? "") ||
      !Number.isSafeInteger(request.appPort) || request.appPort < 1024 || request.appPort > 65535 || !SHA.test(request.targetSha ?? "") ||
      !SHA.test(request.expectedOldSha ?? "") || request.targetSha === request.expectedOldSha ||
      (["diagnose-runtime", "plan", "prepare"].includes(action) ? request.operationId !== null : !UUID.test(request.operationId ?? ""))) failure("maintenance_arguments_invalid");
  return request;
}

export async function createRuntimeDiagnosticReport(request, diagnose = diagnoseRuntimeCompatibility) {
  if (request.action !== "diagnose-runtime" || request.operationId !== null) failure("maintenance_arguments_invalid");
  const diagnostics = validateRuntimeCompatibilityDiagnostic(await diagnose({
    appDir: request.appDir, appName: request.appName, appPort: request.appPort, expectedOldSha: request.expectedOldSha,
  }));
  // This report has no operation UUID and is never a held or release proof.
  return { version: 1, targetSha: request.targetSha, expectedOldSha: request.expectedOldSha, state: "runtime-diagnosed", diagnostics };
}

export function validateMaintenanceState(state, request, bootId, now) {
  if (!exact(state, ["version", "operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "phase", "runtime", "ingress", "database", "publicSupabaseUrl", "tokenHash", "candidate", "resumed"]) ||
      state.version !== 1 || !UUID.test(state.operationId) || !PHASES.includes(state.phase) || state.bootId !== bootId ||
      !Number.isSafeInteger(state.createdAt) || state.createdAt > now || now - state.createdAt > MAX_AGE_MS ||
      !/^[0-9a-f]{64}$/.test(state.tokenHash) || typeof state.publicSupabaseUrl !== "string" || !record(state.runtime) || !record(state.ingress) || !record(state.database) ||
      !(state.candidate === null || record(state.candidate)) || !(state.resumed === null || record(state.resumed)) ||
      ["targetSha", "expectedOldSha", "appDir", "appName", "appPort", "operationId"].some((key) => state[key] !== request[key])) failure("maintenance_state_binding_invalid");
  if (["candidate", "resuming", "ended"].includes(state.phase) && !state.candidate) failure("maintenance_state_binding_invalid");
  return state;
}

export function validateMaintenanceSubproofBindings(state) {
  const runtime = state.runtime;
  const ingress = state.ingress;
  const database = ingress?.docker?.containers?.find((container) => container.service === "db");
  if (!runtime?.input || !ingress?.input || !database || runtime.bootId !== state.bootId ||
      ["appDir", "appName", "appPort", "expectedOldSha"].some((key) => runtime.input[key] !== state[key]) ||
      ingress.input.operationId !== state.operationId || ingress.input.appPort !== state.appPort ||
      database.id !== state.database?.id || database.image !== state.database?.image) failure("maintenance_subproof_binding_invalid");
  let publicUrl;
  try { publicUrl = new URL(state.publicSupabaseUrl).href; } catch { failure("maintenance_subproof_binding_invalid"); }
  if (ingress.input.publicSupabaseUrl !== publicUrl) failure("maintenance_subproof_binding_invalid");
  return true;
}

function publicSummary(state, value = state.phase) {
  return { version: 1, operationId: state.operationId, targetSha: state.targetSha, expectedOldSha: state.expectedOldSha, state: value };
}

/** All effects are injected: unit tests never start a process or contact production. */
export async function runMaintenanceAction(request, ops) {
  const assertHeld = async (state, requireDatabase = true) => {
    if (!["held", "failed-held"].includes(state.phase)) failure("maintenance_not_held");
    await ops.verifyIngress(state.ingress, { probeControlServices: requireDatabase });
    await ops.assertRuntimeStopped(state.runtime);
    if (requireDatabase) await ops.assertDatabaseQuiet(state.database);
  };
  const assertCandidate = async (state) => {
    if (state.phase !== "candidate" || !state.candidate) failure("maintenance_candidate_unverified");
    await ops.verifyIngress(state.ingress, { probeControlServices: false });
    if (state.candidate.targetSha !== state.targetSha) failure("maintenance_candidate_target_invalid");
    await ops.verifyCandidate(state.runtime, state.candidate, "1");
  };
  const keepFailedClosed = async (state) => {
    let verified = true;
    try {
      state.ingress = await ops.installIngress(state.ingress, ops.readToken(state), { probeControlServices: false });
      ops.save(state);
    } catch { verified = false; }
    try {
      if (state.resumed) await ops.stopResumedCandidate(state.runtime, state.resumed);
      else if (state.candidate) await ops.stopCandidate(state.runtime, state.candidate);
      else await ops.stopRuntime(state.runtime);
    } catch { verified = false; }
    try {
      await ops.verifyIngress(state.ingress, { probeControlServices: false });
      await ops.assertRuntimeStopped(state.runtime);
      await ops.assertDatabaseQuiet(state.database);
    } catch { verified = false; }
    state.phase = verified ? "failed-held" : "failed-unknown";
    ops.save(state);
    if (!verified) failure("maintenance_failure_state_unverified");
    return publicSummary(state);
  };

  if (["plan", "prepare"].includes(request.action)) {
    const captureStep = async (stage, inspect) => {
      try { return await inspect(); }
      catch (error) {
        // The read-only workflow may publish only these fixed phase codes,
        // never raw host/configuration/transport errors or a success proof.
        if (request.action === "plan") failure(`maintenance_plan_${stage}_unverified`);
        throw error;
      }
    };
    await captureStep("operation_state", () => ops.assertNoActiveOperation());
    const operationId = ops.uuid();
    if (!UUID.test(operationId)) failure("maintenance_operation_invalid");
    const runtime = await captureStep("runtime", () => ops.captureRuntime({ appDir: request.appDir, appName: request.appName, appPort: request.appPort, expectedOldSha: request.expectedOldSha }));
    const publicSupabaseUrl = await captureStep("public_gateway", () => ops.readPublicSupabaseUrl(runtime));
    const capturedIngress = await captureStep("ingress", () => ops.captureIngress({ appPort: request.appPort, publicSupabaseUrl, operationId }));
    const database = await captureStep("database", () => ops.captureDatabase());
    const token = ops.token();
    if (!/^[0-9a-f]{64}$/.test(token)) failure("maintenance_token_invalid");
    const ingress = await captureStep("installation", () => ops.planIngressInstallation(capturedIngress, token));
    if (request.action === "plan") return publicSummary({ ...request, operationId }, "planned");
    const state = { version: 1, operationId, targetSha: request.targetSha, expectedOldSha: request.expectedOldSha,
      appDir: request.appDir, appName: request.appName, appPort: request.appPort, bootId: ops.bootId(), createdAt: ops.now(),
      phase: "preparing", runtime, ingress, database, publicSupabaseUrl, tokenHash: digest(token), candidate: null, resumed: null };
    validateMaintenanceState(state, { ...request, operationId }, ops.bootId(), ops.now());
    ops.validateProofs(state);
    if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) failure("maintenance_state_size_exceeded");
    // Persist the exact recovery targets before the first network or process mutation.
    ops.create(state, token);
    try {
      state.ingress = await ops.installIngress(state.ingress, token);
      ops.save(state);
      await ops.stopRuntime(runtime);
      await ops.assertRuntimeStopped(runtime);
      await ops.verifyIngress(state.ingress);
      await ops.waitDatabaseQuiet(database);
      await ops.verifyIngress(state.ingress);
      state.phase = "held";
      ops.save(state);
      return publicSummary(state);
    } catch {
      let code = "maintenance_prepare_failed_held";
      let summary;
      try { summary = await keepFailedClosed(state); }
      catch { code = "maintenance_failure_state_unverified"; summary = publicSummary(state, "failed-unknown"); }
      // The command still fails. Preserve only the operation identity so an
      // operator can investigate a partially established maintenance window.
      const error = new Error(code);
      Object.defineProperty(error, "maintenanceReport", { value: summary });
      throw error;
    }
  }

  const state = validateMaintenanceState(ops.load(), request, ops.bootId(), ops.now());
  // Validation of subordinate proofs is mandatory before they reach an actuator.
  ops.validateProofs(state);
  if (request.action === "fail-held") return keepFailedClosed(state);
  if (request.action === "check-runtime-held") {
    // Internal deploy-only checkpoint while the separately verified readiness
    // fence holds its own transaction. This is NOT a database-quiet certificate.
    await assertHeld(state, false);
    return publicSummary(state, "runtime-held");
  }
  if (["check-held", "runtime-handoff"].includes(request.action)) {
    await assertHeld(state);
    const summary = publicSummary(state, "held");
    return request.action === "runtime-handoff" ? { ...summary, runtime: state.runtime } : summary;
  }
  if (request.action === "register-candidate") {
    if (state.phase !== "held") failure("maintenance_not_held");
    await ops.verifyIngress(state.ingress, { probeControlServices: false });
    state.candidate = await ops.captureCandidate(state.runtime, state.targetSha, "1");
    state.phase = "candidate";
    ops.save(state);
    await assertCandidate(state);
    return publicSummary(state);
  }
  if (request.action === "check-candidate") {
    await assertCandidate(state);
    return publicSummary(state);
  }
  if (request.action === "end") {
    await assertCandidate(state);
    await ops.assertClientWritesDenied(state.database);
    state.phase = "resuming";
    ops.save(state);
    try {
      state.resumed = await ops.resumeCandidate(state.runtime, state.candidate, state.targetSha);
      ops.save(state);
      await ops.verifyResumedCandidate(state.runtime, state.resumed);
      await ops.verifyIngress(state.ingress);
      await ops.restoreIngress(state.ingress);
      await ops.verifyResumedCandidate(state.runtime, state.resumed);
      state.phase = "ended";
      ops.save(state);
      return publicSummary(state);
    } catch {
      await keepFailedClosed(state);
      failure("maintenance_end_failed_held");
    }
  }
  failure("maintenance_arguments_invalid");
}

function secureDirectory(directory, create = false) {
  if (create) { try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; } }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o077) !== 0 || realpathSync(directory) !== directory) failure("maintenance_private_directory_invalid");
}
function readPrivate(file, maximum = MAX_STATE_BYTES) {
  let fd;
  try {
    const before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== 0 || (before.mode & 0o077) !== 0 || before.size < 1 || before.size > maximum) failure("maintenance_private_file_invalid");
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    const bytes = readFileSync(fd);
    const after = lstatSync(file);
    if (opened.dev !== before.dev || opened.ino !== before.ino || after.dev !== opened.dev || after.ino !== opened.ino ||
        after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || bytes.length !== opened.size) failure("maintenance_private_file_changed");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { if (fd !== undefined) closeSync(fd); }
}
function writePrivate(file, content, replace = false) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    if (!replace) { try { lstatSync(file); failure("maintenance_private_file_exists"); } catch (error) { if (error.code !== "ENOENT") throw error; } }
    else readPrivate(file);
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, content, "utf8"); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, file);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function execute(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: "utf8", timeout: 12_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", PGOPTIONS: "" }, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
  if (result.error || result.signal || result.status !== 0) failure("maintenance_fixed_command_failed");
  return result.stdout;
}

/** Private host-only authorization for bounded, real public-origin health probes. */
export function readMaintenanceProbeContext(environment = process.env) {
  const names = ["FAOLLA_MAINTENANCE_APP_NAME", "FAOLLA_MAINTENANCE_OPERATION_ID", "FAOLLA_MAINTENANCE_TARGET_SHA"];
  if (names.every((key) => environment[key] === undefined || environment[key] === "")) return null;
  const [appName, operationId, targetSha] = names.map((key) => environment[key]);
  if (!APP.test(appName ?? "") || !UUID.test(operationId ?? "") || !SHA.test(targetSha ?? "") ||
      process.platform !== "linux" || process.getuid?.() !== 0) failure("maintenance_probe_binding_invalid");
  const directory = `${ROOT}/${appName}`;
  secureDirectory(ROOT); secureDirectory(directory);
  const state = JSON.parse(readPrivate(`${directory}/state.json`));
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  validateMaintenanceState(state, { ...state, appName, operationId, targetSha }, bootId, Date.now());
  if (!["held", "candidate", "failed-held"].includes(state.phase)) failure("maintenance_probe_phase_invalid");
  const token = readPrivate(`${directory}/control.token`, 64);
  if (!/^[0-9a-f]{64}$/.test(token) || digest(token) !== state.tokenHash) failure("maintenance_token_identity_invalid");
  return { publicSupabaseUrl: state.publicSupabaseUrl, token };
}

// A stale lock is an explicit operator stop, never automatically broken or stolen.
async function withPrivateOperationLock(request, action) {
  if (request.action === "plan") return action();
  secureDirectory(ROOT, true);
  const directory = `${ROOT}/${request.appName}`;
  secureDirectory(directory, true);
  const lock = `${directory}/operation.lock`;
  try { mkdirSync(lock, { mode: 0o700 }); } catch { failure("maintenance_operation_locked"); }
  const identity = lstatSync(lock);
  try { return await action(); } finally {
    const current = lstatSync(lock);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) failure("maintenance_lock_identity_changed");
    rmdirSync(lock);
  }
}
const DOCKER = ["--host", "unix:///var/run/docker.sock"];
const SCHEDULER_SAFE_SQL = "NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname NOT IN ('plpgsql','pgcrypto','uuid-ossp','pg_stat_statements','pgjwt','pg_graphql','pgaudit','pgsodium','pg_trgm','vector','pg_net')) " +
  "AND to_regclass('cron.job') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_subscription WHERE subenabled) " +
  "AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(current_setting('shared_preload_libraries'), ',') AS library WHERE trim(both ' \"' from library) NOT IN ('','pg_stat_statements','pgaudit','pgsodium','pg_net','pg_cron')) " +
  "AND (position('pg_cron' in current_setting('shared_preload_libraries'))=0 OR current_setting('cron.database_name',true)=current_database())";
const QUIET_SQL = "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; " +
  "SELECT json_build_object('complete', current_setting('is_superuser')='on' OR pg_has_role(current_user,'pg_read_all_stats','USAGE')," +
  "'schedulerSafe',(" + SCHEDULER_SAFE_SQL + ")," +
  "'transactions',(SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND xact_start IS NOT NULL)," +
  "'prepared',(SELECT count(*) FROM pg_prepared_xacts), 'databaseOid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()))::text; ROLLBACK;";
const ACL_SQL = "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; " +
  "SELECT json_build_object('migration',exists(select 1 from public.faolla_schema_migrations where version=202609090048 and name='pages_client_write_acl')," +
  "'clientsDenied',bool_and(NOT has_table_privilege(r.oid,'public.pages','INSERT') AND NOT has_table_privilege(r.oid,'public.pages','UPDATE') AND NOT has_table_privilege(r.oid,'public.pages','DELETE') AND NOT has_any_column_privilege(r.oid,'public.pages','INSERT') AND NOT has_any_column_privilege(r.oid,'public.pages','UPDATE')) AND count(*)=2," +
  "'serviceWrites',has_table_privilege('service_role','public.pages','INSERT') AND has_table_privilege('service_role','public.pages','UPDATE') AND has_table_privilege('service_role','public.pages','DELETE'))::text FROM pg_roles r WHERE rolname IN ('anon','authenticated'); ROLLBACK;";
// Fixed read-only SQL exported for acceptance on a separately bound disposable PG15 service.
export const PRODUCTION_MAINTENANCE_QUIET_SQL = QUIET_SQL;
export const PRODUCTION_MAINTENANCE_ACL_SQL = ACL_SQL;

async function productionOperations(request) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) failure("maintenance_host_authority_unavailable");
  if (realpathSync(request.appDir) !== request.appDir) failure("maintenance_app_path_invalid");
  const runtime = await import("./production-maintenance-runtime.mjs");
  const ingress = await import("./production-maintenance-ingress.mjs");
  const { MAINTENANCE_PSQL_CONTAINER_SCRIPT } = await import("./check-production-maintenance-capabilities.mjs");
  const directory = `${ROOT}/${request.appName}`;
  const statePath = `${directory}/state.json`;
  const tokenPath = `${directory}/control.token`;
  const bootId = () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const load = () => { secureDirectory(ROOT); secureDirectory(directory); return JSON.parse(readPrivate(statePath)); };
  const save = (state) => { secureDirectory(ROOT); secureDirectory(directory); writePrivate(statePath, JSON.stringify(state), true); };
  const captureDatabase = () => {
    const item = JSON.parse(execute("docker", [...DOCKER, "inspect", "--type=container", "--format", '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"running":{{json .State.Running}}}', "supabase-db"]));
    if (!exact(item, ["id", "name", "image", "running"]) || !/^[0-9a-f]{64}$/.test(item.id) || item.name !== "/supabase-db" || !item.image.startsWith("supabase/postgres:") || item.running !== true) failure("maintenance_database_identity_invalid");
    const proof = { id: item.id, image: item.image, databaseOid: 0 };
    const row = queryDatabase(proof, QUIET_SQL);
    if (!row.complete || !Number.isSafeInteger(row.databaseOid) || row.databaseOid < 1) failure("maintenance_database_visibility_incomplete");
    if (row.schedulerSafe !== true) failure("maintenance_database_scheduler_unsupported");
    proof.databaseOid = row.databaseOid;
    return proof;
  };
  const queryDatabase = (proof, sql) => {
    if (!exact(proof, ["id", "image", "databaseOid"]) || !/^[0-9a-f]{64}$/.test(proof.id) || !proof.image.startsWith("supabase/postgres:") || !Number.isSafeInteger(proof.databaseOid)) failure("maintenance_database_identity_invalid");
    const observed = JSON.parse(execute("docker", [...DOCKER, "inspect", "--type=container", "--format", '{"id":{{json .Id}},"image":{{json .Config.Image}},"running":{{json .State.Running}}}', "supabase-db"]));
    if (observed.id !== proof.id || observed.image !== proof.image || observed.running !== true) failure("maintenance_database_identity_changed");
    return JSON.parse(execute("docker", [...DOCKER, "exec", "-i", proof.id, "sh", "-c", MAINTENANCE_PSQL_CONTAINER_SCRIPT], sql).trim());
  };
  const assertDatabaseQuiet = (proof) => {
    const row = queryDatabase(proof, QUIET_SQL);
    if (!exact(row, ["complete", "schedulerSafe", "transactions", "prepared", "databaseOid"]) || row.schedulerSafe !== true || row.complete !== true || row.transactions !== 0 || row.prepared !== 0 || row.databaseOid !== proof.databaseOid) failure("maintenance_database_not_quiet");
  };
  const privateProbeOptions = async () => {
    const loaded = load();
    const state = validateMaintenanceState(loaded, { ...request, operationId: request.operationId ?? loaded.operationId }, bootId(), Date.now());
    const environment = await runtime.readRuntimeHandoffEnvironment(state.runtime);
    if (typeof environment.anonKey !== "string" || !environment.anonKey || /[\r\n]/.test(environment.anonKey)) failure("maintenance_probe_credentials_invalid");
    return { probeHeaders: { apikey: environment.anonKey, authorization: `Bearer ${environment.anonKey}` } };
  };
  return {
    ...runtime, ...ingress, uuid: randomUUID, token: () => randomBytes(32).toString("hex"), now: Date.now, bootId, load, save,
    installIngress: async (proof, token, options = {}) => ingress.installIngress(proof, token, { ...await privateProbeOptions(), probeControlServices: options.probeControlServices !== false }),
    verifyIngress: async (proof, options = {}) => ingress.verifyIngress(proof, { ...await privateProbeOptions(), probeControlServices: options.probeControlServices !== false }),
    restoreIngress: async (proof) => ingress.restoreIngress(proof, await privateProbeOptions()),
    assertNoActiveOperation() {
      try {
        const previous = load();
        if (previous.phase !== "ended") failure("maintenance_operation_already_active");
        // Retain completed evidence; never automatically replace it on a new request.
        failure("maintenance_previous_operation_requires_archival");
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    },
    create(state, token) {
      secureDirectory(ROOT, true); secureDirectory(directory, true);
      writePrivate(tokenPath, token);
      writePrivate(statePath, JSON.stringify(state));
    },
    readToken(state) {
      const token = readPrivate(tokenPath, 64);
      if (!/^[0-9a-f]{64}$/.test(token) || digest(token) !== state.tokenHash) failure("maintenance_token_identity_invalid");
      return token;
    },
    validateProofs(state) {
      runtime.validateRuntimeProof(state.runtime); ingress.validateIngressProof(state.ingress);
      validateMaintenanceSubproofBindings(state);
      if (state.candidate) {
        runtime.validateCandidateProof(state.candidate, state.runtime);
        if (state.candidate.targetSha !== state.targetSha) failure("maintenance_candidate_target_invalid");
      }
      if (state.resumed) {
        runtime.validateResumedCandidateProof(state.resumed, state.runtime);
        if (state.resumed.candidate.targetSha !== state.targetSha) failure("maintenance_candidate_target_invalid");
      }
    },
    readPublicSupabaseUrl: async (proof) => (await runtime.readRuntimeHandoffEnvironment(proof)).publicUrl,
    captureDatabase, assertDatabaseQuiet,
    async waitDatabaseQuiet(proof) {
      const deadline = Date.now() + 30_000;
      let matched = 0;
      while (Date.now() < deadline) {
        try { assertDatabaseQuiet(proof); matched += 1; } catch { matched = 0; }
        if (matched >= 3) return;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      failure("maintenance_database_drain_timeout");
    },
    assertClientWritesDenied(proof) {
      const row = queryDatabase(proof, ACL_SQL);
      if (!exact(row, ["migration", "clientsDenied", "serviceWrites"]) || Object.values(row).some((value) => value !== true)) failure("maintenance_client_write_cutover_unverified");
    },
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let request;
  try {
    request = parseMaintenanceRequest(process.argv.slice(2));
    let result;
    if (request.action === "diagnose-runtime") {
      // Deliberately bypass the operation-state/actuator factory and lock:
      // diagnosis only reads existing state and cannot start maintenance.
      result = await createRuntimeDiagnosticReport(request);
    } else {
      const ops = await productionOperations(request);
      result = await withPrivateOperationLock(request, () => runMaintenanceAction(request, ops));
    }
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    const report = Object.getOwnPropertyDescriptor(error ?? {}, "maintenanceReport")?.value;
    if (request?.action === "prepare" && exact(report, ["version", "operationId", "targetSha", "expectedOldSha", "state"]) &&
        report.version === 1 && UUID.test(report.operationId) && report.targetSha === request.targetSha && report.expectedOldSha === request.expectedOldSha &&
        ["failed-held", "failed-unknown"].includes(report.state)) process.stdout.write(JSON.stringify(report) + "\n");
    const code = /^(?:maintenance_|production_maintenance_(?:runtime_|ingress_))[a-z0-9_]+$/.test(error?.message ?? "") ? error.message : "maintenance_operation_failed";
    process.stderr.write(code + "\n"); process.exitCode = 1;
  }
}
