import {isDeepStrictEqual} from 'node:util';

// A deliberately single-slot, first-retirement policy. It has no I/O, remote
// commands, cleanup, restart, port allocation or implicit certificate creation.
// The controller owns collection of root-verified evidence and additive files.
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const app = '/www/wwwroot/merchant-space';
const identityFields = ['target', 'name', 'pmId', 'pid', 'cwd', 'port'];
const fail = reason => { throw Error(`online_retirement_${reason}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const equal = (left, right, reason) => { if (!isDeepStrictEqual(left, right)) fail(reason); };

function identity(value) {
  if (!object(value) || !sha.test(value.target ?? '') ||
      value.name !== `merchant-space-online-${value.target.slice(0, 12)}` ||
      value.cwd !== `${app}.web-releases/${value.target.slice(0, 12)}-online` ||
      !Number.isSafeInteger(value.pmId) || value.pmId < 0 || !positive(value.pid) ||
      !Number.isSafeInteger(value.port) || value.port < 3103 || value.port > 3108) fail('victim_identity_invalid');
  return Object.fromEntries(identityFields.map(key => [key, value[key]]));
}

function anchor(value, port) {
  if (!object(value) || !sha.test(value.target ?? '') || value.port !== port ||
      value.name !== `merchant-space-online-${value.target.slice(0, 12)}` ||
      value.directory !== `${app}.web-releases/${value.target.slice(0, 12)}-online`) fail('protected_anchor_invalid');
}

function processList(value) {
  if (!Array.isArray(value) || !value.length) fail('process_evidence_invalid');
  const names = new Set(), ids = new Set();
  for (const item of value) {
    if (!object(item) || typeof item.name !== 'string' || !item.name ||
        !Number.isSafeInteger(item.pmId) || item.pmId < 0 ||
        typeof item.cwd !== 'string' || !item.cwd.startsWith('/') ||
        !['online', 'stopped'].includes(item.status) ||
        (item.status === 'online' ? !positive(item.pid) : item.pid !== 0) ||
        names.has(item.name) || ids.has(item.pmId)) fail('process_evidence_invalid');
    names.add(item.name); ids.add(item.pmId);
  }
  return value;
}

function paused(process) {
  if (process.backgroundPaused !== '1' || process.automationEnabled !== '0' ||
      process.invitationEnabled !== '0') fail('victim_background_work_enabled');
  // Stop must remain stopped. PM2 watch/cron can otherwise resurrect this
  // registration after its port has been assigned to the next candidate.
  if (process.watch !== undefined && process.watch !== false) fail('victim_watch_enabled');
  if (![undefined, null, false, '0'].includes(process.cronRestart)) fail('victim_cron_restart_enabled');
  // Next checks truthiness, so even the strings "false" and "0" suppress its
  // normal signal handler. Require absent/empty rather than guessing intent.
  if (process.manualSignalHandle !== undefined && process.manualSignalHandle !== '') fail('victim_manual_signal_enabled');
}

function liveIdentity(victim, process) {
  if (!process || process.name !== victim.name || process.pmId !== victim.pmId ||
      process.pid !== victim.pid || process.cwd !== victim.cwd ||
      process.port !== victim.port || process.status !== 'online') fail('victim_process_changed');
  paused(process);
}

function sockets(evidence, victim, stopped = false) {
  if (!Array.isArray(evidence.listeners) || !Array.isArray(evidence.established)) fail('socket_evidence_invalid');
  for (const socket of evidence.listeners) {
    if (!object(socket) || typeof socket.address !== 'string' || !socket.address ||
        !positive(socket.port) || socket.port > 65535 || !positive(socket.pid)) fail('socket_evidence_invalid');
  }
  for (const socket of evidence.established) {
    if (!object(socket) || !positive(socket.localPort) || socket.localPort > 65535 ||
        !positive(socket.peerPort) || socket.peerPort > 65535) fail('socket_evidence_invalid');
  }
  const listening = evidence.listeners.filter(item => item.port === victim.port || item.pid === victim.pid);
  if (stopped ? listening.length !== 0 : listening.length !== 1 ||
      listening[0].address !== '127.0.0.1' || listening[0].port !== victim.port || listening[0].pid !== victim.pid)
    fail('victim_listener_changed');
  if (evidence.established.some(item => item.localPort === victim.port || item.peerPort === victim.port))
    fail('victim_connections_present');
}

function source(evidence, victim) {
  const state = evidence.sourceState;
  if (evidence.sourceClean !== true || !object(state) || state.status !== 'active' ||
      state.target !== victim.target || state.name !== victim.name || state.directory !== victim.cwd ||
      state.port !== victim.port || state.buildId !== victim.target || state.sourceHead !== victim.target)
    fail('victim_source_changed');
}

/**
 * Evidence is collected under the existing publication lock, not trusted from
 * user input. active is the current 3110 release; rollback is its 3109 baseline.
 * Process/socket arrays must be complete, not prefiltered to the selected victim.
 */
export function assertOnlineRetirementPlan(evidence) {
  if (!object(evidence)) fail('evidence_invalid');
  const victim = identity(evidence.victim);
  anchor(evidence.active, 3110); anchor(evidence.rollback, 3109);
  if (evidence.active.target === evidence.rollback.target ||
      [evidence.active.target, evidence.rollback.target].includes(victim.target)) fail('protected_release');
  if (evidence.maintenanceEnded !== true) fail('maintenance_not_ended');
  if (!Array.isArray(evidence.priorCertificates) || evidence.priorCertificates.length !== 0)
    fail('single_retirement_limit');
  if (!Array.isArray(evidence.protectedNames) || !evidence.protectedNames.length ||
      evidence.protectedNames.some(name => typeof name !== 'string' || !name) ||
      new Set(evidence.protectedNames).size !== evidence.protectedNames.length ||
      !evidence.protectedNames.includes(evidence.active.name) ||
      !evidence.protectedNames.includes(evidence.rollback.name) || evidence.protectedNames.includes(victim.name))
    fail('protected_processes_invalid');
  const all = processList(evidence.processes);
  if (all.some(item => item.status !== 'online') || evidence.protectedNames.some(name => !all.some(item => item.name === name)))
    fail('protected_processes_missing');
  for (const item of [evidence.active, evidence.rollback]) {
    const process = all.find(process => process.name === item.name);
    if (!process || process.cwd !== item.directory || process.port !== item.port || process.status !== 'online')
      fail('protected_anchor_changed');
  }
  liveIdentity(victim, all.find(item => item.name === victim.name));
  source(evidence, victim); sockets(evidence, victim);
  if (typeof evidence.nginxConfig !== 'string' || !evidence.nginxConfig.trim()) fail('proxy_evidence_missing');
  // Conservative: comments and indirect declarations count too. Do not strip or
  // rewrite effective nginx configuration to turn an ambiguous reference green.
  if (new RegExp(`(?:^|[^0-9])${victim.port}(?:$|[^0-9])`).test(evidence.nginxConfig) ||
      evidence.nginxConfig.includes(victim.name) || evidence.nginxConfig.includes(victim.cwd)) fail('victim_proxy_reference');
  return Object.freeze(victim);
}

/** Only pm2 stop is accepted: registration/files remain, all other facts match. */
export function assertOnlineRetirementCompletion(before, after) {
  const victim = assertOnlineRetirementPlan(before);
  if (!object(after)) fail('completion_evidence_invalid');
  for (const key of Object.keys(before).filter(key => !['processes', 'listeners', 'established'].includes(key)))
    equal(after[key], before[key], 'completion_baseline_changed');
  const previous = processList(before.processes), current = processList(after.processes);
  if (current.length !== previous.length) fail('completion_process_set_changed');
  for (const process of previous) {
    const found = current.find(item => item.name === process.name);
    equal(found, process.name === victim.name ? {...process, pid: 0, status: 'stopped'} : process,
      process.name === victim.name ? 'victim_not_stopped' : 'unrelated_process_changed');
  }
  sockets(after, victim, true);
  const unrelated = listeners => listeners.filter(item => item.pid !== victim.pid && item.port !== victim.port)
    .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  equal(unrelated(after.listeners), unrelated(before.listeners), 'unrelated_listener_changed');
  return true;
}

/** Root-only, additive certificates authorize one exact stopped registration. */
export function assertOnlineRetirementCertificate(certificate) {
  if (!object(certificate) || certificate.version !== 1 || certificate.status !== 'completed') fail('certificate_invalid');
  const victim = identity(certificate.victim);
  const stopped = processList([certificate.stoppedProcess])[0];
  if (stopped.name !== victim.name || stopped.pmId !== victim.pmId || stopped.pid !== 0 ||
      stopped.status !== 'stopped' || stopped.cwd !== victim.cwd || stopped.port !== victim.port)
    fail('certificate_stopped_identity_invalid');
  paused(stopped);
  if (!sha.test(certificate.activeTarget ?? '') || !sha.test(certificate.rollbackTarget ?? '') ||
      !sha.test(certificate.nextTarget ?? '') ||
      new Set([certificate.activeTarget, certificate.rollbackTarget, certificate.nextTarget, certificate.victim.target]).size !== 4 ||
      !Array.isArray(certificate.allowedActiveTargets) || certificate.allowedActiveTargets.length !== 3 ||
      !certificate.allowedActiveTargets.includes(certificate.activeTarget) ||
      !certificate.allowedActiveTargets.includes(certificate.rollbackTarget) ||
      !certificate.allowedActiveTargets.includes(certificate.nextTarget) ||
      !digest.test(certificate.beforeSha256 ?? '') || !digest.test(certificate.afterSha256 ?? '') ||
      certificate.beforeSha256 === certificate.afterSha256 ||
      typeof certificate.completedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(certificate.completedAt) ||
      !Number.isFinite(Date.parse(certificate.completedAt))) fail('certificate_invalid');
  return true;
}

/**
 * Historical saved snapshots stay untouched. Missing/deleted processes and
 * restarted old identities never qualify. New stage snapshots may omit only
 * the certified stopped registration after this complete-list validation.
 */
export function assertRetainedOnlineProcesses({saved, current, certificates = [], activeTarget, protectedNames = []}) {
  if (!Array.isArray(saved) || !saved.length || !Array.isArray(certificates) || certificates.length > 1 ||
      !sha.test(activeTarget ?? '') || !Array.isArray(protectedNames) ||
      protectedNames.some(name => typeof name !== 'string' || !name)) fail('retained_evidence_invalid');
  const all = processList(current);
  for (const certificate of certificates) {
    assertOnlineRetirementCertificate(certificate);
    if (!certificate.allowedActiveTargets.includes(activeTarget) || protectedNames.includes(certificate.victim.name))
      fail('certificate_anchor_rejected');
    const victim = certificate.victim, process = all.find(item => item.name === victim.name);
    // Includes executable, arguments, interpreter, restart policy and environment
    // hashes collected by the controller, not just the historical PID/cwd tuple.
    equal(process, certificate.stoppedProcess, 'retired_registration_changed');
    paused(process);
  }
  const names = new Set();
  for (const previous of saved) {
    if (!object(previous) || typeof previous.name !== 'string' || !previous.name || !positive(previous.pid) ||
        typeof previous.cwd !== 'string' || !previous.cwd.startsWith('/') || names.has(previous.name)) fail('saved_process_invalid');
    names.add(previous.name);
    const found = all.find(item => item.name === previous.name);
    if (found?.status === 'online' && found.pid === previous.pid && found.cwd === previous.cwd &&
        (previous.pmId === undefined || previous.pmId === found.pmId)) continue;
    const matching = certificates.filter(({victim}) => victim.name === previous.name && victim.pid === previous.pid &&
      victim.cwd === previous.cwd && (previous.pmId === undefined || previous.pmId === victim.pmId));
    if (matching.length !== 1) fail('existing_process_changed');
  }
  // Even when a new snapshot omitted the certified process, an unrelated stopped
  // process cannot silently enter the next publication's baseline.
  for (const process of all.filter(item => item.status !== 'online')) {
    if (!certificates.some(({victim}) => victim.name === process.name)) fail('uncertified_stopped_process');
  }
  return true;
}
