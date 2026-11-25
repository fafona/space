// Test-only TLS launcher for an already-built, exact pinned source (old or new). No dev-mode
// instrumentation workaround, source rewrite, system certificate or workers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { createRequire } from 'node:module';
const directory = fs.realpathSync(process.argv[2]);
assert.equal(process.env.FAOLLA_CHECKOUT_NEXT_LOCAL, '1');
const relative = path.relative(os.tmpdir(), directory);
assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
assert.equal(path.basename(directory), 'app'); assert.ok(path.basename(path.dirname(directory)).startsWith('faolla-checkout-build-'));
assert.equal(process.env.NODE_ENV, 'production'); assert.equal(process.env.FAOLLA_BACKGROUND_JOBS_PAUSED, '1');
assert.ok(!fs.readdirSync(directory).some(name => name.startsWith('.env'))); assert.ok(fs.statSync(path.join(directory, '.next/BUILD_ID')).isFile());
const nativeFetch = globalThis.fetch; let forbiddenFetches = 0;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') { forbiddenFetches++; throw Error('owned_old_next_external_fetch_refused'); }
  return nativeFetch(input, init);
};
const requireApp = createRequire(path.join(directory, 'package.json'));
const app = requireApp('next')({ dev: false, dir: directory, hostname: '127.0.0.1' });
const server = https.createServer({ key: fs.readFileSync(path.join(directory, '..', 'tls-key.pem')),
  cert: fs.readFileSync(path.join(directory, '..', 'tls-cert.pem')) }, (req, res) => app.getRequestHandler()(req, res));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  try { server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); await app.close();
    process.send?.({ type: 'stopped', forbiddenFetches }); process.disconnect?.(); }
  finally { process.exit(0); }
}
process.on('message', message => { if (message === 'close') void close(); }); process.on('disconnect', () => void close());
app.prepare().then(() => server.listen(0, '127.0.0.1', () => process.send?.({ type: 'listening', port: server.address().port })))
  .catch(() => { process.send?.({ type: 'startup-failed' }); void close(); });
