import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {assertOnlineRollingHistory, assertRollingRetainedProcesses, ROLLING_BASE_NAMES,
  rollingHash, rollingCanonicalText, assertRollingExecutable} from './online-release-rolling-policy.mjs';
import {assertRetainedOnlineProcesses} from './online-release-retirement-policy.mjs';
import {WEB_RELEASE_FILES} from './web-presentation-release-policy.mjs';

// Inactive, pure evidence contract. No stop, publication, cleanup or authorization
// is performed here. The eventual host adapter must collect these facts itself.
export const ONLINE_RETENTION_POLICY = 'current-plus-one-v2';
export const retentionHash = rollingHash;
export const retentionCanonicalText = rollingCanonicalText;
const APP = '/www/wwwroot/merchant-space';
// Strict end-of-input, unlike `$` before a final line terminator.
const SHA = /^[a-f0-9]{40}(?![\s\S])/, HASH = /^[a-f0-9]{64}(?![\s\S])/;
const fail = reason => {throw Error(`online_retention_${reason}`);};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const equal = (a, b, reason) => {if (!isDeepStrictEqual(a, b)) fail(reason);};
const nameOf = target => `merchant-space-online-${target.slice(0, 12)}`;
const directoryOf = target => `${APP}.web-releases/${target.slice(0, 12)}-online`;
const locationOf = a => Object.fromEntries(['target', 'name', 'directory', 'port'].map(key => [key, a[key]]));
const rawHash = text => createHash('sha256').update(text).digest('hex');
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const PROCESS_KEYS = ['name', 'pmId', 'pid', 'cwd', 'status', 'port', 'executable', 'interpreter', 'args', 'nodeArgs',
  'execMode', 'autorestart', 'watch', 'cronRestart', 'backgroundPaused', 'automationEnabled', 'invitationEnabled',
  'killTimeout', 'shutdownWithMessage', 'restartCount', 'createdAt', 'environmentSha256'];

function processList(value) {
  if (!Array.isArray(value) || !value.length) fail('processes_invalid');
  const names = new Set(), ids = new Set(), pids = new Set();
  for (const p of value) {
    if (!object(p) || PROCESS_KEYS.some(key => !Object.hasOwn(p, key)) ||
        Object.keys(p).some(key => !PROCESS_KEYS.includes(key) && key !== 'manualSignalHandle') ||
        typeof p.name !== 'string' || !p.name || names.has(p.name) || !Number.isSafeInteger(p.pmId) || p.pmId < 0 || ids.has(p.pmId) ||
        typeof p.cwd !== 'string' || !p.cwd.startsWith('/') || typeof p.executable !== 'string' || !p.executable.startsWith('/') ||
        !Array.isArray(p.args) || !p.args.every(item => typeof item === 'string') || !Array.isArray(p.nodeArgs) ||
        !p.nodeArgs.every(item => typeof item === 'string') || !HASH.test(p.environmentSha256 ?? '') ||
        !['online', 'stopped'].includes(p.status) ||
        (p.status === 'online' ? !positive(p.pid) || pids.has(p.pid) : p.pid !== 0)) fail('processes_invalid');
    names.add(p.name); ids.add(p.pmId); if (p.pid) pids.add(p.pid);
  }
  return value;
}
function anchor(a) {
  if (!object(a) || !SHA.test(a.target ?? '') || a.name !== nameOf(a.target) || a.directory !== directoryOf(a.target) ||
      !Number.isSafeInteger(a.port) || a.port < 3103 || a.port > 3110) fail('anchor_invalid');
  const p = processList([a.process])[0];
  if (p.name !== a.name || p.cwd !== a.directory || p.port !== a.port || p.status !== 'online') fail('anchor_process_invalid');
  return a;
}
function pair(active, rollback) {
  anchor(active); anchor(rollback);
  if (active.target === rollback.target || active.port === rollback.port || active.process.pmId === rollback.process.pmId ||
      active.process.pid === rollback.process.pid) fail('window_invalid');
}
function victim(v) {
  if (!object(v) || !SHA.test(v.target ?? '')) fail('victim_invalid');
  const p = processList([v.process])[0];
  anchor({target: v.target, name: p.name, directory: p.cwd, port: p.port, process: p});
  if (p.backgroundPaused !== '1' || p.automationEnabled !== '0' || p.invitationEnabled !== '0' ||
      p.watch !== false || ![null, false, '0'].includes(p.cronRestart) ||
      ![undefined, ''].includes(p.manualSignalHandle) || p.shutdownWithMessage !== false) fail('victim_unsafe');
  return p;
}
function roots(value, old) {
  if (value.legacySha256 !== old.legacySha256 || value.rollingHeadSha256 !== old.headSha256 ||
      value.rollingHistorySha256 !== rollingHash(old)) fail('legacy_root_changed');
}
function baseCertificates(history) {return [...history.rollingHistory.legacyCertificates, ...history.rollingHistory.entries];}
function retirementCertificates(history) {
  return [...baseCertificates(history).map(cert => ({process: {...cert.stoppedProcess, pid: cert.victim.pid, status: 'online'},
    stopped: cert.stoppedProcess})), ...history.entries.filter(cert => cert.kind === 'retire')
    .map(cert => ({process: cert.victim.process, stopped: cert.stoppedProcess}))];
}
function preserve(saved, current, certificates) {
  processList(current);
  for (const old of saved) {
    const stopped = certificates.filter(cert => cert.process.name === old.name);
    if (stopped.length > 1) fail('duplicate_retirement');
    equal(current.find(p => p.name === old.name), stopped[0]?.stopped ?? old, 'retained_identity_changed');
  }
  for (const cert of certificates) equal(current.find(p => p.name === cert.process.name), cert.stopped, 'stopped_registration_changed');
  if (current.some(p => p.status === 'stopped' && !certificates.some(cert => cert.stopped.name === p.name))) fail('uncertified_stop');
  for (const name of ROLLING_BASE_NAMES) if (!current.some(p => p.name === name && p.status === 'online')) fail('base_process_missing');
}

export function createOnlineRetentionHistory(rollingHistory) {
  assertOnlineRollingHistory(rollingHistory);
  return {version: 2, policy: ONLINE_RETENTION_POLICY, rollingHistory: structuredClone(rollingHistory), entries: [], headSha256: null};
}
export function onlineRetentionHeadRecord(history) {
  assertOnlineRetentionHistory(history);
  if (!history.entries.length) fail('window_uninitialized');
  return {version: 2, policy: ONLINE_RETENTION_POLICY, sequence: history.entries.length, headSha256: history.headSha256};
}
export function assertOnlineRetentionHeadRecord(history, record) {
  equal(record, onlineRetentionHeadRecord(history), 'recorded_head_changed');
  return true;
}
function rollbackProof(proof, history) {
  const latest = history.entries.at(-1);
  if (!latest || !object(proof) || proof.version !== 1 || proof.historyHeadSha256 !== history.headSha256 ||
      typeof proof.failedStateText !== 'string' || rawHash(proof.failedStateText) !== proof.failedStateSha256)
    fail('rollback_proof_invalid');
  equal(Object.keys(proof).sort(), ['version', 'historyHeadSha256', 'from', 'to', 'activeFile',
    'failedStateText', 'failedStateSha256', 'proxyFiles', 'proxyHashes'].sort(), 'rollback_proof_invalid');
  equal(proof.from, locationOf(latest.active), 'rollback_from_changed');
  equal(proof.to, locationOf(latest.rollback), 'rollback_to_changed');
  equal(proof.activeFile, proof.to, 'rollback_active_changed');
  let failed; try {failed = JSON.parse(proof.failedStateText);} catch {fail('rollback_state_invalid');}
  if (!object(failed) || failed.status !== 'rolled-back' || !iso(failed.activatedAt) || !iso(failed.rolledBackAt) ||
      Date.parse(failed.rolledBackAt) < Date.parse(failed.activatedAt) ||
      failed.retentionRollbackHeadSha256 !== proof.historyHeadSha256) fail('rollback_state_invalid');
  equal(locationOf(failed), proof.from, 'rollback_state_changed');
  equal([failed.baseline, failed.oldName, failed.oldDirectory, failed.oldPort],
    [proof.to.target, proof.to.name, proof.to.directory, proof.to.port], 'rollback_baseline_changed');
  if (failed.previousActive !== undefined) equal(failed.previousActive, proof.to, 'rollback_baseline_changed');
  const birth = history.entries.find(c => c.kind === 'converge' && c.active.target === proof.from.target);
  if (birth ? failed.retentionHeadSha256 !== birth.previousSha256 :
    history.entries[0].active.target !== proof.from.target || failed.retentionHeadSha256 !== undefined)
    fail('rollback_birth_head_changed');
  for (const value of [proof.proxyFiles, proof.proxyHashes, failed.configs]) {
    if (!object(value)) fail('rollback_proxy_invalid');
    equal(Object.keys(value).sort(), [...WEB_RELEASE_FILES].sort(), 'rollback_proxy_invalid');
  }
  for (const file of WEB_RELEASE_FILES) {
    const texts = proof.proxyFiles[file], hashes = failed.configs[file];
    if (!object(texts) || typeof texts.beforeText !== 'string' || !texts.beforeText ||
        typeof texts.afterText !== 'string' || !texts.afterText || !object(hashes) ||
        rawHash(texts.beforeText) !== hashes.oldHash || rawHash(texts.afterText) !== hashes.newHash ||
        proof.proxyHashes[file] !== hashes.oldHash) fail('rollback_proxy_changed');
    equal(Object.keys(texts).sort(), ['afterText', 'beforeText'], 'rollback_proxy_invalid');
  }
  return failed;
}
export function assertOnlineRetentionRollbackProof({history, proof, actualActive}) {
  assertOnlineRetentionHistory(history); rollbackProof(proof, history);
  if (actualActive !== undefined) equal(actualActive, proof.to, 'rollback_active_changed');
  return true;
}
export function assertOnlineRetentionCertificate(c) {
  if (!object(c) || c.version !== 2 || c.policy !== ONLINE_RETENTION_POLICY || c.status !== 'completed' ||
      !['initialize', 'converge', 'retire'].includes(c.kind) || !positive(c.sequence) || c.sequence > 999999 ||
      !(c.previousSha256 === null || HASH.test(c.previousSha256 ?? '')) || !HASH.test(c.legacySha256 ?? '') ||
      !(c.rollingHeadSha256 === null || HASH.test(c.rollingHeadSha256 ?? '')) || !HASH.test(c.rollingHistorySha256 ?? '') ||
      !['beforeSha256', 'afterSha256', 'preparedSha256', 'recoverySha256'].every(key => HASH.test(c[key] ?? '')) ||
      !SHA.test(c.toolRevision ?? '') || !iso(c.completedAt)) fail('certificate_invalid');
  pair(c.active, c.rollback); processList(c.processes);
  for (const a of [c.active, c.rollback]) equal(c.processes.find(p => p.name === a.name), a.process, 'window_process_changed');
  if (c.kind === 'retire') {
    const p = victim(c.victim);
    if ([c.active.name, c.rollback.name, ...ROLLING_BASE_NAMES].includes(p.name)) fail('protected_victim');
    equal(c.stoppedProcess, {...p, pid: 0, status: 'stopped'}, 'stopped_process_invalid');
    equal(c.processes.find(item => item.name === p.name), c.stoppedProcess, 'stopped_process_invalid');
    if (c.beforeSha256 === c.afterSha256) fail('retirement_without_change');
  } else if (c.victim !== null || c.stoppedProcess !== null) fail('unexpected_victim');
  return true;
}
function checkTransition(c, history) {
  roots(c, history.rollingHistory);
  if (c.sequence !== history.entries.length + 1 || c.previousSha256 !== history.headSha256) fail('history_chain_invalid');
  const prior = history.entries.at(-1);
  if (!prior) {
    if (c.kind !== 'initialize') fail('initialization_required');
    const old = history.rollingHistory, last = old.entries.at(-1), first = old.legacyCertificates[0];
    const chain = last ? [last.nextTarget, ...last.protectedAnchors.map(a => a.target)]
      : first ? [first.nextTarget, first.activeTarget, first.rollbackTarget] : [];
    if (!chain.some((target, index) => target === c.active.target && chain[index + 1] === c.rollback.target)) fail('initial_window_unbound');
  } else {
    if (c.kind === 'initialize') fail('duplicate_initialization');
    if (c.kind === 'converge') {
      if (history.entries.some(entry => [entry.active.target, entry.rollback.target].includes(c.active.target)))
        fail('publication_transition_invalid');
      if (c.rollbackProof !== undefined && c.rollbackProof !== null) {
        rollbackProof(c.rollbackProof, history);
        equal(c.rollback, prior.rollback, 'rollback_identity_changed');
      } else {
        if (c.rollback.target !== prior.active.target) fail('publication_transition_invalid');
        equal(c.rollback, prior.active, 'rollback_identity_changed');
      }
    } else {
      equal(c.active, prior.active, 'window_changed'); equal(c.rollback, prior.rollback, 'window_changed');
    }
  }
  if (c.kind !== 'converge' && c.rollbackProof !== undefined && c.rollbackProof !== null) fail('unexpected_rollback_proof');
  if (c.kind === 'retire' && retirementCertificates(history).some(old =>
    old.process.name === c.victim.process.name || old.process.pmId === c.victim.process.pmId)) fail('duplicate_retirement');
  if (c.kind === 'retire') equal(prior.processes.find(p => p.name === c.victim.process.name), c.victim.process, 'victim_birth_identity_changed');
}
export function assertOnlineRetentionHistory(history) {
  if (!object(history) || history.version !== 2 || history.policy !== ONLINE_RETENTION_POLICY || !Array.isArray(history.entries)) fail('history_invalid');
  assertOnlineRollingHistory(history.rollingHistory);
  const prefix = createOnlineRetentionHistory(history.rollingHistory);
  for (const c of history.entries) {
    assertOnlineRetentionCertificate(c); checkTransition(c, prefix);
    const previous = prefix.entries.at(-1);
    if (previous && Date.parse(c.completedAt) < Date.parse(previous.completedAt)) fail('history_time_reversed');
    const certificates = retirementCertificates(prefix);
    if (c.kind === 'retire') certificates.push({process: c.victim.process, stopped: c.stoppedProcess});
    preserve(previous?.processes ?? history.rollingHistory.legacyProcesses, c.processes, certificates);
    if (previous) {
      const added = c.processes.filter(p => !previous.processes.some(old => old.name === p.name));
      equal(added, c.kind === 'converge' ? [c.active.process] : [], 'unexpected_process_added');
    }
    prefix.entries.push(c); prefix.headSha256 = retentionHash(c);
  }
  if (history.headSha256 !== prefix.headSha256) fail('history_head_invalid');
  return true;
}

/** A self-contained directory cannot prove an absent complete tail never
 * existed. Publication state must separately pin the head it actually used. */
export function assertOnlineRetentionHead(history, expectedHeadSha256) {
  assertOnlineRetentionHistory(history);
  if (!HASH.test(expectedHeadSha256 ?? '') || history.headSha256 !== expectedHeadSha256) fail('recorded_head_changed');
  return true;
}

function state(a, value, previous) {
  if (!object(value) || value.status !== 'active') fail('release_not_active');
  for (const key of ['target', 'name', 'directory', 'port']) equal(value[key], a[key], 'release_state_changed');
  if (!iso(value.activatedAt)) fail('release_not_published');
  if (previous) equal([value.baseline, value.oldName, value.oldDirectory, value.oldPort],
    [previous.target, previous.name, previous.directory, previous.port], 'baseline_edge_changed');
}
function sockets(value) {
  if (!Array.isArray(value.listeners) || !Array.isArray(value.established)) fail('sockets_invalid');
  for (const p of value.listeners) if (!object(p) || typeof p.address !== 'string' || !positive(p.port) || p.port > 65535 || !positive(p.pid)) fail('sockets_invalid');
  for (const p of value.established) if (!object(p) || !positive(p.localPort) || p.localPort > 65535 ||
    !positive(p.peerPort) || p.peerPort > 65535 || !Array.isArray(p.pids) || p.pids.some(pid => !positive(pid))) fail('sockets_invalid');
}
function observation(value, history) {
  if (!object(value) || value.version !== 2 || value.policy !== ONLINE_RETENTION_POLICY ||
      !['initialize', 'converge', 'retire'].includes(value.kind) ||
      !SHA.test(value.toolRevision ?? '') || value.sourceClean !== true || value.maintenanceEnded !== true ||
      !HASH.test(value.maintenanceSha256 ?? '') || !HASH.test(value.markerSha256 ?? '') ||
      typeof value.baseDirectory !== 'string' || !value.baseDirectory.startsWith('/') ||
      !object(value.proxyHashes) || !Object.keys(value.proxyHashes).length ||
      Object.values(value.proxyHashes).some(hash => !HASH.test(hash ?? '')) ||
      typeof value.nginxConfig !== 'string' || !value.nginxConfig.trim()) fail('observation_invalid');
  equal(Object.keys(value.proxyHashes).sort(), [...WEB_RELEASE_FILES].sort(), 'proxy_hash_set_invalid');
  roots(value, history.rollingHistory); pair(value.active, value.rollback); processList(value.processes); sockets(value);
  equal(value.activeFile, Object.fromEntries(['target', 'name', 'directory', 'port'].map(k => [k, value.active[k]])), 'active_file_changed');
  state(value.active, value.activeState, value.rollback);
  if (!Array.isArray(value.releaseProofs)) fail('release_proofs_invalid');
  const anchors = [value.active, value.rollback, ...(value.victim ? [{target: value.victim.target,
    name: value.victim.process.name, directory: value.victim.process.cwd, port: value.victim.process.port, process: value.victim.process}] : [])];
  if (value.releaseProofs.length !== anchors.length || new Set(value.releaseProofs.map(p => p.target)).size !== anchors.length) fail('release_proofs_invalid');
  for (const a of anchors) {
    const proof = value.releaseProofs.find(p => p.target === a.target);
    if (!proof || proof.sourceHead !== a.target || proof.sourceClean !== true ||
        proof.http?.status !== 200 || proof.http?.ok !== true || proof.http?.buildId !== a.target ||
        !['stateSha256', 'buildSha256', 'runtimeSha256', 'environmentSha256'].every(k => HASH.test(proof[k] ?? ''))) fail('release_proof_changed');
    const failed = a.target === value.victim?.target && history.entries.find(c =>
      c.kind === 'converge' && c.rollbackProof?.from.target === a.target)?.rollbackProof;
    if (failed && proof.state?.status === 'rolled-back') {
      equal(proof.stateText, failed.failedStateText, 'retired_rollback_state_changed');
      equal(locationOf(proof.state), locationOf(a), 'release_state_changed');
    } else state(a, proof.state);
    if (rawHash(proof.stateText) !== proof.stateSha256) fail('release_state_hash_changed');
    let parsed; try {parsed = JSON.parse(proof.stateText);} catch {fail('release_state_invalid');}
    equal(parsed, proof.state, 'release_state_hash_changed');
    if (a.target === value.active.target) equal(proof.state, value.activeState, 'active_state_changed');
    equal(value.processes.find(p => p.name === a.name), a.process, 'anchor_process_changed');
    equal(value.listeners.filter(s => s.port === a.port || s.pid === a.process.pid),
      [{address: '127.0.0.1', port: a.port, pid: a.process.pid}], 'release_listener_changed');
  }
  const online = value.processes.filter(p => p.status === 'online');
  if (!Array.isArray(value.identityProofs) || value.identityProofs.length !== online.length ||
      new Set(value.identityProofs.map(p => p.name)).size !== online.length) fail('os_process_set_invalid');
  for (const p of online) {
    const fact = value.identityProofs.find(f => f.name === p.name);
    if (!fact || fact.pid !== p.pid || fact.cwd !== p.cwd || fact.uid !== 0 || !positive(fact.parentPid) ||
        !/^\d+$/.test(fact.startTicks ?? '') || !HASH.test(fact.commandSha256 ?? '') ||
        !HASH.test(fact.environmentSha256 ?? '') || typeof fact.executable !== 'string' || !fact.executable.startsWith('/')) fail('os_identity_invalid');
    const release = anchors.find(a => a.name === p.name);
    if (release) assertRollingExecutable(p, fact, value.releaseProofs.find(proof => proof.target === release.target).resolvedInterpreter);
  }
}

export function assertOnlineRetentionPlan(before, history) {
  assertOnlineRetentionHistory(history); observation(before, history);
  const c = {...before, status: 'completed', completedAt: '2000-01-01T00:00:00.000Z'};
  checkTransition(c, history);
  const previous = history.entries.at(-1), certificates = retirementCertificates(history);
  preserve(previous?.processes ?? history.rollingHistory.legacyProcesses, before.processes, certificates);
  if (previous) {
    const added = before.processes.filter(p => !previous.processes.some(old => old.name === p.name));
    equal(added, before.kind === 'converge' ? [before.active.process] : [], 'unexpected_process_added');
  }
  if (!previous) {
    const old = history.rollingHistory, saved = before.processes.filter(p => p.status === 'online');
    if (old.entries.length) assertRollingRetainedProcesses({saved, current: before.processes, history: old, activeTarget: before.active.target});
    else assertRetainedOnlineProcesses({saved, current: before.processes, certificates: old.legacyCertificates, activeTarget: before.active.target});
  }
  if (before.kind === 'converge') {
    // Old stable rollback survives until the publication has completed. After a
    // rollback, a future explicit publication proof is needed; no inferred flip.
    if (before.activeState.retentionHeadSha256 !== history.headSha256) fail('publication_birth_head_changed');
    equal(before.activeState.retentionRollbackProof ?? null, before.rollbackProof ?? null, 'publication_rollback_proof_changed');
    if (before.rollbackProof && Date.parse(before.activeState.activatedAt) <
        Date.parse(JSON.parse(before.rollbackProof.failedStateText).rolledBackAt)) fail('publication_predates_rollback');
    equal(before.processes.find(p => p.name === previous.rollback.name), previous.rollback.process, 'previous_rollback_missing');
  }
  const expectedAncestry = [{older: before.rollback.target, newer: before.active.target, verified: true}];
  if (before.kind !== 'retire') {
    if (before.victim !== null) fail('unexpected_victim');
  } else {
    const p = victim(before.victim);
    if ([before.active.name, before.rollback.name, ...ROLLING_BASE_NAMES].includes(p.name)) fail('protected_victim');
    expectedAncestry.unshift({older: before.victim.target, newer: before.active.target, verified: true});
    equal(before.processes.find(item => item.name === p.name), p, 'victim_process_changed');
    const fact = before.identityProofs.find(f => f.name === p.name);
    if (!positive(before.daemon?.fact?.pid) || fact.parentPid !== before.daemon.fact.pid ||
        !/^\d+$/.test(before.daemon.fact.startTicks ?? '') || !['SIGINT', 'SIGTERM'].includes(before.daemon.killSignal) ||
        !Number.isSafeInteger(before.daemon.killTimeout) || before.daemon.killTimeout < 1000 || before.daemon.killTimeout > 60000 ||
        before.victimChildren !== '') fail('victim_os_unsafe');
    equal(before.victimRuntimeFlags, {backgroundPaused: '1', automationEnabled: '0', invitationEnabled: '0', manualSignalHandle: ''}, 'victim_runtime_unsafe');
    assertRollingExecutable(p, fact, before.resolvedInterpreter);
    const own = before.listeners.filter(s => s.pid === p.pid || s.port === p.port);
    equal(own, [{address: '127.0.0.1', port: p.port, pid: p.pid}], 'victim_listener_changed');
    if (before.established.some(s => s.localPort === p.port || s.peerPort === p.port || s.pids.includes(p.pid))) fail('victim_connections_present');
    if (new RegExp(`(?:^|[^0-9])${p.port}(?:$|[^0-9])`).test(before.nginxConfig) ||
        before.nginxConfig.includes(p.name) || before.nginxConfig.includes(p.cwd)) fail('victim_proxy_reference');
  }
  equal(before.ancestry, expectedAncestry, 'ancestry_invalid');
  return true;
}

export function assertOnlineRetentionCompletion(before, after, history) {
  assertOnlineRetentionPlan(before, history);
  if (!object(after)) fail('completion_invalid');
  const expected = structuredClone(before);
  if (before.kind === 'retire') {
    const p = before.victim.process;
    expected.processes = expected.processes.map(item => item.name === p.name ? {...item, pid: 0, status: 'stopped'} : item);
    expected.listeners = expected.listeners.filter(s => s.pid !== p.pid && s.port !== p.port);
    expected.identityProofs = expected.identityProofs.filter(f => f.name !== p.name);
  }
  sockets(after);
  if (before.kind === 'retire' && after.established.some(s => s.localPort === before.victim.process.port ||
      s.peerPort === before.victim.process.port || s.pids.includes(before.victim.process.pid))) fail('victim_connections_present');
  // Other processes' transient connections do not change the owned stop proof.
  equal({...after, established: before.established}, expected, 'completion_changed');
  return true;
}

/** Actual active is supplied by the future adapter, never inferred from a cert.
 * Rolled-back is deliberately non-converged: staging is possible, retirement or
 * a reverse/second rollback is not. This does not certify the running host. */
export function inspectOnlineRetentionWindow({history, actualActive, current, saved, rollbackProof: proof}) {
  assertOnlineRetentionHistory(history);
  const latest = history.entries.at(-1);
  if (!latest || !object(actualActive)) fail('window_uninitialized');
  const selected = [latest.active, latest.rollback].find(a => a.target === actualActive.target);
  if (!selected) fail('active_outside_window');
  equal(actualActive, Object.fromEntries(['target', 'name', 'directory', 'port'].map(k => [k, selected[k]])), 'actual_active_changed');
  preserve(latest.processes, current, retirementCertificates(history));
  if (saved) preserve(saved, current, retirementCertificates(history));
  for (const a of [latest.active, latest.rollback]) equal(current.find(p => p.name === a.name), a.process, 'window_process_changed');
  const stable = selected.target === latest.active.target;
  if (!stable && proof !== undefined) rollbackProof(proof, history);
  const extraOnlineWebProcesses = current.filter(p => p.status === 'online' && /^merchant-space-online-[a-f0-9]{12}$/.test(p.name) &&
    ![latest.active.name, latest.rollback.name].includes(p.name)).map(p => p.name);
  return {phase: stable ? 'stable' : 'rolled-back', converged: stable && extraOnlineWebProcesses.length === 0, extraOnlineWebProcesses,
    mayStage: stable || proof !== undefined, mayRetire: stable, mayRollback: stable,
    active: selected, stableRollback: stable ? latest.rollback : null};
}
export function assertOnlineRetentionRollback({history, actualActive, destinationTarget, current, saved}) {
  const window = inspectOnlineRetentionWindow({history, actualActive, current, saved});
  if (!window.mayRollback || destinationTarget !== window.stableRollback.target) fail('rollback_edge_invalid');
  return true;
}

/** Only the host publisher supplies actual active/PM2 facts. These snapshots
 * authorize no mutation and never infer an unrecorded candidate's ownership. */
export function snapshotOnlineRetentionPublication({history, actualActive, current, releaseTarget, rollbackProof: proof}) {
  const window = inspectOnlineRetentionWindow({history, actualActive, current, rollbackProof: proof});
  if (!window.mayStage || !SHA.test(releaseTarget ?? '') || history.entries.some(c =>
    [c.active.target, c.rollback.target, c.victim?.target].includes(releaseTarget)) ||
    current.some(p => p.name === nameOf(releaseTarget))) fail('publication_target_invalid');
  const latest = history.entries.at(-1);
  if (current.length !== latest.processes.length || current.some(p => !latest.processes.some(old => old.name === p.name)))
    fail('unexpected_process_added');
  if (window.phase === 'stable' && proof !== undefined && proof !== null) fail('unexpected_rollback_proof');
  return {processes: structuredClone(current), retentionHeadSha256: history.headSha256,
    ...(window.phase === 'rolled-back' ? {retentionRollbackProof: structuredClone(proof)} : {})};
}

export function assertOnlineRetentionPublication({history, state: publication, actualActive, current, action}) {
  assertOnlineRetentionHistory(history); processList(current);
  if (!object(publication) || !SHA.test(publication.target ?? '') || publication.name !== nameOf(publication.target) ||
      publication.directory !== directoryOf(publication.target) || !Number.isSafeInteger(publication.port) ||
      publication.port < 3103 || publication.port > 3110)
    fail('publication_state_invalid');
  if (publication.retentionHeadSha256 === undefined) {
    const adopted = history.entries[0], latest = history.entries.at(-1);
    if (!adopted || adopted.kind !== 'initialize' || adopted.active.target !== publication.target ||
        history.entries.some(c => c.kind === 'converge')) fail('publication_birth_head_changed');
    equal(locationOf(publication), locationOf(adopted.active), 'publication_state_invalid');
    equal([publication.baseline, publication.oldName, publication.oldDirectory, publication.oldPort],
      [adopted.rollback.target, adopted.rollback.name, adopted.rollback.directory, adopted.rollback.port], 'publication_baseline_changed');
    if (publication.previousActive !== undefined) equal(publication.previousActive, locationOf(adopted.rollback), 'publication_baseline_changed');
    const window = inspectOnlineRetentionWindow({history, actualActive, current});
    preserve(latest.processes, current, retirementCertificates(history));
    if (current.length !== latest.processes.length) fail('unexpected_process_added');
    if (action === 'rollback' && window.phase !== 'stable') fail('rollback_edge_invalid');
    if (window.phase === 'rolled-back' && (publication.status !== 'rolled-back' ||
        publication.retentionRollbackHeadSha256 !== history.headSha256 || !iso(publication.rolledBackAt))) fail('rollback_state_invalid');
    return {phase: window.phase === 'stable' ? 'adopted' : 'rolled-back', converged: window.converged,
      baseline: structuredClone(adopted.rollback), candidatePresent: true};
  }
  if (!HASH.test(publication.retentionHeadSha256)) fail('publication_birth_head_changed');
  const birthIndex = history.entries.findIndex(c => retentionHash(c) === publication.retentionHeadSha256);
  if (birthIndex < 0) fail('publication_birth_head_changed');
  const prefix = {...history, entries: history.entries.slice(0, birthIndex + 1), headSha256: publication.retentionHeadSha256};
  const born = prefix.entries.at(-1), proof = publication.retentionRollbackProof;
  if (born.processes.some(p => p.name === publication.name)) fail('publication_target_invalid');
  let baseline = born.active;
  if (proof !== undefined && proof !== null) {rollbackProof(proof, prefix); baseline = born.rollback;}
  equal([publication.baseline, publication.oldName, publication.oldDirectory, publication.oldPort],
    [baseline.target, baseline.name, baseline.directory, baseline.port], 'publication_baseline_changed');
  if (publication.previousActive !== undefined) equal(publication.previousActive, locationOf(baseline), 'publication_baseline_changed');
  processList(publication.processes);
  if (publication.processes.length !== born.processes.length) fail('publication_snapshot_changed');
  for (const p of born.processes) equal(publication.processes.find(row => row.name === p.name), p, 'publication_snapshot_changed');
  const introduced = history.entries.find(c => c.kind === 'converge' && c.active.target === publication.target);
  if (introduced) {
    if (introduced.previousSha256 !== publication.retentionHeadSha256) fail('publication_birth_head_changed');
    equal(introduced.rollback, baseline, 'publication_baseline_changed');
    equal(introduced.rollbackProof ?? null, proof ?? null, 'publication_rollback_proof_changed');
    const suffix = history.entries.slice(history.entries.indexOf(introduced) + 1);
    if (suffix.some(c => c.kind !== 'retire' || c.active.target !== publication.target || c.rollback.target !== baseline.target))
      fail('publication_no_longer_current');
  } else if (history.headSha256 !== publication.retentionHeadSha256) fail('publication_birth_head_changed');
  const latest = history.entries.at(-1), certificates = retirementCertificates(history);
  preserve(latest.processes, current, certificates); preserve(publication.processes, current, certificates);
  const added = current.filter(p => !latest.processes.some(old => old.name === p.name));
  if (added.length > (introduced ? 0 : 1) || added.some(p => p.name !== publication.name || p.cwd !== publication.directory ||
      p.port !== publication.port || p.status !== 'online')) fail('unexpected_process_added');
  const own = current.find(p => p.name === publication.name);
  if (own && (own.cwd !== publication.directory || own.port !== publication.port || own.status !== 'online')) fail('candidate_identity_changed');
  equal(current.find(p => p.name === baseline.name), baseline.process, 'baseline_identity_changed');
  const isOwn = isDeepStrictEqual(actualActive, locationOf(publication));
  const isBaseline = isDeepStrictEqual(actualActive, locationOf(baseline));
  if ((!isOwn && !isBaseline) || (isOwn && (!own || !['active', 'activating'].includes(publication.status))))
    fail('publication_active_changed');
  if (action === 'rollback' && !isOwn) fail('rollback_edge_invalid');
  if (publication.status === 'active' && !isOwn) fail('publication_active_changed');
  if (introduced && isBaseline) {
    if (publication.status !== 'rolled-back' || publication.retentionRollbackHeadSha256 !== history.headSha256 ||
        !iso(publication.rolledBackAt)) fail('rollback_state_invalid');
  }
  const extraOnline = current.some(p => p.status === 'online' && /^merchant-space-online-[a-f0-9]{12}$/.test(p.name) &&
    ![publication.name, baseline.name].includes(p.name));
  return {phase: isOwn ? introduced ? 'published' : 'published-unconverged' :
    publication.status === 'rolled-back' ? 'rolled-back' : 'staged', converged: !!introduced && isOwn && !extraOnline,
    baseline: structuredClone(baseline), candidatePresent: !!own};
}
