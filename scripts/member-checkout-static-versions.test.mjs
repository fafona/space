import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalStaticPath, mergeStaticCatalogs, loadOwnedStaticVersions } from './member-checkout-static-versions.mjs';
test('static URL normalization accepts literal/encoded bracket names but refuses traversal, encoded separators and non-assets', () => {
  assert.equal(canonicalStaticPath('/_next/static/chunks/app/%5BsiteId%5D/page-a.js'), '/_next/static/chunks/app/[siteId]/page-a.js');
  for (const raw of ['/etc/passwd', '/_next/static/../secret.js', '/_next/static/%2e%2e/secret.js', '/_next/static/%252e%252e/secret.js',
    '/_next/static/%2fsecret.js', '/_next/static/a%5cb.js', '/_next/static//a.js', '/_next/static/a.js?query', '/_next/static/%00.js', '/_next/static/a.sql', '/_next/static/%zz.js']) assert.equal(canonicalStaticPath(raw), null, raw);
});
test('static paths may be shared only when both immutable bytes and hashes match; conflicting versions fail before routing', () => {
  const item = { url: '/_next/static/chunks/shared.js', bytes: 1, sha256: 'a'.repeat(64) };
  const catalog = value => [{ name: 'old', files: [item] }, { name: 'candidate', files: [value] }];
  assert.deepEqual(mergeStaticCatalogs(catalog(item)).get(item.url).owners, ['old', 'candidate']);
  assert.throws(() => mergeStaticCatalogs(catalog({ ...item, sha256: 'b'.repeat(64) })), /path_collision/);
  assert.throws(() => mergeStaticCatalogs(catalog({ ...item, bytes: 2 })), /length_collision/);
  assert.throws(() => mergeStaticCatalogs([{ name: 'old', files: [item, item] }, { name: 'candidate', files: [item] }]), /duplicate_version_asset/);
});
async function fixture(name, text) {
  const evidence = await mkdtemp(path.join(tmpdir(), 'faolla-checkout-build-')), app = path.join(evidence, 'app');
  await mkdir(path.join(app, '.next/static/chunks'), { recursive: true }); await writeFile(path.join(app, '.next/BUILD_ID'), name, { flag: 'wx' });
  const file = path.join(app, '.next/static/chunks', name + '.js'); await writeFile(file, text, { flag: 'wx' }); return { app, file };
}
test('owned asset union reads either version after routing changes, rejects unknown assets and detects later byte drift', async () => {
  const old = await fixture('old', 'old bytes'), candidate = await fixture('candidate', 'new bytes');
  const union = await loadOwnedStaticVersions({ old: old.app, candidate: candidate.app }); assert.equal(union.summary.files, 2);
  assert.equal((await union.read('/_next/static/chunks/old.js')).body.toString(), 'old bytes'); assert.equal((await union.read('/_next/static/chunks/candidate.js')).body.toString(), 'new bytes');
  assert.equal(await union.read('/_next/static/chunks/unknown.js'), null);
  await writeFile(old.file, 'bad bytes'); await assert.rejects(union.read('/_next/static/chunks/old.js'), /immutable_asset_changed/);
});
test('asset inventory refuses symlinks before reading their targets', async () => {
  const old = await fixture('old', 'old bytes'), candidate = await fixture('candidate', 'new bytes');
  await symlink(path.dirname(candidate.file), path.join(old.app, '.next/static/chunks', 'linked'), 'junction');
  await assert.rejects(loadOwnedStaticVersions({ old: old.app, candidate: candidate.app }));
});
