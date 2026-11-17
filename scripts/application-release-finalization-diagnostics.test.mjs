import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {APPLICATION_FINALIZATION_PHASES,applicationFinalizationFailure,observeApplicationFinalization} from './application-release-finalization-diagnostics.mjs';
import {executeOrdinaryApplicationPublication,ordinaryPublicationSteps,applicationPublicationServicePlan} from './application-release-publish.mjs';
const target='a'.repeat(40),hash=value=>createHash('sha256').update(value).digest('hex');

test('only exact known error codes survive; arbitrary text, credentials and stack never leave the reporter',()=>{
 const secret='password=private-token user@example.invalid /private/source.mjs';
 for(const message of [secret,'application_release_audit_'+secret,'booking_recovery_probe_'+secret]){
  const error=Error(message),record=applicationFinalizationFailure(error);
  assert.deepEqual(record,{code:'unclassified',exceptionMessageSha256:hash(message),detailsRedacted:true});
  assert.doesNotMatch(JSON.stringify(record),/private-token|example.invalid|source.mjs|password/);
 }
 for(const message of ['application_release_audit_worker_source','booking_recovery_probe_deadline','online_retention_writer_dump_process_changed','release_toolchain_source_changed'])assert.equal(applicationFinalizationFailure(Error(message)).code,message);
});
test('error getters, proxies and foreign inherited message properties are not evaluated',()=>{
 let calls=0;const getter={};Object.defineProperty(getter,'message',{get(){calls++;throw Error('secret');}});
 const proxy=new Proxy({},{get(){calls++;throw Error('secret');},getOwnPropertyDescriptor(){calls++;throw Error('secret');}});
 for(const error of [getter,proxy,Object.create({message:'secret'}),null,'secret'])assert.equal(applicationFinalizationFailure(error).exceptionMessageSha256,hash(''));
 assert.equal(calls,0);
});
test('observation returns the same result, with monotonic diagnostic timings but no completion authority',async()=>{
 const records=[],value={verified:true};let clock=100,calls=0;
 const result=await observeApplicationFinalization(target,'finish',async mark=>{calls++;clock+=7;mark('finish-retention');clock+=8;return value;},{emit:record=>records.push(record),clock:()=>clock});
 assert.equal(result,value);assert.equal(calls,1);assert.deepEqual(records.map(row=>[row.phase,row.event,row.elapsedMs]),[['finish-entry','enter',0],['finish-retention','enter',7],['finish-retention','returned',15]]);
 for(const row of records){assert.equal(row.publicationAuthority,false);assert.equal(row.publicationCompleted,false);}
});
test('the existing successful CLI protocol remains silent; only the dedicated diagnostic entry opts into progress output',async t=>{
 const output=t.mock.method(console,'error',()=>{}),value={same:true};
 assert.equal(await observeApplicationFinalization(target,'audit',mark=>{mark('audit-history');return value;}),value);
 assert.equal(output.mock.calls.length,0);
 const original=Error('application_release_audit_worker_source');
 await assert.rejects(observeApplicationFinalization(target,'audit',()=>{throw original;}),error=>error===original);
 assert.equal(output.mock.calls.length,1);
 const record=JSON.parse(output.mock.calls[0].arguments[0]);assert.equal(record.event,'threw');assert.equal(record.code,'application_release_audit_worker_source');
});
for(const scope of Object.keys(APPLICATION_FINALIZATION_PHASES))for(const phase of APPLICATION_FINALIZATION_PHASES[scope])test('isolation preserves the original refusal at '+phase+' without replay',async()=>{
 const records=[],original=Error('booking_recovery_probe_deadline'),events=[];
 await assert.rejects(observeApplicationFinalization(target,scope,async mark=>{for(const current of APPLICATION_FINALIZATION_PHASES[scope]){mark(current);events.push(current);if(current===phase)throw original;}},{emit:record=>records.push(record)}),error=>error===original);
 assert.equal(events.at(-1),phase);assert.equal(new Set(events).size,events.length);
 const failures=records.filter(row=>row.event==='threw');assert.equal(failures.length,1);assert.equal(failures[0].phase,phase);assert.equal(failures[0].code,'booking_recovery_probe_deadline');assert.ok(!records.some(row=>row.event==='returned'));
});
test('sink failure cannot turn a refusal into success, change the error or replay an action',async()=>{
 const original=Error('original-refusal');let calls=0;
 await assert.rejects(observeApplicationFinalization(target,'finish',async mark=>{calls++;mark('finish-final-audit');throw original;},{emit(){throw Error('sink-failed');}}),error=>error===original);
 assert.equal(calls,1);
 const value={same:true};assert.equal(await observeApplicationFinalization(target,'audit',()=>value,{emit(){throw Error('sink-failed');}}),value);
});
test('diagnostics expose no process, filesystem, network, gate or recovery control',()=>{
 const source=readFileSync(new URL('./application-release-finalization-diagnostics.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/from ['"]node:(?:fs|child_process|http|https|net|tls)['"]|fetch\(|process\.kill|writeFile|mkdir|unlink|rename|setInterval|setTimeout/);
});
test('the real publication coordinator still refuses a verified rollback, but the inner isolated cause is retained',async()=>{
 const records=[],events=[],original=Error('application_release_audit_worker_gate');
 const operations={
  target,admit:async()=>events.push('admit'),stage:async()=>events.push('stage'),
  activate:()=>observeApplicationFinalization(target,'finish',async mark=>{events.push('activate');mark('finish-precompletion-audit');throw original;},{emit:record=>records.push(record)}),
  failed:async error=>{assert.equal(error,original);events.push('failed');},
  recover:async()=>{events.push('recover');return{actualTarget:'b'.repeat(40)};},
  audit:async()=>{events.push('audit');},complete:async()=>{events.push('complete');},
 };
 await assert.rejects(executeOrdinaryApplicationPublication(operations),/application_publication_recovered_not_published/);
 assert.deepEqual(events,['admit','stage','activate','failed','recover']);
 assert.deepEqual(records.filter(row=>row.event==='threw').map(row=>[row.phase,row.code]),[['finish-precompletion-audit','application_release_audit_worker_gate']]);
 assert.ok(records.every(row=>row.publicationCompleted===false));
});
test('diagnostics do not alter a rolled-back candidate refusal, the 30-second probe or supervised service limits',()=>{
 assert.throws(()=>ordinaryPublicationSteps(target,'b'.repeat(40),{target,baseline:'b'.repeat(40),status:'rolled-back'}),/continuation_requires_review/);
 const plan=applicationPublicationServicePlan(target,'b'.repeat(40));
 assert.ok(plan.properties.includes('Restart=no'));assert.ok(plan.properties.includes('TimeoutStartSec=2700'));assert.ok(plan.properties.includes('TimeoutStopSec=1500'));
 const audit=readFileSync(new URL('./application-release-audit.mjs',import.meta.url),'utf8');
 const release=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.match(audit,/observeApplicationFinalization\(target,'audit',async mark=>/);
 for(const phase of APPLICATION_FINALIZATION_PHASES.audit.filter(phase=>phase!=='audit-entry'))assert.ok(audit.includes("mark('"+phase+"')"),phase);
 assert.match(audit,/requireCompletion=true/);assert.match(audit,/requireCompletion\)need\(state.applicationCompletion/);
 assert.match(audit,/deadlineAtMs:Date.now\(\)\+30000/);
 assert.match(audit,/historyObservation.finish\(\);verifyRuntime\(\)/);
 assert.match(release,/observeApplicationFinalization\(s.target,'finish',async mark=>/);
 for(const phase of APPLICATION_FINALIZATION_PHASES.finish.filter(phase=>phase!=='finish-entry'))assert.ok(release.includes("mark('"+phase+"')"),phase);
 assert.match(release,/while\(Date.now\(\)-started<160000\)/);assert.match(release,/readNaturalWorkerCycle\(current,Date.parse\(certificate.completedAt\),2\)/);
 assert.match(release,/restoreConfigs\(s\);return confirmBaseline\(s,'ordinary-application-verified-rollback'\)/);
});
