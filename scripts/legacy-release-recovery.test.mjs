import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {posix as path} from 'node:path';
import {classifyLegacyRecoveryRecords, readLegacyReleaseRecovery} from './legacy-release-recovery.mjs';

const ROOT = '/var/lib/faolla-maintenance', OLD = '/www/wwwroot/merchant-space.releases/aaaaaaaaaaaa-20260917000000';
const OP = '11111111-1111-4111-8111-111111111111', RESTORED_OP = '22222222-2222-4222-8222-222222222222';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value);
const base = (phase = 'ended') => ({version: 2, revision: 15, operationId: OP, phase, targetSha: 'a'.repeat(40),
  expectedOldSha: 'b'.repeat(40), runtime: {disk: {runtime: OLD}, privateCredential: 'must-never-appear-in-output'}});
const current = () => ({kind: 'current', id: null, path: `${ROOT}/merchant-space`, files: {'state.json': json(base()), 'control.token': 'SECRET-TOKEN'}});
const archive = (phase = 'failed-held', id = '35069590176') => ({kind: 'archive', id, path: `${ROOT}/merchant-space.archived-${id}`, files: {'state.json': json(base(phase))}});
function restoredFixture() {
  const old = archive(), state = {...base(), version: 1, operationId: RESTORED_OP, predecessorDigest: sha(old.files['state.json'])};
  return [current(), old, {kind: 'restoration', id: old.id, path: `/var/lib/faolla-restoration-${old.id}`,
    files: {'state.json': json(state), 'predecessor.json': old.files['state.json']}}];
}
function abortedFixture() {
  const old = archive('failed-unknown', '35395021973');
  const started = {version: 1, operationId: OP, oldSha: 'b'.repeat(40), stateDigest: sha(old.files['state.json']), at: '2026-09-18T01:00:00.000Z'};
  return [current(), old, {kind: 'aborted', id: old.id, path: `/var/lib/faolla-aborted-prepare-${old.id}`,
    files: {'started.json': json(started), 'completed.json': json({...started, state: 'old-service-restored', archive: old.path})}}];
}
function change(record, name, edit) { const value = JSON.parse(record.files[name]); edit(value); record.files[name] = json(value); }
const classify = classifyLegacyRecoveryRecords;

test('current and archived ended records release historical references without disclosing private fields', () => {
  const records = [current(), archive('ended')], result = classify(records);
  assert.equal(result.closedRecords.length, 2); assert.deepEqual(result.protectedDirectories, []);
  assert.equal(result.hashes.length, 3);
  assert(result.hashes.some(item => item.path.endsWith('/control.token') && item.sha256 === sha('SECRET-TOKEN')));
  for (const secret of ['must-never-appear', 'SECRET-TOKEN', OP, OLD]) assert(!json(result).includes(secret));
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.hashes)); assert(Object.isFrozen(result.hashes[0]));
  assert.throws(() => result.closedRecords.push({}));
});
test('separate restoration operation closes exact original failed bytes and all evidence is hashed', () => {
  const records = restoredFixture(), result = classify(records);
  assert.deepEqual(result.protectedDirectories, []); assert.equal(result.hashes.length, 5);
  assert.equal(result.closedRecords.filter(item => item.closure === 'restoration-ended').length, 2);
  assert.deepEqual(classify(records.toReversed()), result);
});
test('aborted prepare requires matching started and completed records', () => {
  const result = classify(abortedFixture());
  assert.equal(result.closedRecords.filter(item => item.closure === 'aborted-prepare-restored').length, 2);
  assert.deepEqual(result.protectedDirectories, []);
});
test('unclosed historical record protects only exact legacy roots, including nested predecessor paths', () => {
  const old = archive(), second = OLD.replace('aaaaaaaaaaaa', 'bbbbbbbbbbbb');
  change(old, 'state.json', value => { value.predecessor = {runtime: `${second}/.env.local`, unrelated: '/private/not-output'}; });
  const result = classify([current(), old]);
  assert.deepEqual(result.protectedDirectories, [OLD, second]); assert.equal(result.closedRecords.length, 1);
});
test('paired historical authority and predecessor bind the same archived operation without requiring same target/revision', () => {
  const records = restoredFixture(), old = records[1];
  old.files['startup-35165126333.authority.json'] = json({operationId: OP, targetSha: 'c'.repeat(40), kind: 'historical-authority'});
  old.files['startup-35165126333.predecessor.json'] = json({...base('failed-held'), revision: 7, targetSha: 'd'.repeat(40)});
  assert.equal(classify(records).hashes.length, 7);
});

const rejectCases = [
  ['current not ended', records => change(records[0], 'state.json', value => { value.phase = 'failed-held'; })],
  ['current missing', records => records.shift()],
  ['duplicate archive', records => records.push(structuredClone(records[1]))],
  ['malformed JSON', records => { records[1].files['state.json'] = '{private'; }],
  ['invalid state identity', records => change(records[1], 'state.json', value => { value.operationId = ''; })],
  ['restoration not ended', records => change(records[2], 'state.json', value => { value.phase = 'resuming'; })],
  ['restoration wrong digest', records => change(records[2], 'state.json', value => { value.predecessorDigest = '0'.repeat(64); })],
  ['restoration wrong target', records => change(records[2], 'state.json', value => { value.targetSha = 'c'.repeat(40); })],
  ['restoration reused operation', records => change(records[2], 'state.json', value => { value.operationId = OP; })],
  ['predecessor reserialized', records => { records[2].files['predecessor.json'] += '\n'; }],
  ['predecessor missing', records => { delete records[2].files['predecessor.json']; }],
  ['unknown proof', records => { records[1].files['unknown.json'] = '{}'; }],
  ['orphan restoration', records => records.splice(1, 1)],
  ['authority without pair', records => { records[1].files['daemon-123.authority.json'] = json({operationId: OP}); }],
  ['authority wrong operation', records => {
    records[1].files['daemon-123.authority.json'] = json({operationId: RESTORED_OP});
    records[1].files['daemon-123.predecessor.json'] = json({operationId: OP});
  }],
  ['predecessor wrong operation', records => {
    records[1].files['daemon-123.authority.json'] = json({operationId: OP});
    records[1].files['daemon-123.predecessor.json'] = json({operationId: RESTORED_OP});
  }],
  ['already ended archive with closure', records => change(records[1], 'state.json', value => { value.phase = 'ended'; })],
];
for (const [name, mutate] of rejectCases) test(`fails closed: ${name}`, () => {
  const records = restoredFixture(); mutate(records); assert.throws(() => classify(records), /^Error: legacy_recovery_[a-z_]+$/);
});
for (const [name, mutate] of [
  ['started absent', records => { delete records[2].files['started.json']; }],
  ['started wrong digest', records => change(records[2], 'started.json', value => { value.stateDigest = '0'.repeat(64); })],
  ['completed wrong archive', records => change(records[2], 'completed.json', value => { value.archive += '-other'; })],
  ['completed wrong old SHA', records => change(records[2], 'completed.json', value => { value.oldSha = 'c'.repeat(40); })],
  ['completed wrong operation', records => change(records[2], 'completed.json', value => { value.operationId = RESTORED_OP; })],
  ['completed unsuccessful', records => change(records[2], 'completed.json', value => { value.state = 'reclosed'; })],
  ['extra failure receipt', records => { records[2].files['reclosed.json'] = '{}'; }],
]) test(`aborted closure refuses ${name}`, () => {
  const records = abortedFixture(); mutate(records); assert.throws(() => classify(records), /legacy_recovery_/);
});

// Synthetic Linux metadata and descriptors; never reads/writes host private data.
function filesystem(records = restoredFixture()) {
  const nodes = new Map(), descriptors = new Map(); let inode = 1, nextFd = 10;
  const put = (location, bytes = null, patch = {}) => {
    if (location !== '/' && !nodes.has(path.dirname(location))) put(path.dirname(location));
    nodes.set(location, {bytes: bytes === null ? null : Buffer.from(bytes), uid: 0n, gid: 0n, dev: 1n, ino: BigInt(inode++), nlink: 1n,
      mode: bytes === null ? 0o40700n : 0o100600n, mtimeNs: 1n, ctimeNs: 1n, ...patch});
  };
  put('/'); put('/var'); put('/var/lib'); put(ROOT);
  for (const record of records) {
    put(record.path);
    for (const [name, bytes] of Object.entries(record.files)) put(`${record.path}/${name}`, bytes);
  }
  for (const name of ['/', '/var', '/var/lib']) nodes.get(name).mode = 0o40755n;
  const node = location => { const value = nodes.get(location); if (!value) throw Object.assign(Error('private path must not leak'), {code: 'ENOENT'}); return value; };
  const stat = value => ({...value, size: BigInt(value.bytes?.length ?? 0), isDirectory: () => value.bytes === null && !value.link,
    isFile: () => value.bytes !== null && !value.link, isSymbolicLink: () => Boolean(value.link)});
  const io = {
    lstatSync: location => stat(node(location)), realpathSync: location => node(location).link ?? location,
    readdirSync: location => [...nodes.keys()].filter(item => item !== location && path.dirname(item) === location).map(item => path.basename(item)),
    openSync: location => { const fd = nextFd++; descriptors.set(fd, node(location)); return fd; },
    fstatSync: fd => stat(descriptors.get(fd)), readFileSync: fd => Buffer.from(descriptors.get(fd).bytes),
    closeSync: fd => descriptors.delete(fd),
  };
  return {nodes, put, io, read: () => readLegacyReleaseRecovery({io}), descriptors};
}
test('reader matches pure result, ignores unrelated tool directories, and never leaves descriptors open', () => {
  const f = filesystem(); f.put('/var/lib/faolla-restoration-code-123');
  assert.deepEqual(f.read(), classify(restoredFixture())); assert.equal(f.descriptors.size, 0);
});
test('empty owned current operation lock does not change inspect/apply report', () => {
  const f = filesystem(), before = f.read(); f.put(`${ROOT}/merchant-space/operation.lock`);
  assert.deepEqual(f.read(), before);
  f.put(`${ROOT}/merchant-space/operation.lock/unexpected`, 'x'); assert.throws(f.read, /operation_lock_not_empty/);
});
for (const [name, mutate] of [
  ['file symlink', f => { f.nodes.get(`${ROOT}/merchant-space/state.json`).link = '/secret'; }],
  ['directory symlink', f => { f.nodes.get(`${ROOT}/merchant-space`).link = '/secret'; }],
  ['non-root owner', f => { f.nodes.get(`${ROOT}/merchant-space/state.json`).uid = 1000n; }],
  ['world-readable private file', f => { f.nodes.get(`${ROOT}/merchant-space/state.json`).mode = 0o100644n; }],
  ['hardlinked file', f => { f.nodes.get(`${ROOT}/merchant-space/state.json`).nlink = 2n; }],
  ['world-writable ancestor', f => { f.nodes.get('/var').mode = 0o40777n; }],
  ['group-readable private directory', f => { f.nodes.get(`${ROOT}/merchant-space`).mode = 0o40750n; }],
  ['unknown maintenance directory', f => { f.put(`${ROOT}/merchant-space.unknown`); }],
  ['unknown nested directory', f => { f.put(`${ROOT}/merchant-space/extra`); }],
  ['archived operation lock', f => { f.put(`${ROOT}/merchant-space.archived-35069590176/operation.lock`); }],
  ['unknown numeric recovery suffix', f => { f.put('/var/lib/faolla-restoration-123-partial'); }],
]) test(`reader rejects ${name}`, () => { const f = filesystem(); mutate(f); assert.throws(f.read, /^Error: legacy_recovery_[a-z_]+$/); });
test('reader rejects replacement between lstat/open and changes during file read', () => {
  for (const phase of ['open', 'read']) {
    const f = filesystem(), location = `${ROOT}/merchant-space/state.json`;
    if (phase === 'open') { const original = f.io.openSync; f.io.openSync = name => { if (name === location) f.nodes.get(name).ino++; return original(name); }; }
    else { const original = f.io.readFileSync; f.io.readFileSync = fd => { const result = original(fd); f.nodes.get(location).mtimeNs++; return result; }; }
    assert.throws(f.read, /evidence_changed/); assert.equal(f.descriptors.size, 0);
  }
});
test('reader rejects evidence addition during the observation and sanitizes IO errors', () => {
  const f = filesystem(), original = f.io.readFileSync; let changed = false;
  f.io.readFileSync = fd => { if (!changed) { changed = true; f.put(`${ROOT}/merchant-space/new-proof.json`, '{}'); } return original(fd); };
  assert.throws(f.read, /evidence_changed/);
  const broken = filesystem(); broken.io.openSync = () => { throw Error('secret /private/credential'); };
  assert.throws(broken.read, /^Error: legacy_recovery_read_unverified$/);
});
