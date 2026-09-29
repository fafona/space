import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {captureRetiredArtifactTree, applyRetiredArtifactTree} from './online-release-artifact-tree.mjs';

const canonical = filename => path.resolve(filename).replaceAll('\\', '/');
function fixture(t) {
  const parent = canonical(fs.realpathSync(os.tmpdir()));
  const root = canonical(fs.mkdtempSync(path.join(parent, 'faolla-artifact-tree-test-')));
  const app = root + '/merchant-space', shared = app + '.shared/.runtime';
  fs.mkdirSync(app); fs.mkdirSync(shared, {recursive: true});
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, {GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0'});
  const git = (cwd, args, input) => execFileSync('git', ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
    '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-C', cwd, ...args],
  {encoding: 'utf8', env, input, windowsHide: true, timeout: 15000, stdio: ['pipe', 'pipe', 'pipe']});
  const write = (directory, name, bytes) => { const filename = directory + '/' + name; fs.mkdirSync(path.dirname(filename), {recursive: true}); fs.writeFileSync(filename, bytes); };
  const sources = {
    '.gitignore': '/.env.local\n/.next/\n/.runtime\n/next-env.d.ts\n/node_modules/\n/ignored-extra*\n',
    'package.json': '{"name":"artifact-tree-fixture","private":true}\n',
    'package-lock.json': '{"name":"artifact-tree-fixture","lockfileVersion":3}\n',
    'PROJECT_RULES.md': 'Isolated test only.\n',
    'src/app/page.tsx': 'export default function Page(){ return "test"; }\n',
    'public/binary.dat': Buffer.from([0, 2, 7, 10, 13, 128, 255]),
    'scripts/example.mjs': 'export const example = true;\n',
  };
  git(app, ['init', '--quiet']);
  for (const [name, bytes] of Object.entries(sources)) write(app, name, bytes);
  git(app, ['add', '--', '.']);
  git(app, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture']);
  const target = git(app, ['rev-parse', 'HEAD']).trim();
  git(app, ['update-ref', 'refs/remotes/origin/main', target]);
  const directory = app + '.web-releases/' + target.slice(0, 12) + '-online';
  git(app, ['worktree', 'add', '--quiet', '--detach', directory, target]);
  const preserved = {
    '.env.local': 'FIXTURE_ONLY=preserve\n',
    '.next/static/immutable.js': '/* old immutable asset remains */\n',
    '.next/server/app.js': '/* old runtime remains */\n',
    '.next/BUILD_ID': 'fixture-build\n',
    'next-env.d.ts': '// ignored declaration\n',
  };
  for (const [name, bytes] of Object.entries(preserved)) write(directory, name, bytes);
  write(directory, 'node_modules/package/index.js', 'module.exports = "fixture";\n');
  write(directory, 'node_modules/package/subtree/asset.dat', 'generated\n');
  write(directory, '.next/cache/webpack/fixture.pack', 'rebuildable webpack cache\n');
  write(shared, 'business-record.txt', 'Runtime data must never be traversed or changed.\n');
  fs.symlinkSync(shared, directory + '/.runtime', process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => {
    const real = canonical(fs.realpathSync(root));
    assert.equal(real, root); assert.equal(canonical(path.dirname(real)), parent);
    assert.match(path.basename(real), /^faolla-artifact-tree-test-[A-Za-z0-9]+$/);
    fs.rmSync(real, {recursive: true});
  });
  return {root, app, directory, target, shared, sources, preserved, git, write, ports: {fixture: {root, app}}};
}

test('real Git capture and bounded reclaim preserve static/config/runtime, and source restores exactly', t => {
  const f = fixture(t), rootBefore = fs.lstatSync(f.directory), pointer = fs.readFileSync(f.directory + '/.git');
  const plan = captureRetiredArtifactTree(f.directory, f.target, f.ports);
  assert.equal(plan.source.entries.length, Object.keys(f.sources).length);
  assert.equal(plan.source.reachableFrom, 'origin/main');
  assert.equal(plan.generated.dependencies.entries, 5);
  assert.doesNotMatch(JSON.stringify(plan), /FIXTURE_ONLY|Runtime data must/);
  const result = applyRetiredArtifactTree(JSON.parse(JSON.stringify(plan)), f.ports);
  assert.equal(result.instantRollback, false);
  assert.equal(result.preservedSha256, plan.preserved.sha256);
  assert.ok(result.removedAllocatedBytes > 0);
  assert.equal(fs.lstatSync(f.directory).ino, rootBefore.ino);
  assert.deepEqual(fs.readFileSync(f.directory + '/.git'), pointer);
  assert.equal(fs.existsSync(f.directory + '/node_modules'), false);
  assert.equal(fs.existsSync(f.directory + '/.next/cache/webpack'), false);
  for (const [name, bytes] of Object.entries(f.preserved)) assert.equal(fs.readFileSync(f.directory + '/' + name, 'utf8'), bytes, name);
  assert.equal(fs.realpathSync(f.directory + '/.runtime'), fs.realpathSync(f.shared));
  assert.match(fs.readFileSync(f.shared + '/business-record.txt', 'utf8'), /must never/);
  assert.equal(f.git(f.directory, ['status', '--porcelain=v1']).trim(), '');
  assert.equal(fs.existsSync(f.directory + '/src/app/page.tsx'), false);
  f.git(f.directory, ['sparse-checkout', 'disable']);
  for (const [name, bytes] of Object.entries(f.sources)) assert.deepEqual(fs.readFileSync(f.directory + '/' + name), Buffer.from(bytes), name);
  assert.equal(f.git(f.directory, ['rev-parse', 'HEAD']).trim(), f.target);
});

test('rejects broad roots, siblings, traversal and target mismatch before mutation', t => {
  const f = fixture(t);
  for (const directory of [f.root, f.app, f.app + '.web-releases', f.directory + '/', f.directory + '/..', f.directory + '/node_modules']) {
    assert.throws(() => captureRetiredArtifactTree(directory, f.target, f.ports), /outside_exact_retired_leaf/);
  }
  assert.throws(() => captureRetiredArtifactTree(f.directory, 'a'.repeat(40), f.ports), /outside_exact_retired_leaf/);
  assert.throws(() => captureRetiredArtifactTree(f.directory, 'not-a-sha', f.ports), /invalid_target/);
  assert.ok(fs.existsSync(f.directory + '/node_modules'));
});

test('rejects ignored unknown files and even unknown empty directories', t => {
  const f = fixture(t);
  f.write(f.directory, 'ignored-extra.json', '{"private":"keep"}');
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /unknown_extra_file/);
  fs.unlinkSync(f.directory + '/ignored-extra.json');
  fs.mkdirSync(f.directory + '/ignored-extra-empty');
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /unknown_extra_directory/);
});

test('missing environment recovery material blocks capture without deleting dependencies', t => {
  const f = fixture(t);
  fs.unlinkSync(f.directory + '/.env.local');
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /missing_required_recovery_file:\.env\.local/);
  assert.ok(fs.existsSync(f.directory + '/node_modules/package/index.js'));
});

test('missing build identity blocks capture without deleting static assets', t => {
  const f = fixture(t);
  fs.unlinkSync(f.directory + '/.next/BUILD_ID');
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /missing_required_recovery_file:\.next\/BUILD_ID/);
  assert.ok(fs.existsSync(f.directory + '/node_modules/package/index.js'));
  assert.ok(fs.existsSync(f.directory + '/.next/static/immutable.js'));
});

test('rejects dirty source and source hidden by assume-unchanged', t => {
  const f = fixture(t);
  f.write(f.directory, 'src/app/page.tsx', 'changed');
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /worktree_dirty/);
  f.git(f.directory, ['update-index', '--assume-unchanged', 'src/app/page.tsx']);
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /source_blob_changed/);
});

test('rejects source commit no longer reachable from retained main', t => {
  const f = fixture(t);
  f.git(f.app, ['update-ref', '-d', 'refs/remotes/origin/main']);
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports));
  assert.ok(fs.existsSync(f.directory + '/node_modules'));
});

test('rejects branch-backed worktree rather than detached registered identity', t => {
  const f = fixture(t);
  f.git(f.directory, ['checkout', '--quiet', '-b', 'not-retired']);
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /worktree_registration_changed/);
});

test('external hardlinks are refused; fully internal dependency hardlinks are safely unlinked', t => {
  const f = fixture(t), dependency = f.directory + '/node_modules/package/index.js';
  fs.linkSync(dependency, f.root + '/outside-link');
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /external_hardlink/);
  fs.unlinkSync(f.root + '/outside-link');
  fs.linkSync(dependency, f.directory + '/node_modules/package/internal-link.js');
  const plan = captureRetiredArtifactTree(f.directory, f.target, f.ports);
  applyRetiredArtifactTree(plan, f.ports);
  assert.equal(fs.existsSync(f.directory + '/node_modules'), false);
});

test('refuses external dependency links and a replaced generated root', t => {
  const f = fixture(t), link = f.directory + '/node_modules/outside';
  fs.symlinkSync(f.shared, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /external_generated_symlink/);
  fs.unlinkSync(link);
  fs.renameSync(f.directory + '/node_modules', f.root + '/dependencies');
  fs.symlinkSync(f.root + '/dependencies', f.directory + '/node_modules', process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /unsafe_type|unsafe_directory/);
});

test('internal dependency directory link is unlinked without double-traversing its target', t => {
  const f = fixture(t);
  fs.symlinkSync(f.directory + '/node_modules/package', f.directory + '/node_modules/alias', process.platform === 'win32' ? 'junction' : 'dir');
  const plan = captureRetiredArtifactTree(f.directory, f.target, f.ports);
  applyRetiredArtifactTree(plan, f.ports);
  assert.equal(fs.existsSync(f.directory + '/node_modules'), false);
  assert.ok(fs.existsSync(f.shared + '/business-record.txt'));
});

test('absent webpack cache is accepted without deleting other Next cache files', t => {
  const f = fixture(t);
  fs.unlinkSync(f.directory + '/.next/cache/webpack/fixture.pack');
  fs.rmdirSync(f.directory + '/.next/cache/webpack');
  f.write(f.directory, '.next/cache/images/immutable.webp', 'preserve image cache');
  const plan = captureRetiredArtifactTree(f.directory, f.target, f.ports);
  assert.equal(plan.generated.webpack, null);
  applyRetiredArtifactTree(plan, f.ports);
  assert.equal(fs.readFileSync(f.directory + '/.next/cache/images/immutable.webp', 'utf8'), 'preserve image cache');
});

test('symlinked worktree and copied Git pointer cannot impersonate a registered retired root', t => {
  const f = fixture(t), alternate = f.root + '/renamed';
  fs.renameSync(f.directory, alternate);
  fs.symlinkSync(alternate, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /unsafe_type|unsafe_directory/);
  fs.unlinkSync(f.directory);
  fs.mkdirSync(f.directory);
  fs.copyFileSync(alternate + '/.git', f.directory + '/.git');
  // Identity still lacks every exact tracked file; no copied pointer alone can
  // authorize deletion (even when Git reports the registered destination).
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports));
  assert.ok(fs.existsSync(alternate + '/node_modules/package/index.js'));
});

test('refuses source hardlinks and an unexpected runtime link without following it', t => {
  const f = fixture(t);
  fs.linkSync(f.directory + '/src/app/page.tsx', f.root + '/source-link');
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /external_hardlink/);
  fs.unlinkSync(f.root + '/source-link');
  fs.unlinkSync(f.directory + '/.runtime');
  fs.symlinkSync(f.root, f.directory + '/.runtime', process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /unexpected_runtime_link/);
});

test('apply refuses source, generated and preserved drift before any removal', t => {
  const f = fixture(t), original = captureRetiredArtifactTree(f.directory, f.target, f.ports);
  f.write(f.directory, '.next/static/immutable.js', 'changed asset');
  assert.throws(() => applyRetiredArtifactTree(original, f.ports), /retired_artifact_plan_drift/);
  assert.ok(fs.existsSync(f.directory + '/node_modules/package/index.js'));
  const current = captureRetiredArtifactTree(f.directory, f.target, f.ports);
  f.write(f.directory, 'node_modules/package/index.js', 'changed generated file');
  assert.throws(() => applyRetiredArtifactTree(current, f.ports), /retired_artifact_plan_drift/);
  assert.ok(fs.existsSync(f.directory + '/src/app/page.tsx'));
});

test('partial unlink failure throws, does not sparse source, and original plan cannot be retried', t => {
  const f = fixture(t), plan = captureRetiredArtifactTree(f.directory, f.target, f.ports); let operations = 0;
  assert.throws(() => applyRetiredArtifactTree(plan, {...f.ports, beforeOperation({operation}) {
    if (operation === 'unlink' && ++operations === 2) throw Error('injected_unlink_failure');
  }}), /injected_unlink_failure/);
  assert.equal(operations, 2);
  assert.ok(fs.existsSync(f.directory + '/src/app/page.tsx'));
  assert.ok(fs.existsSync(f.directory + '/.next/static/immutable.js'));
  assert.throws(() => applyRetiredArtifactTree(plan, f.ports), /retired_artifact_plan_drift/);
});

test('new entry during removal fails closed without traversing it', t => {
  const f = fixture(t), plan = captureRetiredArtifactTree(f.directory, f.target, f.ports); let injected = false;
  assert.throws(() => applyRetiredArtifactTree(plan, {...f.ports, beforeOperation({operation, path: filename}) {
    if (!injected && operation === 'rmdir') { injected = true; fs.writeFileSync(filename + '/unplanned', 'do not delete'); }
  }}), /generated_directory_not_empty/);
  assert.ok(fs.existsSync(f.directory + '/src/app/page.tsx'));
});

test('special/writeable modes are refused on POSIX', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t), filename = f.directory + '/node_modules/package/index.js';
  fs.chmodSync(filename, 0o666);
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /unsafe_mode/);
  fs.chmodSync(filename, 0o644);
  fs.chmodSync(filename, 0o4644);
  assert.throws(() => captureRetiredArtifactTree(f.directory, f.target, f.ports), /unsafe_mode/);
});
