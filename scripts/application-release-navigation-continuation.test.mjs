import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
import {navigationContinuationServicePlan} from './application-release-navigation-continuation.mjs';
import {NAVIGATION_TARGET,NAVIGATION_BASELINE,executeNavigationScopeClosure} from './application-release-navigation-policy.mjs';
const restored=()=>({actualTarget:NAVIGATION_BASELINE,restored:true,publicProof:['https://faolla.com','https://launch.faolla.com'].map(origin=>({origin,status:200,buildId:NAVIGATION_BASELINE}))});
test('the actual shared closure archives only after complete public proof, durable seal and unchanged ownership',async()=>{
 const events=[];await executeNavigationScopeClosure({verify:()=>events.push('verify'),seal:()=>events.push('seal'),archive:()=>events.push('archive')},async()=>{events.push('work');return restored();});assert.deepEqual(events,['work','verify','seal','verify','archive']);
 for(const failure of ['work','verify','seal']){
  const calls=[];const op=name=>{calls.push(name);if(name===failure)throw Error('failure_'+name);};
  await assert.rejects(executeNavigationScopeClosure({verify:()=>op('verify'),seal:()=>op('seal'),archive:()=>op('archive')},async()=>{op('work');return restored();}));assert.ok(!calls.includes('archive'));
 }
 for(const value of [{actualTarget:NAVIGATION_TARGET,proof:{}},{...restored(),publicProof:[]},{...restored(),restored:false},{...restored(),publicProof:[...restored().publicProof,restored().publicProof[0]]}])await assert.rejects(executeNavigationScopeClosure({verify:()=>{},seal:()=>assert.fail('no invalid seal'),archive:()=>assert.fail('no invalid archive')},async()=>value));
});
test('the retained supervisor never rebuilds and uses an independent bounded no-restart recovery',()=>{
 const p=navigationContinuationServicePlan('e'.repeat(40));assert.ok(p.properties.includes('Restart=no'));assert.ok(p.properties.includes('TimeoutStartSec=2700'));assert.ok(p.properties.includes('TimeoutStopSec=1500'));assert.ok(p.properties.some(v=>v.startsWith('ExecStopPost=')&&v.endsWith(' recover')));assert.equal(p.command.at(-1),'run');assert.doesNotMatch(JSON.stringify(p),/build|migrate|database|restart/);assert.throws(()=>navigationContinuationServicePlan(NAVIGATION_TARGET));
});
test('the real continuation source preserves failures, full builds and original receipts',()=>{
 const text=readFileSync(new URL('./application-release-navigation-continuation.mjs',import.meta.url),'utf8');
 for(const guard of ['assertNavigationPreserved({originalState:true})','original-state.json','prior-recovery.log','failure.json','completed.json','withApplicationCliLifetime'])assert.ok(text.includes(guard));
 assert.doesNotMatch(text,/unlinkSync|rmSync|rmdirSync|--force|npm.*build|process\.argv\s*=/);
});
test('actual Linux/root filesystem and CLI lifetime acceptance runs on the disposable CI runner',()=>{
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted')return;
 assert.equal(process.platform,'linux');
 const r=spawnSync('sudo',['-n','/usr/bin/node',new URL('./application-release-navigation-native.mjs',import.meta.url).pathname],{encoding:'utf8',timeout:45000,windowsHide:true,maxBuffer:65536});assert.equal(r.status,0,r.stderr);const proof=JSON.parse(r.stdout);assert.equal(proof.kind,'navigation-continuation-native-verified');assert.equal(proof.realFilesystem,true);assert.equal(proof.businessDataWritten,false);
});
