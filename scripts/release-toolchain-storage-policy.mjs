// Independent maintenance, never publication authority. No user-supplied paths.
import {createHash} from 'node:crypto';
import {planReleaseCacheCleanup} from './online-release-cache-policy.mjs';

export const STORAGE_ROOT = '/var/lib/faolla-storage-lifecycle';
export const STORAGE_BASELINE = 'aa5810a7c5bd459d61dda758e03a1f99a70696d0';
export const STORAGE_GIB = 1024 ** 3;
export const STORAGE_WARN_BYTES = 30 * STORAGE_GIB;
export const STORAGE_CRITICAL_BYTES = 20 * STORAGE_GIB;
export const STORAGE_UNITS = ['faolla-storage-daily.service', 'faolla-storage-daily.timer',
  'faolla-storage-post-release.service', 'faolla-storage-post-release.timer'];
const need = (v, code) => {if (!v) throw Error('storage_lifecycle_' + code);};
const sha = v => /^[a-f0-9]{40}$/.test(v ?? '');
const hash = v => /^[a-f0-9]{64}$/.test(v ?? '');
export const storageDigest = v => createHash('sha256').update(v).digest('hex');

export function storageEvent({active, completed, retentionHead, now = Date.now()}) {
  need(sha(active?.target) && active.directory === '/www/wwwroot/merchant-space.web-releases/' + active.target.slice(0, 12) + '-online'
    && active.name === 'merchant-space-online-' + active.target.slice(0, 12), 'active');
  need(hash(retentionHead), 'retention_head');
  const p = completed?.proof, at = Date.parse(completed?.at);
  need(completed?.kind === 'ordinary-application-publication-completed' && completed.target === active.target
    && sha(completed.baseline) && completed.baseline !== active.target && completed.mailEnabled === false
    && p?.kind === 'ordinary-application-release-readonly-verified' && p.target === active.target && p.baseline === completed.baseline
    && hash(p.certificateSha256) && hash(p.manifestSha256) && p.rollbackRetained === true
    && p.savedProcessConfigurationVerified === true && p.otherProcessesUnchanged === true
    && p.businessDataWrittenByAudit === false && p.mailEnabled === false
    && p.naturalCycle?.status === 'completed' && p.naturalCycle.observedScheduledCycle === true
    && Number.isFinite(at) && Number.isFinite(now) && at <= now && at === Date.parse(p.at), 'publication_incomplete');
  need(Array.isArray(p.publicProof) && p.publicProof.length === 2 && new Set(p.publicProof.map(r => r.origin)).size === 2
    && ['https://faolla.com', 'https://launch.faolla.com'].every(origin => p.publicProof.some(r =>
      r.origin === origin && r.status === 200 && r.buildId === active.target)), 'public_proof');
  const publicationSha256 = storageDigest(JSON.stringify(completed));
  return {target: active.target, baseline: completed.baseline, certificateSha256: p.certificateSha256,
    publicationSha256, retentionHead, key: storageDigest(JSON.stringify([active.target, publicationSha256, retentionHead]))};
}

// Extra-narrow unattended policy: only already-certified stopped web releases,
// and only their webpack cache. Not dependencies, source, static, backups, DB,
// saved PM2 dumps, registrations, logs, or any online/unknown release.
export function planStorageCaches(observation) {
  need(Array.isArray(observation?.certifiedStoppedDirectories) && Array.isArray(observation?.pm2), 'observation');
  return planReleaseCacheCleanup(observation).eligible.filter(row => {
    if (!/^\/www\/wwwroot\/merchant-space\.web-releases\/[a-f0-9]{12}-online$/.test(row.releaseDirectory)
      || observation.certifiedStoppedDirectories.filter(p => p === row.releaseDirectory).length !== 1) return false;
    const rows = observation.pm2.filter(p => p.cwd === row.releaseDirectory || p.executable?.startsWith(row.releaseDirectory + '/'));
    return rows.length === 1 && rows[0].status === 'stopped' && rows[0].pid === 0 && rows[0].watch === false
      && rows[0].cronRestart === null && rows[0].name === 'merchant-space-online-' + row.releaseDirectory.split('/').at(-1).slice(0, 12)
      && rows[0].executable === row.releaseDirectory + '/node_modules/next/dist/bin/next';
  });
}

export function storagePressure(available, previous, now = Date.now()) {
  need(Number.isSafeInteger(available) && available >= 0 && Number.isFinite(now), 'available_bytes');
  const alerts = [];
  if (available < STORAGE_CRITICAL_BYTES) alerts.push({code: 'below_build_floor', severity: 'critical'});
  else if (available < STORAGE_WARN_BYTES) alerts.push({code: 'low_free_space', severity: 'warning'});
  let growthBytesPerDay = null, daysToBuildFloor = null;
  if (previous) {
    const elapsed = now - Date.parse(previous.at);
    need(Number.isFinite(elapsed) && elapsed >= 0 && Number.isSafeInteger(previous.availableBytes)
      && previous.availableBytes >= 0, 'previous_report');
    if (elapsed >= 20 * 3600000 && elapsed <= 72 * 3600000) {
      growthBytesPerDay = (previous.availableBytes - available) * 86400000 / elapsed;
      if (growthBytesPerDay >= STORAGE_GIB) {
        daysToBuildFloor = Math.max(0, (available - STORAGE_CRITICAL_BYTES) / growthBytesPerDay);
        if (daysToBuildFloor < 7) alerts.push({code: 'growth_reaches_floor_within_week', severity: 'warning'});
      }
    }
  }
  return {warningBytes: STORAGE_WARN_BYTES, criticalBytes: STORAGE_CRITICAL_BYTES, growthBytesPerDay, daysToBuildFloor, alerts};
}

export function storageUnitFiles(revision) {
  need(sha(revision), 'revision');
  const directory = '/var/lib/faolla-online-code/' + revision;
  const service = action => '[Unit]\nDescription=Faolla independent storage ' + action + '\nAfter=local-fs.target\n\n[Service]\nType=oneshot\n'
    + 'WorkingDirectory=' + directory + '\nExecStart=/usr/bin/node ' + directory + '/scripts/release-toolchain-storage-host.mjs ' + action
    + '\nUser=root\nUMask=0077\nEnvironment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\nEnvironment=PM2_HOME=/root/.pm2\n'
    + 'Nice=19\nIOSchedulingClass=idle\nCPUQuota=20%\nMemoryMax=512M\nTasksMax=64\nTimeoutStartSec=600\n'
    + 'NoNewPrivileges=true\nProtectKernelTunables=true\nProtectControlGroups=true\nRestrictSUIDSGID=true\n'
    + 'StandardOutput=journal\nStandardError=journal\nSyslogLevelPrefix=true\n';
  return {
    'faolla-storage-daily.service': service('daily'),
    'faolla-storage-daily.timer': '[Unit]\nDescription=Faolla daily read-only disk inventory\n\n[Timer]\nOnCalendar=*-*-* 04:40:00 UTC\nRandomizedDelaySec=600\nPersistent=true\nUnit=faolla-storage-daily.service\n\n[Install]\nWantedBy=timers.target\n',
    'faolla-storage-post-release.service': service('poll'),
    'faolla-storage-post-release.timer': '[Unit]\nDescription=Faolla completed-publication cache reclamation observer\n\n[Timer]\nOnBootSec=5min\nOnUnitInactiveSec=5min\nRandomizedDelaySec=30\nUnit=faolla-storage-post-release.service\n\n[Install]\nWantedBy=timers.target\n',
  };
}

// No event is automatically retried once durable destructive intent exists.
export function executeStorageEvent(event, operations) {
  const status = operations.status(event.key);
  if (status === 'completed') return {status: 'already-completed', key: event.key};
  need(status === 'absent', 'previous_attempt_requires_review');
  const plan = operations.plan(event);
  operations.preflight(plan, event);
  operations.prepare(plan, event);
  try {
    const result = operations.apply(plan, event);
    operations.verify(plan, event);
    operations.complete(result, event);
    return {status: 'completed', key: event.key, result};
  } catch (error) {
    operations.fail(event); // Fixed error marker; never serialize private errors.
    throw error;
  }
}
