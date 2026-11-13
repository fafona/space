// Pure operations installation, not an application release or database change.
import * as fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {collectRemoteReleaseReview, assertReviewFresh, sourceGit, parseSourceTree,
  assertUnchangedApplicationSource, ownedReleasePath} from './release-toolchain-source.mjs';
import {withOnlineToolPreparationLocks} from './prepare-online-release-tool.mjs';
import {STORAGE_ROOT, STORAGE_BASELINE, STORAGE_UNITS, storageUnitFiles, storageDigest} from './release-toolchain-storage-policy.mjs';
import {inspectStorageSource, storageCommand, storageDirectory, storageWrite, storageRead,
  currentStorageEvent, inspectStorageCandidates, dailyStorage, storageFailure} from './release-toolchain-storage-host.mjs';

const APP = '/www/wwwroot/merchant-space';
const need = (v, code) => {if (!v) throw Error('storage_lifecycle_install_' + code);};
const PROTECTED = ['/var/lib/faolla-online-release/active.json', '/var/lib/faolla-online-retention.head.json',
  '/root/.pm2/dump.pm2', '/root/.pm2/dump.pm2.bak'];
const protectedPins = () => PROTECTED.map(file => ({file, sha256: storageDigest(storageRead(file))}));

export async function installStorageLifecycle() {
  need(process.argv.length === 2, 'invocation');
  const source = inspectStorageSource({installed: false}), revision = source.revision;
  const review = await collectRemoteReleaseReview(revision);
  assertUnchangedApplicationSource(STORAGE_BASELINE,
    parseSourceTree(sourceGit(APP, ['ls-tree', '-r', '-z', STORAGE_BASELINE])), source.rows);
  need(sourceGit(APP, ['rev-parse', 'origin/main']).toString().trim() === revision, 'main_changed');
  return withOnlineToolPreparationLocks({deployLock: APP + '.deploy.lock', maintenance: '/var/lib/faolla-maintenance/merchant-space'}, () => {
    assertReviewFresh(review, revision);
    inspectStorageSource({installed: false});
    const original = protectedPins(), current = currentStorageEvent();
    need(current.event.target === STORAGE_BASELINE, 'initial_publication_changed');
    need(!fs.existsSync(STORAGE_ROOT), 'already_attempted');
    for (const name of STORAGE_UNITS) need(!fs.existsSync('/etc/systemd/system/' + name), 'existing_unit');
    ownedReleasePath('/etc/systemd/system', {directory: true});
    // Complete qualification and report reads before creating any scheduler.
    const inspection = inspectStorageCandidates(revision), initial = dailyStorage(revision, {write: false});
    storageDirectory(STORAGE_ROOT);
    for (const name of ['reports', 'events', 'units']) storageDirectory(STORAGE_ROOT + '/' + name);
    storageWrite(STORAGE_ROOT + '/installation-prepared.json', {kind: 'storage-lifecycle-installation-prepared', revision,
      review, inventorySha256: source.inventorySha256, protectedPins: original, at: new Date().toISOString()});
    try {
      const units = storageUnitFiles(revision);
      for (const [name, text] of Object.entries(units)) storageWrite(STORAGE_ROOT + '/units/' + name, Buffer.from(text));
      storageCommand('/usr/bin/systemd-analyze', ['verify', ...STORAGE_UNITS.map(n => STORAGE_ROOT + '/units/' + n)]);
      need(isDeepStrictEqual(protectedPins(), original) && isDeepStrictEqual(currentStorageEvent(), current), 'protected_state_changed');
      for (const [name, text] of Object.entries(units)) {
        const file = '/etc/systemd/system/' + name;
        const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
        try {fs.writeFileSync(fd, text); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
        need(storageRead(file).equals(Buffer.from(text)), 'unit_readback');
      }
      const unitDir = fs.openSync('/etc/systemd/system', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      try {fs.fsyncSync(unitDir);} finally {fs.closeSync(unitDir);}
      storageWrite(STORAGE_ROOT + '/initial-candidates.json', inspection);
      storageWrite(STORAGE_ROOT + '/reports/initial.json', initial);
      storageWrite(STORAGE_ROOT + '/daily-latest.json', initial);
      storageWrite(STORAGE_ROOT + '/installed.json', {kind: 'storage-lifecycle-installed', revision,
        inventorySha256: source.inventorySha256, applicationUnchanged: true, review, units: Object.fromEntries(
          Object.entries(units).map(([name, text]) => [name, storageDigest(text)])), at: new Date().toISOString()});
      storageCommand('/usr/bin/systemctl', ['daemon-reload']);
      storageCommand('/usr/bin/systemctl', ['enable', '--now', 'faolla-storage-daily.timer', 'faolla-storage-post-release.timer']);
      for (const timer of ['faolla-storage-daily.timer', 'faolla-storage-post-release.timer']) {
        need(storageCommand('/usr/bin/systemctl', ['is-enabled', timer]).trim() === 'enabled'
          && storageCommand('/usr/bin/systemctl', ['is-active', timer]).trim() === 'active', 'timer_not_active');
      }
      need(isDeepStrictEqual(protectedPins(), original) && isDeepStrictEqual(currentStorageEvent(), current), 'protected_state_changed');
      const result = {kind: 'storage-lifecycle-scheduled', revision, timersEnabled: true, initialAvailableBytes: initial.availableBytes,
        initialEligibleCaches: inspection.candidates.length, processControlPerformed: false, applicationPublished: false,
        businessDataWritten: false, mailEnabled: false, at: new Date().toISOString()};
      storageWrite(STORAGE_ROOT + '/scheduling-completed.json', result);
      return result;
    } catch (error) {
      // Disable only the two newly owned timers on incomplete installation. No
      // evidence/unit files are removed; no application/worker is controlled.
      for (const timer of ['faolla-storage-daily.timer', 'faolla-storage-post-release.timer']) {
        if (fs.existsSync('/etc/systemd/system/' + timer)) {
          try {storageCommand('/usr/bin/systemctl', ['disable', '--now', timer]);} catch { /* report installation incomplete */ }
        }
      }
      storageWrite(STORAGE_ROOT + '/installation-failed.json', {kind: 'storage-lifecycle-installation-incomplete',
        automaticRetryAllowed: false, at: new Date().toISOString()});
      throw error;
    }
  });
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  installStorageLifecycle().then(value => console.log(JSON.stringify(value)), error => {
    console.error(JSON.stringify(storageFailure(error))); process.exitCode = 1;
  });
}
