import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const APP = '/www/wwwroot/merchant-space';
const TOOL_ROOT = '/var/lib/faolla-online-code';
const MAINTENANCE = '/var/lib/faolla-maintenance/merchant-space';
const RELEASE_ROOT = '/var/lib/faolla-online-release';
const SELF = 'scripts/prepare-online-release-tool.mjs';
const SHA = /^[a-f0-9]{40}$/;
export const TOOL_SPARSE_PATTERNS = '/*\n!/public/downloads/\n';
export const TOOL_REQUIRED_FILES = Object.freeze([
  SELF, 'scripts/online-traffic-release.mjs', 'scripts/online-traffic-release-policy.mjs',
  'scripts/online-release-rolling.mjs', 'scripts/online-release-rolling-policy.mjs',
  'scripts/online-release-retirement.mjs', 'scripts/online-release-retirement-policy.mjs',
  'scripts/web-presentation-release-policy.mjs', 'scripts/contact-card-release-policy.mjs',
  'scripts/online-static-recovery.mjs', 'scripts/apply-production-database-migrations.mjs',
  'scripts/check-database-backup-readiness.mjs', 'scripts/check-supabase-migrations.mjs',
  'scripts/create-production-database-backup.mjs', 'scripts/verify-production-database-backup.mjs',
  'scripts/database-backup-contract.mjs', 'scripts/database-recovery-content-contract.mjs',
  'scripts/ordinary-account-identity-content-contract.mjs', 'scripts/production-release-attestation.mjs',
  'package.json', 'package-lock.json',
]);
const fail = code => { throw Error(`online_tool_${code}`); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const blobId = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const excluded = name => name === 'public/downloads' || name.startsWith('public/downloads/');
const exists = name => { try { fs.lstatSync(name); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

// The original explicitly approved, never-published attendance candidate. This sidecar
// does not change its original preparing state, delete artifacts or grant a
// retry of that target. The normal exact-main/source/lock gates still apply.
const unpublishedTarget = '5b974eb06c858757c8785d5f9106b006903a5ba0';
const unpublishedOperation = `${RELEASE_ROOT}/${unpublishedTarget}`;
const unpublishedDirectory = `${APP}.web-releases/${unpublishedTarget.slice(0, 12)}-online`;
export const UNPUBLISHED_CANDIDATE_INCIDENT = Object.freeze({
  target: unpublishedTarget, baseline: 'b1304d5d58841c2247b93229b90bb7adcfd64965',
  stateSha256: '98af9fe83f97d8f02236ff964823cebb5804f663469334c3149c067e3f032709',
  operation: unpublishedOperation, directory: unpublishedDirectory,
  name: `merchant-space-online-${unpublishedTarget.slice(0, 12)}`,
  proxyFiles: Object.freeze(['e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf',
    'no_store_entries_www.faolla.com.conf', 'faolla_contact_card_release.conf']),
});
export const UNPUBLISHED_CANDIDATE_ABSENT_PATHS = Object.freeze([
  `${unpublishedDirectory}/.next`, `${unpublishedDirectory}/.next/BUILD_ID`,
  ...['attendance-build-proof.json', 'build-home', 'build-cache', 'build-tmp',
    'attendance-database-progress.json', 'attendance-database-ready.json',
    'migration-preview.json', 'migration-report.json'].map(name => `${unpublishedOperation}/${name}`),
]);
export const UNPUBLISHED_CANDIDATE_PRESERVED_FILES = Object.freeze({
  'runtime.json': `${unpublishedOperation}/runtime.json`,
  '.env.local': `${unpublishedDirectory}/.env.local`,
  'attendance-stage-focused-diagnostic.tap': `${unpublishedOperation}/attendance-stage-focused-diagnostic.tap`,
  ...Object.fromEntries(UNPUBLISHED_CANDIDATE_INCIDENT.proxyFiles.flatMap(name =>
    ['before', 'after'].map(prefix => [`${prefix}-${name}`, `${unpublishedOperation}/${prefix}-${name}`]))),
});
// A second, separately approved incident did enter the sandboxed build unit.
// Its environment check failed before npm; retain the real failed journal,
// original private stage log and the three empty directories, not a fictional
// never-started build. No caller may supply another incident or replace pins.
const environmentTarget = 'e754793a589593011da249d00ae05326f54302bf';
const environmentOperation = `${RELEASE_ROOT}/${environmentTarget}`;
const environmentDirectory = `${APP}.web-releases/${environmentTarget.slice(0, 12)}-online`;
export const UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT = Object.freeze({
  target: environmentTarget, baseline: 'b1304d5d58841c2247b93229b90bb7adcfd64965',
  stateSha256: 'f98fbad3170b634c88e3400952bba0db6cef84d7137b467bdb7ec8a0ee835f3d',
  operation: environmentOperation, directory: environmentDirectory,
  name: `merchant-space-online-${environmentTarget.slice(0, 12)}`,
  proxyFiles: UNPUBLISHED_CANDIDATE_INCIDENT.proxyFiles,
  stageLog: `/var/log/faolla-attendance-publication/${environmentTarget}-stage.log`,
  stageLogSha256: 'd7d045e832780ddfded2b7425cb053bcd7564f381591164357fe16f63eba164a',
  buildSource: `${environmentDirectory}/scripts/attendance-online-build.mjs`,
  buildSourceSha256: '02d43cce249532ee287b25bf9a2c9231ee4351416757a0faf99d47648ee6e636',
  journalSha256: '96095c31158115cb1e9e3399d28ff9fd243c472aa58c32d6045a874513871530',
});
export const UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS = Object.freeze([
  `${environmentDirectory}/.next`, `${environmentDirectory}/.next/BUILD_ID`,
  ...['attendance-build-proof.json', 'attendance-database-progress.json', 'attendance-database-ready.json',
    'attendance-database-compatibility.json', 'attendance-compatibility-attempt.json', 'attendance-compatibility-metadata.sql',
    'migration-preview.json', 'migration-report.json'].map(name => `${environmentOperation}/${name}`),
]);
export const UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_FILES = Object.freeze({
  'runtime.json': `${environmentOperation}/runtime.json`, '.env.local': `${environmentDirectory}/.env.local`,
  'stage.log': UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT.stageLog,
  ...Object.fromEntries(UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT.proxyFiles.flatMap(name =>
    ['before', 'after'].map(prefix => [`${prefix}-${name}`, `${environmentOperation}/${prefix}-${name}`]))),
});
export const UNPUBLISHED_BUILD_ENVIRONMENT_FILE_SHA256 = Object.freeze({
  'runtime.json': '9b227b9d700001926f35b846e5a2a700dc33a9578a05b59f51a532c9b1482ed2',
  '.env.local': 'da261a4e6c130fbf0f6275a3c3fe09391f3971609298349e1b67ff62df23e0e2',
  'stage.log': UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT.stageLogSha256,
  'before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf': '474c2eef77404ebf7905c8563e5a0e015f4525420c4ce925b2478a196a560608',
  'after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf': 'ff7104caafcca9c6578caacfb1305fdcf1438a1f09ecda131aac33d1d863a60c',
  'before-no_store_entries_www.faolla.com.conf': '3a274b28d47d3be7e7963611b638a1d94a75dc9d351277941739291061972db2',
  'after-no_store_entries_www.faolla.com.conf': '2be8bb00e785f713f3119c569de014e4d2ca1d77e14bd900dc9e9fa454d33b52',
  'before-faolla_contact_card_release.conf': '90ec0b94cdb735d9375744c98b1b2fb2ae7ae4bbb9ce22c1d8efb7d6c641d69a',
  'after-faolla_contact_card_release.conf': '0554e813cb3b317caba59ef1e74367bb550d04eac8205909e2bae87d1102b7e5',
});
export const UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_DIRECTORIES = Object.freeze(Object.fromEntries(
  [['build-home', 2624499], ['build-cache', 2624500], ['build-tmp', 2624501]].map(([name, ino]) => [name,
    Object.freeze({path: `${environmentOperation}/${name}`, uid: 0, mode: 0o700, dev: 64769, ino, nlink: 2, entries: Object.freeze([])})]),
));
const terminationObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const terminationKeys = (value, keys) => terminationObject(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const terminationHash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const terminationStable = value => Array.isArray(value) ? value.map(terminationStable) : terminationObject(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, terminationStable(value[key])])) : value;
const terminationJson = value => JSON.stringify(terminationStable(value));
const terminationEqual = (left, right) => terminationJson(left) === terminationJson(right);
const terminationTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const terminationRequire = condition => {if (!condition) fail('unpublished_termination_invalid');};

function unpublishedState(stateText, p = UNPUBLISHED_CANDIDATE_INCIDENT) {
  terminationRequire(typeof stateText === 'string' && Buffer.byteLength(stateText) <= 256 * 1024 && sha256(stateText) === p.stateSha256);
  let state; try {state = JSON.parse(stateText);} catch {fail('unpublished_termination_invalid');}
  terminationRequire(terminationObject(state) && state.target === p.target && state.baseline === p.baseline &&
    state.status === 'preparing' && state.lane === 'attendance' && state.attendanceEnabled === false &&
    state.directory === p.directory && state.name === p.name && Number.isSafeInteger(state.port) && state.port >= 3103 && state.port <= 3110 &&
    Number.isSafeInteger(state.oldPort) && state.oldPort > 0 && state.oldPort !== state.port &&
    terminationObject(state.previousActive) && state.previousActive.target === p.baseline &&
    state.previousActive.name === state.oldName && state.previousActive.directory === state.oldDirectory && state.previousActive.port === state.oldPort &&
    Array.isArray(state.processes) && state.processes.length > 0 && terminationObject(state.configs) &&
    terminationHash(state.maintenanceHash) && terminationHash(state.markerHash) && terminationTime(state.startedAt));
  for (const key of ['attendanceBuildProofSha256', 'attendanceDatabaseProofSha256', 'activatedAt', 'databaseReadyAt', 'terminatedAt', 'termination'])
    terminationRequire(!Object.hasOwn(state, key));
  return state;
}

function unpublishedEvidence(state, evidence) {
  const p = UNPUBLISHED_CANDIDATE_INCIDENT;
  terminationRequire(terminationKeys(evidence, ['schemaVersion', 'target', 'baseline', 'operation', 'observedAt', 'stateSha256',
    'sourceHead', 'sourceClean', 'absentPaths', 'buildUnit', 'activeText', 'processes', 'baseDirectory', 'maintenanceText',
    'markerSha256', 'proxyHashes', 'retentionHeadSha256', 'database', 'preservedFiles', 'processReferencesAbsent',
    'pm2DumpReferencesAbsent', 'portVacant', 'candidateCompatibilityDatabaseAbsent', 'diagnosticKind', 'diagnosticFailures']) &&
    evidence.schemaVersion === 1 && evidence.target === p.target && evidence.baseline === p.baseline && evidence.operation === p.operation &&
    evidence.stateSha256 === p.stateSha256 && evidence.sourceHead === p.target && evidence.sourceClean === true &&
    terminationTime(evidence.observedAt) && Date.parse(evidence.observedAt) >= Date.parse(state.startedAt) &&
    terminationEqual(evidence.absentPaths, UNPUBLISHED_CANDIDATE_ABSENT_PATHS) &&
    terminationKeys(evidence.buildUnit, ['name', 'loadState', 'journalEmpty']) &&
    evidence.buildUnit.name === `faolla-attendance-build-${p.target}.service` && evidence.buildUnit.loadState === 'not-found' && evidence.buildUnit.journalEmpty === true &&
    evidence.processReferencesAbsent === true && evidence.pm2DumpReferencesAbsent === true && evidence.portVacant === true &&
    evidence.candidateCompatibilityDatabaseAbsent === true && evidence.diagnosticKind === 'focused-test-replay' && evidence.diagnosticFailures === 6 &&
    typeof evidence.activeText === 'string' && typeof evidence.maintenanceText === 'string' &&
    terminationEqual(evidence.processes, state.processes) && evidence.baseDirectory === state.baseDirectory &&
    evidence.markerSha256 === state.markerHash && terminationHash(evidence.markerSha256));
  let active, maintenance;
  try {active = JSON.parse(evidence.activeText); maintenance = JSON.parse(evidence.maintenanceText);} catch {fail('unpublished_termination_invalid');}
  terminationRequire(terminationEqual(active, state.previousActive) && active.target === p.baseline &&
    sha256(evidence.maintenanceText) === state.maintenanceHash && maintenance.phase === 'ended' &&
    evidence.retentionHeadSha256 === (state.retentionHeadSha256 ?? state.rollingRetentionHeadSha256 ?? null) &&
    (evidence.retentionHeadSha256 === null || terminationHash(evidence.retentionHeadSha256)) &&
    terminationKeys(evidence.proxyHashes, p.proxyFiles) &&
    terminationKeys(evidence.preservedFiles, Object.keys(UNPUBLISHED_CANDIDATE_PRESERVED_FILES)) &&
    Object.values(evidence.preservedFiles).every(terminationHash) &&
    terminationKeys(evidence.database, ['identitySha256', 'registrySha256', 'registryCount', 'registryMaximum', 'attendanceRelations', 'attendanceFunctions']) &&
    terminationHash(evidence.database.identitySha256) && terminationHash(evidence.database.registrySha256) &&
    evidence.database.registryCount === 60 && evidence.database.registryMaximum === '202609240052' &&
    evidence.database.attendanceRelations === 0 && evidence.database.attendanceFunctions === 0);
  for (const file of p.proxyFiles) {
    terminationRequire(terminationObject(state.configs[file]) && terminationHash(state.configs[file].oldHash) && terminationHash(state.configs[file].newHash) &&
      evidence.proxyHashes[file] === state.configs[file].oldHash &&
      evidence.preservedFiles[`before-${file}`] === state.configs[file].oldHash && evidence.preservedFiles[`after-${file}`] === state.configs[file].newHash);
  }
  terminationRequire(!evidence.processes.some(process => !terminationObject(process) || process.name === p.name ||
    process.cwd === p.directory || process.status === 'online' && process.port === state.port ||
    typeof process.executable === 'string' && (process.executable === p.directory || process.executable.startsWith(p.directory + '/'))));
}

/** Pure policy; the locked, ownership-checking collector supplies actual facts. */
export function createUnpublishedCandidateTerminationReceipt({stateText, evidence, toolRevision, terminatedAt} = {}) {
  const state = unpublishedState(stateText), p = UNPUBLISHED_CANDIDATE_INCIDENT;
  unpublishedEvidence(state, evidence);
  terminationRequire(typeof toolRevision === 'string' && toolRevision.length === 40 && SHA.test(toolRevision) && terminationTime(terminatedAt) &&
    Date.parse(terminatedAt) >= Date.parse(evidence.observedAt) && Date.parse(terminatedAt) - Date.parse(evidence.observedAt) <= 300000);
  const savedEvidence = JSON.parse(JSON.stringify(evidence));
  return {schemaVersion: 1, kind: 'online-unpublished-candidate-termination', target: p.target, baseline: p.baseline,
    operation: p.operation, candidate: {directory: p.directory, name: p.name, port: state.port}, originalStateSha256: p.stateSha256,
    originalStateText: stateText, evidence: savedEvidence, evidenceSha256: sha256(terminationJson(savedEvidence)), toolRevision, terminatedAt};
}

/** Verify sealed historical facts plus only this failed candidate's retained artifacts.
 * Future successful publication may change the live proxy/DB/PM2 baseline; it
 * does not retroactively invalidate the termination of this unpublished target.
 */
export function assertUnpublishedCandidateTerminationReceipt({stateText, receipt, preservedFiles, absentPaths} = {}) {
  terminationRequire(terminationKeys(receipt, ['schemaVersion', 'kind', 'target', 'baseline', 'operation', 'candidate',
    'originalStateSha256', 'originalStateText', 'evidence', 'evidenceSha256', 'toolRevision', 'terminatedAt']) &&
    receipt.originalStateText === stateText && terminationHash(receipt.evidenceSha256));
  const expected = createUnpublishedCandidateTerminationReceipt({stateText, evidence: receipt.evidence,
    toolRevision: receipt.toolRevision, terminatedAt: receipt.terminatedAt});
  terminationRequire(terminationEqual(receipt, expected) &&
    terminationKeys(preservedFiles, Object.keys(UNPUBLISHED_CANDIDATE_PRESERVED_FILES)) &&
    terminationEqual(preservedFiles, receipt.evidence.preservedFiles) && terminationEqual(absentPaths, UNPUBLISHED_CANDIDATE_ABSENT_PATHS));
  return true;
}

function unpublishedBuildEnvironmentEvidence(state, evidence) {
  const p = UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT;
  terminationRequire(terminationKeys(evidence, ['schemaVersion', 'target', 'baseline', 'operation', 'observedAt', 'stateSha256',
    'sourceHead', 'sourceClean', 'absentPaths', 'buildUnit', 'activeText', 'processes', 'baseDirectory', 'maintenanceText',
    'markerSha256', 'proxyHashes', 'retentionHeadSha256', 'database', 'preservedFiles', 'processReferencesAbsent',
    'pm2DumpReferencesAbsent', 'portVacant', 'candidateCompatibilityDatabaseAbsent', 'diagnosticKind', 'diagnosticTests',
    'diagnosticPasses', 'diagnosticFailures', 'diagnosticSkipped', 'diagnosticCancelled', 'buildAttemptOccurred', 'npmStarted',
    'buildSourceSha256', 'preservedDirectories']) && evidence.schemaVersion === 1 && evidence.target === p.target &&
    evidence.baseline === p.baseline && evidence.operation === p.operation && evidence.stateSha256 === p.stateSha256 &&
    evidence.sourceHead === p.target && evidence.sourceClean === true && terminationTime(evidence.observedAt) &&
    Date.parse(evidence.observedAt) >= Date.parse(state.startedAt) &&
    terminationEqual(evidence.absentPaths, UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS) &&
    terminationEqual(evidence.preservedFiles, UNPUBLISHED_BUILD_ENVIRONMENT_FILE_SHA256) &&
    terminationEqual(evidence.preservedDirectories, UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_DIRECTORIES) &&
    evidence.buildSourceSha256 === p.buildSourceSha256 && evidence.buildAttemptOccurred === true && evidence.npmStarted === false &&
    evidence.processReferencesAbsent === true && evidence.pm2DumpReferencesAbsent === true && evidence.portVacant === true &&
    evidence.candidateCompatibilityDatabaseAbsent === true && evidence.diagnosticKind === 'failed-build-environment' &&
    evidence.diagnosticTests === 543 && evidence.diagnosticPasses === 543 && evidence.diagnosticFailures === 0 &&
    evidence.diagnosticSkipped === 0 && evidence.diagnosticCancelled === 0 &&
    terminationKeys(evidence.buildUnit, ['name', 'loadState', 'journalEmpty', 'journalSha256', 'journalEntries']) &&
    evidence.buildUnit.name === `faolla-attendance-build-${p.target}.service` && evidence.buildUnit.loadState === 'not-found' &&
    evidence.buildUnit.journalEmpty === false && evidence.buildUnit.journalSha256 === p.journalSha256 &&
    Array.isArray(evidence.buildUnit.journalEntries) && evidence.buildUnit.journalEntries.length === 4 &&
    sha256(terminationJson(evidence.buildUnit.journalEntries)) === p.journalSha256 &&
    typeof evidence.activeText === 'string' && typeof evidence.maintenanceText === 'string' &&
    terminationEqual(evidence.processes, state.processes) && evidence.baseDirectory === state.baseDirectory &&
    evidence.markerSha256 === state.markerHash && terminationHash(evidence.markerSha256));
  let active, maintenance;
  try {active = JSON.parse(evidence.activeText); maintenance = JSON.parse(evidence.maintenanceText);} catch {fail('unpublished_termination_invalid');}
  terminationRequire(terminationEqual(active, state.previousActive) && active.target === p.baseline &&
    sha256(evidence.maintenanceText) === state.maintenanceHash && maintenance.phase === 'ended' &&
    evidence.retentionHeadSha256 === (state.retentionHeadSha256 ?? state.rollingRetentionHeadSha256 ?? null) &&
    (evidence.retentionHeadSha256 === null || terminationHash(evidence.retentionHeadSha256)) &&
    terminationKeys(evidence.proxyHashes, p.proxyFiles) &&
    terminationKeys(evidence.database, ['identitySha256', 'registrySha256', 'registryCount', 'registryMaximum', 'attendanceRelations', 'attendanceFunctions']) &&
    terminationHash(evidence.database.identitySha256) && terminationHash(evidence.database.registrySha256) &&
    evidence.database.registryCount === 60 && evidence.database.registryMaximum === '202609240052' &&
    evidence.database.attendanceRelations === 0 && evidence.database.attendanceFunctions === 0);
  for (const file of p.proxyFiles) {
    terminationRequire(terminationObject(state.configs[file]) && terminationHash(state.configs[file].oldHash) && terminationHash(state.configs[file].newHash) &&
      evidence.proxyHashes[file] === state.configs[file].oldHash &&
      evidence.preservedFiles[`before-${file}`] === state.configs[file].oldHash && evidence.preservedFiles[`after-${file}`] === state.configs[file].newHash);
  }
  terminationRequire(!evidence.processes.some(process => !terminationObject(process) || process.name === p.name ||
    process.cwd === p.directory || process.status === 'online' && process.port === state.port ||
    typeof process.executable === 'string' && (process.executable === p.directory || process.executable.startsWith(p.directory + '/'))));
}

/** Separate fixed-case policy: this receipt cannot terminate the old 5b case. */
export function createUnpublishedBuildEnvironmentTerminationReceipt({stateText, evidence, toolRevision, terminatedAt} = {}) {
  const p = UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT, state = unpublishedState(stateText, p);
  unpublishedBuildEnvironmentEvidence(state, evidence);
  terminationRequire(typeof toolRevision === 'string' && toolRevision.length === 40 && SHA.test(toolRevision) && terminationTime(terminatedAt) &&
    Date.parse(terminatedAt) >= Date.parse(evidence.observedAt) && Date.parse(terminatedAt) - Date.parse(evidence.observedAt) <= 300000);
  const savedEvidence = JSON.parse(JSON.stringify(evidence));
  return {schemaVersion: 1, kind: 'online-unpublished-build-environment-termination', target: p.target, baseline: p.baseline,
    operation: p.operation, candidate: {directory: p.directory, name: p.name, port: state.port}, originalStateSha256: p.stateSha256,
    originalStateText: stateText, evidence: savedEvidence, evidenceSha256: sha256(terminationJson(savedEvidence)), toolRevision, terminatedAt};
}

export function assertUnpublishedBuildEnvironmentTerminationReceipt({stateText, receipt, preservedFiles, absentPaths,
  preservedDirectories, buildSourceSha256} = {}) {
  terminationRequire(terminationKeys(receipt, ['schemaVersion', 'kind', 'target', 'baseline', 'operation', 'candidate',
    'originalStateSha256', 'originalStateText', 'evidence', 'evidenceSha256', 'toolRevision', 'terminatedAt']) &&
    receipt.originalStateText === stateText && terminationHash(receipt.evidenceSha256));
  const expected = createUnpublishedBuildEnvironmentTerminationReceipt({stateText, evidence: receipt.evidence,
    toolRevision: receipt.toolRevision, terminatedAt: receipt.terminatedAt});
  terminationRequire(terminationEqual(receipt, expected) && terminationEqual(preservedFiles, receipt.evidence.preservedFiles) &&
    terminationEqual(absentPaths, UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS) &&
    terminationEqual(preservedDirectories, receipt.evidence.preservedDirectories) &&
    buildSourceSha256 === UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT.buildSourceSha256);
  return true;
}

function canonicalAbsolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value || /[\r\n\0]/.test(value)) fail('path_invalid');
  return value;
}
export function createOnlineReleaseToolPlan(target, roots = {}) {
  if (typeof target !== 'string' || target.length !== 40 || !SHA.test(target) || Object.keys(roots).some(key => !['app', 'toolRoot'].includes(key))) fail('invocation_invalid');
  const app = canonicalAbsolute(roots.app ?? APP), toolRoot = canonicalAbsolute(roots.toolRoot ?? TOOL_ROOT);
  if (app === toolRoot || app.startsWith(toolRoot + path.sep) || toolRoot.startsWith(app + path.sep)) fail('roots_overlap');
  return Object.freeze({version: 1, target, app, toolRoot, directory: path.join(toolRoot, target), sparsePatterns: TOOL_SPARSE_PATTERNS});
}

// Used only for fixed production paths. Tests inject an explicit fixture-only
// path checker; the CLI has no path/owner/permission override switches.
export function assertOnlineToolOwnedPath(location, kind = 'directory', io = fs) {
  canonicalAbsolute(location);
  let current = location;
  while (true) {
    const value = io.lstatSync(current);
    const expectedDirectory = current !== location || kind === 'directory';
    if (value.isSymbolicLink() || !(expectedDirectory ? value.isDirectory() : value.isFile()) ||
        value.uid !== 0 || (value.mode & 0o022) || (!expectedDirectory && value.nlink !== 1) ||
        io.realpathSync(current) !== current) fail('unsafe_path');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}

export function readUnpublishedBuildEnvironmentDirectories(io = fs, checkPath = assertOnlineToolOwnedPath) {
  const result = {};
  for (const [key, expected] of Object.entries(UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_DIRECTORIES)) {
    checkPath(expected.path); const before = io.lstatSync(expected.path);
    const entries = io.readdirSync(expected.path).sort(), after = io.lstatSync(expected.path);
    for (const name of ['dev', 'ino', 'mode', 'uid', 'nlink', 'mtimeMs', 'ctimeMs'])
      if (before[name] !== after[name]) fail('unpublished_termination_invalid');
    result[key] = {path: expected.path, uid: before.uid, mode: before.mode & 0o777,
      dev: before.dev, ino: before.ino, nlink: before.nlink, entries};
  }
  terminationRequire(terminationEqual(result, UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_DIRECTORIES));
  return result;
}

function gitEnvironment() {
  // Do not inherit GIT_DIR, GIT_WORK_TREE, config injection, credential helpers
  // or caller SSH commands. No command in this tool contacts a remote.
  return {PATH: '/usr/bin:/bin', HOME: '/root', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0'};
}
export function runOnlineToolGit(cwd, args, input) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', ...args], {
    cwd, input, env: gitEnvironment(), timeout: 120000, maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  if (result.status !== 0 || result.error || result.signal) fail('git_failed');
  return result.stdout;
}
const text = value => Buffer.isBuffer(value) ? value.toString('utf8') : String(value);

export function readOnlineToolInventory(plan, git = runOnlineToolGit) {
  const rows = text(git(plan.app, ['ls-tree', '-rz', '--full-tree', plan.target])).split('\0').filter(Boolean);
  const seen = new Set();
  const inventory = rows.map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)$/.exec(row);
    if (!match) fail('source_entry_invalid');
    const [, mode, oid, name] = match;
    if (name.startsWith('/') || name.includes('\\') || /[\r\n]/.test(name) ||
        name.split('/').some(part => !part || part === '.' || part === '..') || seen.has(name)) fail('source_path_invalid');
    seen.add(name); return Object.freeze({mode, oid, name, excluded: excluded(name)});
  });
  if (!inventory.length || TOOL_REQUIRED_FILES.some(name => !seen.has(name))) fail('source_incomplete');
  return Object.freeze(inventory);
}

function validateTarget(plan, git) {
  if (text(git(plan.app, ['rev-parse', 'origin/main'])).trim() !== plan.target ||
      text(git(plan.app, ['rev-parse', `${plan.target}^{commit}`])).trim() !== plan.target) fail('target_not_main');
}
export function verifyOnlineReleaseTool(plan, {git = runOnlineToolGit, checkPath = assertOnlineToolOwnedPath} = {}) {
  const expected = createOnlineReleaseToolPlan(plan.target, {app: plan.app, toolRoot: plan.toolRoot});
  if (JSON.stringify(plan) !== JSON.stringify(expected)) fail('plan_changed');
  checkPath(plan.app); checkPath(plan.toolRoot); checkPath(plan.directory);
  validateTarget(plan, git);
  if (text(git(plan.directory, ['rev-parse', 'HEAD'])).trim() !== plan.target) fail('source_head_changed');
  if (path.resolve(text(git(plan.directory, ['rev-parse', '--show-toplevel'])).trim()) !== plan.directory) fail('source_directory_changed');
  if (text(git(plan.directory, ['status', '--porcelain=v1', '--untracked-files=all'])).trim()) fail('source_dirty');
  // An unborn/symbolic HEAD is not a detached immutable tool checkout.
  const head = path.resolve(plan.directory, text(git(plan.directory, ['rev-parse', '--git-path', 'HEAD'])).trim());
  checkPath(head, 'file');
  if (fs.readFileSync(head, 'utf8').trim() !== plan.target) fail('head_not_detached');
  for (const [name, expectedValue] of [['core.sparseCheckout', 'true'], ['core.sparseCheckoutCone', 'false'], ['index.sparse', 'false']]) {
    if (text(git(plan.directory, ['config', '--worktree', '--get', name])).trim() !== expectedValue) fail('sparse_config_changed');
  }
  const patternFile = path.resolve(plan.directory, text(git(plan.directory, ['rev-parse', '--git-path', 'info/sparse-checkout'])).trim());
  checkPath(patternFile, 'file');
  if (fs.readFileSync(patternFile, 'utf8') !== TOOL_SPARSE_PATTERNS || exists(path.join(plan.directory, 'public/downloads'))) fail('sparse_patterns_changed');
  const inventory = readOnlineToolInventory(plan, git);
  const indexed = text(git(plan.directory, ['ls-files', '-t', '-z'])).split('\0').filter(Boolean);
  const expectedIndex = inventory.map(item => `${item.excluded ? 'S' : 'H'} ${item.name}`).sort();
  if (JSON.stringify(indexed.sort()) !== JSON.stringify(expectedIndex)) fail('index_changed');
  for (const item of inventory) {
    if (item.excluded) continue;
    const file = path.join(plan.directory, ...item.name.split('/')); checkPath(file, 'file');
    if (blobId(fs.readFileSync(file)) !== item.oid) fail('source_blob_changed');
  }
  // Ignored artifacts can hide from git status. A source-only tool may contain
  // exactly tracked files/directories and the worktree's .git pointer.
  const allowed = new Set(['.git']);
  for (const {name, excluded: skip} of inventory) if (!skip) {
    const parts = name.split('/'); while (parts.length) {allowed.add(parts.join('/')); parts.pop();}
  }
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const name = prefix + entry.name;
      if (!allowed.has(name) || entry.isSymbolicLink()) fail('unexpected_tool_entry');
      const file = path.join(directory, entry.name);
      checkPath(file, entry.isDirectory() ? 'directory' : 'file');
      if (entry.isDirectory()) walk(file, name + '/');
    }
  }
  walk(plan.directory);
  validateTarget(plan, git);
  return Object.freeze({version: 1, target: plan.target, directory: plan.directory, sourceFiles: inventory.filter(item => !item.excluded).length,
    excludedFiles: inventory.filter(item => item.excluded).length, inventorySha256: sha256(JSON.stringify(inventory)), verified: true});
}

export function executeOnlineReleaseToolPlan(plan, ports = {}) {
  const {git = runOnlineToolGit, checkPath = assertOnlineToolOwnedPath} = ports;
  const expected = createOnlineReleaseToolPlan(plan.target, {app: plan.app, toolRoot: plan.toolRoot});
  if (JSON.stringify(plan) !== JSON.stringify(expected)) fail('plan_changed');
  checkPath(plan.app); checkPath(plan.toolRoot); validateTarget(plan, git);
  readOnlineToolInventory(plan, git); // Reject links/submodules before checkout.
  if (exists(plan.directory)) return {...verifyOnlineReleaseTool(plan, ports), created: false};
  // No force/reset/repair and no deletion on failure. An incomplete checkout is
  // evidence and subsequent calls must verify it, never overwrite it.
  git(plan.app, ['worktree', 'add', '--detach', '--no-checkout', plan.directory, plan.target]);
  checkPath(plan.directory);
  // Git 2.27 has sparse-checkout but predates the --no-sparse-index option.
  git(plan.directory, ['-c', 'index.sparse=false', 'sparse-checkout', 'set', '--no-cone', '--stdin'], TOOL_SPARSE_PATTERNS);
  // That version also leaves --no-cone implicit; persist it for strict verify.
  git(plan.directory, ['config', '--worktree', 'core.sparseCheckoutCone', 'false']);
  git(plan.directory, ['config', '--worktree', 'index.sparse', 'false']);
  // --no-checkout starts with an empty index. Materialize HEAD only after the
  // exclusion is installed; never populate downloads even transiently.
  git(plan.directory, ['read-tree', '-mu', 'HEAD']);
  return {...verifyOnlineReleaseTool(plan, ports), created: true};
}

export function assertOnlineToolNoPending({maintenance = MAINTENANCE, releaseRoot = RELEASE_ROOT} = {}, checkPath = assertOnlineToolOwnedPath) {
  checkPath(maintenance);
  const statePath = path.join(maintenance, 'state.json'); checkPath(statePath, 'file');
  if (JSON.parse(fs.readFileSync(statePath, 'utf8')).phase !== 'ended') fail('maintenance_not_ended');
  checkPath(releaseRoot);
  for (const name of fs.readdirSync(releaseRoot)) {
    if (name === 'active.json') {checkPath(path.join(releaseRoot, name), 'file'); continue;}
    if (!SHA.test(name)) fail('release_entry_invalid');
    const directory = path.join(releaseRoot, name); checkPath(directory);
    const state = path.join(directory, 'state.json'); checkPath(state, 'file');
    const stateText = fs.readFileSync(state, 'utf8'), value = JSON.parse(stateText);
    if (value.target !== name) fail('release_pending');
    if (['active', 'rolled-back'].includes(value.status)) continue;
    const environmentCase = name === UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT.target;
    const incident = environmentCase ? UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT : UNPUBLISHED_CANDIDATE_INCIDENT;
    const retainedPaths = environmentCase ? UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_FILES : UNPUBLISHED_CANDIDATE_PRESERVED_FILES;
    const absentPaths = environmentCase ? UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS : UNPUBLISHED_CANDIDATE_ABSENT_PATHS;
    const receiptPath = path.join(directory, 'unpublished-termination.json');
    if (name !== incident.target || directory !== incident.operation || value.status !== 'preparing' || !exists(receiptPath)) fail('release_pending');
    checkPath(receiptPath, 'file'); checkPath(incident.directory);
    for (const [full, mode] of [[directory, 0o700], [state, 0o600], [receiptPath, 0o600]])
      if ((fs.lstatSync(full).mode & 0o777) !== mode) fail('unsafe_path');
    const preservedFiles = {};
    for (const [key, full] of Object.entries(retainedPaths)) {
      checkPath(full, 'file'); if ((fs.lstatSync(full).mode & 0o777) !== 0o600) fail('unsafe_path');
      preservedFiles[key] = sha256(fs.readFileSync(full));
    }
    for (const full of absentPaths) if (exists(full)) fail('release_pending');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (environmentCase) {
      checkPath(incident.buildSource, 'file');
      assertUnpublishedBuildEnvironmentTerminationReceipt({stateText, receipt, preservedFiles, absentPaths: [...absentPaths],
        preservedDirectories: readUnpublishedBuildEnvironmentDirectories(fs, checkPath), buildSourceSha256: sha256(fs.readFileSync(incident.buildSource))});
    } else assertUnpublishedCandidateTerminationReceipt({stateText, receipt, preservedFiles, absentPaths: [...absentPaths]});
  }
}

export function withOnlineToolPreparationLocks({deployLock, maintenance}, work, {
  checkPath = assertOnlineToolOwnedPath, spawn = spawnSync,
} = {}) {
  checkPath(path.dirname(deployLock)); checkPath(maintenance);
  if (exists(deployLock)) checkPath(deployLock, 'file');
  const fd = fs.openSync(deployLock, fs.constants.O_RDWR | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  const operation = path.join(maintenance, 'operation.lock'); let held = false, identity;
  try {
    checkPath(deployLock, 'file');
    const opened = fs.fstatSync(fd), onDisk = fs.lstatSync(deployLock);
    if (opened.dev !== onDisk.dev || opened.ino !== onDisk.ino) fail('deploy_lock_changed');
    // flock(2) locks the shared open-file description. FD 3 is inherited from
    // this still-open parent FD, so the lock remains held after flock exits.
    const locked = spawn('flock', ['--nonblock', '3'], {stdio: ['ignore', 'pipe', 'pipe', fd], env: gitEnvironment(), timeout: 10000});
    if (locked.status !== 0 || locked.signal || locked.error) fail('deploy_lock_busy');
    fs.mkdirSync(operation, {mode: 0o700}); held = true; checkPath(operation);
    identity = fs.lstatSync(operation);
    return work();
  } finally {
    try {
      if (held) {
        checkPath(operation); const actual = fs.lstatSync(operation);
        if (!identity || actual.dev !== identity.dev || actual.ino !== identity.ino) fail('operation_lock_changed');
        fs.rmdirSync(operation); // Only the empty directory this call created.
      }
    } finally {fs.closeSync(fd);}
  }
}

export function verifyOnlineToolBootstrap(plan, self = fileURLToPath(import.meta.url), ports = {}) {
  const {git = runOnlineToolGit, checkPath = assertOnlineToolOwnedPath} = ports;
  checkPath(plan.app); checkPath(self, 'file'); validateTarget(plan, git);
  const repository = path.resolve(text(git(path.dirname(self), ['rev-parse', '--show-toplevel'])).trim());
  checkPath(repository);
  const sourceHead = text(git(repository, ['rev-parse', 'HEAD'])).trim();
  if (path.join(repository, SELF) !== self || sourceHead.length !== 40 || !SHA.test(sourceHead) ||
      text(git(repository, ['status', '--porcelain=v1', '--untracked-files=all'])).trim() ||
      !fs.readFileSync(self).equals(Buffer.from(git(plan.app, ['show', `${plan.target}:${SELF}`])))) fail('bootstrap_source_changed');
  // The helper imports only Node builtins. An unchanged, target-verified copy
  // from a clean known ancestor can prepare the next tool without first
  // needing that tool to exist. Changed helper bytes still require bootstrap.
  git(plan.app, ['merge-base', '--is-ancestor', sourceHead, plan.target]);
}

export function prepareOnlineReleaseToolMain(args = process.argv.slice(2)) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || args.length !== 1) fail('invocation_invalid');
  const plan = createOnlineReleaseToolPlan(args[0]);
  verifyOnlineToolBootstrap(plan);
  return withOnlineToolPreparationLocks({deployLock: `${APP}.deploy.lock`, maintenance: MAINTENANCE}, () => {
    verifyOnlineToolBootstrap(plan); assertOnlineToolNoPending();
    if (!exists(TOOL_ROOT)) {assertOnlineToolOwnedPath(path.dirname(TOOL_ROOT)); fs.mkdirSync(TOOL_ROOT, {mode: 0o700});}
    const previousUmask = process.umask(0o077);
    try {return executeOnlineReleaseToolPlan(plan);} finally {process.umask(previousUmask);}
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const prepared = prepareOnlineReleaseToolMain();
    // Preparation's exported synchronous contract is unchanged. Only the CLI
    // runs bounded housekeeping from the newly verified target checkout. The
    // old bootstrap may still be executing and is explicitly protected.
    const bootstrapDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    import(`file://${prepared.directory}/scripts/online-release-tool-retention.mjs`)
      .then(module => module.runOnlineReleaseToolRetention({target: prepared.target, bootstrapDirectory}))
      .then(toolRetention => console.log(JSON.stringify({...prepared, toolRetention})))
      .catch(() => console.log(JSON.stringify({...prepared,
        toolRetention: {status: 'pending', reason: 'online_tool_retention_module_unavailable'}})));
  }
  catch (error) {console.error(error.message); process.exitCode = 1;}
}
