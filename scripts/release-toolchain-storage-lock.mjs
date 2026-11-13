// A crash-released lease on the EXISTING deployment flock. Never create an
// operation.lock directory: an unattended, killed housekeeping process must not
// leave a filesystem fence which strands subsequent publications. Existing
// publication directory fences still block us, in addition to the shared flock.
import * as fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {ownedReleasePath} from './release-toolchain-source.mjs';

const LOCK = '/www/wwwroot/merchant-space.deploy.lock';
const OPERATION = '/var/lib/faolla-maintenance/merchant-space/operation.lock';
const need = (v, code) => {if (!v) throw Error('storage_lifecycle_lock_' + code);};
const identity = s => ['dev', 'ino', 'uid', 'mode', 'nlink'].map(k => s[k]);
function operationAbsent(io) {
  try {io.lstatSync(OPERATION);} catch (error) {if (error.code === 'ENOENT') return; throw error;}
  throw Error('storage_lifecycle_publication_busy'); // Links/unknown entries also block.
}

// Ports exist for isolated tests only; no CLI argument/environment can change
// the lock paths, observer, ownership checks or flock executable.
export function withStorageDeploymentLock(work, {io = fs, spawn = spawnSync,
  check = file => ownedReleasePath(file, {privateMode: true})} = {}) {
  need(typeof work === 'function', 'callback');
  operationAbsent(io);
  const initial = check(LOCK), fd = io.openSync(LOCK, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
  let acquired = false;
  try {
    const witness = identity(initial);
    const verify = () => {
      need(acquired && isDeepStrictEqual(identity(check(LOCK)), witness)
        && isDeepStrictEqual(identity(io.fstatSync(fd)), witness), 'identity_changed');
      operationAbsent(io);
    };
    need(isDeepStrictEqual(identity(io.fstatSync(fd)), witness) && isDeepStrictEqual(identity(check(LOCK)), witness), 'identity_changed');
    const result = spawn('/usr/bin/flock', ['--nonblock', '3'], {stdio: ['ignore', 'pipe', 'pipe', fd],
      env: {PATH: '/usr/bin:/bin', LANG: 'C.UTF-8'}, timeout: 10000});
    need(!result.error && !result.signal && [0, 1].includes(result.status), 'acquisition_failed');
    if (result.status === 1) throw Error('storage_lifecycle_publication_busy');
    acquired = true; verify();
    const value = work(verify);
    need(!value || typeof value.then !== 'function', 'synchronous_callback_required');
    verify();
    return value;
  } finally {acquired = false; io.closeSync(fd);} // Kernel releases the same lease on SIGKILL/reboot too.
}
