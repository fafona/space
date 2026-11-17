import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
import {chatContinuationServicePlan} from './application-release-chat-continuation.mjs';
import {CHAT_TARGET,CHAT_BASELINE,executeChatScopeClosure,completeChatRecovery} from './application-release-chat-policy.mjs';
const restored=()=>({actualTarget:CHAT_BASELINE,restored:true,publicProof:['https://faolla.com','https://launch.faolla.com'].map(origin=>({origin,status:200,buildId:CHAT_BASELINE}))});
test('the actual shared closure archives only after complete public proof, durable seal and unchanged ownership',async()=>{
 const events=[];await executeChatScopeClosure({verify:()=>events.push('verify'),seal:()=>events.push('seal'),archive:()=>events.push('archive')},async()=>{events.push('work');return restored();});assert.deepEqual(events,['work','verify','seal','verify','archive']);
 for(const failure of ['work','verify','seal']){
  const calls=[];const op=name=>{calls.push(name);if(name===failure)throw Error('failure_'+name);};
  await assert.rejects(executeChatScopeClosure({verify:()=>op('verify'),seal:()=>op('seal'),archive:()=>op('archive')},async()=>{op('work');return restored();}));assert.ok(!calls.includes('archive'));
 }
 for(const value of [{actualTarget:CHAT_TARGET,proof:{}},{...restored(),publicProof:[]},{...restored(),restored:false},{...restored(),publicProof:[...restored().publicProof,restored().publicProof[0]]}])await assert.rejects(executeChatScopeClosure({verify:()=>{},seal:()=>assert.fail('no invalid seal'),archive:()=>assert.fail('no invalid archive')},async()=>value));
});
test('the retained supervisor never rebuilds and uses an independent bounded no-restart recovery',()=>{
 const p=chatContinuationServicePlan('e'.repeat(40));assert.ok(p.properties.includes('Restart=no'));assert.ok(p.properties.includes('TimeoutStartSec=600'));assert.ok(p.properties.includes('TimeoutStopSec=1500'));assert.ok(p.properties.some(v=>v.startsWith('ExecStopPost=')&&v.endsWith(' recover')));assert.equal(p.command.at(-1),'run');assert.doesNotMatch(JSON.stringify(p),/build|migrate|database|restart/);assert.throws(()=>chatContinuationServicePlan(CHAT_TARGET));
});
test('the real continuation source preserves failures, full builds and original receipts',()=>{
 const text=readFileSync(new URL('./application-release-chat-continuation.mjs',import.meta.url),'utf8');
 for(const guard of ['assertChatPreserved({originalState:true})','original-state.json','prior-recovery.log','failure.json','completed.json','withApplicationCliLifetime'])assert.ok(text.includes(guard));
 assert.doesNotMatch(text,/unlinkSync|rmSync|rmdirSync|--force|npm.*build|process\.argv\s*=/);
});
test('actual Linux/root filesystem and CLI lifetime acceptance runs on the disposable CI runner',()=>{
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted')return;
 assert.equal(process.platform,'linux');
 const r=spawnSync('sudo',['-n','/usr/bin/node',new URL('./application-release-chat-native.mjs',import.meta.url).pathname],{encoding:'utf8',timeout:45000,windowsHide:true,maxBuffer:65536});assert.equal(r.status,0,r.stderr);const proof=JSON.parse(r.stdout);assert.equal(proof.kind,'chat-continuation-native-verified');assert.equal(proof.realFilesystem,true);assert.equal(proof.businessDataWritten,false);
});

test('new authority is issued in-process and all original source/build/data guards remain in force',()=>{
 const source=readFileSync(new URL('./application-release-chat-source.mjs',import.meta.url),'utf8');
 for(const guard of ['P.history','P.gate','P.dump','P.active','CHAT_REVIEWED_PARENT','assertUnchangedApplicationSource(TARGET,application.rows,tool.rows)','collectRemoteReleaseReview','assertReviewFresh','original-state.json','immutable_state_changed','built_artifacts_changed'])assert.ok(source.includes(guard),guard);
 const traffic=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const run=traffic.slice(traffic.indexOf('export async function runRetainedChatUnderLock'),traffic.indexOf('export async function runOnlineTrafficRelease'));
 for(const guard of ['reviewedChatApplicationSource()','assertApplicationExecutionSource()','chatContinuationPhase','configUnchanged(s)','verifyCandidate(s)','await smoke(s)','await activateCandidate(s)','await finishApplicationRelease','restoreConfigs','Date.now()+30000'])assert.ok(run.includes(guard),guard);
 assert.doesNotMatch(run,/npm|applyProductionDatabase|pm2|unlinkSync|rmSync|rmdirSync|setTimeout/);
 const lock=readFileSync(new URL('./online-release-retention-writer.mjs',import.meta.url),'utf8').split('export async function withChatContinuationLocks')[1];
 for(const guard of ['assertChatOperationOwner','flock','applicationOperationBirth','application_controller_still_present','startup_owner_ambiguous'.replace('startup','chat'),'fs.renameSync(OPERATION_LOCK,destination)'])assert.ok(lock.includes(guard),guard);
 assert.doesNotMatch(lock,/NAVIGATION_PINS|STARTUP_PINS|unlinkSync|rmSync|rmdirSync/);
});

test('both lock-held and already-closed recovery require a fresh independent proof before sealing completion',async()=>{
 const proof={kind:'ordinary-application-release-readonly-verified',target:CHAT_TARGET,baseline:CHAT_BASELINE,certificateSha256:'a'.repeat(64),workerPid:100,mailEnabled:false,businessDataWrittenByAudit:false,savedProcessConfigurationVerified:true,publicProof:['https://faolla.com','https://launch.faolla.com'].map(origin=>({origin,status:200,buildId:CHAT_TARGET}))};
 for(const value of [{actualTarget:CHAT_TARGET,replayed:false},{kind:'chat-continuation-already-completed',actualTarget:CHAT_TARGET,replayed:false}]){
  const events=[];const result=await completeChatRecovery(value,{audit:()=>{events.push('audit');return proof;},verify:()=>events.push('verify'),seal:()=>events.push('seal')});
  assert.equal(result.proof,proof);assert.deepEqual(events,['audit','verify','seal','verify']);
  for(const failure of ['audit','verify']){const calls=[];await assert.rejects(completeChatRecovery(value,{audit:()=>{calls.push('audit');if(failure==='audit')throw Error('audit');return proof;},verify:()=>{calls.push('verify');throw Error('verify');},seal:()=>calls.push('seal')}));assert.ok(!calls.includes('seal'));}
  await assert.rejects(completeChatRecovery(value,{audit:()=>({...proof,publicProof:[]}),verify:()=>{},seal:()=>assert.fail('no invalid receipt')}));
 }
 const value=restored();assert.equal(await completeChatRecovery(value,{audit:()=>assert.fail('rollback is not publication'),seal:()=>assert.fail('rollback is not publication')}),value);
 const source=readFileSync(new URL('./application-release-chat-continuation.mjs',import.meta.url),'utf8');assert.ok(source.includes('return completeRecovery(await closeOrRun(true))'));
});
