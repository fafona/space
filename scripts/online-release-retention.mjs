import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readOnlineRollingRetentions, ONLINE_ROLLING_ROOT} from './online-release-rolling.mjs';
import {normalizeRetirementProcess, ONLINE_RETIREMENT_ROOT} from './online-release-retirement.mjs';
import {ONLINE_RETENTION_POLICY, createOnlineRetentionHistory, assertOnlineRetentionCertificate,
  assertOnlineRetentionHistory, assertOnlineRetentionPlan, assertOnlineRetentionHeadRecord,
  assertOnlineRetentionCompletion, retentionHash, retentionCanonicalText} from './online-release-retention-policy.mjs';

export const ONLINE_RETENTION_ROOT = '/var/lib/faolla-online-retention';
export const ONLINE_RETENTION_HEAD_FILE = `${ONLINE_RETENTION_ROOT}.head.json`;
export const ONLINE_RETENTION_FILES = Object.freeze(['prepared.json', 'before.json', 'after.json', 'recovery-pm2.json', 'certificate.json']);
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const fail = reason => {throw Error(`online_retention_${reason}`);};
const equal = (a, b, code) => {if (!isDeepStrictEqual(a, b)) fail(code);};
const hash = value => createHash('sha256').update(value).digest('hex');
const parse = text => {try {return JSON.parse(text);} catch {fail('invalid_json');}};
const identity = st => Object.fromEntries(['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].map(k => [k, st[k]]));
const ancestorIdentity = st => Object.fromEntries(['dev', 'ino', 'mode', 'uid'].map(k => [k, st[k]]));
function rootPath(value) {
  if (typeof value !== 'string' || !path.posix.isAbsolute(value) || path.posix.normalize(value) !== value || value.endsWith('/') || /[\\\0\r\n]/.test(value)) fail('root_invalid');
}
function inspect(st, file, privateMode) {
  if (st.isSymbolicLink() || !(file ? st.isFile() : st.isDirectory()) || st.uid !== 0 ||
      (privateMode ? (st.mode & 0o777) !== (file ? 0o600 : 0o700) : (st.mode & 0o022) !== 0) ||
      (file && (st.nlink !== 1 || !Number.isSafeInteger(st.size) || st.size < 1 || st.size > MAX_FILE_BYTES))) fail('unsafe_path');
}

/** Read-only. Optional filesystem/paths support isolated tests, not CLI flags.
 * The old reader is intentionally unchanged and must validate all old raw proof
 * files before/after the new history. Presence of malformed v2 never falls back.
 * No writer, stop command, network call or host certification is exposed here. */
export function readOnlineRetentionHistory(root = ONLINE_RETENTION_ROOT, io = fs,
  rollingRoot = ONLINE_ROLLING_ROOT, legacyRoot = ONLINE_RETIREMENT_ROOT) {
  for (const location of [root, rollingRoot, legacyRoot]) rootPath(location);
  if (new Set([root, rollingRoot, legacyRoot]).size !== 3 || [rollingRoot, legacyRoot].some(old =>
    old.startsWith(root + '/') || root.startsWith(old + '/'))) fail('roots_overlap');
  const snapshots = new Map(), listings = new Map();
  const directory = (location, privateMode, ancestor = false) => {
    const st = io.lstatSync(location); inspect(st, false, privateMode);
    if (io.realpathSync(location) !== location) fail('path_redirected');
    snapshots.set(location, {value: ancestor ? ancestorIdentity(st) : identity(st), ancestor, file: false, privateMode});
  };
  for (let parent = path.posix.dirname(root); ; parent = path.posix.dirname(parent)) {
    directory(parent, false, true); if (parent === '/') break;
  }
  const verifySnapshots = () => {
    for (const [location, captured] of snapshots) {
      const st = io.lstatSync(location); inspect(st, captured.file, captured.privateMode);
      if (!captured.file && io.realpathSync(location) !== location) fail('path_redirected');
      equal(captured.ancestor ? ancestorIdentity(st) : identity(st), captured.value, 'history_path_changed');
    }
  };
  const old = readOnlineRollingRetentions(rollingRoot, io, legacyRoot);
  const history = createOnlineRetentionHistory(old);
  let initial;
  try {initial = io.lstatSync(root);} catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const assertNoHead = () => {
      try {io.lstatSync(`${root}.head.json`);} catch (headError) {if (headError.code === 'ENOENT') return; throw headError;}
      fail('orphaned_head');
    };
    assertNoHead();
    equal(readOnlineRollingRetentions(rollingRoot, io, legacyRoot), old, 'legacy_root_changed');
    verifySnapshots();
    let absent = false;
    try {io.lstatSync(root);} catch (recheck) {if (recheck.code !== 'ENOENT') throw recheck; absent = true;}
    if (!absent) fail('history_appeared');
    assertNoHead();
    return history;
  }
  inspect(initial, false, true);
  directory(root, true);
  const list = location => {
    const names = io.readdirSync(location).sort(); listings.set(location, names); return names;
  };
  const read = location => {
    const before = io.lstatSync(location); inspect(before, true, true);
    const fd = io.openSync(location, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = io.fstatSync(fd); inspect(opened, true, true);
      equal(identity(opened), identity(before), 'file_replaced');
      const bytes = io.readFileSync(fd);
      if (!Buffer.isBuffer(bytes) || bytes.length !== before.size) fail('file_read_changed');
      equal(identity(io.fstatSync(fd)), identity(before), 'file_changed');
      equal(identity(io.lstatSync(location)), identity(before), 'file_replaced');
      snapshots.set(location, {value: identity(before), ancestor: false, file: true, privateMode: true});
      let text; try {text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);} catch {fail('invalid_utf8');}
      if (!Buffer.from(text, 'utf8').equals(bytes)) fail('noncanonical_utf8');
      const value = parse(text);
      equal(text, retentionCanonicalText(value), 'noncanonical_proof'); // Includes duplicate-key rejection.
      return {text, value};
    } finally {io.closeSync(fd);}
  };
  const names = list(root);
  if (!names.length) fail('history_empty');
  for (const [index, name] of names.entries()) {
    if (name !== String(index + 1).padStart(6, '0') || !/^[0-9]{6}$/.test(name)) fail('history_entry_invalid');
    const location = `${root}/${name}`; directory(location, true);
    equal(list(location), [...ONLINE_RETENTION_FILES].sort(), 'history_files_incomplete');
    const files = Object.fromEntries(ONLINE_RETENTION_FILES.map(file => [file, read(`${location}/${file}`)]));
    const c = files['certificate.json'].value, before = files['before.json'].value, after = files['after.json'].value;
    const prepared = files['prepared.json'].value, recovery = files['recovery-pm2.json'].value;
    assertOnlineRetentionCertificate(c);
    if (c.sequence !== index + 1) fail('directory_sequence_changed');
    for (const [file, key] of [['prepared.json', 'preparedSha256'], ['before.json', 'beforeSha256'],
      ['after.json', 'afterSha256'], ['recovery-pm2.json', 'recoverySha256']])
      if (hash(files[file].text) !== c[key]) fail('proof_hash_changed');
    assertOnlineRetentionCompletion(before, after, history);
    for (const key of ['kind', 'sequence', 'previousSha256', 'legacySha256', 'rollingHeadSha256', 'rollingHistorySha256',
      'toolRevision', 'active', 'rollback', 'victim', 'rollbackProof']) equal(c[key], before[key], 'certificate_context_changed');
    equal(c.processes, after.processes, 'certificate_processes_changed');
    equal(c.stoppedProcess, c.kind === 'retire' ? after.processes.find(p => p.name === c.victim.process.name) : null, 'certificate_stopped_changed');
    const expectedPrepared = {version: 2, policy: ONLINE_RETENTION_POLICY, status: 'prepared',
      ...Object.fromEntries(['kind', 'sequence', 'previousSha256', 'legacySha256', 'rollingHeadSha256', 'rollingHistorySha256',
        'toolRevision', 'active', 'rollback', 'victim', 'beforeSha256', 'recoverySha256'].map(k => [k, c[k]])),
      ...(c.rollbackProof !== undefined ? {rollbackProof: c.rollbackProof} : {}), preparedAt: prepared.preparedAt};
    equal(prepared, expectedPrepared, 'preparation_changed');
    if (typeof prepared.preparedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(prepared.preparedAt) ||
        !Number.isFinite(Date.parse(prepared.preparedAt)) || new Date(prepared.preparedAt).toISOString() !== prepared.preparedAt ||
        Date.parse(prepared.preparedAt) > Date.parse(c.completedAt) ||
        Date.parse(prepared.preparedAt) < Date.parse(before.activeState.activatedAt)) fail('preparation_time_invalid');
    if (!recovery || recovery.version !== 2 || Object.keys(recovery).sort().join(',') !== 'process,version') fail('recovery_invalid');
    if (c.kind === 'retire') equal(normalizeRetirementProcess(recovery.process), c.victim.process, 'recovery_process_changed');
    else if (recovery.process !== null) fail('unexpected_recovery_process');
    history.entries.push(c); history.headSha256 = retentionHash(c); assertOnlineRetentionHistory(history);
  }
  assertOnlineRetentionHeadRecord(history, read(`${root}.head.json`).value);
  for (const [location, names] of listings) equal(io.readdirSync(location).sort(), names, 'history_listing_changed');
  equal(readOnlineRollingRetentions(rollingRoot, io, legacyRoot), old, 'legacy_root_changed');
  verifySnapshots();
  return history;
}

const CONTEXT_KEYS = ['kind', 'sequence', 'previousSha256', 'legacySha256', 'rollingHeadSha256', 'rollingHistorySha256',
  'toolRevision', 'active', 'rollback', 'victim'];
const context = before => ({...Object.fromEntries(CONTEXT_KEYS.map(key => [key, structuredClone(before[key])])),
  ...(before.rollbackProof !== undefined ? {rollbackProof: structuredClone(before.rollbackProof)} : {})});
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('preparation_time_invalid');
}
/** Pure serializers shared by the future writer and tests. No filesystem write. */
export function buildOnlineRetentionPreparation(before, recovery, history, preparedAt) {
  assertOnlineRetentionPlan(before, history); timestamp(preparedAt);
  if (Date.parse(preparedAt) < Date.parse(before.activeState.activatedAt)) fail('preparation_time_invalid');
  if (!recovery || recovery.version !== 2 || Object.keys(recovery).sort().join(',') !== 'process,version') fail('recovery_invalid');
  if (before.kind === 'retire') equal(normalizeRetirementProcess(recovery.process), before.victim.process, 'recovery_process_changed');
  else if (recovery.process !== null) fail('unexpected_recovery_process');
  const beforeText = retentionCanonicalText(before), recoveryText = retentionCanonicalText(recovery);
  const prepared = {version: 2, policy: ONLINE_RETENTION_POLICY, status: 'prepared', ...context(before),
    beforeSha256: hash(beforeText), recoverySha256: hash(recoveryText), preparedAt};
  return {prepared, beforeText, recoveryText, preparedText: retentionCanonicalText(prepared)};
}
export function buildOnlineRetentionReceipt(before, after, recovery, history, {preparedAt, completedAt}) {
  assertOnlineRetentionCompletion(before, after, history); timestamp(completedAt);
  const p = buildOnlineRetentionPreparation(before, recovery, history, preparedAt);
  if (Date.parse(completedAt) < Date.parse(preparedAt)) fail('preparation_time_invalid');
  const afterText = retentionCanonicalText(after);
  const certificate = {version: 2, policy: ONLINE_RETENTION_POLICY, status: 'completed', ...context(before),
    stoppedProcess: before.kind === 'retire' ? structuredClone(after.processes.find(row => row.name === before.victim.process.name)) : null,
    processes: structuredClone(after.processes), beforeSha256: hash(p.beforeText), afterSha256: hash(afterText),
    preparedSha256: hash(p.preparedText), recoverySha256: hash(p.recoveryText), completedAt};
  assertOnlineRetentionHistory({...history, entries: [...history.entries, certificate], headSha256: retentionHash(certificate)});
  return {certificate, prepared: p.prepared, files: new Map([
    ['prepared.json', p.preparedText], ['before.json', p.beforeText], ['after.json', afterText],
    ['recovery-pm2.json', p.recoveryText], ['certificate.json', retentionCanonicalText(certificate)]])};
}
