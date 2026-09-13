import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Next 16.3.4's normal fallback reads this cache directory. Materialize only the
// npm-integrity-pinned package, never invoke its unverified network downloader.
export const NEXT_WASM_VERSION = '16.3.4';
export const NEXT_WASM_INTEGRITY = 'sha512-jEjgbohZoYbHLURv/A6qjC+M8JrV7ndUB6ITECOuOcONmcDSHR+jujyzWbwYo0FAfZ9dfdIp1c+KZoO/zSxzqw==';
export const NEXT_WASM_FILES = Object.freeze({
  'README.md': Object.freeze([64, 'b6f84b0c647a9bf03824d4ea100f090947d7b904ec33742e330ab3b119d26b4c']),
  'package.json': Object.freeze([295, '44f6d92a5b612fc9a8a95e290847ba9fa8ca304999aea7b2a6403b83a03eedd3']),
  'wasm.d.ts': Object.freeze([788, 'bf2ff3453cc4aa55423f4608a82d2d871c061282f493fe15c6211d609a5791e4']),
  'wasm.js': Object.freeze([25376, 'e95d839aa6adc01d876831b5db4ba682cb91c145e2fe3b04b9460fecb6610dd3']),
  'wasm_bg.wasm': Object.freeze([30393446, 'e205a5ede641db588a654750c26fdbc88ed10adb64b49a8085ccaa6d8e2cbe9e']),
});
const fail = () => { throw new Error('next_wasm_prepare_unverified'); };
const identity = (s) => ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].map((k) => String(s[k])).join(':');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
function directory(path) {
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(path) !== path) fail();
}
function read(path, size) {
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(size)) fail();
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (identity(fstatSync(fd, { bigint: true })) !== identity(before)) fail();
    const bytes = readFileSync(fd);
    if (bytes.length !== Number(before.size) || identity(fstatSync(fd, { bigint: true })) !== identity(before) || identity(lstatSync(path, { bigint: true })) !== identity(before)) fail();
    return bytes;
  } finally { closeSync(fd); }
}
function contents(path) {
  directory(path);
  if (JSON.stringify(readdirSync(path).sort()) !== JSON.stringify(Object.keys(NEXT_WASM_FILES).sort())) fail();
  return Object.entries(NEXT_WASM_FILES).map(([name, [size, hash]]) => {
    const bytes = read(join(path, name), size);
    if (bytes.length !== size || sha256(bytes) !== hash) fail();
    return [name, bytes];
  });
}
function ensureDirectory(path) {
  try { lstatSync(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    mkdirSync(path, { mode: 0o700 });
  }
  directory(path);
}
export function prepareNextWasm(projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  try {
    const root = resolve(projectDir);
    directory(root);
    const pkg = JSON.parse(read(join(root, 'package.json'), 1048576));
    const lock = JSON.parse(read(join(root, 'package-lock.json'), 4194304));
    const name = '@next/swc-wasm-nodejs';
    const entry = lock.packages?.['node_modules/' + name];
    if (pkg.dependencies?.next !== NEXT_WASM_VERSION || pkg.devDependencies?.[name] !== NEXT_WASM_VERSION || lock.lockfileVersion !== 3 || lock.packages?.['']?.devDependencies?.[name] !== NEXT_WASM_VERSION || entry?.version !== NEXT_WASM_VERSION || entry.integrity !== NEXT_WASM_INTEGRITY || entry.resolved !== 'https://registry.npmjs.org/@next/swc-wasm-nodejs/-/swc-wasm-nodejs-16.3.4.tgz' || entry.dev !== true) fail();
    for (const part of ['node_modules', 'node_modules/@next', 'node_modules/next']) directory(join(root, part));
    const next = JSON.parse(read(join(root, 'node_modules/next/package.json'), 1048576));
    if (next.name !== 'next' || next.version !== NEXT_WASM_VERSION) fail();
    const source = join(root, 'node_modules/@next/swc-wasm-nodejs');
    const files = contents(source);
    const base = join(root, 'node_modules/next/wasm');
    ensureDirectory(base);
    ensureDirectory(join(base, '@next'));
    const target = join(base, '@next/swc-wasm-nodejs');
    try { lstatSync(target); contents(target); return { version: NEXT_WASM_VERSION, verified: true }; } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Only a genuinely absent target can be created. Never repair/overwrite a
      // partial or foreign existing fallback directory.
      try { lstatSync(target); fail(); } catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
    }
    const staging = join(base, '@next/.swc-wasm-nodejs-preparing');
    mkdirSync(staging, { mode: 0o700 });
    directory(staging);
    for (const [name, bytes] of files) writeFileSync(join(staging, name), bytes, { flag: 'wx', mode: 0o600 });
    contents(source);
    contents(staging);
    renameSync(staging, target);
    contents(target);
    return { version: NEXT_WASM_VERSION, verified: true };
  } catch { fail(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { prepareNextWasm(); console.log('[next-wasm] pinned fallback ready'); } catch { console.error('[next-wasm] next_wasm_prepare_unverified'); process.exitCode = 1; }
}
