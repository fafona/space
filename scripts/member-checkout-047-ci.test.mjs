import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {assertCheckout047CiOptIn} from './member-checkout-047-ci-cases.mjs';

test('047 fixture upgrade is explicit and invalid flags do not silently fall back',()=>{
 for(const value of [undefined,'0'])assert.equal(assertCheckout047CiOptIn(value===undefined?{}:{FAOLLA_CHECKOUT_047_REVISION_ACCEPTANCE:value}),false);
 assert.equal(assertCheckout047CiOptIn({FAOLLA_CHECKOUT_047_REVISION_ACCEPTANCE:'1'}),true);
 for(const value of ['',true,1,'true','01','1 ',null])assert.throws(()=>assertCheckout047CiOptIn({FAOLLA_CHECKOUT_047_REVISION_ACCEPTANCE:value}),/flag_invalid/);
});
test('a 047 opt-in alone cannot connect or install outside the exact owned hosted CI environment',()=>{
 const code=`import {installOwnedCheckout047Revision} from './scripts/member-checkout-047-ci-cases.mjs';
 let queried=false;try {await installOwnedCheckout047Revision({}, {query(){queried=true;throw Error('unexpected_query');}});process.exitCode=2;}
 catch {if(queried)process.exitCode=3;}`;
 const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{cwd:process.cwd(),env:{FAOLLA_CHECKOUT_047_REVISION_ACCEPTANCE:'1'},encoding:'utf8',timeout:15000});
 assert.ifError(result.error);assert.equal(result.status,0);assert.equal(result.stderr,'');
});
test('the new workflow preserves the exact old matrix, owned services, pinned tools, build and cleanup path',async()=>{
 const old=await readFile('.github/workflows/member-checkout-real-auth.yml','utf8'),next=await readFile('.github/workflows/member-checkout-047-real-auth.yml','utf8');
 const section=(value,start,end)=>value.split(start)[1].split(end)[0];
 assert.equal(section(next,'    strategy:','    steps:'),section(old,'    strategy:','    steps:'));
 assert.equal(section(next,'    steps:','      - name: Validate Isolation Contracts'),section(old,'    steps:','      - name: Validate Isolation Contracts'));
 assert.match(next,/branches:\s+- acceptance\/member-checkout-real-auth-20261125/);
 assert.match(next,/permissions:\s+contents: read/);assert.match(next,/FAOLLA_CHECKOUT_047_REVISION_ACCEPTANCE: '1'/);
 assert.match(next,/FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE: \$\{\{ matrix.profile == 'current-auth' && '1' \|\| '0' \}\}/);
 assert.match(next,/run: node --import tsx --test scripts\/member-checkout-real-auth-acceptance.mjs/);
 assert.match(next,/if: always\(\)/);assert.match(next,/name: member-checkout-047-real-auth-\$\{\{ matrix.profile \}\}/);
 assert.match(next,/path: \$\{\{ runner.temp \}\}\/faolla-real-auth-evidence\/report.json/);
 assert.doesNotMatch(next,/secrets\.|id-token:|contents: write|workflow_run:|workflow_dispatch:|pull_request:|environment:|ssh |scp |deploy-production|production-deploy|git push|git merge/);
 assert.doesNotMatch(old,/FAOLLA_CHECKOUT_047_REVISION_ACCEPTANCE/);
 assert.match(old,/ack-mode: \[normal, commit-unknown\]/);
});
test('old compatibility and runtime assertions finish before the separate upgrade and real financial tests',async()=>{
 const fixture=await readFile('scripts/fixtures/member-checkout-real-auth-database.mjs','utf8'),runner=await readFile('scripts/member-checkout-real-auth-acceptance.mjs','utf8'),cases=await readFile('scripts/member-checkout-047-ci-cases.mjs','utf8');
 const oldCheck=fixture.indexOf('await checkoutCompatibilityCases(t, { db })'),runtime=fixture.indexOf('await installOwnedRuntimePrototype(t, { db })'),upgrade=fixture.indexOf('assertCheckout047CiOptIn()?await installOwnedCheckout047Revision(t,db)'),seed=fixture.indexOf('await createOwnedCheckoutData(db,runtimeCall)');
 assert.ok(oldCheck>0&&oldCheck<runtime&&runtime<upgrade&&upgrade<seed);
 assert.match(runner,/if\(financial.revision047\)report.revision047=financial.revision047/);
 assert.ok(cases.indexOf('assertIsolatedCi();assertOwnedLifecycleTarget(db)')<cases.indexOf('await db.query('));
 assert.match(cases,/count\(\*\)::int n from public.faolla_schema_migrations'\)\).rows\[0\].n,5/);
 assert.match(cases,/GRANT EXECUTE ON FUNCTION public.faolla_commit_redemption_v1\(text,jsonb\) TO faolla_checkout_executor/);
 // The installation must never grant the internal writer; the separately
 // rolled-back negative test deliberately grants it to prove refusal.
 assert.doesNotMatch(cases.split(' for(const [name,sql,issue]')[0],/GRANT EXECUTE ON FUNCTION public.faolla_commit_redemption_internal_v1/);
 assert.match(cases,/\['renamed original direct executor execution','GRANT EXECUTE ON FUNCTION public.faolla_commit_redemption_internal_v1/);
 assert.match(cases,/finally\{await db.query\('ROLLBACK'\);\}assert.deepEqual\(await read\(\),baseline\)/);
 assert.match(cases,/assert.equal\(passed,true,'checkout_047_ci_prerequisite_failed:'/);
 assert.doesNotMatch(cases,/deploymentReady:\s*true|productionAuthorized:\s*true|process\.env\.(?:SUPABASE|STRIPE|PG|DATABASE)/);
});
