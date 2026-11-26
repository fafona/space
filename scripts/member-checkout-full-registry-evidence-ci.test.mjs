import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
test('native file rehearsal has a separate read-only branch-only workflow and preserves all old workflow checks',async()=>{
 const text=await readFile('.github/workflows/member-checkout-full-registry-evidence.yml','utf8');
 assert.match(text,/branches:\s+- acceptance\/member-checkout-real-auth-20261125/);assert.match(text,/permissions:\s+contents: read/);
 assert.match(text,/runs-on: ubuntu-24.04/);assert.match(text,/persist-credentials: false/);assert.match(text,/npm ci --ignore-scripts --no-audit --no-fund/);
 for(const f of ['member-checkout-full-registry-evidence.test.mjs','member-checkout-full-registry-evidence-ci.test.mjs','member-checkout-full-registry-result.test.mjs','member-checkout-production-source-draft.test.mjs','member-checkout-evidence-storage.test.mjs','member-checkout-047-evidence.test.mjs','member-checkout-full-registry-evidence-acceptance.mjs'])assert.ok(text.includes(f));
 assert.match(text,/FAOLLA_CHECKOUT_FULL_REGISTRY_EVIDENCE_ACCEPTANCE: '1'/);assert.match(text,/path: \$\{\{ runner.temp \}\}\/faolla-full-registry-file-evidence\/report.json/);
 assert.doesNotMatch(text,/secrets\.|contents: write|pull_request:|workflow_dispatch:|workflow_run:|environment:|ssh |scp |sudo |deploy|pm2|DATABASE_URL|STRIPE_SECRET/);
 const old=await readFile('.github/workflows/member-checkout-047-real-auth.yml','utf8');assert.doesNotMatch(old,/full-registry/);
});
test('native harness and worker refuse outside exact isolated opt-in before parsing requests or creating owned files',async()=>{
 for(const args of [['--test','scripts/member-checkout-full-registry-evidence-acceptance.mjs'],['scripts/fixtures/member-checkout-full-registry-evidence-worker.mjs','private-canary-not-a-request']]){
  const r=spawnSync(process.execPath,args,{cwd:process.cwd(),env:{},encoding:'utf8',timeout:15000});assert.ifError(r.error);assert.equal(r.status,1);
  assert.match(r.stdout+r.stderr,/AssertionError/);assert.doesNotMatch(r.stdout+r.stderr,/ENOENT|ECONNREFUSED|private-canary/);
 }
 const source=await readFile('scripts/fixtures/member-checkout-full-registry-evidence-worker.mjs','utf8');
 assert.ok(source.indexOf('assertIsolatedCi()')<source.indexOf('const requestWire=process.argv[2]'));assert.ok(source.indexOf('assertIsolatedCi()')<source.indexOf("await import('node:fs')"));
});
test('rehearsal evidence distinguishes actual Linux files from embedded SQL, modelled connection identity and complete installation',async()=>{
 const source=await readFile('scripts/member-checkout-full-registry-evidence-acceptance.mjs','utf8');
 for(const item of ['nativePrivateFileOperations:true',"registryEngine:'PGlite'",'nativePostgresInstallationValidated:false','wholeInstallerInterrupted:false','realDatabaseConnectionIdentityValidated:false','persistentProductionStorageValidated:false','hostBackupRestoreValidated:false','powerLossValidated:false','productionAuthorized:false','deploymentReady:false','productionReadPerformed:false'])assert.ok(source.includes(item));
 assert.match(source,/child.kill\('SIGKILL'\)/);assert.match(source,/expectedKill:killAfterReady/);assert.match(source,/prepared.json/);assert.match(source,/\.retained/);
 assert.doesNotMatch(source,/from ['"]pg['"]|\bfetch\s*\(|spawnSync|SUPABASE_URL|STRIPE_SECRET|\.query\(step.body\)/);
});
