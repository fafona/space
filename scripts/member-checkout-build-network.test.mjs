import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const preload = fileURLToPath(new URL('./fixtures/member-checkout-build-network.mjs', import.meta.url));
async function fixture() {
  const evidence = await mkdtemp(path.join(tmpdir(), 'faolla-checkout-build-')), app = path.join(evidence, 'app'); await mkdir(app);
  let requests = 0; const server = http.createServer((req, res) => { requests++; res.end('owned'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const run = async code => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, '--input-type=module', '-e', code], {
      cwd: app, windowsHide: true, env: { SystemRoot: process.env.SystemRoot, TEMP: evidence, TMP: evidence, FAOLLA_CHECKOUT_BUILD_LOCAL: '1', FAOLLA_CHECKOUT_BUILD_EVIDENCE_DIR: evidence, FAOLLA_CHECKOUT_BUILD_ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', part => { output += part; }); child.stderr.on('data', part => { output += part; });
    const [exitCode] = await once(child, 'exit'); assert.equal(exitCode, 0, output); return output;
  };
  return { run, origin, requests: () => requests, audit: async () => (await readFile(path.join(evidence, 'network.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)), close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
test('owned build permits only its exact loopback backend, including native fetch HTTP agent', { timeout: 10000 }, async () => {
  const f = await fixture(); try { assert.equal(await f.run('const r=await fetch(process.env.FAOLLA_CHECKOUT_BUILD_ORIGIN);console.log(await r.text())'), 'owned\n'); assert.equal(f.requests(), 1); } finally { await f.close(); }
});
test('non-owned fetches and raw sockets are blocked before connection; audit never includes credentials', { timeout: 10000 }, async () => {
  const f = await fixture(); try {
    await f.run("import net from 'node:net'; for(const target of ['https://private:never-log@example.invalid/path?secret=hidden','http://127.0.0.1:1']){try{await fetch(target);throw Error('unexpected')}catch(e){if(e.message!=='checkout_build_external_connection_refused')throw e;}} try{net.connect({host:'example.invalid',port:443});throw Error('unexpected')}catch(e){if(e.message!=='checkout_build_external_connection_refused')throw e;}");
    assert.equal(f.requests(), 0); const audit = await f.audit(); assert.equal(audit.length, 3); assert.deepEqual(audit.map(event => event.kind), ['fetch-refused', 'fetch-refused', 'socket-refused']);
    assert.ok(!JSON.stringify(audit).includes('never-log')); assert.ok(!JSON.stringify(audit).includes('hidden'));
  } finally { await f.close(); }
});
test('optional framework version check stays refused and separately visible, never a successful mock', { timeout: 10000 }, async () => {
  const f = await fixture(); try {
    await f.run("try{await fetch('https://registry.npmjs.org/-/package/next/dist-tags');throw Error('unexpected')}catch(e){if(e.message!=='checkout_build_external_connection_refused')throw e;}");
    assert.equal(f.requests(), 0); assert.deepEqual(await f.audit(), [{ kind: 'framework-version-refused', target: 'https://registry.npmjs.org' }]);
  } finally { await f.close(); }
});
test('actual pinned TSX parent IPC probe stays blocked but is distinguished from external sockets', { timeout: 10000 }, async () => {
  const f = await fixture(); try {
    const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    await f.run('await import(' + JSON.stringify(loader) + ')');
    assert.equal(f.requests(), 0); const audit = await f.audit(); assert.ok(audit.length >= 1);
    assert.ok(audit.every(event => event.kind === 'owned-tsx-ipc-refused' && event.target === 'owned-tsx-parent-pipe'));
  } finally { await f.close(); }
});
test('even the exact owned parent pipe is NOT trusted when called outside the pinned TSX client', { timeout: 10000 }, async () => {
  const f = await fixture(); try {
    const connectOwnedPipeOutsideTsx = async () => {
      const { default: net } = await import('node:net'), { default: os } = await import('node:os'), { default: path } = await import('node:path');
      const uid = process.geteuid ? process.geteuid() : os.userInfo().username;
      const file = path.join(os.tmpdir(), 'tsx-' + uid, process.ppid + '.pipe');
      const pipe = process.platform === 'win32' ? '\\\\?\\pipe\\' + file : file;
      try { net.connect(pipe); throw Error('unexpected'); } catch (error) { if (error.message !== 'checkout_build_external_connection_refused') throw error; }
    };
    await f.run('await (' + connectOwnedPipeOutsideTsx.toString() + ')()');
    assert.equal(f.requests(), 0); assert.equal((await f.audit())[0].kind, 'socket-refused');
  } finally { await f.close(); }
});
