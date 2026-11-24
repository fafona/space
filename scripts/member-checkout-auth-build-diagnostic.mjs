// Reproducible LOCAL upstream build diagnostic, NOT an Auth acceptance pass.
// The pinned source currently fails on Windows's missing unix.SO_REUSEPORT.
// Never patch upstream, install a service, or read .env to make it pass.
import assert from 'node:assert/strict';
import { readFile, readdir, realpath, lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

assert.equal(process.env.FAOLLA_CHECKOUT_AUTH_BUILD_ACCEPTANCE, '1');
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
assert.equal(await realpath(process.cwd()), root);
const directory = await realpath(process.env.FAOLLA_CHECKOUT_AUTH_TOOLS_DIR ?? '.missing-owned-auth-tools');
assert.equal(path.dirname(directory), path.dirname(root)); assert.match(path.basename(directory), /^faolla-checkout-auth-tools-[0-9a-f]{32}$/);
const commit = '387e91f37e00b64b9060352988066bbb685f6e45', version = 'v2.198.0';
const source = path.join(directory, 'auth-' + commit), compiler = path.join(directory, 'compiler-1.27.4/go'), executable = path.join(compiler, 'bin/go.exe');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(await realpath(source), source); assert.equal(await realpath(executable), executable);
assert.equal(sha256(await readFile(path.join(directory, 'compiler-1.27.4/go1.27.4.windows-amd64.zip'))), '178ab98950ac69ab25069307dc6ade79f3816e414cce95b4da166a115cde1e7e');
assert.equal(sha256(await readFile(path.join(directory, 'supabase-auth-387e91f.zip'))), '99cdf807b817cf59da7ff10329898fbd32380e2e73231c3458660595e6ca679f');
// Independently downloaded official GitHub tree, not just a self-hash of ZIP.
// Verify every source blob against that fixed commit before running the build.
const tree = JSON.parse(await readFile(path.join(directory, 'source-tree.json'), 'utf8'));
assert.equal(tree.sha, commit); assert.equal(tree.truncated, false);
const expected = new Map();
for (const entry of tree.tree) {
  assert.ok(['tree', 'blob'].includes(entry.type));
  assert.ok(!path.isAbsolute(entry.path) && !entry.path.includes('\\') && !entry.path.split('/').some(part => !part || part === '.' || part === '..'));
  if (entry.type === 'blob') { assert.ok(['100644', '100755'].includes(entry.mode)); assert.ok(!expected.has(entry.path)); expected.set(entry.path, entry.sha); }
}
async function inspectSource() {
  const actual = new Map();
  async function walk(relative) {
    for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name, file = path.join(source, name);
      assert.ok(!entry.isSymbolicLink()); assert.equal(await realpath(file), file);
      if (entry.isDirectory()) await walk(name);
      else {
        assert.ok(entry.isFile()); const bytes = await readFile(file);
        actual.set(name, createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'));
      }
    }
  }
  await walk(''); assert.deepEqual(actual, expected);
}
await inspectSource(); assert.ok(!(await readdir(source)).includes('.env'));
assert.match(await readFile(path.join(source, 'go.mod'), 'utf8'), /^go 1\.27\.4$/m);
const evidence = await mkdtemp(path.join(directory, 'build-')), temporary = path.join(evidence, 'tmp'); await mkdir(temporary);
console.log(`CHECKOUT_AUTH_BUILD_EVIDENCE=${evidence}`);
const environment = {
  SystemRoot: process.env.SystemRoot, PATH: path.join(compiler, 'bin') + path.delimiter + path.join(process.env.SystemRoot, 'System32'),
  TEMP: temporary, TMP: temporary, GOROOT: compiler, GOPATH: path.join(directory, 'gopath'), GOCACHE: path.join(directory, 'go-cache'),
  GOMODCACHE: path.join(directory, 'go-modules'), GOENV: 'off', GOTOOLCHAIN: 'local', GOPROXY: 'https://proxy.golang.org', GOSUMDB: 'sum.golang.org',
  GOFLAGS: '-mod=readonly', CGO_ENABLED: '0', GOOS: 'windows', GOARCH: 'amd64', GOMAXPROCS: '2', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL',
};
const results = []; let complete = false;
try {
  for (const [name, args] of [
    ['compiler-version', ['version']], ['module-download', ['mod', 'download']], ['module-verify', ['mod', 'verify']],
    ['auth-build', ['build', '-trimpath', '-buildvcs=false', '-ldflags', '-X github.com/supabase/auth/internal/utilities.Version=' + version, '-o', path.join(evidence, 'auth.exe'), '.']],
  ]) {
    console.log('CHECKOUT_AUTH_BUILD_STEP=' + name);
    const started = Date.now(), log = createWriteStream(path.join(evidence, name + '.log'), { flags: 'wx' });
    const child = spawn(executable, args, { cwd: source, windowsHide: true, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    const timer = setTimeout(() => child.kill(), 600000); timer.unref();
    let code;
    try { [code] = await once(child, 'exit'); } finally { clearTimeout(timer); await new Promise(resolve => log.end(resolve)); }
    results.push({ name, code, pid: child.pid, milliseconds: Date.now() - started }); assert.equal(code, 0, 'owned_auth_' + name + '_failed');
    if (name === 'compiler-version') assert.equal((await readFile(path.join(evidence, name + '.log'), 'utf8')).trim(), 'go version go1.27.4 windows/amd64');
  }
  await inspectSource(); assert.ok((await lstat(path.join(evidence, 'auth.exe'))).isFile());
  await writeFile(path.join(evidence, 'auth-build.json'), JSON.stringify({ version, commit, sourceBlobs: expected.size, compiler: 'go1.27.4', binarySha256: sha256(await readFile(path.join(evidence, 'auth.exe'))), steps: results, scope: 'owned-unmodified-upstream-auth-only', productionVersionMatched: false, deploymentAuthorized: false }, null, 2), { flag: 'wx' });
  complete = true; console.log('CHECKOUT_AUTH_BUILD_DIAGNOSTIC=compiled-only-not-auth-accepted');
} finally {
  await writeFile(path.join(evidence, 'run-summary.json'), JSON.stringify({ complete, steps: results }, null, 2), { flag: 'wx' });
  console.log(`CHECKOUT_AUTH_BUILD_STOPPED=${evidence}`);
}
