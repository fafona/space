import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {assertFullRegistryInstallationCi,nativeInstallationModes,assertFullRegistryInstallationRequest,readFullRegistryInstallationInput} from './member-checkout-full-registry-installation-support.mjs';
import {nativeCheckoutFinancialExports} from './member-checkout-full-registry-installation-imports.mjs';
const env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:'fafona/space',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/acceptance/member-checkout-real-auth-20261125',GITHUB_SHA:'1'.repeat(40),RUNNER_TEMP:'/tmp/owned-ci-only',FAOLLA_CHECKOUT_REAL_AUTH_ACCEPTANCE:'1',FAOLLA_CHECKOUT_AUTH_TEST_PROFILE:'current-auth',FAOLLA_CHECKOUT_FULL_REGISTRY_INSTALLATION_ACCEPTANCE:'1',FAOLLA_CHECKOUT_FULL_REGISTRY_INSTALLATION_MODE:'normal'};
const source=name=>readFile(new URL('./'+name,import.meta.url),'utf8');

test('native full-registry harness requires exact owned Linux CI, protocol, separate opt-in and bounded mode',()=>{
 for(const mode of nativeInstallationModes)assert.equal(assertFullRegistryInstallationCi({...env,FAOLLA_CHECKOUT_FULL_REGISTRY_INSTALLATION_MODE:mode},'linux','x64').profileName,'current-auth');
 assert.deepEqual(nativeInstallationModes,['normal','commit-unknown']);assert.equal(Object.isFrozen(nativeInstallationModes),true);
 for(const [key,value] of [['GITHUB_ACTIONS','false'],['RUNNER_ENVIRONMENT','self-hosted'],['GITHUB_REPOSITORY','other/repo'],['GITHUB_EVENT_NAME','workflow_dispatch'],['GITHUB_REF','refs/heads/main'],['GITHUB_SHA','not-a-sha'],['FAOLLA_CHECKOUT_AUTH_TEST_PROFILE','legacy'],['FAOLLA_CHECKOUT_FULL_REGISTRY_INSTALLATION_ACCEPTANCE','0'],['FAOLLA_CHECKOUT_FULL_REGISTRY_INSTALLATION_MODE','retry'],['DATABASE_URL','private-sentinel']])assert.throws(()=>assertFullRegistryInstallationCi({...env,[key]:value},'linux','x64'));
 assert.throws(()=>assertFullRegistryInstallationCi(env,'win32','x64'));assert.throws(()=>assertFullRegistryInstallationCi(env,'linux','arm64'));
});

test('outside CI worker and request readers refuse before IPC, file selection or native client creation',async()=>{
 const result=spawnSync(process.execPath,['scripts/member-checkout-full-registry-installation-worker.mjs'],{cwd:process.cwd(),env:{},encoding:'utf8',timeout:15000});
 assert.ifError(result.error);assert.equal(result.status,71);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
 let accessed=false;const request=new Proxy({},{get(){accessed=true;throw Error('unapproved_input_read');}});
 assert.throws(()=>assertFullRegistryInstallationRequest(request));assert.equal(accessed,false);
 assert.throws(()=>readFullRegistryInstallationInput(request));assert.equal(accessed,false);
 const {runFullRegistryNativeWorker}=await import('./member-checkout-full-registry-installation-worker.mjs');await assert.rejects(runFullRegistryNativeWorker(request));assert.equal(accessed,false);
});

test('native worker permits fixed owned target only and reopens private evidence before connecting',async()=>{
 const s=await source('member-checkout-full-registry-installation-worker.mjs');
 assert.ok(s.indexOf('assertFullRegistryInstallationRequest(request)')<s.indexOf('readFullRegistryInstallationInput(request)'));
 assert.ok(s.indexOf('reopenCheckoutFullRegistryEvidence(store,locator')<s.indexOf('new Client('));
 assert.match(s,/host:'127\.0\.0\.1',port:databasePort,database,user:'checkout_ci_admin'/);
 assert.match(s,/version:'150008'/);assert.match(s,/assertOwnedLifecycleTarget\(db\)/);assert.match(s,/require\('pg\/package.json'\)\.version,'8\.23\.1'/);
 assert.doesNotMatch(s,/connectionString|DATABASE_URL|SUPABASE|STRIPE|process\.env\.PG|\bfetch\s*\(|\bDROP\b|\bTRUNCATE\b|\bGRANT\b|\bREVOKE\b/);
});

test('entire installer uses exact immutable 38 bodies, native ACL checks and durable prepared-before-receipts-before-COMMIT order',async()=>{
 const s=await source('member-checkout-full-registry-installation-worker.mjs');
 const baseline=s.indexOf('assertCheckout047InstallationObservation(before,'),ddl=s.indexOf('for(const step of bundle.material.steps)'),priv=s.indexOf("progress.phase='privileges'"),prepare=s.indexOf('appendCheckoutFullRegistryPrepared(context,prepared)'),receipts=s.indexOf('INSERT INTO public.faolla_schema_migrations'),commit=s.indexOf("await query('COMMIT')");
 assert.ok(baseline<ddl&&ddl<priv&&priv<prepare&&prepare<receipts&&receipts<commit);
 assert.match(s,/BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE/);assert.match(s,/assert\.equal\(progress.applied,38\)/);
 assert.match(s,/pg_try_advisory_xact_lock\(20261125,6064\)/);assert.match(s,/lock_timeout='1s'/);assert.match(s,/statement_timeout='15s'/);
 assert.match(s,/progress.applied===34\)await query\('SELECT 1\/0'\)/);
 assert.match(s,/assert\.equal\(receipts.length,2\)/);assert.doesNotMatch(s,/readFile.*sql|readdir|migration.*glob|source047RegistryVersion|seal047RegistryVersion/);
});

test('native commit ambiguity kills the installer before acknowledgement and never offers a retry or continuation',async()=>{
 const s=await source('member-checkout-full-registry-installation-worker.mjs');
 assert.match(s,/assert\.rejects\(query\('COMMIT; SELECT 1\/0'\),error=>error.code==='22012'\)/);
 assert.match(s,/checkpoint\('before-commit'\)/);assert.match(s,/checkpoint\('commit-unknown'\)/);assert.match(s,/await new Promise\(\(\)=>\{\}\)/);
 assert.match(s,/process\.once\('disconnect'/);assert.match(s,/setTimeout\(\(\)=>process.exit\(73\),60000\)/);assert.match(s,/if\(used\)return;used=true/);
 assert.match(s,/if\(!finished\)process.exit\(72\)/);assert.match(s,/finished=true;process.disconnect\(\)/);
 assert.doesNotMatch(s,/action==='retry'|action==='resume'|on\('continue'|repeatProductionReadAuthorized:true/);
});

test('recovery is independently connected read-only RR, retains effective privilege validation and has no DDL mutation branch',async()=>{
 const s=await source('member-checkout-full-registry-installation-worker.mjs'),recovery=s.slice(s.indexOf("if(request.action==='recover')"),s.indexOf("progress.phase='baseline'"));
 assert.match(recovery,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);assert.match(recovery,/statement_timeout='5s'/);assert.match(recovery,/confirmCheckoutFullRegistryEvidence\(context,current\)/);
 assert.match(recovery,/await assertCheckout047InstalledPrivileges\(query,bundle\)/);assert.match(recovery,/mutationStatements:0/);
 assert.doesNotMatch(recovery,/INSERT|UPDATE|DELETE|ALTER|CREATE|COMMIT|steps|appendCheckoutFullRegistryPrepared/);
});

test('private input has fixed owned sibling paths, externally pinned bytes, owner/mode/link checks and no repair operation',async()=>{
 const s=await source('member-checkout-full-registry-installation-support.mjs');
 assert.match(s,/assertFullRegistryInstallationCi\(\);assert.ok\(value/);assert.match(s,/Object.keys\(value\)\.sort\(\)/);
 assert.match(s,/faolla-checkout-evidence-test-full-native-/);assert.match(s,/input\.private\.json/);assert.match(s,/O_NOFOLLOW/);assert.match(s,/stat.nlink,1/);assert.match(s,/stat.mode&0o7777,0o600/);
 assert.match(s,/root.mode&0o7777,0o700/);assert.match(s,/stat.uid,process.getuid\(\)/);assert.match(s,/digest\('hex'\),request.inputSha256/);assert.match(s,/fatal:true/);
 assert.doesNotMatch(s,/chmod|chown|unlink|rmSync|rename|writeFile|\.\.\.env|\.\.\.process\.env/);
});

test('native source binds supplied entire catalog while retaining explicit synthetic references and no authority',async()=>{
 const s=await source('fixtures/member-checkout-full-registry-native-source.mjs');
 assert.match(s,/for\(const key of Object.keys\(value\)\)delete value\[key\]/);assert.match(s,/Object.assign\(value,structuredClone\(metadata\)\)/);
 assert.match(s,/referenceKind,'owned-synthetic-evidence'/);assert.match(s,/Object.values\(sourceDraft.material.authority\).every\(v=>v===false\)/);
 assert.doesNotMatch(s,/saved-production-evidence|\.query\(|\bfetch\s*\(|readFile|output\//);
});

test('native rehearsal covers actual rollback, whole-installer deaths, independent readers and missing evidence before opening DB',async()=>{
 const s=await source('member-checkout-full-registry-installation-acceptance.mjs');
 for(const required of ["inventory.entries.filter(v=>v.file!==excluded)","assert.equal(inserted,208)","inspectCheckout047Preinstall(contract,captured)","install(operation,'after34'","install(operation,'before-commit'","not-committed-original","committed-original","r.opened,0","r.applied,0","fileHashes(completed.roots)","pointBalance,920","phase='payment'","checkout_disabled"] )assert.ok(s.includes(required),required);
 assert.match(s,/fullHistoricalDdlReplay:false/);assert.match(s,/syntheticGatewayAndAcceptanceReferences:true/);assert.match(s,/productionReadPerformed:false,productionAuthorized:false,deploymentReady:false,stripeEnabled:false/);
 assert.match(s,/SIGKILL/);assert.match(s,/remaining,0/);assert.match(s,/opened===closed/);assert.match(s,/child\.stdout\.on/);assert.match(s,/assert.equal\(stdoutBytes,0\)/);
});

test('separate matrix retains all old workflows, publishes only sanitized report and grants no deployment permission',async()=>{
 const workflow=await readFile('.github/workflows/member-checkout-full-registry-installation.yml','utf8');
 assert.match(workflow,/ack-mode: \[normal, commit-unknown\]/);assert.match(workflow,/image: postgres:15\.8/);assert.match(workflow,/node-version: 20\.20\.1/);assert.match(workflow,/pg@8\.23\.1/);
 assert.match(workflow,/FAOLLA_CHECKOUT_FULL_REGISTRY_INSTALLATION_ACCEPTANCE: '1'/);assert.match(workflow,/node --import tsx --test scripts\/member-checkout-full-registry-installation-acceptance.mjs/);
 assert.match(workflow,/faolla-full-native-evidence\/report.json/);assert.match(workflow,/contents: read/);assert.match(workflow,/persist-credentials: false/);
 assert.doesNotMatch(workflow,/secrets\.|contents: write|workflow_dispatch:|workflow_run:|ssh |scp |output\//);
 for(const file of ['.github/workflows/member-checkout-real-auth.yml','.github/workflows/member-checkout-047-real-auth.yml','.github/workflows/member-checkout-full-registry-evidence.yml'])assert.doesNotMatch(await readFile(file,'utf8'),/FULL_REGISTRY_INSTALLATION_ACCEPTANCE|full-registry-installation-acceptance/);
});

test('test-driver financial imports accept exact ESM/CJS exports on the actual Node runtime and refuse missing or conflicting functions',()=>{
 const f=()=>{},other=()=>{},s={submitMemberCheckout:f},p=Object.fromEntries(['checkoutSubmissionIdentity','parseCheckoutSubmissionSnapshot','quoteCheckoutSubmissionSnapshot'].map(k=>[k,f]));
 for(const [submission,points] of [[s,p],[{default:s},{default:p}],[{...s,default:s},{...p,default:p}]]){
  const result=nativeCheckoutFinancialExports(submission,points);assert.equal(result.submission.submitMemberCheckout,f);assert.equal(result.points.checkoutSubmissionIdentity,f);assert.equal(Object.isFrozen(result),true);
 }
 for(const [submission,points] of [[{},p],[s,{}],[{...s,default:{submitMemberCheckout:other}},p],[{submitMemberCheckout:'not-a-function'},p]])assert.throws(()=>nativeCheckoutFinancialExports(submission,points));
 const code="const {nativeCheckoutFinancialExports}=await import('./scripts/member-checkout-full-registry-installation-imports.mjs');const value=nativeCheckoutFinancialExports(await import('./src/lib/merchantCheckoutSubmission.server.ts'),await import('./src/lib/merchantCheckoutSubmissionPlan.server.ts'));if(typeof value.submission.submitMemberCheckout!=='function'||typeof value.points.checkoutSubmissionIdentity!=='function')process.exit(1);";
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:process.cwd(),env:{},encoding:'utf8',timeout:15000});assert.ifError(result.error);assert.equal(result.status,0);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
});
