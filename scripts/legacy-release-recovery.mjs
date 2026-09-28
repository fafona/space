// Read-only evidence classification. Closure releases historical references,
// never the evidence itself; the caller still owns all live-reference checks.
import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
import {posix as path} from 'node:path';

const MAINTENANCE = '/var/lib/faolla-maintenance', EVIDENCE = '/var/lib';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]{0,19}$/;
const EXTRA = /^(?:daemon|startup|startup-completion|transport)-[1-9][0-9]{0,19}\.(?:authority|predecessor)\.json$/;
const PHASES = ['preparing', 'held', 'candidate', 'resuming', 'failed-held', 'failed-unknown', 'ended'];
const MAX_FILE = 32 * 1024 * 1024, MAX_TOTAL = 128 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Error(`legacy_recovery_${code}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const parse = bytes => {
  try { const value = JSON.parse(bytes.toString('utf8')); if (object(value)) return value; } catch { /* fixed code only */ }
  fail('invalid_json');
};
function state(bytes) {
  const value = parse(bytes);
  if (!Number.isSafeInteger(value.version) || value.version < 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !UUID.test(value.operationId ?? '') || !SHA.test(value.targetSha ?? '') || !PHASES.includes(value.phase)) fail('invalid_state');
  return value;
}
function references(value, found = new Set(), depth = 0) {
  if (depth > 128) fail('record_too_deep');
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\/www\/wwwroot\/merchant-space\.releases\/[a-f0-9]{12}-[0-9]{14}(?=\/|[^a-zA-Z0-9_.-]|$)/g)) found.add(match[0]);
  } else if (value && typeof value === 'object') Object.values(value).forEach(item => references(item, found, depth + 1));
  return found;
}
function fileSet(record, required, optional = []) {
  const names = Object.keys(record.files);
  if (required.some(name => !Object.hasOwn(record.files, name)) || names.some(name => ![...required, ...optional].includes(name)))
    fail('record_files_invalid');
}
function auxiliary(record, value) {
  const names = Object.keys(record.files).filter(name => EXTRA.test(name));
  fileSet(record, ['state.json'], ['control.token', ...names]);
  for (const name of names) {
    const counterpart = name.endsWith('.authority.json') ? name.replace(/\.authority\.json$/, '.predecessor.json')
      : name.replace(/\.predecessor\.json$/, '.authority.json');
    if (!Object.hasOwn(record.files, counterpart) || parse(record.files[name]).operationId !== value.operationId)
      fail('auxiliary_binding_invalid');
  }
}
function recoveredLockName(name) {
  const parts = /^operation\.lock\.recovered-([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})Z$/.exec(name);
  if (!parts) return false;
  const iso = `${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:00.000Z`, date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso;
}

/** Pure classifier for already securely read records. No parsed private values
 * are returned. Files are original Buffer/string bytes, never reserialized JSON. */
export function classifyLegacyRecoveryRecords(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 128) fail('records_invalid');
  const seen = new Set(), maps = {current: new Map(), archive: new Map(), restoration: new Map(), aborted: new Map()};
  const hashes = [], closedRecords = [], protectedDirectories = new Set();
  for (const record of records) {
    if (!object(record) || !Object.hasOwn(maps, record.kind) || typeof record.path !== 'string' ||
        !record.path.startsWith('/') || path.normalize(record.path) !== record.path || seen.has(record.path) || !object(record.files) ||
        (record.kind === 'current' ? record.id !== null : !ID.test(record.id ?? ''))) fail('records_invalid');
    seen.add(record.path);
    const key = record.id ?? 'current';
    if (maps[record.kind].has(key)) fail('records_invalid');
    maps[record.kind].set(key, record);
    for (const [name, bytes] of Object.entries(record.files)) {
      if (!/^[A-Za-z0-9.-]+$/.test(name) || name === '.' || name === '..' || !(typeof bytes === 'string' || Buffer.isBuffer(bytes)) ||
          Buffer.byteLength(bytes) < 1 || Buffer.byteLength(bytes) > MAX_FILE) fail('records_invalid');
      hashes.push({path: `${record.path}/${name}`, sha256: hash(bytes)});
    }
  }
  const close = (record, closure) => closedRecords.push({path: record.path, stateSha256: hash(record.files['state.json']), closure});
  if (maps.current.size !== 1) fail('current_missing');
  const current = maps.current.get('current'), currentState = state(current.files['state.json']);
  auxiliary(current, currentState);
  if (currentState.phase !== 'ended') fail('current_not_ended');
  close(current, 'maintenance-ended');
  for (const [id, archive] of maps.archive) {
    const value = state(archive.files['state.json']), digest = hash(archive.files['state.json']);
    auxiliary(archive, value);
    const restoration = maps.restoration.get(id), aborted = maps.aborted.get(id);
    if (restoration && aborted) fail('ambiguous_closure');
    if (value.phase === 'ended') {
      if (restoration || aborted) fail('unexpected_closure');
      close(archive, 'archive-ended');
    } else if (restoration) {
      fileSet(restoration, ['predecessor.json', 'state.json']);
      const restored = state(restoration.files['state.json']);
      if (!value.phase.startsWith('failed-') || restored.phase !== 'ended' || restored.predecessorDigest !== digest ||
          restored.targetSha !== value.targetSha || restored.operationId === value.operationId ||
          !Buffer.from(restoration.files['predecessor.json']).equals(Buffer.from(archive.files['state.json']))) fail('restoration_binding_invalid');
      close(archive, 'restoration-ended'); close(restoration, 'restoration-ended');
    } else if (aborted) {
      fileSet(aborted, ['started.json', 'completed.json']);
      const started = parse(aborted.files['started.json']), completed = parse(aborted.files['completed.json']);
      if (!value.phase.startsWith('failed-') || !SHA.test(value.expectedOldSha ?? '') ||
          completed.state !== 'old-service-restored' || completed.archive !== archive.path ||
          [started, completed].some(item => item.version !== 1 || item.operationId !== value.operationId ||
            item.oldSha !== value.expectedOldSha || item.stateDigest !== digest)) fail('aborted_binding_invalid');
      close(archive, 'aborted-prepare-restored');
      closedRecords.push({path: aborted.path, stateSha256: hash(aborted.files['completed.json']), closure: 'aborted-prepare-restored'});
    } else {
      const refs = references(value);
      for (const [name, bytes] of Object.entries(archive.files)) if (name.endsWith('.json')) references(parse(bytes), refs);
      if (!refs.size) fail('unclosed_reference_unknown');
      refs.forEach(ref => protectedDirectories.add(ref));
    }
  }
  for (const kind of ['restoration', 'aborted']) for (const id of maps[kind].keys()) if (!maps.archive.has(id)) fail('orphan_closure');
  return freeze({version: 1, hashes: hashes.sort((a, b) => a.path.localeCompare(b.path)),
    protectedDirectories: [...protectedDirectories].sort(), closedRecords: closedRecords.sort((a, b) => a.path.localeCompare(b.path))});
}

const identity = stat => JSON.stringify(['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtimeNs', 'ctimeNs', 'mtimeMs', 'ctimeMs']
  .map(key => String(stat[key] ?? '')));
/** Roots/io are dependency injection for isolated tests; no command-line or
 * environment override is provided. The production caller uses fixed defaults. */
export function readLegacyReleaseRecovery({io = fs, maintenanceRoot = MAINTENANCE, evidenceRoot = EVIDENCE} = {}) {
  try {
    if (![maintenanceRoot, evidenceRoot].every(value => typeof value === 'string' && value.startsWith('/') && value !== '/' &&
        path.normalize(value) === value && !/[\x00-\x1f\\]/.test(value)) || path.dirname(maintenanceRoot) !== evidenceRoot) fail('roots_invalid');
    const snapshots = new Map(), recoveredLocks = []; let total = 0;
    const directory = (location, privateMode = true) => {
      const stat = io.lstatSync(location, {bigint: true});
      if (!stat.isDirectory() || stat.isSymbolicLink() || Number(stat.uid) !== 0 ||
          (Number(stat.mode) & (privateMode ? 0o077 : 0o022)) || (Number(stat.mode) & 0o500) !== 0o500 ||
          io.realpathSync(location) !== location) fail('unsafe_directory');
      return stat;
    };
    for (let location = evidenceRoot; ; location = path.dirname(location)) {
      directory(location, false); if (location === '/') break;
    }
    const listing = (location, privateMode = true) => {
      const before = directory(location, privateMode), names = io.readdirSync(location).sort();
      if (names.length > 4096 || names.some(name => typeof name !== 'string' || !name || name === '.' || name === '..' || /[\/\\\x00-\x1f]/.test(name)))
        fail('directory_entries_invalid');
      if (identity(directory(location, privateMode)) !== identity(before)) fail('evidence_changed');
      snapshots.set(location, {identity: identity(before), names, privateMode}); return names;
    };
    const read = location => {
      const before = io.lstatSync(location, {bigint: true});
      if (!before.isFile() || before.isSymbolicLink() || Number(before.uid) !== 0 || Number(before.nlink) !== 1 ||
          (Number(before.mode) & 0o077) || !(Number(before.mode) & 0o400) || Number(before.size) < 1 || Number(before.size) > MAX_FILE)
        fail('unsafe_file');
      total += Number(before.size); if (total > MAX_TOTAL) fail('evidence_too_large');
      const fd = io.openSync(location, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        if (identity(io.fstatSync(fd, {bigint: true})) !== identity(before)) fail('evidence_changed');
        const bytes = io.readFileSync(fd);
        if (bytes.length !== Number(before.size) || [io.fstatSync(fd, {bigint: true}), io.lstatSync(location, {bigint: true})]
          .some(stat => identity(stat) !== identity(before))) fail('evidence_changed');
        snapshots.set(location, {identity: identity(before)}); return bytes;
      } finally { io.closeSync(fd); }
    };
    const record = (kind, id, location) => {
      const files = Object.create(null);
      for (const name of listing(location)) {
        // The caller acquires this empty lock for apply only. Validate it, but
        // do not make inspect/apply differ merely because that lock now exists.
        if (kind === 'current' && name === 'operation.lock') {
          if (listing(`${location}/${name}`).length) fail('operation_lock_not_empty');
          continue;
        }
        if (kind === 'archive' && recoveredLockName(name)) {
          const lock = `${location}/${name}`, entries = listing(lock);
          if ((Number(directory(lock).mode) & 0o7777) !== 0o700 || entries.length) fail('recovered_lock_invalid');
          recoveredLocks.push({archive: location, path: lock, identity: snapshots.get(lock).identity, entries});
          continue;
        }
        files[name] = read(`${location}/${name}`);
      }
      return {kind, id, path: location, files};
    };
    const records = [];
    for (const name of listing(maintenanceRoot)) {
      if (name === 'merchant-space') records.push(record('current', null, `${maintenanceRoot}/${name}`));
      else if (/^merchant-space\.archived-[1-9][0-9]{0,19}$/.test(name)) records.push(record('archive', name.split('-').at(-1), `${maintenanceRoot}/${name}`));
      else if (name.startsWith('merchant-space')) fail('unknown_maintenance_entry');
    }
    for (const name of listing(evidenceRoot, false)) {
      const match = /^faolla-(restoration|aborted-prepare)-([1-9][0-9]{0,19})$/.exec(name);
      if (match) records.push(record(match[1] === 'restoration' ? 'restoration' : 'aborted', match[2], `${evidenceRoot}/${name}`));
      else if (/^faolla-(?:restoration|aborted-prepare)-[0-9]/.test(name)) fail('unknown_recovery_entry');
    }
    const classification = classifyLegacyRecoveryRecords(records);
    const closedArchives = new Set(classification.closedRecords.filter(record =>
      ['archive-ended', 'restoration-ended', 'aborted-prepare-restored'].includes(record.closure)).map(record => record.path));
    const lockHashes = recoveredLocks.map(lock => {
      if (!closedArchives.has(lock.archive)) fail('recovered_lock_unclosed');
      // Unlike the caller's transient current lock, this sealed historical
      // directory is immutable evidence. Bind its identity AND empty listing.
      return {path: lock.path, sha256: hash(JSON.stringify({version: 1, kind: 'archived-recovered-lock',
        identity: lock.identity, entries: lock.entries}))};
    });
    for (const [location, snapshot] of snapshots) {
      const stat = snapshot.names ? directory(location, snapshot.privateMode) : io.lstatSync(location, {bigint: true});
      if (identity(stat) !== snapshot.identity || snapshot.names && JSON.stringify(io.readdirSync(location).sort()) !== JSON.stringify(snapshot.names))
        fail('evidence_changed');
    }
    return freeze({...classification, hashes: [...classification.hashes, ...lockHashes].sort((a, b) => a.path.localeCompare(b.path))});
  } catch (error) {
    if (/^legacy_recovery_[a-z_]+$/.test(error?.message ?? '')) throw error;
    fail('read_unverified');
  }
}
