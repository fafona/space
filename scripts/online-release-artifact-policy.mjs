// Pure, single-victim eligibility. The host must first validate the complete
// retention history with its existing reader; this does not replace that reader.
// No file access, PM2 changes, certificate rewriting, or cleanup occurs here.
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {assertOnlineRetentionCertificate, ONLINE_RETENTION_POLICY,
  retentionHash} from './online-release-retention-policy.mjs';

const WEB = '/www/wwwroot/merchant-space.web-releases';
const SHA = /^[a-f0-9]{40}(?![\s\S])/;
const HASH = /^[a-f0-9]{64}(?![\s\S])/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = reason => {throw Error(`online_artifact_${reason}`);};
const check = (value, reason) => {if (!value) fail(reason);};
const equal = (actual, expected, reason) => check(isDeepStrictEqual(actual, expected), reason);
const under = (value, root) => value === root || value.startsWith(root === '/' ? '/' : root + '/');
const canonicalPath = value => typeof value === 'string' && path.posix.isAbsolute(value) &&
  path.posix.normalize(value) === value && !/[\\\x00-\x1f\x7f]/.test(value) &&
  (value === '/' || !value.endsWith('/'));

function retiredCertificate(certificate) {
  try {assertOnlineRetentionCertificate(certificate);} catch {fail('certificate_invalid');}
  check(certificate.kind === 'retire', 'certificate_not_retirement');
  const {target, process: before} = certificate.victim;
  const directory = `${WEB}/${target.slice(0, 12)}-online`;
  check(before.name === `merchant-space-online-${target.slice(0, 12)}` && before.cwd === directory &&
    before.executable === `${directory}/node_modules/next/dist/bin/next`, 'victim_path_changed');
  check(before.watch === false && before.cronRestart === null, 'victim_restart_enabled');
  check(![certificate.active.target, certificate.rollback.target].includes(target) &&
    ![certificate.active.directory, certificate.rollback.directory].some(p => under(p, directory) || under(directory, p)),
  'protected_victim');
  equal(certificate.stoppedProcess, {...before, pid: 0, status: 'stopped'}, 'certificate_stop_changed');
  return {directory, before, stopped: certificate.stoppedProcess};
}

/**
 * observation is the normalized host observation, including retentionHead,
 * certifiedStoppedDirectories, protectedDirectories and pm2. Only the latest
 * completed retirement performed by this publication may supply a victim.
 */
export function createRetiredArtifactContext({state, retentionResult, history, observation} = {}) {
  check(object(state) && state.status === 'active' && SHA.test(state.target ?? ''), 'publication_not_active');
  check(object(retentionResult) && retentionResult.status === 'completed' &&
    SHA.test(retentionResult.retired ?? ''), 'no_new_retirement');
  check(object(history) && history.version === 2 && history.policy === ONLINE_RETENTION_POLICY &&
    Array.isArray(history.entries) && history.entries.length > 0 && HASH.test(history.headSha256 ?? ''),
  'history_invalid');
  const certificate = history.entries.at(-1);
  const {directory} = retiredCertificate(certificate);
  const certificateSha256 = retentionHash(certificate);
  check(certificateSha256 === history.headSha256, 'certificate_head_changed');
  check(certificate.victim.target === retentionResult.retired, 'retired_target_changed');
  check(certificate.active.target === state.target, 'active_target_changed');
  for (const key of ['name', 'directory', 'port']) {
    if (Object.hasOwn(state, key)) equal(state[key], certificate.active[key], 'publication_identity_changed');
  }
  check(object(observation) && observation.retentionHead === history.headSha256, 'observation_head_changed');
  check(Array.isArray(observation.certifiedStoppedDirectories) &&
    observation.certifiedStoppedDirectories.filter(p => p === directory).length === 1, 'victim_not_certified');
  check(Array.isArray(observation.protectedDirectories) && observation.protectedDirectories.every(canonicalPath),
    'protection_invalid');
  check(!observation.protectedDirectories.some(p => under(p, directory) || under(directory, p)), 'protected_target');
  check(Array.isArray(observation.pm2) && observation.pm2.every(object), 'processes_invalid');
  const stopped = certificate.stoppedProcess;
  const aliases = observation.pm2.filter(p => p.name === stopped.name || p.pmId === stopped.pmId ||
    p.cwd === directory || p.executable === stopped.executable);
  check(aliases.length === 1, 'victim_process_not_unique');
  equal(aliases[0], stopped, 'victim_process_changed');
  // Retention just established this process set. A restart, extra process, changed
  // worker or changed rollback after that proof defers cleanup instead of guessing.
  equal([...observation.pm2].sort((a, b) => a.pmId - b.pmId),
    [...certificate.processes].sort((a, b) => a.pmId - b.pmId), 'process_set_changed');
  return {directory, victim: structuredClone(certificate.victim), certificateSha256,
    activeTarget: state.target, retentionHead: history.headSha256};
}

function dumpTarget(rows, process, source) {
  check(Array.isArray(rows) && rows.every(object), `${source}_dump_invalid`);
  const matches = rows.map((row, index) => ({row, index})).filter(({row}) =>
    row.name === process.name || row.pm_cwd === process.cwd || row.pm_exec_path === process.executable);
  check(matches.length === 1, `${source}_target_not_unique`);
  const match = matches[0], row = match.row;
  check(row.name === process.name && row.pm_cwd === process.cwd && row.pm_exec_path === process.executable,
    `${source}_identity_changed`);
  // PM2's persisted single-instance stopped branch is safe only with instances
  // absent. Explicitly reject truthy/falsey coercions and scheduler/watch values.
  check(row.instances === undefined && row.pm_id === undefined && row.watch === false &&
    [undefined, null].includes(row.cron_restart), `${source}_recovery_unsafe`);
  return match;
}

function normalizedDump(row, expected, source) {
  let normalized;
  try {
    // PM2 dump rows deliberately omit pm_id and live PID. Supply only those
    // certificate-owned identifiers; every other normalized fact comes from row.
    normalized = normalizeRetirementProcess({name: row.name, pm_id: expected.pmId,
      pid: expected.pid, pm2_env: row});
  } catch {fail(`${source}_process_invalid`);}
  equal(normalized, expected, `${source}_process_changed`);
}

/**
 * Replace at most the certified victim's backup row with its verified primary
 * row. The host separately proves the primary dump against live PM2, archives
 * the original raw bytes, and atomically writes/rechecks the returned backup.
 * This helper never authorizes a second PM2 save, restart or registration change.
 */
export function buildRetiredBackupReplacement({main, backup, certificate} = {}) {
  const {before, stopped} = retiredCertificate(certificate);
  const primary = dumpTarget(main, stopped, 'main');
  check(primary.row.status === 'stopped', 'main_not_stopped');
  normalizedDump(primary.row, stopped, 'main');
  const previous = dumpTarget(backup, stopped, 'backup');
  check(['stopped', 'online'].includes(previous.row.status), 'backup_status_invalid');
  normalizedDump(previous.row, previous.row.status === 'online' ? before : stopped, 'backup');
  const replacement = structuredClone(backup);
  const changed = !isDeepStrictEqual(previous.row, primary.row);
  if (changed) replacement[previous.index] = structuredClone(primary.row);
  return {replacement, changed};
}
