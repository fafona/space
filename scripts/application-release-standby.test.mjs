import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {applicationStandbyPlan,executeApplicationStandbyInspection,executeApplicationStandbyReconciliation,applicationStandbyMain} from './application-release-standby.mjs';
import {reviewedApplicationStandbyExecution,withApplicationStandbyExecution,assertApplicationStandbyCommandLine} from './application-release-authority.mjs';
import {applicationPublicationProof} from './application-release-publication-proof.mjs';
import {applicationRetentionFixture} from './test-support/application-release-retention-fixture.mjs';
import {buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {assertOnlineRetentionPlan,assertOnlineRetentionHistory,retentionHash} from './online-release-retention-policy.mjs';
const clone=structuredClone;
function standbyFixture(){
 const f=applicationRetentionFixture();
 const publication=buildOnlineRetentionReceipt(f.before,clone(f.before),f.recovery,f.history,
  {preparedAt:'2026-10-26T10:02:00.000Z',completedAt:'2026-10-26T10:02:01.000Z'});
 const history={...f.history,entries:[...f.history.entries,publication.certificate],headSha256:retentionHash(publication.certificate)};
 const before=clone(f.before),victim=f.original.certificate.rollback;
 delete before.applicationRelease;
 Object.assign(before,{kind:'retire',sequence:history.entries.length+1,previousSha256:history.headSha256,
  victim:{target:victim.target,process:clone(victim.process)},
  ancestry:[{older:victim.target,newer:f.target,verified:true},...before.ancestry],
  releaseProofs:[...before.releaseProofs,clone(f.fixture.before.releaseProofs.find(p=>p.target===victim.target))],
  daemon:{fact:{pid:99,startTicks:'90'},killSignal:'SIGINT',killTimeout:1600},victimChildren:'',
  victimRuntimeFlags:{backgroundPaused:'1',automationEnabled:'0',invitationEnabled:'0',manualSignalHandle:''},resolvedInterpreter:'/usr/bin/node'});
 assertOnlineRetentionPlan(before,history);
 const after=clone(before);
 after.processes=after.processes.map(p=>p.name===victim.name?{...p,pid:0,status:'stopped'}:p);
 after.listeners=after.listeners.filter(p=>p.pid!==victim.process.pid);
 after.identityProofs=after.identityProofs.filter(p=>p.pid!==victim.process.pid);
 return{f,history,before,after,publication,victim};
}
test('standby selection has fixed source paths and cannot select the candidate or its live baseline',()=>{
 const[target,baseline,victim]=['a','b','c'].map(c=>c.repeat(40));
 assert.deepEqual(applicationStandbyPlan(target,baseline,victim),{target,baseline,victimTarget:victim,source:'/var/lib/faolla-online-code/'+target,
  retainsFiles:true,retainsLogs:true,retainsRegistration:true,changesRoutes:false,changesDatabase:false});
 for(const values of [[target,baseline,target],[target,baseline,baseline],[target,target,victim],[target,baseline,'../x'],[target,baseline,victim+'\n']])
  assert.throws(()=>applicationStandbyPlan(...values));
});
test('the real kernel command must be the exact reviewed entry, not a rewritten JavaScript argv or eval wrapper',()=>{
 const options={target:'a'.repeat(40),baseline:'b'.repeat(40),victimTarget:'c'.repeat(40),action:'retire'};
 const command=['/usr/bin/node','/var/lib/faolla-online-code/'+options.target+'/scripts/application-release-standby.mjs',options.action,options.target,options.baseline,options.victimTarget];
 assert.equal(assertApplicationStandbyCommandLine(command,options),true);
 for(const changed of [['/usr/bin/node','--eval','spoofed'],[...command,'extra'],['/other/node',...command.slice(1)],command.map((v,i)=>i===2?'inspect':v)])
  assert.throws(()=>assertApplicationStandbyCommandLine(changed,options));
});
test('inspection performs the original complete retirement guards twice, never a stop or save',async()=>{
 const f=standbyFixture(),events=[];
 const operations={history:()=>f.history,observe:async()=>{events.push('observe');return clone(f.before);},wait:async ms=>{assert.equal(ms,2000);events.push('wait');},stop:()=>assert.fail('inspection cannot stop'),save:()=>assert.fail('inspection cannot save')};
 const result=await executeApplicationStandbyInspection(operations);
 assert.equal(result.stopped,false);assert.equal(result.victimTarget,f.victim.target);assert.deepEqual(events,['observe','wait','observe']);
});
test('active work, routing, connections, children, changed identity and unreviewed processes refuse before a stop',async()=>{
 for(const mutate of [v=>v.victimRuntimeFlags.backgroundPaused='0',v=>v.victimRuntimeFlags.automationEnabled='1',
  v=>v.victimChildren='123',v=>v.nginxConfig+=' '+v.victim.process.cwd,
  v=>v.established.push({localPort:v.victim.process.port,peerPort:443,pids:[v.victim.process.pid]}),
  v=>v.identityProofs.find(p=>p.name===v.victim.process.name).startTicks='999',
  v=>v.victim.process.watch=true,v=>v.sourceClean=false]){
  const f=standbyFixture();let calls=0;
  await assert.rejects(executeApplicationStandbyInspection({history:()=>f.history,wait:async()=>{},observe:async()=>{const v=clone(f.before);if(++calls===2)mutate(v);return v;}}));
 }
});
test('JSON flags and arbitrary calls cannot mint the standby authority or bypass the historic guard',async()=>{
 assert.equal(reviewedApplicationStandbyExecution('a'.repeat(40),'b'.repeat(40),'c'.repeat(40),'retire'),null);
 await assert.rejects(withApplicationStandbyExecution({target:'a'.repeat(40),baseline:'b'.repeat(40),victimTarget:'c'.repeat(40),action:'retire'},()=>assert.fail('must not enter')));
 await assert.rejects(applicationStandbyMain('retire','a'.repeat(40),'b'.repeat(40),'c'.repeat(40)));
 const writer=readFileSync(new URL('./online-release-retention-writer.mjs',import.meta.url),'utf8');
 assert.ok(writer.includes('}else assertOnlineToolNoPending();'));
 const entry=readFileSync(new URL('./application-release-standby.mjs',import.meta.url),'utf8');
 assert.ok(entry.includes('runOnlineRetentionUnderHeldLocks(options)'));
 assert.ok(!/spawnSync|execSync|\.unlink|\.rmSync|writeFileSync|process\.env\./.test(entry));
});
test('a certified standby retirement preserves the original application proof without replaying publication',()=>{
 const f=standbyFixture();
 const p=f.victim.process,recovery={name:p.name,pm_id:p.pmId,pid:p.pid,pm2_env:{status:p.status,pm_cwd:p.cwd,pm_exec_path:p.executable,
  exec_interpreter:p.interpreter,args:p.args,node_args:p.nodeArgs,exec_mode:p.execMode,watch:p.watch,cron_restart:p.cronRestart,
  kill_timeout:p.killTimeout,shutdown_with_message:p.shutdownWithMessage,restart_time:p.restartCount,created_at:p.createdAt,
  FAOLLA_BACKGROUND_JOBS_PAUSED:p.backgroundPaused,MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:p.automationEnabled,
  MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:p.invitationEnabled,PORT:String(p.port),env:{PORT:String(p.port)}}};
 const retired=buildOnlineRetentionReceipt(f.before,f.after,{version:2,process:recovery},f.history,
  {preparedAt:'2026-10-26T10:03:00.000Z',completedAt:'2026-10-26T10:03:01.000Z'});
 const history={...f.history,entries:[...f.history.entries,retired.certificate],headSha256:retentionHash(retired.certificate)};
 assertOnlineRetentionHistory(history);
 const proof=applicationPublicationProof(history,f.f.target);
 assert.equal(proof.manifestSha256,f.f.before.applicationRelease.manifestSha256);
 assert.deepEqual(proof.completionCertificates,[f.history.headSha256,history.headSha256]);
 assert.equal(proof.introduced.active.target,f.f.target);assert.equal(history.entries.at(-1).victim.target,f.victim.target);
 for(const mutate of [v=>v.entries.at(-1).rollback.target='a'.repeat(40),v=>v.entries.at(-1).active.target='a'.repeat(40),
  v=>v.entries.at(-1).kind='converge',v=>v.entries.at(-1).previousSha256='a'.repeat(64)]){
  const changed=clone(history);mutate(changed);assert.throws(()=>applicationPublicationProof(changed,f.f.target));
 }
 assert.throws(()=>applicationPublicationProof(history,'a'.repeat(40)));
});
test('importing the standby entry has no native host or process side effect',()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',"await import('./scripts/application-release-standby.mjs');"],{cwd:process.cwd(),encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');
});
test('only a complete exact standby tail may reconcile its head; no stop, save or partial-tail retry exists',async()=>{
 const expected={target:'a'.repeat(40),activeTarget:'b'.repeat(40),victimTarget:'c'.repeat(40)};
 const pending={status:'complete-uncommitted-tail',before:{kind:'retire',toolRevision:expected.target,active:{target:expected.activeTarget},victim:{target:expected.victimTarget}},history:{headSha256:'d'.repeat(64)}};
 let calls=0;const operations={inspect:()=>clone(pending),reconcile:async()=>{calls++;},history:()=>pending.history};
 const result=await executeApplicationStandbyReconciliation(operations,expected);assert.equal(calls,1);assert.equal(result.stopReplayed,false);assert.equal(result.saveReplayed,false);
 for(const mutate of [v=>v.status='incomplete-tail',v=>v.before.kind='converge',v=>v.before.toolRevision='e'.repeat(40),v=>v.before.active.target='e'.repeat(40),v=>v.before.victim.target='e'.repeat(40)]){
  calls=0;const changed=clone(pending);mutate(changed);await assert.rejects(executeApplicationStandbyReconciliation({...operations,inspect:()=>changed},expected));assert.equal(calls,0);
 }
 await assert.rejects(executeApplicationStandbyReconciliation({...operations,reconcile:async()=>{throw Error('retained_failure');}},expected),/retained_failure/);
});
