import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { NEXT_WASM_FILES, NEXT_WASM_INTEGRITY, prepareNextWasm } from './prepare-next-wasm.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules/@next/swc-wasm-nodejs');
const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'faolla-wasm-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['package.json', 'package-lock.json']) writeFileSync(join(dir, name), readFileSync(join(root, name)));
  mkdirSync(join(dir, 'node_modules/next'), { recursive: true });
  mkdirSync(join(dir, 'node_modules/@next'), { recursive: true });
  writeFileSync(join(dir, 'node_modules/next/package.json'), JSON.stringify({ name: 'next', version: '16.3.4' }));
  cpSync(source, join(dir, 'node_modules/@next/swc-wasm-nodejs'), { recursive: true, dereference: false });
  return { dir, source: join(dir, 'node_modules/@next/swc-wasm-nodejs'), target: join(dir, 'node_modules/next/wasm/@next/swc-wasm-nodejs') };
}
const rejected = (dir) => assert.throws(() => prepareNextWasm(dir), { message: 'next_wasm_prepare_unverified' });

test('build retains both config gates and budget around pinned fallback plus webpack', () => {
  assert.equal(readJSON(join(root, 'package.json')).scripts.build, 'npm run check:env:strict && npm run check:v1-deploy-config && node scripts/prepare-next-wasm.mjs && next build --webpack && npm run check:bundle:admin');
  const lock = readJSON(join(root, 'package-lock.json'));
  assert.deepEqual(lock.packages['node_modules/@next/swc-wasm-nodejs'], { version: '16.3.4', resolved: 'https://registry.npmjs.org/@next/swc-wasm-nodejs/-/swc-wasm-nodejs-16.3.4.tgz', integrity: NEXT_WASM_INTEGRITY, dev: true });
  assert.equal(Object.keys(NEXT_WASM_FILES).length, 5);
});
test('verified official package materializes exactly five files and is idempotent', (t) => {
  const f = fixture(t);
  assert.deepEqual(prepareNextWasm(f.dir), { version: '16.3.4', verified: true });
  for (const name of Object.keys(NEXT_WASM_FILES)) assert.deepEqual(readFileSync(join(f.target, name)), readFileSync(join(f.source, name)));
  assert.deepEqual(prepareNextWasm(f.dir), { version: '16.3.4', verified: true });
});
test('lock integrity or version mismatch cannot populate fallback', (t) => {
  const f = fixture(t), path = join(f.dir, 'package-lock.json'), lock = readJSON(path);
  lock.packages['node_modules/@next/swc-wasm-nodejs'].integrity = 'sha512-invalid';
  writeFileSync(path, JSON.stringify(lock)); rejected(f.dir);
});
test('installed Next mismatch fails closed', (t) => {
  const f = fixture(t); writeFileSync(join(f.dir, 'node_modules/next/package.json'), JSON.stringify({ name: 'next', version: '16.3.5' })); rejected(f.dir);
});
test('package declaration mismatch fails closed', (t) => {
  const f = fixture(t), path = join(f.dir, 'package.json'), pkg = readJSON(path);
  pkg.devDependencies['@next/swc-wasm-nodejs'] = '^16.3.4'; writeFileSync(path, JSON.stringify(pkg)); rejected(f.dir);
});
test('source tampering of same-sized JavaScript is rejected', (t) => {
  const f = fixture(t), path = join(f.source, 'wasm.js'), bytes = readFileSync(path); bytes[0] ^= 1; writeFileSync(path, bytes); rejected(f.dir);
});
test('unknown source files and missing files are rejected', (t) => {
  const f = fixture(t); writeFileSync(join(f.source, 'extra'), 'sentinel-secret'); rejected(f.dir);
  rmSync(join(f.source, 'extra')); rmSync(join(f.source, 'wasm.d.ts')); rejected(f.dir);
});
test('existing foreign or incomplete fallback is never repaired', (t) => {
  const f = fixture(t); mkdirSync(f.target, { recursive: true }); writeFileSync(join(f.target, 'sentinel'), 'private-marker'); rejected(f.dir);
  assert.equal(readFileSync(join(f.target, 'sentinel'), 'utf8'), 'private-marker');
});
test('existing source hardlink is rejected even with correct bytes', (t) => {
  const f = fixture(t); linkSync(join(f.source, 'wasm.js'), join(f.dir, 'same-inode')); rejected(f.dir);
});
test('existing staging collision is rejected without overwriting', (t) => {
  const f = fixture(t), staging = join(f.dir, 'node_modules/next/wasm/@next/.swc-wasm-nodejs-preparing'); mkdirSync(staging, { recursive: true }); writeFileSync(join(staging, 'sentinel'), 'private-marker'); rejected(f.dir);
  assert.equal(readFileSync(join(staging, 'sentinel'), 'utf8'), 'private-marker');
});
test('symlinked fallback destination cannot redirect the write', { skip: process.platform === 'win32' }, (t) => {
  const f = fixture(t), outside = join(f.dir, 'outside'); mkdirSync(outside); mkdirSync(dirname(f.target), { recursive: true }); symlinkSync(outside, f.target); rejected(f.dir);
});
test('preparation never imports the binding, spawns or downloads', () => {
  const code = readFileSync(join(root, 'scripts/prepare-next-wasm.mjs'), 'utf8');
  assert.doesNotMatch(code, /child_process|\bfetch\s*\(|NEXT_TEST_|loadBindings\s*\(|import\s*\(.*wasm/);
  assert.match(code, /contents\(source\);\s*contents\(staging\);\s*renameSync/);
});
