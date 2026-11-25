import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {loadCredentialCandidateSources} from './member-checkout-credential-candidate.mjs';
test('credential candidate is a four-file independent overlay and retains the complete exact ENV client',async()=>{
 const {overlay,revision:r}=await loadCredentialCandidateSources();assert.equal(r.material.baseApplication.files,2971);assert.equal(r.material.application.files,2974);assert.notEqual(r.material.application.sha256,r.material.baseApplication.sha256);
 assert.deepEqual(Object.keys(overlay).sort(),['src/lib/merchantCheckoutCredentialFile.server.ts','src/lib/merchantCheckoutRuntime.server.ts','src/lib/merchantCheckoutRuntimeDelivery.server.ts','src/lib/merchantCheckoutRuntimeEnv.server.ts']);
 assert.equal(overlay['src/lib/merchantCheckoutRuntimeEnv.server.ts'],(await readFile('src/lib/merchantCheckoutRuntime.server.ts','utf8')).replace(/\r\n/g,'\n'));
 assert.match(overlay['src/lib/merchantCheckoutRuntime.server.ts'],/export \{createServerMerchantCheckoutRuntimeClient\} from "\.\/merchantCheckoutRuntimeDelivery.server"/);
 assert.match(overlay['src/lib/merchantCheckoutRuntimeDelivery.server.ts'],/source===undefined\|\|source==="env"\)return legacy\(options\)/);assert.doesNotMatch(overlay['src/lib/merchantCheckoutRuntimeDelivery.server.ts'],/scripts\/|\.\.\/\.\.\/src/);
 for(const key of ['formalIssuerProvisioned','productionAuthorized','deploymentReady'])assert.equal(r.material[key],false);
});
test('materialization refuses outside exact hosted CI before selecting any target or writing a file',()=>{
 const code=`import{materializeOwnedCredentialCandidate}from'./scripts/member-checkout-credential-candidate.mjs';try{await materializeOwnedCredentialCandidate(new Proxy({},{get(){process.exit(3)}}));process.exit(2)}catch{}`;
 const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{cwd:process.cwd(),env:{},encoding:'utf8',timeout:15000});assert.ifError(result.error);assert.equal(result.status,0);assert.equal(result.stderr,'');
});
test('new Next harness exits before connection or fixture selection outside owned hosted CI',()=>{
 const result=spawnSync(process.execPath,['--import','tsx','--test','scripts/member-checkout-credential-next-acceptance.mjs'],{cwd:process.cwd(),env:{FAOLLA_CHECKOUT_CREDENTIAL_NEXT_ACCEPTANCE:'1'},encoding:'utf8',timeout:15000});assert.ifError(result.error);assert.equal(result.status,1);assert.match(result.stdout,/AssertionError/);assert.doesNotMatch(result.stdout+result.stderr,/ECONNREFUSED|ENOENT|signing.*secret/i);
});
test('candidate build preserves the normal five stages, source binding and zero-backend/browser-secret checks',async()=>{
 const s=await readFile('scripts/member-checkout-credential-candidate-build.mjs','utf8');for(const marker of ['retained-env-tests','environment','deployment-config','pinned-wasm','production-build','admin-bundle-budget'])assert.ok(s.includes("['"+marker+"'"));
 assert.match(s,/assertCredentialCandidateCi\(\)/);assert.match(s,/assert\.deepEqual\(await applicationFingerprint\(fixture\.app\),expected\)/);assert.match(s,/backendRequests,0/);assert.match(s,/credential_configuration_in_browser/);assert.doesNotMatch(s,/SUPABASE_SERVICE_ROLE_KEY|FAOLLA_CHECKOUT_RUNTIME_JWT:|CREDENTIAL_SOURCE:|--no-lint|ignoreBuildErrors/);
});
test('actual delivery rehearsal uses wall time, real gateway rejection and the unchanged original lifecycle guards',async()=>{
 const s=await readFile('scripts/member-checkout-credential-next-acceptance.mjs','utf8');assert.match(s,/for\(let i=0;i<3;i\+\+\)/);assert.match(s,/await waitUntil\(exp\*1000\+31000\)/);assert.match(s,/rawCatalog\(value\.jwt\)\)\.status,401/);assert.match(s,/await runtimeLifecycleCases/);assert.match(s,/signingMaterialPassedToNext:false/);assert.match(s,/kongValidated:false/);assert.doesNotMatch(s,/now:\s*\(\)=>|process\.env\.(?:SUPABASE|DATABASE|PG|STRIPE)\w*\s*=/);
 const workflow=await readFile('.github/workflows/member-checkout-047-real-auth.yml','utf8'),job=workflow.split('\n  credential-next-delivery:\n')[1];assert.ok(job);assert.match(job,/image: postgres:15\.8/);assert.match(job,/FAOLLA_CHECKOUT_AUTH_TEST_PROFILE: current-auth/);assert.match(job,/FAOLLA_CHECKOUT_CREDENTIAL_NEXT_ACCEPTANCE: '1'/);assert.match(job,/node --import tsx --test scripts\/member-checkout-credential-next-acceptance.mjs/);assert.match(job,/path: \$\{\{ runner.temp \}\}\/faolla-credential-next-evidence\/report.json/);assert.doesNotMatch(job,/secrets\.|id-token:|ssh |scp |deploy-production|git push|git merge/);
});
