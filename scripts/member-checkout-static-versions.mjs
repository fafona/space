// Read-only immutable asset union for the OWNED two-build CI proxy only.
// No deployment writes, arbitrary paths, runtime-server fallback or cache purge.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const sha = value => createHash('sha256').update(value).digest('hex');
const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon' };
export function canonicalStaticPath(raw) {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\\\0?#]|%2f|%5c/i.test(raw)) return null;
  let decoded; try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (!decoded.startsWith('/_next/static/') || /[%\\\0?#]|\/\//.test(decoded)
    || decoded.split('/').some(p => p === '.' || p === '..') || !Object.hasOwn(types, path.posix.extname(decoded))) return null;
  return decoded;
}
export function mergeStaticCatalogs(catalogs) {
  assert.deepEqual(catalogs.map(v => v.name).sort(), ['candidate', 'old']); const files = new Map();
  for (const catalog of catalogs) {
    assert.ok(catalog.files.length > 0); const seen = new Set();
    for (const item of catalog.files) {
      assert.equal(canonicalStaticPath(item.url), item.url); assert.match(item.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= 32 * 1024 ** 2);
      assert.equal(seen.has(item.url), false, 'duplicate_version_asset'); seen.add(item.url);
      const prior = files.get(item.url);
      if (prior) { assert.equal(prior.sha256, item.sha256, 'immutable_asset_path_collision'); assert.equal(prior.bytes, item.bytes, 'immutable_asset_length_collision'); prior.owners.push(catalog.name); }
      else files.set(item.url, { ...item, owners: [catalog.name] });
    }
  }
  return files;
}
export async function loadOwnedStaticVersions(versions) {
  const catalogs = [];
  for (const [name, app] of Object.entries(versions)) {
    assert.ok(['old', 'candidate'].includes(name)); assert.equal(await realpath(app), app);
    const relative = path.relative(tmpdir(), app); assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.equal(path.basename(app), 'app'); assert.ok(path.basename(path.dirname(app)).startsWith('faolla-checkout-build-'));
    const idFile = path.join(app, '.next/BUILD_ID'), idStat = await lstat(idFile); assert.ok(idStat.isFile() && !idStat.isSymbolicLink()); assert.equal(await realpath(idFile), idFile);
    const root = path.join(app, '.next/static'); assert.equal(await realpath(root), root); const files = [];
    const walk = async directory => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name); assert.ok(!entry.isSymbolicLink());
        if (entry.isDirectory()) await walk(file);
        else { assert.ok(entry.isFile()); assert.equal(await realpath(file), file);
          const stat = await lstat(file); assert.ok(stat.size > 0 && stat.size <= 32 * 1024 ** 2);
          const url = '/_next/static/' + path.relative(root, file).split(path.sep).join('/'); assert.equal(canonicalStaticPath(url), url);
          const body = await readFile(file); assert.ok(!body.includes(Buffer.from('FAOLLA_CHECKOUT_RUNTIME_JWT')), 'runtime_transport_in_client_asset');
          files.push({ url, sha256: sha(body), bytes: body.length, file }); assert.ok(files.length <= 5000);
        }
      }
    };
    await walk(root); catalogs.push({ name, files });
  }
  const files = mergeStaticCatalogs(catalogs), material = [...files.values()].map(({ url, sha256, bytes, owners }) => ({ url, sha256, bytes, owners })).sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  const read = async raw => {
    const url = canonicalStaticPath(raw), item = url && files.get(url); if (!item) return null;
    assert.equal(await realpath(item.file), item.file); const stat = await lstat(item.file); assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.size, item.bytes, 'immutable_asset_changed'); const body = await readFile(item.file); assert.equal(sha(body), item.sha256, 'immutable_asset_changed');
    return { body, sha256: item.sha256, type: types[path.posix.extname(url)], owners: item.owners };
  };
  return { read, material, summary: { files: material.length, sha256: sha(JSON.stringify(material)),
    oldOnly: material.filter(v => v.owners.length === 1 && v.owners[0] === 'old').length,
    candidateOnly: material.filter(v => v.owners.length === 1 && v.owners[0] === 'candidate').length,
    identicalShared: material.filter(v => v.owners.length === 2).length } };
}
