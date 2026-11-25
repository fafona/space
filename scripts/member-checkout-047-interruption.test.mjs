import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {assertCheckout047InterruptionCi,interruptionPhases} from './member-checkout-047-interruption-support.mjs';
import {createOwned047FileBackup,restoreOwned047FileBackup} from './member-checkout-047-owned-backup.mjs';
const env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:'fafona/space',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/acceptance/member-checkout-real-auth-20261125',GITHUB_SHA:'1'.repeat(40),RUNNER_TEMP:'/tmp/owned-ci-only',FAOLLA_CHECKOUT_REAL_AUTH_ACCEPTANCE:'1',FAOLLA_CHECKOUT_AUTH_TEST_PROFILE:'current-auth',FAOLLA_CHECKOUT_047_INTERRUPTION_ACCEPTANCE:'1'};
test('full installer kill rehearsal requires exact hosted CI, current protocol and separate opt-in',()=>{
 assert.equal(assertCheckout047InterruptionCi(env,'linux','x64').profileName,'current-auth');assert.deepEqual(interruptionPhases,['after-ddl','after-prepared','before-commit','after-commit']);assert.equal(Object.isFrozen(interruptionPhases),true);
 for(const [key,value] of [['GITHUB_ACTIONS','false'],['RUNNER_ENVIRONMENT','self-hosted'],['GITHUB_REPOSITORY','other/repo'],['GITHUB_EVENT_NAME','workflow_dispatch'],['GITHUB_REF','refs/heads/main'],['FAOLLA_CHECKOUT_AUTH_TEST_PROFILE','legacy'],['FAOLLA_CHECKOUT_047_INTERRUPTION_ACCEPTANCE','0'],['DATABASE_URL','private-sentinel']])assert.throws(()=>assertCheckout047InterruptionCi({...env,[key]:value},'linux','x64'));
 assert.throws(()=>assertCheckout047InterruptionCi(env,'win32','x64'));assert.throws(()=>assertCheckout047InterruptionCi(env,'linux','arm64'));
});
test('worker outside CI exits before IPC, filesystem selection or database client creation',()=>{
 const result=spawnSync(process.execPath,['scripts/member-checkout-047-interruption-worker.mjs'],{cwd:process.cwd(),env:{},encoding:'utf8',timeout:15000});
 assert.ifError(result.error);assert.equal(result.status,71);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
 let accessed=false;assert.throws(()=>createOwned047FileBackup({read(){accessed=true;}},'{}','/not-approved'));assert.equal(accessed,false);assert.throws(()=>restoreOwned047FileBackup({},{}));
});
test('worker installs fixed source only, saves prepared before receipt/commit and never accepts continue commands or endpoints',async()=>{
 const source=await readFile(new URL('./member-checkout-047-interruption-worker.mjs',import.meta.url),'utf8');
 assert.ok(source.indexOf('assertCheckout047InterruptionRequest(input)')<source.indexOf('new Client('));assert.match(source,/host:'127\.0\.0\.1',port:databasePort,database,user:'checkout_ci_admin'/);
 const ddl=source.indexOf('for(const step of bundle.material.steps)'),prepare=source.indexOf('appendCheckout047Prepared(context,seal)'),receipt=source.indexOf('INSERT INTO public.faolla_schema_migrations'),commit=source.indexOf("await db.query('COMMIT')");assert.ok(ddl<prepare&&prepare<receipt&&receipt<commit);
 for(const phase of interruptionPhases)assert.ok(source.includes("checkpoint('"+phase+"')"));
 assert.match(source,/await new Promise\(\(\)=>\{\}\)/);assert.match(source,/process\.once\('disconnect'/);assert.match(source,/setTimeout\(\(\)=>process.exit\(73\),45000\)/);
 assert.doesNotMatch(source,/connectionString|DATABASE_URL|SUPABASE|STRIPE|process\.env\.(?:PG|FAOLLA_CHECKOUT_RUNTIME)|UPDATE public\.pages|DROP|REVOKE|TRUNCATE/);
 const support=await readFile(new URL('./member-checkout-047-interruption-support.mjs',import.meta.url),'utf8');assert.match(support,/Object\.fromEntries\(\['GITHUB_ACTIONS'/);assert.doesNotMatch(support,/\.\.\.env|\.\.\.process\.env/);
});
test('backup helper remains CI-only, checks original identities, refuses all collisions and has no data/SQL repair capability',async()=>{
 const source=await readFile(new URL('./member-checkout-047-owned-backup.mjs',import.meta.url),'utf8');
 assert.match(source,/assertCheckout047InterruptionCi\(\)/);assert.match(source,/tickets\.has\(ticket\)/);assert.match(source,/sha\(wire\),ticket.sha256/);assert.match(source,/owned_backup_rebinding_refused/);assert.match(source,/owned_backup_operation_rebinding_refused/);assert.match(source,/owned_backup_conflict_retained/);
 assert.ok(source.indexOf('for(const [fd,name] of files)')<source.indexOf('for(const [fd,name,body] of files)'));assert.match(source,/O_EXCL\|fs.constants.O_NOFOLLOW/);assert.match(source,/hostLossRecoveryProved:false/);
 assert.doesNotMatch(source,/\bfetch\s*\(|\.query\(|node:child_process|unlinkSync|rmSync|chownSync|chmodSync|renameSync|productionAuthorized:\s*true/);
});
test('separate interruption job retains both original matrix and complete existing installation validation',async()=>{
 const workflow=await readFile('.github/workflows/member-checkout-047-real-auth.yml','utf8'),old=await readFile('.github/workflows/member-checkout-real-auth.yml','utf8');
 assert.match(workflow,/  interruption-047:/);assert.match(workflow,/FAOLLA_CHECKOUT_047_INTERRUPTION_ACCEPTANCE: '1'/);assert.match(workflow,/node --import tsx --test scripts\/member-checkout-047-interruption-acceptance.mjs/);
 assert.match(workflow,/name: member-checkout-047-interruption-\$\{\{ github.run_id \}\}/);assert.match(workflow,/faolla-interruption-047-evidence\/report.json/);assert.match(workflow,/ack-mode: \[normal, commit-unknown\]/);
 assert.doesNotMatch(workflow,/secrets\.|contents: write|workflow_dispatch:|workflow_run:|ssh |scp /);assert.doesNotMatch(old,/047-interruption|INTERRUPTION_ACCEPTANCE/);
});
