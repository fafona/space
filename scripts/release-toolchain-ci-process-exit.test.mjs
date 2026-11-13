import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {setTimeout as pause} from 'node:timers/promises';
import {observeCiProcessAlive} from './release-toolchain-ci-process-exit.mjs';

const fact = {pid: 123, startTicks: '45000', uid: 0, executable: '/usr/bin/node', cwd: '/owned-ci'};
const stat = (state = 'S', ticks = fact.startTicks, pid = fact.pid) => `${pid} (owned (ci) worker) ${[state, '1', ...Array(17).fill('0'), ticks, ...Array(30).fill('0')].join(' ')}\n`;
const failure = () => Error('invalid_proc_stat');

test('an owned zombie has exited, while the unchanged strict observer must still reject it', () => {
  let captured = false;
  assert.equal(observeCiProcessAlive(fact, {readStat: () => stat('Z'), capture: () => {captured = true; throw failure();}}), false);
  assert.equal(captured, false);
});

test('a running process still requires every original liveness identity field', () => {
  assert.equal(observeCiProcessAlive(fact, {readStat: () => stat(), capture: () => ({...fact})}), true);
  for (const key of ['pid', 'startTicks', 'uid', 'executable', 'cwd']) {
    assert.equal(observeCiProcessAlive(fact, {readStat: () => stat(), capture: () => ({...fact, [key]: 'different'})}), false, key);
  }
});

test('exit between the initial stat and strict capture is confirmed by a fresh zombie observation', () => {
  let reads = 0;
  assert.equal(observeCiProcessAlive(fact, {readStat: () => stat(++reads === 1 ? 'S' : 'Z'), capture: () => {throw failure();}}), false);
  assert.equal(reads, 2);
});

test('an invalid strict capture is never suppressed when fresh stat does not prove exit', () => {
  const error = failure();
  assert.throws(() => observeCiProcessAlive(fact, {readStat: () => stat(), capture: () => {throw error;}}), value => value === error);
});

test('PID reuse proves the old process is gone without observing or signalling the replacement', () => {
  assert.equal(observeCiProcessAlive(fact, {readStat: () => stat('S', '45001'), capture: () => {throw Error('replacement_must_not_be_captured');}}), false);
});

test('only missing proc files are normal exit; permission and unrelated capture failures propagate', () => {
  for (const code of ['ENOENT', 'ESRCH']) {
    assert.equal(observeCiProcessAlive(fact, {readStat: () => {throw Object.assign(Error(code), {code});}, capture: () => {throw Object.assign(Error(code), {code});}}), false);
  }
  for (const code of ['EACCES', 'EPERM', 'EIO']) {
    const error = Object.assign(Error(code), {code});
    assert.throws(() => observeCiProcessAlive(fact, {readStat: () => {throw error;}, capture: () => {throw error;}}), value => value === error);
  }
  const error = Error('unrelated_capture_failure');
  assert.throws(() => observeCiProcessAlive(fact, {readStat: () => stat(), capture: () => {throw error;}}), value => value === error);
});

test('malformed, oversized or foreign stat and invalid expected identities fail closed', () => {
  for (const raw of ['', 'malformed', stat('?', '45000'), stat('S', '0'), stat('S', '45000', 999), stat() + '\0', 'x'.repeat(65537)]) {
    assert.throws(() => observeCiProcessAlive(fact, {readStat: () => raw, capture: () => fact}));
  }
  for (const expected of [null, {...fact, pid: 0}, {...fact, pid: 1.5}, {...fact, startTicks: '0'}]) {
    assert.throws(() => observeCiProcessAlive(expected, {readStat: () => stat(), capture: () => fact}));
  }
});

test('real Linux zombie deterministically reproduces the old strict-capture teardown failure', {skip: process.platform !== 'linux', timeout: 12000}, async () => {
  const {captureProcessFact} = await import('./check-production-runtime-supervision.mjs');
  const python = `import os, sys, signal
def expired(*args): raise TimeoutError('owned_ci_zombie_deadline')
signal.signal(signal.SIGALRM, expired)
signal.alarm(8)
r,w=os.pipe()
pid=os.fork()
if pid == 0:
 os.close(w)
 os.read(r,1)
 os._exit(0)
os.close(r)
released=False
def release():
 global released
 if not released:
  released=True
  os.write(w,b'x')
  os.close(w)
try:
 print(pid,flush=True)
 for line in sys.stdin:
  if line.strip() == 'release': release()
  elif line.strip() == 'reap': break
finally:
 release()
 os.waitpid(pid,0)
`;
  // The unchanged strict observer rejects literal newlines in argv. Encode the
  // synthetic program so its process satisfies that same production contract.
  const command = "import base64;exec(base64.b64decode('" + Buffer.from(python).toString('base64') + "'))";
  const parent = spawn('/usr/bin/python3', ['-I', '-S', '-B', '-c', command], {stdio: ['pipe', 'pipe', 'pipe'], env: {PATH: '/usr/bin:/bin', LANG: 'C.UTF-8'}});
  let stderr = ''; parent.stderr.setEncoding('utf8'); parent.stderr.on('data', data => {stderr += data;});
  const exited = once(parent, 'exit');
  try {
    const [data] = await once(parent.stdout, 'data');
    const pid = Number(data.toString().trim());
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    const owned = captureProcessFact(pid);
    parent.stdin.write('release\n');
    let raw;
    for (let attempt = 0; attempt < 200; attempt++) {
      raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
      if (raw.slice(raw.lastIndexOf(')') + 2).split(' ')[0] === 'Z') break;
      await pause(10);
    }
    assert.equal(raw.slice(raw.lastIndexOf(')') + 2).split(' ')[0], 'Z');
    assert.throws(() => captureProcessFact(pid), /invalid_proc_stat/);
    assert.equal(observeCiProcessAlive(owned, {readStat: value => readFileSync(`/proc/${value}/stat`, 'utf8'), capture: captureProcessFact}), false);
  } finally {
    parent.stdin.end('reap\n');
    const [code, signal] = await exited;
    assert.equal(code, 0, stderr);
    assert.equal(signal, null);
  }
});
