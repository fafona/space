import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {assertOnlineRetirementCertificate} from './online-release-retirement-policy.mjs';

const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const APP = '/www/wwwroot/merchant-space';
export const ROLLING_BASE_NAMES = ['merchant-space', 'merchant-space-enterprise-automation-worker',
  'merchant-space-contact-card', 'merchant-space-web-live'];
const fail = reason => { throw Error(`online_rolling_${reason}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const equal = (left, right, reason) => { if (!isDeepStrictEqual(left, right)) fail(reason); };
const stable = value => Array.isArray(value) ? value.map(stable) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const rollingHash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export const rollingCanonicalText = value => JSON.stringify(stable(value)) + '\n';
const nameOf = target => `merchant-space-online-${target.slice(0, 12)}`;
const directoryOf = target => `${APP}.web-releases/${target.slice(0, 12)}-online`;

function anchor(value) {
  if (!object(value) || !SHA.test(value.target ?? '') || value.name !== nameOf(value.target) ||
      value.directory !== directoryOf(value.target) || !Number.isSafeInteger(value.port) ||
      value.port < 3103 || value.port > 3110) fail('anchor_invalid');
}
function identity(value) {
  if (!object(value)) fail('victim_invalid');
  anchor({...value, directory: value.cwd});
  if (!Number.isSafeInteger(value.pmId) || value.pmId < 0 || !positive(value.pid)) fail('victim_invalid');
  return value;
}
function processes(value) {
  if (!Array.isArray(value) || !value.length) fail('processes_invalid');
  const names = new Set(), ids = new Set(), pids = new Set();
  for (const item of value) {
    if (!object(item) || typeof item.name !== 'string' || !item.name || typeof item.cwd !== 'string' ||
        !item.cwd.startsWith('/') || !Number.isSafeInteger(item.pmId) || item.pmId < 0 ||
        !['online', 'stopped'].includes(item.status) ||
        (item.status === 'online' ? !positive(item.pid) || pids.has(item.pid) : item.pid !== 0) ||
        names.has(item.name) || ids.has(item.pmId)) fail('processes_invalid');
    names.add(item.name); ids.add(item.pmId); if (item.pid) pids.add(item.pid);
  }
  return value;
}
function paused(value) {
  if (value.backgroundPaused !== '1' || value.automationEnabled !== '0' || value.invitationEnabled !== '0' ||
      ![undefined, false].includes(value.watch) || ![undefined, null, false, '0'].includes(value.cronRestart) ||
      ![undefined, ''].includes(value.manualSignalHandle) || value.shutdownWithMessage !== false)
    fail('victim_background_or_signal_unsafe');
}
export function assertRollingExecutable(value, fact, resolvedInterpreter) {
  if (value.executable !== `${value.cwd}/node_modules/next/dist/bin/next` ||
      !isDeepStrictEqual(value.args, ['start', '-H', '127.0.0.1', '-p', String(value.port)]) ||
      !isDeepStrictEqual(value.nodeArgs, []) || value.execMode !== 'fork_mode' ||
      typeof value.interpreter !== 'string' || !value.interpreter.startsWith('/') ||
      fact.executable !== resolvedInterpreter || fact.cwd !== value.cwd) fail('victim_executable_changed');
}
function stoppedCertificate(value) {
  identity(value.victim); const stopped = processes([value.stoppedProcess])[0];
  const victim = value.victim;
  if (stopped.name !== victim.name || stopped.pmId !== victim.pmId || stopped.cwd !== victim.cwd ||
      stopped.port !== victim.port || stopped.pid !== 0 || stopped.status !== 'stopped') fail('stopped_identity_invalid');
  paused(stopped);
}
export function assertOnlineRollingCertificate(value) {
  if (!object(value) || value.version !== 1 || value.policy !== 'rolling-v1' || value.status !== 'completed' ||
      !SHA.test(value.nextTarget ?? '') || !positive(value.sequence) ||
      !HASH.test(value.legacySha256 ?? '') || !(value.previousSha256 === null || HASH.test(value.previousSha256 ?? '')) ||
      !['beforeSha256', 'afterSha256', 'preparedSha256', 'recoverySha256'].every(key => HASH.test(value[key] ?? '')) ||
      value.beforeSha256 === value.afterSha256 ||
      typeof value.completedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.completedAt) ||
      !Number.isFinite(Date.parse(value.completedAt))) fail('certificate_invalid');
  stoppedCertificate(value);
  if (!Array.isArray(value.protectedAnchors) || value.protectedAnchors.length !== 3) fail('three_anchors_required');
  for (const item of value.protectedAnchors) {
    anchor(item); const process = processes([item.process])[0];
    if (process.status !== 'online' || process.name !== item.name || process.port !== item.port ||
        process.cwd !== item.directory) fail('protected_process_invalid');
  }
  const targets = value.protectedAnchors.map(item => item.target);
  if (new Set([value.nextTarget, value.victim.target, ...targets]).size !== 5 ||
      new Set(value.protectedAnchors.map(item => item.port)).size !== 3 ||
      value.protectedAnchors.some(item => item.port === value.victim.port)) fail('protected_release');
  equal(value.allowedActiveTargets, [value.nextTarget, ...targets], 'allowed_context_invalid');
  return true;
}

/** The reader binds these certificates to all five private proof files. */
export function assertOnlineRollingHistory(history) {
  if (!object(history) || history.version !== 1 || !Array.isArray(history.legacyCertificates) ||
      history.legacyCertificates.length > 1 || !Array.isArray(history.entries) || !HASH.test(history.legacySha256 ?? ''))
    fail('history_invalid');
  for (const cert of history.legacyCertificates) assertOnlineRetirementCertificate(cert);
  if (!Array.isArray(history.legacyProcesses) || (history.legacyCertificates.length && !history.legacyProcesses.length))
    fail('legacy_process_proof_missing');
  if (history.legacyProcesses.length) processes(history.legacyProcesses);
  let head = null, previous = null;
  const nextTargets = new Set(), victims = new Set(history.legacyCertificates.map(cert => cert.victim.name));
  const victimIds = new Set(history.legacyCertificates.map(cert => cert.victim.pmId));
  for (const [index, cert] of history.entries.entries()) {
    assertOnlineRollingCertificate(cert);
    if (cert.sequence !== index + 1 || cert.previousSha256 !== head || cert.legacySha256 !== history.legacySha256 ||
        nextTargets.has(cert.nextTarget) || victims.has(cert.victim.name) || victimIds.has(cert.victim.pmId))
      fail('history_chain_invalid');
    const expected = previous ? [previous.nextTarget, ...previous.protectedAnchors.slice(0, 2).map(item => item.target)]
      : history.legacyCertificates.length ? [history.legacyCertificates[0].nextTarget,
        history.legacyCertificates[0].activeTarget, history.legacyCertificates[0].rollbackTarget] : null;
    if (expected) equal(cert.protectedAnchors.map(item => item.target), expected, 'history_publication_gap');
    nextTargets.add(cert.nextTarget); victims.add(cert.victim.name); victimIds.add(cert.victim.pmId);
    head = rollingHash(cert); previous = cert;
  }
  if (history.headSha256 !== head) fail('history_head_invalid');
  return true;
}

/** Only completed historical rollback callers may use an ancestral birth pin. */
export function assertRollingStateHistory({history, activeTarget, recordedHead, destinationTarget}) {
  assertOnlineRollingHistory(history);
  const latest = history.entries.at(-1);
  if (!latest || !latest.allowedActiveTargets.includes(activeTarget)) fail('state_context_invalid');
  const [current, rollback, secondRollback] = latest.protectedAnchors;
  if (![[latest.nextTarget, current.target], [current.target, rollback.target], [rollback.target, secondRollback.target]].some(([from, to]) =>
    activeTarget === from && destinationTarget === to)) fail('rollback_depth_exceeded');
  if (recordedHead === undefined) {
    if (history.entries.some(cert => cert.nextTarget === activeTarget) ||
        !history.legacyCertificates.some(cert => cert.allowedActiveTargets.includes(activeTarget))) fail('state_birth_pin_missing');
  } else if (!HASH.test(recordedHead ?? '') || !history.entries.some(cert =>
    rollingHash(cert) === recordedHead && cert.nextTarget === activeTarget)) fail('state_birth_pin_invalid');
  return true;
}

function allCertificates(history) { return [...history.legacyCertificates, ...history.entries]; }

export function assertRollingRetainedProcesses({saved, current, history, activeTarget, protectedNames = []}) {
  assertOnlineRollingHistory(history);
  if (!history.entries.length || !SHA.test(activeTarget ?? '') || !Array.isArray(saved) || !saved.length ||
      !Array.isArray(protectedNames) || protectedNames.some(item => typeof item !== 'string' || !item))
    fail('retained_input_invalid');
  const all = processes(current), latest = history.entries.at(-1), certs = allCertificates(history);
  if (!latest.allowedActiveTargets.includes(activeTarget)) fail('retained_context_invalid');
  for (const cert of certs) {
    if (protectedNames.includes(cert.victim.name)) fail('protected_release');
    equal(all.find(item => item.name === cert.victim.name), cert.stoppedProcess, 'retired_registration_changed');
  }
  // Never depend on the caller remembering the second rollback build.
  for (const item of latest.protectedAnchors)
    equal(all.find(process => process.name === item.name), item.process, 'protected_anchor_changed');
  for (const name of [...ROLLING_BASE_NAMES, ...protectedNames]) {
    const item = all.find(process => process.name === name);
    // A new candidate may not exist yet when its initial snapshot is collected.
    if (name === nameOf(latest.nextTarget) && !item) continue;
    if (!item || item.status !== 'online') fail('protected_process_missing');
  }
  const next = all.find(item => item.name === nameOf(latest.nextTarget));
  if (next && (next.status !== 'online' || next.cwd !== directoryOf(latest.nextTarget))) fail('next_process_invalid');
  const names = new Set();
  for (const old of saved) {
    if (!object(old) || !old.name || names.has(old.name) || !positive(old.pid) || typeof old.cwd !== 'string')
      fail('saved_process_invalid');
    names.add(old.name); const found = all.find(item => item.name === old.name);
    if (found?.status === 'online' && old.pid === found.pid && old.cwd === found.cwd &&
        (old.pmId === undefined || old.pmId === found.pmId)) {
      // Old release snapshots only recorded name/PID/cwd. New snapshots retain
      // every normalized field, with no weakening of historical formats.
      for (const key of Object.keys(old)) equal(found[key], old[key], 'existing_process_changed');
      continue;
    }
    const matching = certs.filter(cert => cert.victim.name === old.name && cert.victim.pid === old.pid &&
      cert.victim.cwd === old.cwd && (old.pmId === undefined || cert.victim.pmId === old.pmId));
    if (matching.length !== 1) fail('existing_process_changed');
    const original = {...matching[0].stoppedProcess, pid: matching[0].victim.pid, status: 'online'};
    for (const key of Object.keys(old)) equal(original[key], old[key], 'retired_saved_identity_changed');
  }
  if (all.some(item => item.status === 'stopped' && !certs.some(cert => cert.victim.name === item.name)))
    fail('uncertified_stopped_process');
  return true;
}

function checkSockets(evidence, victim, stopped = false) {
  if (!Array.isArray(evidence.listeners) || !Array.isArray(evidence.established)) fail('sockets_invalid');
  for (const item of evidence.listeners) if (!object(item) || typeof item.address !== 'string' || !item.address ||
      !positive(item.port) || item.port > 65535 || !positive(item.pid)) fail('sockets_invalid');
  for (const item of evidence.established) if (!object(item) || !positive(item.localPort) || item.localPort > 65535 ||
      !positive(item.peerPort) || item.peerPort > 65535 || !Array.isArray(item.pids) || item.pids.some(pid => !positive(pid)))
    fail('sockets_invalid');
  const own = evidence.listeners.filter(item => item.pid === victim.pid || item.port === victim.port);
  if (stopped ? own.length !== 0 : own.length !== 1 || own[0].pid !== victim.pid ||
      own[0].port !== victim.port || own[0].address !== '127.0.0.1') fail('victim_listener_changed');
  if (evidence.established.some(item => item.localPort === victim.port || item.peerPort === victim.port ||
      item.pids.includes(victim.pid))) fail('victim_connections_present');
}

export function assertOnlineRollingPlan(evidence) {
  if (!object(evidence)) fail('evidence_invalid');
  assertOnlineRollingHistory(evidence.history);
  const victim = identity(evidence.victim), all = processes(evidence.processes);
  if (!SHA.test(evidence.toolRevision ?? '') || evidence.targetNotStaged !== true || evidence.maintenanceEnded !== true ||
      evidence.sourceClean !== true || evidence.history.entries.some(cert => cert.nextTarget === evidence.toolRevision))
    fail('target_not_eligible');
  if (!Array.isArray(evidence.protectedAnchors) || evidence.protectedAnchors.length !== 3) fail('three_anchors_required');
  const current = all.find(item => item.name === victim.name);
  if (!current || current.status !== 'online' || current.pid !== victim.pid || current.pmId !== victim.pmId ||
      current.cwd !== victim.cwd || current.port !== victim.port) fail('victim_process_changed');
  paused(current);
  const certs = allCertificates(evidence.history);
  for (const cert of certs) equal(all.find(item => item.name === cert.victim.name), cert.stoppedProcess, 'retired_registration_changed');
  if (all.some(item => item.status === 'stopped' && !certs.some(cert => cert.victim.name === item.name))) fail('uncertified_stopped_process');
  const targets = evidence.protectedAnchors.map(item => item.target);
  for (const item of evidence.protectedAnchors) {
    anchor(item); equal(all.find(process => process.name === item.name), item.process, 'protected_anchor_changed');
    if (item.process.status !== 'online' || item.process.cwd !== item.directory || item.process.port !== item.port ||
        item.process.name !== item.name) fail('protected_anchor_changed');
  }
  if (new Set([victim.target, evidence.toolRevision, ...targets]).size !== 5 ||
      new Set([victim.port, ...evidence.protectedAnchors.map(item => item.port)]).size !== 4) fail('protected_release');
  const previous = evidence.history.entries.at(-1), legacy = evidence.history.legacyCertificates[0];
  const expected = previous ? [previous.nextTarget, ...previous.protectedAnchors.slice(0, 2).map(item => item.target)]
    : legacy ? [legacy.nextTarget, legacy.activeTarget, legacy.rollbackTarget] : null;
  if (!expected) fail('history_root_missing');
  equal(targets, expected, 'previous_release_not_published');
  if (previous) for (let index = 0; index < 2; index++)
    equal(evidence.protectedAnchors[index + 1].process, previous.protectedAnchors[index].process, 'rollback_identity_drift');
  // Bind the first generation to the original completed retirement's full PM2
  // proof, and retain every original registration in all later generations.
  for (const original of evidence.history.legacyProcesses) {
    const retired = certs.find(cert => cert.victim.name === original.name);
    equal(all.find(item => item.name === original.name), retired?.stoppedProcess ?? original, 'legacy_identity_drift');
  }
  for (const name of ROLLING_BASE_NAMES) if (!all.some(item => item.name === name && item.status === 'online')) fail('base_process_missing');
  const pairs = [[victim.target, targets[2]], [targets[2], targets[1]], [targets[1], targets[0]], [targets[0], evidence.toolRevision]];
  equal(evidence.ancestry, pairs.map(([older, newer]) => ({older, newer, verified: true})), 'ancestry_invalid');
  if (typeof evidence.nginxConfig !== 'string' || !evidence.nginxConfig.trim() ||
      new RegExp(`(?:^|[^0-9])${victim.port}(?:$|[^0-9])`).test(evidence.nginxConfig) ||
      evidence.nginxConfig.includes(victim.name) || evidence.nginxConfig.includes(victim.cwd)) fail('proxy_reference');
  const state = evidence.sourceState;
  if (!object(state) || state.status !== 'active' || state.target !== victim.target || state.name !== victim.name ||
      state.directory !== victim.cwd || state.port !== victim.port || state.sourceHead !== victim.target ||
      state.buildId !== victim.target) fail('victim_source_changed');
  const proof = evidence.identityProofs?.find(item => item.name === victim.name);
  const online = all.filter(item => item.status === 'online');
  if (!Array.isArray(evidence.identityProofs) || evidence.identityProofs.length !== online.length ||
      new Set(evidence.identityProofs.map(item => item.name)).size !== online.length) fail('os_process_set_invalid');
  for (const item of online) {
    const fact = evidence.identityProofs.find(value => value.name === item.name);
    if (!fact || fact.pid !== item.pid || fact.cwd !== item.cwd || !Number.isSafeInteger(fact.uid) || fact.uid < 0 ||
        !positive(fact.parentPid) || !/^\d+$/.test(fact.startTicks ?? '') || !HASH.test(fact.commandSha256 ?? '') ||
        !HASH.test(fact.environmentSha256 ?? '') || typeof fact.executable !== 'string' || !fact.executable.startsWith('/'))
      fail('os_process_identity_invalid');
  }
  if (!proof || proof.pid !== victim.pid || proof.cwd !== victim.cwd || proof.uid !== 0 ||
      !positive(evidence.daemon?.fact?.pid) || proof.parentPid !== evidence.daemon.fact.pid ||
      !/^\d+$/.test(proof.startTicks ?? '') || !HASH.test(proof.commandSha256 ?? '') ||
      !HASH.test(proof.environmentSha256 ?? '') || evidence.victimChildren !== '' ||
      !['SIGINT', 'SIGTERM'].includes(evidence.daemon.killSignal)) fail('os_identity_invalid');
  equal(evidence.victimRuntimeFlags, {backgroundPaused: '1', automationEnabled: '0', invitationEnabled: '0',
    manualSignalHandle: ''}, 'runtime_flags_invalid');
  assertRollingExecutable(current, proof, evidence.resolvedInterpreter);
  checkSockets(evidence, victim); return victim;
}

export function assertOnlineRollingCompletion(before, after) {
  const victim = assertOnlineRollingPlan(before);
  if (!object(after)) fail('completion_invalid');
  for (const key of Object.keys(before).filter(key => !['processes', 'listeners', 'established'].includes(key)))
    equal(after[key], before[key], 'completion_baseline_changed');
  const previous = processes(before.processes), current = processes(after.processes);
  if (current.length !== previous.length) fail('process_set_changed');
  for (const process of previous) equal(current.find(item => item.name === process.name),
    process.name === victim.name ? {...process, pid: 0, status: 'stopped'} : process, 'process_identity_changed');
  checkSockets(after, victim, true);
  equal(after.listeners, before.listeners.filter(item => item.pid !== victim.pid && item.port !== victim.port), 'unrelated_listener_changed');
  return true;
}
