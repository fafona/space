import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planStaticPermissionRecovery } from './online-static-recovery.mjs';

const START = '2026-09-25T08:33:33.264Z';
const END = '2026-09-25T08:37:03.614Z';
const RECENT = 1790325407404000000n;
const OLD = BigInt(Date.parse('2026-09-24T00:00:00.000Z')) * 1000000n;
const SOURCE = '/www/wwwroot/merchant-space.web-releases/new/.next/static';
const DEST = '/www/wwwroot/merchant-space.base/.next/static';
const PREVIOUS = '/www/wwwroot/merchant-space.web-releases/old/.next/static';

function fixture() {
  const entries = new Map(); const fds = new Map(); const writes = []; const opens = [];
  let inode = 1n; let descriptor = 20;
  function directory(name, options = {}) {
    if (entries.has(name)) return entries.get(name);
    if (name !== '/') directory(path.posix.dirname(name));
    const record = { path: name, type: 'directory', dev: 10n, ino: inode++, uid: 0n, gid: 0n, mode: 0o755, nlink: 2n,
      birthtimeNs: OLD, ctimeNs: OLD, mtimeNs: OLD, ...options };
    entries.set(name, record);
    if (name !== '/') entries.get(path.posix.dirname(name)).nlink++;
    return record;
  }
  function file(name, contents, options = {}) {
    directory(path.posix.dirname(name));
    const record = { path: name, type: 'file', dev: 10n, ino: inode++, uid: 0n, gid: 0n, mode: 0o644, nlink: 1n,
      contents: Buffer.from(contents), birthtimeNs: OLD, ctimeNs: OLD, mtimeNs: OLD, ...options };
    entries.set(name, record);
    return record;
  }
  function stat(record) {
    if (!record) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; }
    return { dev: record.dev, ino: record.ino, uid: record.uid, gid: record.gid, nlink: record.nlink,
      mode: BigInt(record.mode | (record.type === 'directory' ? 0o040000 : record.type === 'file' ? 0o100000 : 0o120000)),
      size: record.type === 'file' ? BigInt(record.contents.length) : 4096n,
      ctimeNs: record.ctimeNs, birthtimeNs: record.birthtimeNs, mtimeNs: record.mtimeNs,
      isFile: () => record.type === 'file', isDirectory: () => record.type === 'directory', isSymbolicLink: () => record.type === 'symlink' };
  }
  const io = {
    platform: 'linux', getuid: () => 0,
    constants: { O_RDONLY: 0, O_NOFOLLOW: 0x20000, O_NONBLOCK: 0x800, O_DIRECTORY: 0x10000 },
    lstatSync(name) { return stat(entries.get(name)); },
    readdirSync(name) { return [...entries.keys()].filter((candidate) => candidate !== name && path.posix.dirname(candidate) === name).map((candidate) => path.posix.basename(candidate)); },
    openSync(name, flags) {
      const record = entries.get(name); stat(record);
      assert.ok(flags & io.constants.O_NOFOLLOW);
      assert.ok(flags & io.constants.O_NONBLOCK);
      if (record.type === 'directory') assert.ok(flags & io.constants.O_DIRECTORY);
      if (record.type === 'symlink') throw new Error('ELOOP');
      const fd = descriptor++; fds.set(fd, record); opens.push({ name, flags });
      io.onOpen?.(name, record);
      return fd;
    },
    closeSync(fd) { assert.equal(fds.delete(fd), true); },
    fstatSync(fd) { return stat(fds.get(fd)); },
    readSync(fd, buffer, offset, length, position) {
      const record = fds.get(fd); assert.equal(record.type, 'file');
      const count = Math.min(length, Math.max(0, record.contents.length - position));
      record.contents.copy(buffer, offset, position, position + count);
      return count;
    },
    fchmodSync(fd, mode) {
      const record = fds.get(fd); assert.ok(record);
      writes.push({ path: record.path, fd, mode }); record.mode = mode; record.ctimeNs++;
      io.onChmod?.(record, mode);
    },
  };
  for (const root of [SOURCE, DEST, PREVIOUS]) directory(root);
  directory(`${SOURCE}/build-new`, { mode: 0o700 });
  directory(`${DEST}/build-new`, { mode: 0o700, birthtimeNs: RECENT, ctimeNs: RECENT });
  file(`${SOURCE}/build-new/_buildManifest.js`, 'manifest', { mode: 0o600 });
  file(`${DEST}/build-new/_buildManifest.js`, 'manifest', { mode: 0o600, birthtimeNs: RECENT, ctimeNs: RECENT });
  file(`${SOURCE}/chunks/new.js`, 'new chunk', { mode: 0o600 });
  file(`${DEST}/chunks/new.js`, 'new chunk', { mode: 0o600, birthtimeNs: RECENT, ctimeNs: RECENT });
  file(`${SOURCE}/chunks/shared.js`, 'shared', { mode: 0o600 });
  file(`${DEST}/chunks/shared.js`, 'shared');
  file(`${PREVIOUS}/chunks/shared.js`, 'shared');
  file(`${DEST}/chunks/old.js`, 'older retained public');
  file(`${PREVIOUS}/chunks/old.js`, 'older retained public');
  const options = { sourceRoot: SOURCE, destinationRoot: DEST, previousRoots: [PREVIOUS], startedAt: START, rolledBackAt: END, fsAdapter: io };
  return { entries, fds, writes, opens, directory, file, io, options, plan: () => planStaticPermissionRecovery(options) };
}

test('planner is readonly and frozen; apply touches only two new 0600 assets and their one required 0700 directory', () => {
  const f = fixture(); const before = new Map([...f.entries].map(([key, value]) => [key, { ...value, ...(value.contents ? { contents: Buffer.from(value.contents) } : {}) }]));
  const plan = f.plan();
  assert.equal(f.writes.length, 0);
  assert.deepEqual(plan.manifest.files.map((entry) => entry.relativePath), ['build-new/_buildManifest.js', 'chunks/new.js']);
  assert.deepEqual(plan.manifest.directories.map((entry) => entry.relativePath), ['build-new']);
  assert.match(plan.manifest.inventorySha256, /^[a-f0-9]{64}$/);
  assert.match(plan.manifestSha256, /^[a-f0-9]{64}$/);
  for (const entry of [...plan.manifest.files, ...plan.manifest.directories]) {
    for (const field of ['sha256', 'dev', 'ino', 'nlink', 'mode', 'uid', 'gid', 'birthtimeNs', 'ctimeNs']) assert.ok(Object.hasOwn(entry, field));
  }
  assert.throws(() => { plan.manifest.files[0].path = '/private'; }, TypeError);
  assert.throws(() => plan.manifest.files.push({}), TypeError);
  const result = plan.apply();
  assert.equal(result.ok, true); assert.equal(result.changedFiles, 2); assert.equal(result.changedDirectories, 1);
  assert.equal(result.manifestSha256, plan.manifestSha256);
  assert.deepEqual(f.writes.map((entry) => [entry.path, entry.mode]), [
    [`${DEST}/build-new/_buildManifest.js`, 0o644], [`${DEST}/chunks/new.js`, 0o644], [`${DEST}/build-new`, 0o755],
  ]);
  for (const [name, record] of f.entries) {
    const old = before.get(name);
    assert.equal(record.uid, old.uid); assert.equal(record.gid, old.gid); assert.equal(record.ino, old.ino);
    assert.deepEqual(record.contents, old.contents);
    if (!f.writes.some((entry) => entry.path === name)) assert.deepEqual(record, old);
  }
  assert.equal(f.entries.get(SOURCE).mode, 0o755);
  assert.equal(f.entries.get(`${SOURCE}/chunks/new.js`).mode, 0o600);
  assert.equal(f.entries.get(DEST).mode, 0o755);
  assert.equal(f.fds.size, 0);
  assert.throws(() => plan.apply(), /plan_already_used/);
  const second = f.plan().apply();
  assert.equal(second.changedFiles, 0); assert.equal(second.changedDirectories, 0);
});

const refusals = [
  ['destination missing copied candidate', (f) => f.entries.delete(`${DEST}/chunks/shared.js`), /candidate_copy_incomplete/],
  ['different 0644 contents', (f) => { f.entries.get(`${DEST}/chunks/shared.js`).contents = Buffer.from('changed'); }, /candidate_content_mismatch/],
  ['different 0600 contents', (f) => { f.entries.get(`${DEST}/chunks/new.js`).contents = Buffer.from('changed'); }, /candidate_content_mismatch/],
  ['unrelated private file', (f) => f.file(`${DEST}/chunks/private.js`, 'private', { mode: 0o600, birthtimeNs: RECENT, ctimeNs: RECENT }), /candidate_content_mismatch/],
  ['file already present in retained root', (f) => f.file(`${PREVIOUS}/chunks/new.js`, 'new chunk'), /unowned_private_file/],
  ['old birthtime even with fresh ctime', (f) => { f.entries.get(`${DEST}/chunks/new.js`).birthtimeNs = OLD; }, /unowned_private_file/],
  ['old ctime even with fresh birthtime', (f) => { f.entries.get(`${DEST}/chunks/new.js`).ctimeNs = OLD; }, /unowned_private_file/],
  ['unknown birthtime', (f) => { f.entries.get(`${DEST}/chunks/new.js`).birthtimeNs = 0n; }, /unowned_private_file/],
  ['future time outside five-second allowance', (f) => { f.entries.get(`${DEST}/chunks/new.js`).ctimeNs = BigInt(Date.parse(END) + 5001) * 1000000n; }, /unowned_private_file/],
  ['unsupported file mode', (f) => { f.entries.get(`${DEST}/chunks/new.js`).mode = 0o640; }, /unowned_private_file/],
  ['special permission bits', (f) => { f.entries.get(`${DEST}/chunks/new.js`).mode = 0o4600; }, /special_mode/],
  ['non-root file owner', (f) => { f.entries.get(`${DEST}/chunks/new.js`).uid = 1000n; }, /non_root_owner/],
  ['non-root ancestor owner', (f) => { f.entries.get('/www').uid = 1000n; }, /non_root_owner/],
  ['world-writable ancestor', (f) => { f.entries.get('/www').mode = 0o777; }, /writable_directory/],
  ['group-writable ancestor', (f) => { f.entries.get('/www').mode = 0o775; }, /writable_directory/],
  ['world-writable source directory', (f) => { f.entries.get(`${SOURCE}/chunks`).mode = 0o777; }, /writable_directory/],
  ['group-writable retained directory', (f) => { f.entries.get(`${PREVIOUS}/chunks`).mode = 0o775; }, /writable_directory/],
  ['destination hardlink', (f) => { f.entries.get(`${DEST}/chunks/new.js`).nlink = 2n; }, /hardlinked_file/],
  ['source hardlink', (f) => { f.entries.get(`${SOURCE}/chunks/shared.js`).nlink = 2n; }, /hardlinked_file/],
  ['previous-root hardlink', (f) => { f.entries.get(`${PREVIOUS}/chunks/shared.js`).nlink = 2n; }, /hardlinked_file/],
  ['source root symlink', (f) => { f.entries.get(SOURCE).type = 'symlink'; }, /unsafe_entry_type/],
  ['destination root symlink', (f) => { f.entries.get(DEST).type = 'symlink'; }, /unsafe_entry_type/],
  ['ancestor symlink', (f) => { f.entries.get('/www/wwwroot').type = 'symlink'; }, /unsafe_entry_type/],
  ['source entry symlink', (f) => { f.entries.get(`${SOURCE}/chunks/new.js`).type = 'symlink'; }, /unsafe_entry_type/],
  ['destination entry symlink', (f) => { f.entries.get(`${DEST}/chunks/new.js`).type = 'symlink'; }, /unsafe_entry_type/],
  ['unknown entry type', (f) => { f.entries.get(`${DEST}/chunks/new.js`).type = 'fifo'; }, /unsafe_entry_type/],
  ['destination root needs chmod', (f) => { f.entries.get(DEST).mode = 0o700; }, /destination_root_not_public/],
  ['old inaccessible directory', (f) => { f.entries.get(`${DEST}/build-new`).birthtimeNs = OLD; }, /unowned_private_directory/],
  ['retained inaccessible directory', (f) => f.directory(`${PREVIOUS}/build-new`), /unowned_private_directory/],
  ['unnecessary private directory', (f) => { f.directory(`${SOURCE}/unneeded`); f.directory(`${DEST}/unneeded`, { mode: 0o700, ctimeNs: RECENT, birthtimeNs: RECENT }); }, /unowned_private_directory/],
  ['environment filename', (f) => { f.file(`${SOURCE}/.env`, 'secret'); f.file(`${DEST}/.env`, 'secret', { mode: 0o600 }); }, /unsafe_relative_path/],
  ['private-key extension', (f) => { f.file(`${SOURCE}/chunks/private.key`, 'key'); f.file(`${DEST}/chunks/private.key`, 'key', { mode: 0o600, ctimeNs: RECENT, birthtimeNs: RECENT }); }, /unowned_private_file/],
];
for (const [name, mutate, error] of refusals) {
  test(`fail closed without writes: ${name}`, () => {
    const f = fixture(); mutate(f); assert.throws(f.plan, error); assert.equal(f.writes.length, 0); assert.equal(f.fds.size, 0);
  });
}

test('strict root identities, explicit history and bounded timestamp window cannot be widened', () => {
  for (const changed of [
    { sourceRoot: '/' }, { sourceRoot: 'relative/.next/static' }, { sourceRoot: `${SOURCE}/` },
    { sourceRoot: '/www/../www/.next/static' }, { sourceRoot: `${SOURCE} ` }, { sourceRoot: '/www\\private/.next/static' },
    { destinationRoot: SOURCE }, { previousRoots: [] }, { previousRoots: [DEST] }, { previousRoots: [PREVIOUS, PREVIOUS] },
    { previousRoots: [`${DEST}/nested/.next/static`] }, { startedAt: END, rolledBackAt: START },
    { startedAt: '2026-09-25T00:00:00.000Z' }, { rolledBackAt: 'not-a-date' },
  ]) {
    const f = fixture(); assert.throws(() => planStaticPermissionRecovery({ ...f.options, ...changed })); assert.equal(f.writes.length, 0);
  }
});

test('the default adapter requires actual Linux root; injected test adapters still require root-owned identities and safe open flags', () => {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) assert.throws(() => planStaticPermissionRecovery({}), /linux_root_required/);
  for (const mutate of [(io) => { io.getuid = () => 1000; }, (io) => { io.platform = 'win32'; }, (io) => { delete io.constants.O_NOFOLLOW; }]) {
    const f = fixture(); mutate(f.io); assert.throws(f.plan, /linux_root_required|unsafe_open_flags/); assert.equal(f.writes.length, 0);
  }
});

const drifts = [
  ['source bytes', (f) => { f.entries.get(`${SOURCE}/chunks/new.js`).contents = Buffer.from('changed'); }],
  ['destination inode', (f) => { f.entries.get(`${DEST}/chunks/new.js`).ino++; }],
  ['destination hash despite same length', (f) => { f.entries.get(`${DEST}/chunks/new.js`).contents = Buffer.from('new CHUNK'); }],
  ['destination symlink', (f) => { f.entries.get(`${DEST}/chunks/new.js`).type = 'symlink'; }],
  ['destination hardlink', (f) => { f.entries.get(`${DEST}/chunks/new.js`).nlink++; }],
  ['directory inode', (f) => { f.entries.get(`${DEST}/chunks`).ino++; }],
  ['ancestor inode', (f) => { f.entries.get('/www').ino++; }],
  ['new destination sibling', (f) => f.file(`${DEST}/chunks/other.js`, 'new')],
  ['previous root now contains the path', (f) => f.file(`${PREVIOUS}/chunks/new.js`, 'new chunk')],
];
for (const [name, mutate] of drifts) {
  test(`full manifest is revalidated before mutation: ${name}`, () => {
    const f = fixture(); const plan = f.plan(); mutate(f);
    assert.throws(() => plan.apply()); assert.equal(f.writes.length, 0); assert.equal(f.fds.size, 0);
  });
}

test('all target descriptors are pinned before chmod; an open-time identity race changes nothing', () => {
  const f = fixture(); const plan = f.plan(); let seen = 0;
  f.io.onOpen = (name, record) => { if (name === `${DEST}/build-new/_buildManifest.js` && ++seen === 2) record.ino++; };
  assert.throws(() => plan.apply(), /open_identity_drift/);
  assert.equal(f.writes.length, 0); assert.equal(f.fds.size, 0);
});

test('a post-chmod unexpected content change is detected and reported without chmodding later targets or attempting a broad rollback', () => {
  const f = fixture(); const plan = f.plan();
  f.io.onChmod = (record) => { record.contents = Buffer.from('unexpected write'); };
  assert.throws(() => plan.apply(), (error) => {
    assert.match(error.message, /chmod_identity_drift|chmod_content_drift|size_drift/);
    assert.deepEqual(error.changedPaths, [`${DEST}/build-new/_buildManifest.js`]);
    return true;
  });
  assert.equal(f.writes.length, 1); assert.equal(f.entries.get(`${DEST}/chunks/new.js`).mode, 0o600); assert.equal(f.fds.size, 0);
});

test('Linux real descriptors preserve bytes and ownership while applying only 0600 -> 0644 and 0700 -> 0755', { skip: process.platform !== 'linux' }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'faolla-static-recovery-'));
  try {
    const sourceRoot = `${temporary}/candidate/.next/static`;
    const destinationRoot = `${temporary}/public/.next/static`;
    const previousRoot = `${temporary}/previous/.next/static`;
    const startedAt = new Date(Date.now() - 1000).toISOString();
    for (const root of [sourceRoot, destinationRoot, previousRoot]) { fs.mkdirSync(root, { recursive: true, mode: 0o755 }); fs.chmodSync(root, 0o755); }
    fs.mkdirSync(`${sourceRoot}/new`, { mode: 0o700 }); fs.mkdirSync(`${destinationRoot}/new`, { mode: 0o700 });
    fs.writeFileSync(`${sourceRoot}/new/a.js`, 'public asset', { mode: 0o600 });
    fs.writeFileSync(`${destinationRoot}/new/a.js`, 'public asset', { mode: 0o600 });
    const before = fs.statSync(`${destinationRoot}/new/a.js`);
    const fixtureAncestors = new Set();
    for (let ancestor = path.dirname(temporary);;) {
      fixtureAncestors.add(ancestor); if (ancestor === '/') break; ancestor = path.dirname(ancestor);
    }
    const stableAncestors = new Map([...fixtureAncestors].map((name) => {
      const value = fs.lstatSync(name, { bigint: true });
      value.uid = 0n; value.mode = 0o40755n;
      return [name, value];
    }));
    // This test-only projection lets an unprivileged owner exercise real file
    // descriptors beneath /tmp. Production never projects ownership or /tmp's
    // sticky/world-writable mode. External ancestor metadata is pinned so other
    // parallel tests creating /tmp siblings cannot invalidate this isolated
    // fixture; ancestor drift itself is covered by the separate adversarial tests.
    // No fixture target mode, metadata or bytes are projected (except test UID).
    const testStat = (value, name) => {
      if (stableAncestors.has(name)) {
        const pinned = stableAncestors.get(name);
        return Object.assign(Object.create(Object.getPrototypeOf(pinned)), pinned);
      }
      value.uid = typeof value.uid === 'bigint' ? 0n : 0;
      return value;
    };
    const io = { ...fs, platform: 'linux', getuid: () => 0,
      lstatSync: (...args) => testStat(fs.lstatSync(...args), args[0]),
      fstatSync: (...args) => testStat(fs.fstatSync(...args), fs.realpathSync(`/proc/self/fd/${args[0]}`)),
    };
    const plan = planStaticPermissionRecovery({ sourceRoot, destinationRoot, previousRoots: [previousRoot], startedAt, rolledBackAt: new Date().toISOString(), fsAdapter: io });
    // Simulate an unrelated concurrently running test modifying /tmp's nlink
    // and timestamps AFTER planning. Only its external ancestor is projected.
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), 'faolla-static-recovery-sibling-'));
    let result;
    try { result = plan.apply(); } finally { fs.rmdirSync(sibling); }
    const after = fs.statSync(`${destinationRoot}/new/a.js`);
    assert.equal(result.changedFiles, 1); assert.equal(result.changedDirectories, 1);
    assert.equal(after.mode & 0o777, 0o644); assert.equal(fs.statSync(`${destinationRoot}/new`).mode & 0o777, 0o755);
    assert.equal(after.uid, before.uid); assert.equal(after.gid, before.gid); assert.equal(after.ino, before.ino);
    assert.equal(fs.readFileSync(`${destinationRoot}/new/a.js`, 'utf8'), 'public asset');
    assert.equal(fs.statSync(`${sourceRoot}/new/a.js`).mode & 0o777, 0o600);
  } finally {
    // Only the mkdtemp-owned fixture is removed; no application or release paths.
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
