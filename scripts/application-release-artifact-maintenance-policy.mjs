// Explicit historical maintenance, not a replay of publication housekeeping.
// The host must supply the original fully validated disk history/observation.
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {assertOnlineRetentionCertificate, ONLINE_RETENTION_POLICY, retentionHash} from './online-release-retention-policy.mjs';
import {selectPm2CacheProtection} from './online-release-cache-cleanup.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';

export const ARTIFACT_MAINTENANCE_FILES = Object.freeze([
  'scripts/application-release-artifact-maintenance.mjs',
  'scripts/application-release-artifact-maintenance-policy.mjs',
  'scripts/application-release-artifact-maintenance.test.mjs',
  'docs/historical-application-artifact-maintenance.md',
]);
const sha = v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const need = (v, code) => {if (!v) throw Error('artifact_maintenance_' + code);};
const same = (a, b, code) => need(isDeepStrictEqual(a, b), code);
const overlap = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
export const maintenanceHash = v => createHash('sha256').update(v).digest('hex');

export function assertArtifactMaintenanceScope(files) {
  need(Array.isArray(files) && new Set(files).size === files.length && files.every(f => ARTIFACT_MAINTENANCE_FILES.includes(f)), 'tool_scope');
}
export function historicalArtifactContext({victimTarget, history, observation, window, active}) {
  need(sha(victimTarget) && history?.version === 2 && history.policy === ONLINE_RETENTION_POLICY && Array.isArray(history.entries) && history.entries.length, 'history');
  const latest = history.entries.at(-1);
  need(retentionHash(latest) === history.headSha256 && observation?.retentionHead === history.headSha256, 'history_head');
  need(window?.phase === 'stable' && sha(window.active?.target) && sha(window.stableRollback?.target), 'window');
  for (const key of ['target', 'directory', 'name', 'port']) {
    same(window.active[key], latest.active[key], 'active');
    same(window.stableRollback[key], latest.rollback[key], 'rollback');
    same(active?.[key], window.active[key], 'active');
  }
  need(![window.active.target, window.stableRollback.target].includes(victimTarget), 'protected_target');
  const directory = '/www/wwwroot/merchant-space.web-releases/' + victimTarget.slice(0, 12) + '-online';
  need(Array.isArray(observation.protectedDirectories) && observation.protectedDirectories.every(p => typeof p === 'string' && p.startsWith('/')), 'protection');
  need(!observation.protectedDirectories.some(p => overlap(p, directory)), 'protected_reference');
  const matches = history.entries.filter(c => c.kind === 'retire' && c.victim?.target === victimTarget);
  need(matches.length === 1, 'retirement_not_unique');
  const certificate = matches[0]; assertOnlineRetentionCertificate(certificate);
  need(certificate.status === 'completed' && certificate.victim.process.cwd === directory, 'retirement');
  // Reuse the established birth/reboot corridor; do not infer retirement from a
  // name, PID zero, age or a caller-supplied "certified" array.
  const protection = selectPm2CacheProtection({pm2: observation.pm2, history});
  need(protection.certifiedStoppedDirectories.includes(directory) && observation.certifiedStoppedDirectories?.includes(directory), 'not_certified');
  const old = certificate.stoppedProcess;
  const aliases = observation.pm2.filter(p => p.cwd === directory || p.name === old.name || p.pmId === old.pmId || p.executable === old.executable);
  need(aliases.length === 1, 'process_alias');
  const stopped = aliases[0];
  need(stopped.pid === 0 && stopped.status === 'stopped' && stopped.watch === false && stopped.cronRestart === null &&
    stopped.backgroundPaused === '1' && stopped.automationEnabled === '0' && stopped.invitationEnabled === '0', 'process');
  return {kind: 'historical-retired-artifact-maintenance', victimTarget, directory,
    activeTarget: window.active.target, rollbackTarget: window.stableRollback.target,
    retentionHead: history.headSha256, retirementCertificateSha256: retentionHash(certificate), stopped: structuredClone(stopped)};
}
export function assertHistoricalStoppedDump(rows, context) {
  need(Array.isArray(rows) && rows.every(v => v && typeof v === 'object'), 'dump');
  const p = context.stopped, aliases = rows.filter(r => r.name === p.name || r.pm_cwd === p.cwd || r.pm_exec_path === p.executable);
  need(aliases.length === 1, 'dump_alias'); const r = aliases[0];
  need(r.name === p.name && r.pm_cwd === p.cwd && r.pm_exec_path === p.executable && r.status === 'stopped' &&
    r.instances === undefined && r.pm_id === undefined && r.watch === false && [null, undefined].includes(r.cron_restart), 'dump_not_stopped');
  same(normalizeRetirementProcess({name:r.name, pm_id:p.pmId, pid:0, pm2_env:r}), p, 'dump_identity');
}
export function executeHistoricalArtifactMaintenance(plan, operations) {
  operations.verify('before-intent'); operations.begin(plan); let stage = 'preserve';
  try {
    operations.preserve(); stage = 'backup'; operations.repairBackup();
    stage = 'before-delete'; operations.verify(stage);
    stage = 'apply'; const result = operations.apply(plan.tree);
    stage = 'after-delete'; operations.verify(stage);
    stage = 'complete'; operations.complete(result); return result;
  } catch (error) {
    operations.failed({stage, partialCleanupPossible: ['apply','after-delete','complete'].includes(stage),
      code: /^artifact_maintenance_[a-z_]+$/.test(error?.message ?? '') ? error.message : 'artifact_maintenance_check_failed'});
    throw error;
  }
}
