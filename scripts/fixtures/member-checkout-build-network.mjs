// Isolated build preload only. Never load this as a production network policy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';

assert.equal(process.env.FAOLLA_CHECKOUT_BUILD_LOCAL, '1');
const app = fs.realpathSync(process.cwd()), evidence = fs.realpathSync(process.env.FAOLLA_CHECKOUT_BUILD_EVIDENCE_DIR);
assert.equal(path.dirname(app), evidence); assert.equal(path.basename(app), 'app');
assert.ok(path.basename(evidence).startsWith('faolla-checkout-build-'));
assert.ok(!fs.readdirSync(app).some(name => name.startsWith('.env')));
const allowed = new URL(process.env.FAOLLA_CHECKOUT_BUILD_ORIGIN);
assert.equal(allowed.protocol, 'http:'); assert.equal(allowed.hostname, '127.0.0.1');
assert.ok(Number(allowed.port) > 0); assert.equal(allowed.origin + '/', allowed.href);
const audit = path.join(evidence, 'network.jsonl');
const require = createRequire(import.meta.url), tsxPackage = require.resolve('tsx/package.json');
assert.equal(JSON.parse(fs.readFileSync(tsxPackage, 'utf8')).version, '4.21.0');
const tsxSources = ['client-BQVF1NaW.mjs', 'client-D6NvIMSC.cjs'].flatMap(name => {
  const file = path.join(path.dirname(tsxPackage), 'dist', name); return [file + ':', pathToFileURL(file).href + ':'];
});
const uid = process.geteuid ? process.geteuid() : os.userInfo().username;
const tsxPipe = path.join(evidence, `tsx-${uid}`, `${process.ppid}.pipe`);
const ownedTsxPipe = process.platform === 'win32' ? '\\\\?\\pipe\\' + tsxPipe : tsxPipe;
const record = (kind, target) => fs.appendFileSync(audit, JSON.stringify({ kind, target }) + '\n', { mode: 0o600 });
const reject = (kind, target) => { record(kind, target); throw Error('checkout_build_external_connection_refused'); };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== allowed.origin || url.username || url.password) {
    // The optional framework version probe remains OFFLINE, not mocked green.
    return reject(url.href === 'https://registry.npmjs.org/-/package/next/dist-tags' && init === undefined ? 'framework-version-refused' : 'fetch-refused', url.origin);
  }
  return nativeFetch(input, init);
};
const nativeConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // Node's HTTP agent can pass the normalized [options, callback] overload.
  const values = Array.isArray(args[0]) ? args[0] : args;
  const option = values[0];
  const port = typeof option === 'object' && option !== null ? option.port : option;
  const host = typeof option === 'object' && option !== null ? option.host ?? option.hostname : values[1];
  const frames = new Error().stack?.split('\n').slice(2, 8).map(line => line.trim());
  // TSX 4.21.0 unconditionally probes its parent's IPC pipe. Keep it blocked:
  // classify only the exact owned TEMP/parent path and pinned client frames,
  // never permit the pipe or excuse an arbitrary local/external connection.
  if (os.tmpdir() === evidence && option?.path === ownedTsxPipe && frames?.some(frame => tsxSources.some(source => frame.includes(source)))) {
    return reject('owned-tsx-ipc-refused', 'owned-tsx-parent-pipe');
  }
  if (host !== '127.0.0.1' || String(port) !== allowed.port || option?.path) return reject('socket-refused', {
    host: typeof host === 'string' && /^[a-zA-Z0-9.:[\]-]{1,253}$/.test(host) ? host : 'unspecified-or-non-host',
    port: /^\d{1,5}$/.test(String(port)) ? Number(port) : null, pipe: Boolean(option?.path), overload: typeof option,
    frames,
  });
  return Reflect.apply(nativeConnect, this, args);
};
syncBuiltinESMExports();
