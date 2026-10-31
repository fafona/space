import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {applicationPublicationServicePlan,executeOrdinaryApplicationPublication} from './application-release-publish.mjs';
const target='a'.repeat(40),baseline='b'.repeat(40);
function operations({failure,recoveredTarget=baseline,recoveryFails=false}={}){
 const events=[];let failed=false;
 const step=async name=>{events.push(name);if(name===failure&&!failed){failed=true;throw Error('injected_'+name);}return{target,certificateSha256:'c'.repeat(64)};};
 return {events,target,admit:()=>step('admit'),stage:()=>step('stage'),activate:()=>step('activate'),audit:()=>step('audit'),complete:()=>step('complete'),
  failed:()=>step('failed'),recover:async()=>{await step('recover');if(recoveryFails)throw Error('unknown_recovery');return{actualTarget:recoveredTarget};}};
}
test('a durable service has fixed limits, independent stop recovery and no maintenance/database/worker mutation command',()=>{
 const plan=applicationPublicationServicePlan(target,baseline);
 assert.equal(plan.unit,'faolla-application-publish-'+target);
 assert.ok(plan.properties.includes('Restart=no'));
 assert.ok(plan.properties.includes('TimeoutStartSec=2700'));
 assert.ok(plan.properties.includes('TimeoutStopSec=1500'));
 assert.ok(plan.properties.includes('ExecStopPost=/usr/bin/node '+plan.entry+' recover '+target+' '+baseline));
 assert.deepEqual(plan.command,['/usr/bin/node',plan.entry,'run',target,baseline]);
 assert.doesNotMatch(JSON.stringify(plan),/database|migrate|restart|deploy-production\.sh|maintenance\.sh/);
 for(const values of [[target,target],['../x',baseline],[target,baseline+'\n']])assert.throws(()=>applicationPublicationServicePlan(...values));
});
test('completion requires stage, activate and independent audit, not a process exit or green source report',async()=>{
 const op=operations();assert.equal((await executeOrdinaryApplicationPublication(op)).target,target);
 assert.deepEqual(op.events,['admit','stage','activate','audit','complete']);
});
test('each uncertain step preserves failure then recovers once; verified rollback is not falsely called a publication',async()=>{
 for(const failure of ['stage','activate','audit','complete']){
  const op=operations({failure});await assert.rejects(executeOrdinaryApplicationPublication(op),/recovered_not_published/);
  assert.equal(op.events.filter(value=>value==='recover').length,1);assert.ok(op.events.indexOf('failed')<op.events.indexOf('recover'));
  assert.equal(op.events.at(-1),'recover');assert.equal(op.events.filter(value=>value==='stage').length,1);assert.equal(op.events.filter(value=>value==='activate').length,failure==='stage'?0:1);
 }
 const refused=operations({failure:'admit'});await assert.rejects(executeOrdinaryApplicationPublication(refused));assert.deepEqual(refused.events,['admit']);
});
test('an already committed healthy release finishes by read-only re-verification, never by replaying activation',async()=>{
 const op=operations({failure:'audit',recoveredTarget:target});await executeOrdinaryApplicationPublication(op);
 assert.deepEqual(op.events,['admit','stage','activate','audit','failed','recover','audit','complete']);
 const unknown=operations({failure:'activate',recoveryFails:true});await assert.rejects(executeOrdinaryApplicationPublication(unknown),/unknown_recovery/);
 assert.ok(!unknown.events.includes('complete'));
});
test('importing the actual controller and publisher is inert on ordinary developer machines',()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',"await import('./scripts/online-traffic-release.mjs');await import('./scripts/application-release-publish.mjs');",'application-import-fixture.mjs'],
  {encoding:'utf8',timeout:10000,maxBuffer:65536,windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
});
test('ordinary manifests and tooling trigger the existing mandatory safety workflow without removing any real acceptance',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/release-toolchain.yml',import.meta.url),'utf8');
 for(const value of ["'release/application-release.json'","'scripts/application-release*'",'node --test scripts/release-toolchain-*.test.mjs','scripts/application-release-*.test.mjs',
  'release-toolchain-full-rehearsal.mjs','release-toolchain-full-active-rehearsal.mjs','release-toolchain-pm2-real-acceptance.mjs',
  'release-toolchain-origin-gate-native.mjs','booking-atomic-worker.test.mjs'])assert.ok(workflow.includes(value),value);
 assert.doesNotMatch(workflow,/continue-on-error: true/);
});
