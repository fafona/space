import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {withStorageDeploymentLock} from './release-toolchain-storage-lock.mjs';

const LOCK = '/www/wwwroot/merchant-space.deploy.lock', OP = '/var/lib/faolla-maintenance/merchant-space/operation.lock';
function fixture({busy = false, locked = true, swapped = false} = {}) {
  const events = [], st = {dev: 1, ino: 2, uid: 0, mode: 0o100600, nlink: 1};
  let held = false, reads = 0;
  const ports = {
    check(file) {assert.equal(file, LOCK); return {...st, ino: swapped && ++reads > 1 ? 99 : 2};},
    io: {lstatSync(file) {assert.equal(file, OP); if (busy) return {}; throw Object.assign(Error(), {code: 'ENOENT'});},
      openSync(file, flags) {assert.equal(file, LOCK); assert.equal(flags, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW); events.push('open'); return 42;},
      fstatSync(fd) {assert.equal(fd, 42); return st;}, closeSync(fd) {assert.equal(fd, 42); events.push('close'); held = false;}},
    spawn(command, args, options) {
      assert.equal(command, '/usr/bin/flock'); assert.deepEqual(args, ['--nonblock', '3']);
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe', 42]); assert.equal(options.timeout, 10000);
      events.push('flock'); held = locked; return {status: locked ? 0 : 1};
    },
  };
  return {ports, events, held: () => held};
}
test('same production flock and existing operation fence, no create/truncate/directory lease', () => {
  const f = fixture(); const r = withStorageDeploymentLock(verify => {assert.equal(f.held(), true); verify(); return 'ok';}, f.ports);
  assert.equal(r, 'ok'); assert.deepEqual(f.events, ['open', 'flock', 'close']); assert.equal(f.held(), false);
  let escaped; withStorageDeploymentLock(verify => {escaped = verify;}, fixture().ports);
  assert.throws(escaped, /identity_changed/, 'a returned verifier cannot claim a released lease');
  const source = fs.readFileSync(new URL('./release-toolchain-storage-lock.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /mkdirSync|rmdirSync|unlinkSync|O_CREAT|O_TRUNC|process\.kill/);
  for (const name of ['host', 'install']) {
    const body = fs.readFileSync(new URL('./release-toolchain-storage-' + name + '.mjs', import.meta.url), 'utf8');
    assert.match(body, /withStorageDeploymentLock/); assert.doesNotMatch(body, /withOnlineToolPreparationLocks/);
  }
});
test('busy fences do not invoke work; changed lock inode and callback errors always close the fd', () => {
  for (const settings of [{busy: true}, {locked: false}, {swapped: true}]) {
    const f = fixture(settings); let called = false;
    assert.throws(() => withStorageDeploymentLock(() => {called = true;}, f.ports)); assert.equal(called, false);
    assert.equal(f.events.includes('open'), f.events.includes('close'));
  }
  const f = fixture(); assert.throws(() => withStorageDeploymentLock(() => {throw Error('fixture failure');}, f.ports), /fixture failure/);
  assert.equal(f.events.at(-1), 'close'); assert.equal(f.held(), false);
});
test('a dangling/unknown operation entry blocks too; arbitrary filesystem errors do not become absence', () => {
  const f = fixture(); f.ports.io.lstatSync = () => {throw Object.assign(Error('fixture EACCES'), {code: 'EACCES'});};
  assert.throws(() => withStorageDeploymentLock(() => {}, f.ports), /fixture EACCES/); assert.deepEqual(f.events, []);
  for (const result of [{status: null, error: Error('fixture ENOENT')}, {status: null, signal: 'SIGTERM'}, {status: 64}]) {
    const f = fixture(); f.ports.spawn = () => result;
    assert.throws(() => withStorageDeploymentLock(() => {}, f.ports), /acquisition_failed/);
    assert.equal(f.events.at(-1), 'close');
  }
});

if (process.platform === 'linux') test('real kernel flock blocks a second owner and releases after SIGKILL without an operation directory', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'faolla-storage-kill-'));
  const lock = path.join(directory, 'deploy.lock'), operation = path.join(directory, 'operation.lock');
  fs.writeFileSync(lock, '', {mode: 0o600});
  let child;
  try {
    const fixtureModuleUrl = new URL('./release-toolchain-storage-lock.mjs', import.meta.url).href;
    const code = `import * as fs from 'node:fs';import {withStorageDeploymentLock} from ${JSON.stringify(fixtureModuleUrl)};
const map=p=>p===${JSON.stringify(LOCK)}?${JSON.stringify(lock)}:p===${JSON.stringify(OP)}?${JSON.stringify(operation)}:(()=>{throw Error('fixture path')})();
const io={lstatSync:p=>fs.lstatSync(map(p)),openSync:(p,f)=>fs.openSync(map(p),f),fstatSync:fs.fstatSync,closeSync:fs.closeSync};
withStorageDeploymentLock(verify=>{verify();fs.writeSync(1,'held\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);},{io,check:p=>fs.lstatSync(map(p))});`;
    child = spawn(process.execPath, ['--input-type=module', '-e', code], {stdio: ['ignore', 'pipe', 'pipe']});
    const closed = once(child, 'close');
    let stderr = ''; child.stderr.on('data', b => {stderr += b;});
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('fixture holder did not become ready: ' + stderr)), 10000);
      child.once('error', error => {clearTimeout(timer); reject(error);});
      child.once('exit', () => {clearTimeout(timer); reject(Error('fixture holder exited before kill: ' + stderr));});
      child.stdout.once('data', bytes => {clearTimeout(timer); bytes.toString() === 'held\n' ? resolve() : reject(Error('fixture ready protocol'));});
    });
    const contender = () => spawnSync('/usr/bin/flock', ['--nonblock', lock, '/usr/bin/true'], {encoding: 'utf8', timeout: 10000});
    assert.equal(contender().status, 1, 'the shared file lock is actually held');
    assert.equal(fs.existsSync(operation), false, 'no new operation fence can strand publications');
    child.kill('SIGKILL');
    const [codeExit, signal] = await closed; assert.equal(codeExit, null); assert.equal(signal, 'SIGKILL');
    assert.equal(contender().status, 0, 'kernel released the publication flock after abrupt death');
    assert.equal(fs.existsSync(operation), false);
    assert.deepEqual(fs.readdirSync(directory), ['deploy.lock']);
    child = null;
  } finally {
    if (child?.exitCode === null && child.signalCode === null) {const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;}
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
