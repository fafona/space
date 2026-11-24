// Test-only boot of an already built owned application. All jobs stay paused.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const appDirectory = fs.realpathSync(process.argv[2]);
assert.equal(appDirectory, fs.realpathSync(process.cwd()));
assert.equal(path.basename(appDirectory), 'app');
assert.ok(path.basename(path.dirname(appDirectory)).startsWith('faolla-checkout-build-'));
assert.equal(process.env.FAOLLA_CHECKOUT_BUILD_LOCAL, '1');
assert.equal(process.env.NODE_ENV, 'production');
assert.equal(process.env.FAOLLA_BACKGROUND_JOBS_PAUSED, '1');
assert.ok(!fs.readdirSync(appDirectory).some(name => name.startsWith('.env')));
assert.ok(fs.statSync(path.join(appDirectory, '.next/BUILD_ID')).isFile());
const requireApp = createRequire(path.join(appDirectory, 'package.json'));
const app = requireApp('next')({ dev: false, dir: appDirectory, hostname: '127.0.0.1' });
const server = http.createServer((req, res) => app.getRequestHandler()(req, res));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  try {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await app.close(); process.send?.({ type: 'stopped' }); process.disconnect?.();
  } finally { process.exit(0); }
}
process.on('message', message => { if (message === 'close') void close(); });
process.on('disconnect', () => void close());
app.prepare().then(() => server.listen(0, '127.0.0.1', () => process.send?.({ type: 'listening', port: server.address().port })))
  .catch(() => { process.send?.({ type: 'startup-failed' }); void close(); });
