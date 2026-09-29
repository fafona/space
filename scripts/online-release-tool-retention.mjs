// A bounded post-preparation housekeeping operation, not an application release.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {assertOnlineToolOwnedPath, createOnlineReleaseToolPlan, readOnlineToolInventory,
  runOnlineToolGit, verifyOnlineReleaseTool, TOOL_SPARSE_PATTERNS,
  withOnlineToolPreparationLocks, assertOnlineToolNoPending} from './prepare-online-release-tool.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES, WEB_RELEASE_PROXY, WEB_RELEASE_MARKER} from './web-presentation-release-policy.mjs';

const APP = '/www/wwwroot/merchant-space', ROOT = '/var/lib/faolla-online-code';
const AUDIT = '/var/lib/faolla-online-tool-retention', MAINTENANCE = '/var/lib/faolla-maintenance/merchant-space';
const ARTIFACT_AUDIT = '/var/lib/faolla-online-artifact-reclaim';
const SHA = /^[a-f0-9]{40}$/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const validRevision = value => typeof value === 'string' && value.length === 40 && SHA.test(value);
const MAX_TOOLS = 32, MAX_JSON = 32 * 1024 * 1024;
const fail = reason => {throw Error(`online_tool_retention_${reason}`);};
const check = (yes, reason) => {if (!yes) fail(reason);};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value) + '\n';
const text = value => Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
const equal = (a, b, reason) => check(isDeepStrictEqual(a, b), reason);
const under = (p, root) => p === root || p.startsWith(root === '/' ? '/' : root + '/');
const directoryFor = revision => `${ROOT}/${revision}`;
const own = assertOnlineToolOwnedPath;

/** An ancestry order comes from Git, never mtimes or lexicographic SHA order.
 * Executing checkouts are additional protection, not permission to exceed the
 * window silently. At most one older eligible source-only tool is selected. */
export function selectOnlineToolRetention({target, revisions, ancestorOrder, executingDirectories = []}) {
  check(validRevision(target) && Array.isArray(revisions) && revisions.length <= MAX_TOOLS &&
    revisions.every(validRevision) && new Set(revisions).size === revisions.length &&
    revisions.includes(target) && Array.isArray(ancestorOrder) && ancestorOrder[0] === target &&
    ancestorOrder.every(validRevision) && new Set(ancestorOrder).size === ancestorOrder.length &&
    revisions.every(s => ancestorOrder.includes(s)) && Array.isArray(executingDirectories) &&
    executingDirectories.every(s => typeof s === 'string' && !/[\r\n\0]/.test(s) && path.posix.isAbsolute(s) && path.posix.normalize(s) === s), 'selection_invalid');
  const ordered = ancestorOrder.filter(s => revisions.includes(s));
  const keep = ordered.slice(0, 2), excess = ordered.slice(2);
  const candidates = [...excess].reverse().filter(s => !executingDirectories.some(p =>
    under(p, directoryFor(s)) || under(directoryFor(s), p)));
  return {keep, victim: candidates[0] ?? null, remainingExcess: excess.length,
    status: excess.length ? (candidates.length ? 'candidate' : 'pending') : 'within-window'};
}

/** Historical verification is separate from verifyOnlineReleaseTool: the latter
 * intentionally still requires target === origin/main. No production override
 * relaxes that contract. Paths/Git injection below support isolated fixtures. */
export function verifyHistoricalOnlineTool(plan, currentRevision, {git = runOnlineToolGit, checkPath = own} = {}) {
  equal(plan, createOnlineReleaseToolPlan(plan.target, {app: plan.app, toolRoot: plan.toolRoot}), 'historical_plan_changed');
  check(validRevision(currentRevision) && currentRevision !== plan.target, 'historical_revision_invalid');
  for (const p of [plan.app, plan.toolRoot, plan.directory]) checkPath(p);
  check(text(git(plan.app, ['rev-parse', 'origin/main'])).trim() === currentRevision, 'main_changed');
  git(plan.app, ['merge-base', '--is-ancestor', plan.target, currentRevision]);
  check(text(git(plan.directory, ['rev-parse', 'HEAD'])).trim() === plan.target &&
    path.resolve(text(git(plan.directory, ['rev-parse', '--show-toplevel'])).trim()) === plan.directory, 'historical_head_changed');
  check(!text(git(plan.directory, ['status', '--porcelain=v1', '--untracked-files=all'])).trim(), 'historical_dirty');
  const registration = `worktree ${plan.directory}\nHEAD ${plan.target}\ndetached\n`;
  const registrations = text(git(plan.app, ['worktree', 'list', '--porcelain'])).replaceAll('\r\n', '\n').split('\n\n')
    .map(row => row.replace(/^worktree ([^\n]+)/, (_match, p) => `worktree ${path.resolve(p)}`));
  check(registrations.filter(row => row + '\n' === registration || row === registration).length === 1, 'historical_registration_changed');
  const headPath = path.resolve(plan.directory, text(git(plan.directory, ['rev-parse', '--git-path', 'HEAD'])).trim());
  checkPath(headPath, 'file'); check(fs.readFileSync(headPath, 'utf8').trim() === plan.target, 'historical_not_detached');
  for (const [key, value] of [['core.sparseCheckout', 'true'], ['core.sparseCheckoutCone', 'false'], ['index.sparse', 'false']])
    check(text(git(plan.directory, ['config', '--worktree', '--get', key])).trim() === value, 'historical_sparse_changed');
  const pattern = path.resolve(plan.directory, text(git(plan.directory, ['rev-parse', '--git-path', 'info/sparse-checkout'])).trim());
  checkPath(pattern, 'file'); check(fs.readFileSync(pattern, 'utf8') === TOOL_SPARSE_PATTERNS, 'historical_sparse_changed');
  const inventory = readOnlineToolInventory(plan, git), allowed = new Set(['.git']);
  equal(text(git(plan.directory, ['ls-files', '-t', '-z'])).split('\0').filter(Boolean).sort(),
    inventory.map(f => `${f.excluded ? 'S' : 'H'} ${f.name}`).sort(), 'historical_index_changed');
  for (const f of inventory) if (!f.excluded) {
    const location = path.join(plan.directory, ...f.name.split('/')); checkPath(location, 'file');
    const bytes = fs.readFileSync(location);
    check(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === f.oid, 'historical_blob_changed');
    const parts = f.name.split('/'); while (parts.length) {allowed.add(parts.join('/')); parts.pop();}
  }
  function walk(p, prefix = '') {
    for (const e of fs.readdirSync(p, {withFileTypes: true})) {
      const relative = prefix + e.name;
      check(allowed.has(relative) && !e.isSymbolicLink() && (e.isDirectory() || e.isFile()), 'historical_extra_entry');
      checkPath(path.join(p, e.name), e.isDirectory() ? 'directory' : 'file');
      if (e.isDirectory()) walk(path.join(p, e.name), relative + '/');
    }
  }
  walk(plan.directory);
  const st = fs.lstatSync(plan.directory);
  return {revision: plan.target, directory: plan.directory, dev: st.dev, ino: st.ino,
    sourceTree: text(git(plan.app, ['rev-parse', `${plan.target}^{tree}`])).trim(),
    inventorySha256: hash(canonical(inventory)), sourceFiles: inventory.filter(f => !f.excluded).length};
}

/** Exceptions after preparation are persistent pending work, not automatic retry.
 * Host ports must check references again immediately before their remove call. */
export function executeOnlineToolRetention(plan, operations) {
  equal(operations.observeBefore(), plan.before, 'observation_changed');
  operations.begin(plan);
  try {
    equal(operations.observeBefore(), plan.before, 'observation_changed');
    operations.remove(plan.victim);
    const after = operations.observeAfter();
    operations.removed(plan, after);
    operations.complete(plan, after);
    return {status: 'completed', kept: plan.keep, removed: plan.victim.revision,
      remainingExcess: plan.remainingExcess - 1};
  } catch (error) {
    operations.failed(error);
    throw error;
  }
}

/** OS scheduler packages may legitimately install root:root 0664 files. This
 * is a read-only metadata policy, never the tool/candidate/audit owner policy. */
export function readOnlineToolReferenceConfig(filename, {io = fs, maxBytes = 4 * 1024 * 1024} = {}) {
  check(typeof filename === 'string' && path.isAbsolute(filename) && path.resolve(filename) === filename &&
    !/[\r\n\0]/.test(filename), 'configuration_path_invalid');
  const identity = s => ({dev: s.dev, ino: s.ino, mode: s.mode, uid: s.uid, gid: s.gid,
    nlink: s.nlink, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs});
  let initial;
  for (let p = filename; ; p = path.dirname(p)) {
    const s = io.lstatSync(p);
    check(!s.isSymbolicLink() && (p === filename ? s.isFile() : s.isDirectory()) &&
      s.uid === 0 && !(s.mode & 0o002) && (!(s.mode & 0o020) || s.gid === 0) &&
      io.realpathSync(p) === p, 'configuration_path_unsafe');
    if (p === filename) {check(s.size <= maxBytes, 'configuration_too_large'); initial = identity(s);}
    if (path.dirname(p) === p) break;
  }
  const fd = io.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    equal(identity(io.fstatSync(fd)), initial, 'configuration_changed');
    const bytes = io.readFileSync(fd);
    equal(identity(io.fstatSync(fd)), initial, 'configuration_changed');
    equal(identity(io.lstatSync(filename)), initial, 'configuration_changed');
    check(bytes.length === initial.size, 'configuration_changed'); return bytes;
  } finally {io.closeSync(fd);}
}

/** An incomplete application-artifact cleanup keeps the tool whose implementation
 * wrote its plan. A completed receipt must bind the same context before release. */
export function assertArtifactAttemptNotReferencing({prepared, completed = null, failed = false}, revision) {
  check(prepared?.version === 1 && validRevision(prepared.toolRevision) && prepared.context &&
    validRevision(prepared.context.activeTarget) && validRevision(prepared.context.victim?.target), 'artifact_plan_invalid');
  if (completed !== null) {
    check(completed.version === 1 && completed.context, 'artifact_completion_invalid');
    equal(completed.context, prepared.context, 'artifact_completion_invalid');
  }
  if (failed || completed === null) check(prepared.toolRevision !== revision, 'artifact_tool_referenced');
}

function run(command, args) {
  const r = spawnSync(command, args, {encoding: 'utf8', timeout: 20000, maxBuffer: MAX_JSON,
    env: {...process.env, PM2_HOME: '/root/.pm2'}, windowsHide: true});
  check(r.status === 0 && !r.error && !r.signal, 'observation_command_failed'); return r.stdout;
}
function readOwned(filename, limit = MAX_JSON) {
  own(filename, 'file'); const stat = fs.lstatSync(filename);
  check(stat.size <= limit, 'metadata_too_large'); return fs.readFileSync(filename);
}
function writePrivate(filename, value) {
  own(path.dirname(filename));
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {fs.writeFileSync(fd, value); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  const parent = fs.openSync(path.dirname(filename), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {fs.fsyncSync(parent);} finally {fs.closeSync(parent);}
}
function disk() {const s = fs.statfsSync('/var/lib'); return {used: (s.blocks - s.bfree) * s.bsize, available: s.bavail * s.bsize};}
function worktrees() {return text(runOnlineToolGit(APP, ['worktree', 'list', '--porcelain'])).trim().split('\n\n').sort();}
function assertAuditComplete() {
  if (!fs.existsSync(AUDIT)) return;
  own(AUDIT); check((fs.statSync(AUDIT).mode & 0o777) === 0o700, 'audit_not_private');
  const names = fs.readdirSync(AUDIT); check(names.length <= 4096, 'audit_review_required');
  for (const name of names) {
    check(UUID.test(name), 'audit_entry_unknown'); const p = `${AUDIT}/${name}`; own(p);
    check((fs.statSync(p).mode & 0o777) === 0o700, 'audit_not_private');
    equal(fs.readdirSync(p).sort(), ['completed.json', 'plan.json', 'prepared.json', 'removed.json'], 'unfinished_attempt');
    for (const name of fs.readdirSync(p)) check((fs.statSync(`${p}/${name}`).mode & 0o777) === 0o600, 'audit_not_private');
    const rawPlan = readOwned(`${p}/plan.json`), rawPrepared = readOwned(`${p}/prepared.json`), rawRemoved = readOwned(`${p}/removed.json`);
    const completed = JSON.parse(readOwned(`${p}/completed.json`));
    check(completed.version === 1 && completed.planSha256 === hash(rawPlan) && completed.preparedSha256 === hash(rawPrepared) &&
      completed.removedSha256 === hash(rawRemoved), 'audit_proof_changed');
  }
}
function pm2() {
  const pid = readOwned('/root/.pm2/pm2.pid').toString().trim();
  check(/^[1-9][0-9]*$/.test(pid), 'daemon_missing');
  const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0+$/, '');
  check(command === 'PM2 v6.0.14: God Daemon (/root/.pm2)', 'daemon_changed');
  const rows = JSON.parse(run('pm2', ['jlist']));
  check(readOwned('/root/.pm2/pm2.pid').toString().trim() === pid, 'daemon_changed'); return rows;
}
function protectedFacts() {
  assertOnlineToolNoPending(); const history = readOnlineRetentionHistory();
  const files = ['/var/lib/faolla-online-release/active.json', `${MAINTENANCE}/state.json`,
    '/root/.pm2/dump.pm2', '/root/.pm2/dump.pm2.bak', WEB_RELEASE_MARKER,
    ...WEB_RELEASE_FILES.map(name => `${WEB_RELEASE_PROXY}/${name}`)];
  return {files: Object.fromEntries(files.map(p => [p, hash(readOwned(p))])), retentionHead: history.headSha256,
    processes: pm2().map(normalizeRetirementProcess).sort((a, b) => a.pmId - b.pmId)};
}

/** Bounded metadata and process checks only. Never walks app/node_modules trees.
 * References and unknown layouts block deletion; no secret text is returned. */
function assertUnreferenced(directory, revision) {
  const referenceMetadata = [];
  const mentions = (bytes, allowRevision = false) => {
    const value = text(bytes); check(!value.includes(directory) && !(allowRevision && value.includes(revision)), 'tool_referenced');
  };
  for (const pid of fs.readdirSync('/proc').filter(n => /^[1-9][0-9]*$/.test(n))) {
    try {
      const command = fs.readFileSync(`/proc/${pid}/cmdline`); mentions(command);
      for (const name of ['environ', 'maps']) mentions(fs.readFileSync(`/proc/${pid}/${name}`));
      for (const name of ['cwd', 'exe']) {
        try {mentions(fs.readlinkSync(`/proc/${pid}/${name}`));}
        catch (error) {
          // Kernel threads/zombies have no command or executable. Still inspect
          // their maps/environment/descriptors; never skip a live user process
          // merely because its current directory was unlinked concurrently.
          if (!['ENOENT', 'ESRCH'].includes(error.code) || command.length) throw error;
        }
      }
      for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
        try {mentions(fs.readlinkSync(`/proc/${pid}/fd/${fd}`));}
        catch (error) {if (!['ENOENT', 'ESRCH', 'EINVAL'].includes(error.code)) throw error;}
      }
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
      check(!fs.existsSync(`/proc/${pid}`), 'process_observation_incomplete');
    }
  }
  mentions(fs.readFileSync('/proc/self/mountinfo'));
  mentions(canonical(pm2()));
  for (const p of ['/root/.pm2/dump.pm2', '/root/.pm2/dump.pm2.bak']) {
    const bytes = readOwned(p); check(Array.isArray(JSON.parse(bytes)), 'saved_pm2_invalid'); mentions(bytes);
  }
  let metadataCount = 0, metadataBytes = 0;
  function states(p, depth = 0) {
    check(depth <= 4, 'state_layout_unknown'); own(p);
    for (const e of fs.readdirSync(p, {withFileTypes: true})) {
      check(++metadataCount <= 4096 && !e.isSymbolicLink(), 'state_layout_unknown');
      const file = `${p}/${e.name}`;
      if (e.isDirectory()) states(file, depth + 1);
      else if (e.isFile() && /^(?:state|failed|rejected).*\.json$|failure\.json$/.test(e.name)) {
        const bytes = readOwned(file); metadataBytes += bytes.length; check(metadataBytes <= 64 * 1024 * 1024, 'state_scan_budget');
        referenceMetadata.push([file, hash(bytes)]);
        const value = JSON.parse(bytes);
        if (!['active', 'rolled-back'].includes(value.status) && value.phase !== 'ended') mentions(bytes, true);
      }
    }
  }
  for (const name of fs.readdirSync('/var/lib')) if (/^faolla-(?:online-release|contact-card-release|web-presentation-release(?:-failed-[a-f0-9]+)?|maintenance)$/.test(name)) states(`/var/lib/${name}`);
  if (fs.existsSync(ARTIFACT_AUDIT)) {
    own(ARTIFACT_AUDIT); const attempts = fs.readdirSync(ARTIFACT_AUDIT);
    check(attempts.length <= 512, 'artifact_audit_review_required');
    for (const name of attempts) {
      check(/^[a-f0-9]{40}-[a-f0-9]{40}$/.test(name) && name.length === 81, 'artifact_audit_unknown');
      const root = `${ARTIFACT_AUDIT}/${name}`; own(root);
      const entries = fs.readdirSync(root);
      check(entries.every(n => ['prepared.json', 'original-dump.pm2', 'original-dump.pm2.bak',
        'backup-verified.json', 'completed.json', 'failed.json'].includes(n)), 'artifact_audit_unknown');
      const bytes = readOwned(`${root}/prepared.json`), prepared = JSON.parse(bytes);
      check(name === `${prepared.context?.activeTarget}-${prepared.context?.victim?.target}`, 'artifact_plan_invalid');
      const completedBytes = entries.includes('completed.json') ? readOwned(`${root}/completed.json`) : null;
      assertArtifactAttemptNotReferencing({prepared, completed: completedBytes ? JSON.parse(completedBytes) : null,
        failed: entries.includes('failed.json')}, revision);
      referenceMetadata.push([root, hash(bytes), completedBytes ? hash(completedBytes) : null, entries.includes('failed.json')]);
    }
  }
  let configCount = 0, configBytes = 0; const seen = new Set();
  function config(p, depth = 0) {
    check(depth <= 8, 'configuration_layout_unknown');
    if (!fs.existsSync(p)) return;
    const real = fs.realpathSync(p); if (real === '/dev/null' || seen.has(real)) return; seen.add(real);
    check(++configCount <= 8192, 'configuration_scan_budget'); const stat = fs.statSync(real);
    if (stat.isDirectory()) for (const name of fs.readdirSync(real)) config(`${real}/${name}`, depth + 1);
    else {check(stat.isFile(), 'configuration_type_unknown'); const bytes = readOnlineToolReferenceConfig(real);
      configBytes += bytes.length; check(configBytes <= 32 * 1024 * 1024, 'configuration_scan_budget');
      referenceMetadata.push([real, hash(bytes)]); mentions(bytes);}
  }
  for (const p of ['/etc/systemd/system', '/run/systemd/system', '/usr/lib/systemd/system', '/etc/crontab', '/etc/rc.local',
    '/etc/cron.d', '/etc/cron.hourly', '/etc/cron.daily', '/etc/cron.weekly', '/etc/cron.monthly', '/var/spool/cron',
    '/www/server/panel/vhost/nginx']) config(p);
  const containers = run('docker', ['ps', '-aq']).trim().split(/\s+/).filter(Boolean);
  check(containers.length <= 128 && containers.every(id => /^[a-f0-9]{12,64}$/.test(id)), 'containers_unknown');
  if (containers.length) mentions(run('docker', ['inspect', '--format',
    '{{json .Mounts}} {{json .Config.Env}} {{json .Config.Cmd}} {{json .Config.Entrypoint}} {{json .Config.Labels}}', ...containers]));
  const roots = [APP, `${APP}.shared`, `${APP}.releases`, `${APP}.route-releases`, `${APP}.web-releases`, ROOT];
  const links = [`${APP}.current`, `${APP}/.next/static`, `${APP}/node_modules`];
  for (const root of roots) {
    own(root); const entries = fs.readdirSync(root, {withFileTypes: true}); check(entries.length <= 4096, 'link_scan_budget');
    for (const e of entries) if (e.isSymbolicLink()) links.push(`${root}/${e.name}`);
  }
  for (const p of links) {
    if (fs.lstatSync(p).isSymbolicLink()) mentions(fs.readlinkSync(p));
    mentions(fs.realpathSync(p));
  }
  return {referenceMetadataSha256: hash(canonical(referenceMetadata.sort((a, b) => a[0].localeCompare(b[0])))),
    stateEntries: metadataCount, schedulerEntries: configCount};
}

export function runOnlineReleaseToolRetention({target, bootstrapDirectory}) {
  const pending = error => ({status: 'pending', reason: /^online_tool_retention_[a-z0-9_]+$/.test(error?.message ?? '')
    ? error.message : 'online_tool_retention_check_failed'});
  try {
    check(process.platform === 'linux' && process.getuid?.() === 0 && SHA.test(target ?? ''), 'invocation_invalid');
    const current = createOnlineReleaseToolPlan(target);
    check(path.dirname(path.dirname(fileURLToPath(import.meta.url))) === current.directory, 'module_source_invalid');
    return withOnlineToolPreparationLocks({deployLock: `${APP}.deploy.lock`, maintenance: MAINTENANCE}, () => {
      assertOnlineToolNoPending(); verifyOnlineReleaseTool(current); assertAuditComplete();
      const entries = fs.readdirSync(ROOT, {withFileTypes: true});
      check(entries.length <= MAX_TOOLS && entries.every(e => e.isDirectory() && !e.isSymbolicLink() && SHA.test(e.name)), 'tool_root_unknown');
      const ancestry = text(runOnlineToolGit(APP, ['rev-list', '--topo-order', target])).trim().split('\n');
      const execution = [current.directory, process.cwd(), ...(bootstrapDirectory ? [bootstrapDirectory] : [])];
      if (process.argv[1]) execution.push(path.dirname(path.dirname(path.resolve(process.argv[1]))));
      const selection = selectOnlineToolRetention({target, revisions: entries.map(e => e.name), ancestorOrder: ancestry, executingDirectories: execution});
      for (const revision of selection.keep.slice(1)) verifyHistoricalOnlineTool(createOnlineReleaseToolPlan(revision), target);
      if (!selection.victim) return {...selection, removed: null};
      const victimPlan = createOnlineReleaseToolPlan(selection.victim);
      const inspect = () => {
        verifyOnlineReleaseTool(current);
        const victim = verifyHistoricalOnlineTool(victimPlan, target);
        const references = assertUnreferenced(victim.directory, victim.revision);
        return {victim, worktrees: worktrees(), protected: protectedFacts(), references};
      };
      const before = inspect();
      const plan = {version: 1, kind: 'source-only-tool-retention', target, keep: selection.keep,
        victim: before.victim, remainingExcess: selection.remainingExcess, before};
      let attempt, planBytes, preparedBytes, removedBytes, beforeDisk;
      return executeOnlineToolRetention(plan, {
        observeBefore: inspect,
        begin: value => {
          if (!fs.existsSync(AUDIT)) {own(path.dirname(AUDIT)); fs.mkdirSync(AUDIT, {mode: 0o700});}
          assertAuditComplete(); attempt = `${AUDIT}/${randomUUID()}`; fs.mkdirSync(attempt, {mode: 0o700});
          planBytes = canonical(value); writePrivate(`${attempt}/plan.json`, planBytes); beforeDisk = disk();
          preparedBytes = canonical({version: 1, planSha256: hash(planBytes), beforeDisk, at: new Date().toISOString()});
          writePrivate(`${attempt}/prepared.json`, preparedBytes);
        },
        remove: victim => {
          equal(assertUnreferenced(victim.directory, victim.revision), before.references, 'reference_metadata_changed');
          equal(verifyHistoricalOnlineTool(victimPlan, target), victim, 'victim_changed');
          runOnlineToolGit(APP, ['worktree', 'remove', victim.directory]);
        },
        observeAfter: () => {
          check(!fs.existsSync(victimPlan.directory), 'victim_still_present'); verifyOnlineReleaseTool(current);
          const expected = before.worktrees.filter(row => !row.startsWith(`worktree ${victimPlan.directory}\n`));
          check(expected.length === before.worktrees.length - 1, 'worktree_count_changed'); equal(worktrees(), expected, 'other_worktrees_changed');
          const facts = protectedFacts(); equal(facts, before.protected, 'protected_state_changed'); return {protected: facts, disk: disk()};
        },
        removed: (value, after) => {
          removedBytes = canonical({version: 1, planSha256: hash(planBytes), revision: value.victim.revision,
            directory: value.victim.directory, sourceTree: value.victim.sourceTree, afterDisk: after.disk,
            recovery: 'Recreate the exact source-only sparse Git worktree; no runtime or business files removed.', at: new Date().toISOString()});
          writePrivate(`${attempt}/removed.json`, removedBytes);
        },
        complete: (_value, after) => writePrivate(`${attempt}/completed.json`, canonical({version: 1,
          planSha256: hash(planBytes), preparedSha256: hash(preparedBytes), removedSha256: hash(removedBytes),
          beforeDisk, afterDisk: after.disk, netAvailableIncrease: after.disk.available - beforeDisk.available, at: new Date().toISOString()})),
        failed: error => {if (attempt) writePrivate(`${attempt}/failed.json`, canonical({version: 1,
          reason: pending(error).reason, candidate: selection.victim, at: new Date().toISOString()}));},
      });
    });
  } catch (error) {return pending(error);}
}
