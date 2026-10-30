// Disposable subprocess fixture. It may exit only itself/its owned child;
// the process identity collectors are imported unchanged from the checkout.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {captureProcessFact} from '../check-production-runtime-supervision.mjs';
import {captureReparentableProcessFact} from '../release-toolchain-process-reparent-capture.mjs';
const [role, mode] = process.argv.slice(2), entry = fileURLToPath(import.meta.url);
if (!['strict', 'reparentable', 'command-change'].includes(mode)) throw Error('fixture_mode');
if (role === 'parent') {
  const child = spawn(process.execPath, [entry, 'observer', mode], {
    cwd: process.cwd(), env: {PATH: process.env.PATH}, stdio: ['ignore', process.stdout, process.stderr, 'ipc'],
  });
  const timer = setTimeout(() => { child.kill(); process.exit(2); }, 8000);
  child.once('message', value => {
    if (value !== 'exit-owned-parent') throw Error('fixture_protocol');
    clearTimeout(timer);
    // Natural parent exit, not a forged PPID or a signal to a foreign PID.
    process.exit(0);
  });
  child.once('error', () => process.exit(3));
} else if (role === 'observer') {
  process.title = 'owned-release-reparent-observer';
  const original = fs.readFileSync, originalParent = process.ppid, stat = '/proc/' + process.pid + '/stat';
  const baseline = captureProcessFact(process.pid);
  let reads = 0, commandReads = 0, rejected = false, actual, errorCode = null;
  fs.readFileSync = function(file, ...args) {
    const bytes = Reflect.apply(original, this, [file, ...args]);
    if (file === stat && ++reads === 1) {
      process.send('exit-owned-parent');
      const deadline = Date.now() + 3000, sleep = new Int32Array(new SharedArrayBuffer(4));
      while (process.ppid === originalParent && Date.now() < deadline) Atomics.wait(sleep, 0, 0, 1);
      if (process.ppid === originalParent) throw Error('fixture_parent_did_not_exit');
    }
    if (mode === 'command-change' && file === '/proc/' + process.pid + '/cmdline' && ++commandReads === 1) process.title = 'owned-release-changed-command';
    return bytes;
  };
  syncBuiltinESMExports();
  try { actual = (mode === 'strict' ? captureProcessFact : captureReparentableProcessFact)(process.pid); }
  catch (error) { rejected = true; errorCode = error.message; }
  finally { fs.readFileSync = original; syncBuiltinESMExports(); }
  const after = captureProcessFact(process.pid);
  if (baseline.startTicks !== after.startTicks || originalParent === process.ppid || reads !== 2) throw Error('fixture_birth_or_boundary');
  if (mode === 'reparentable') {
    if (rejected || actual.startTicks !== baseline.startTicks || actual.parentPid !== process.ppid) throw Error('fixture_reparent_failed');
  } else if (!rejected || errorCode !== 'process_identity_drift') throw Error('fixture_drift_not_rejected');
  process.stdout.write(JSON.stringify({mode, reads, rejected, errorCode, sameBirth: true, actualParentChanged: true,
    strictDefaultUnchanged: true, formalHostTouched: false, publicationAuthority: false}) + '\n');
  if (process.connected) process.disconnect();
} else throw Error('fixture_role');
