import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./member-checkout-auth-build-diagnostic.mjs', import.meta.url));
test('upstream Auth diagnostic refuses implicit use before touching source, packages or services', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, [script], { windowsHide: true, env: { SystemRoot: process.env.SystemRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', part => { output += part; }); child.stderr.on('data', part => { output += part; });
  const [code] = await once(child, 'exit'); assert.notEqual(code, 0); assert.match(output, /AssertionError/);
  assert.doesNotMatch(output, /CHECKOUT_AUTH_BUILD_EVIDENCE|CHECKOUT_AUTH_BUILD_STEP/);
});
test('diagnostic pins upstream/toolchain and verifies unchanged blobs without granting an Auth or release pass', async () => {
  const source = await readFile(script, 'utf8');
  for (const requirement of ["GOTOOLCHAIN: 'local'", "GOFLAGS: '-mod=readonly'", "CGO_ENABLED: '0'", "GOPROXY: 'https://proxy.golang.org'", "GOSUMDB: 'sum.golang.org'", "assert.deepEqual(actual, expected)", "await inspectSource()", "'mod', 'verify'", "productionVersionMatched: false", "deploymentAuthorized: false"]) assert.ok(source.includes(requirement), requirement);
  assert.doesNotMatch(source, /CHECKOUT_AUTH_BUILD_ACCEPTANCE=passed|writeFile\(path\.join\(source|execSync|process\.env\.(?:SUPABASE|DATABASE_URL)|go mod tidy/);
});
