// Pure contract/static tests. No PostgreSQL, services or browser is started.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {continuationRacesPlan,continuationRacesProtectedHash,continuationRacesQuotaStart,continuationRacesAssertFootprint,
 continuationRacesLimit,continuationRacesBodyLimit,continuationRacesTables,verifyPeriodContinuationRacesNative} from './attendance-period-continuation-races-native.mjs';
const require=createRequire(import.meta.url),source=readFileSync(new URL('./attendance-period-continuation-races-native.mjs',import.meta.url),'utf8');
const {parsePeriodClosureV2Command,parsePeriodClosureV2Query}=require('../../src/lib/merchantAttendancePeriodClosureV2.ts');
const has=(...values)=>values.forEach(value=>assert(source.includes(value),value));
const ordered=(...values)=>{let at=-1;for(const value of values){at=source.indexOf(value,at+1);assert(at>=0,value);}};
const site='99990001',workerId=id(174703),employeeId=id(174701),employeeAuthUserId=id(174702),owner=id(99);

test('inert export refuses unowned context before connecting',async()=>{
 assert.equal(typeof verifyPeriodContinuationRacesNative,'function');await assert.rejects(verifyPeriodContinuationRacesNative({}),/races_owned_synthetic_context_required/);
 assert.doesNotMatch(source,/process\.argv|process\.env|spawn\(|listen\(|initdb|pg_ctl|CREATE DATABASE|playwright|chromium/);
});
test('fixed two dates, two periods and five successful IDs never include the losing CAS number',()=>{
 const p=continuationRacesPlan();assert.deepEqual(p.periods.map(x=>x.date),['2010-01-03','2010-01-04']);
 const ids=[...p.periods.flatMap(x=>[x.periodId,x.send]),p.confirm,p.seal,p.reopen,p.losingReopen];assert.equal(new Set(ids).size,8);
 assert(ids.every(x=>x.startsWith('00000000-0000-4000-8000-000232300')));assert.equal(p.periods.length,2);
 assert.equal(continuationRacesLimit,67108864);assert.equal(continuationRacesBodyLimit,262144);
});
test('quota injection and restoration use actual holder bytes, never old baseline or blind SUM healing',()=>{
 assert.deepEqual(continuationRacesQuotaStart(1000,301,405),{injected:67108563,full:67108864,restored:1301});
 for(const values of [[0,1,1],[100,-1,1],[100,262145,1],[100,1,262145],[67108863,1,1],[100,1.5,1]])assert.throws(()=>continuationRacesQuotaStart(...values));
 has("octet_length(convert_to(${json(args.p_artifact)}::text,'UTF8'))",'races_holder_actual_bytes','races_restore_exact_committed_footprint',
  'where merchant_id=${site} and used_bytes=${continuationRacesLimit}','set used_bytes=${baseline+injectionBytes}');
 assert.doesNotMatch(source,/set used_bytes\s*=\s*\(?select\s+sum|set used_bytes=\$\{baseline\}(?:;|\swhere)/i);
});
test('protected hash excludes only exact future rows and target quota; failed command and all other rows remain guarded',()=>{
 const p=continuationRacesPlan(),hash=continuationRacesProtectedHash([...continuationRacesTables,'merchant_attendance_events'],site);
 for(const period of p.periods){assert(hash.includes(period.periodId));assert(hash.includes(period.send));}
 for(const op of [p.confirm,p.seal,p.reopen])assert(hash.includes(op));assert(!hash.includes(p.losingReopen));
 assert(hash.includes('t.version=1'));assert(hash.includes(`t.merchant_id<>'${site}'`));
 assert(hash.includes('from public.merchant_attendance_events t )'));
 assert.throws(()=>continuationRacesProtectedHash(['bad;drop'],site));assert.throws(()=>continuationRacesProtectedHash(['merchants','merchants'],site));
 assert.throws(()=>continuationRacesProtectedHash(['merchants'],'bad'));
});
function fixture(){
 const plan=continuationRacesPlan(),receipts=new Map(),archives=new Map(),heads=new Map(),baseline=1000,stamp='2026-10-08T00:00:00.000001Z';
 const proof={usedBytes:baseline,actualBytes:baseline,heads:[],entries:[],versions:[],artifacts:[],metadata:[]};
 for(const [index,p]of plan.periods.entries()){
  const artifact={sourceFingerprint:(index?'b':'a').repeat(64),worker:{workerName:'Synthetic only',workerNo:'QA'}};
  const artifactText=JSON.stringify(artifact),saved={artifact,artifactText,artifactBytes:Buffer.byteLength(artifactText),artifactSha256:createHash('sha256').update(artifactText).digest('hex')};archives.set(p.send,saved);
  const actions=index?[['send',p.send]]:[['send',p.send],['confirm',plan.confirm],['seal',plan.seal],['reopen',plan.reopen]];
  for(const [i,[action,operationId]]of actions.entries()){
   const query=parsePeriodClosureV2Query({siteId:site,access:action==='confirm'?'self':'owner',workerId,fromDate:p.date,throughDate:p.date,mode:'detail',periodId:p.periodId,operationId:null,version:null,cursor:null});
   const command=parsePeriodClosureV2Command(query,{action,operationId,periodId:p.periodId,expectedRevision:i,expectedVersion:i?1:0,
    expectedFingerprint:action==='reopen'?null:artifact.sourceFingerprint,reason:'Synthetic pure test only'});
   const receipt={operationId,revision:i+1,version:1,actorId:action==='confirm'?employeeAuthUserId:owner,action,reason:command.reason,recordedAt:stamp,command};receipts.set(operationId,receipt);proof.entries.push(receipt);
  }
  const period={periodId:p.periodId,workerId,employeeId,employeeAuthUserId,fromDate:p.date,throughDate:p.date,currentVersion:1,revision:actions.length,state:index?'review':'open'};heads.set(p.periodId,period);
  proof.heads.push({period,openedAt:stamp,updatedAt:stamp,operationId:actions.at(-1)[1]});
  proof.versions.push({periodId:p.periodId,version:1,operationId:p.send,artifactId:p.send,recordedAt:stamp});
  proof.artifacts.push({...saved,periodId:p.periodId,artifactId:p.send,sourceFingerprint:artifact.sourceFingerprint,recordedAt:stamp});
  proof.metadata.push({merchant_id:site,artifact_id:p.send,worker_name:artifact.worker.workerName,worker_no:artifact.worker.workerNo});proof.actualBytes+=saved.artifactBytes;
 }
 proof.usedBytes=proof.actualBytes;return {proof,expected:{site,workerId,employeeId,employeeAuthUserId,baseline,receipts,archives,heads,plan}};
}
test('exact final proof requires two bodies, two versions, five parsed commands and exact actual byte charge',()=>{
 const {proof,expected}=fixture();assert.equal(continuationRacesAssertFootprint(proof,expected),proof.usedBytes-expected.baseline);
 assert.equal(proof.entries.length,5);assert.equal(proof.versions.length,2);
 const full={...proof,usedBytes:continuationRacesLimit};assert.equal(continuationRacesAssertFootprint(full,{...expected,projected:true}),proof.usedBytes-expected.baseline);
 assert.throws(()=>continuationRacesAssertFootprint(full,expected));
});
test('proof rejects extra or missing rows, changed saved bytes, wrong identity, altered commands and quota drift',()=>{
 const changes=[p=>p.entries.push({...p.entries[0],operationId:id(232300016)}),p=>p.entries.pop(),p=>p.versions.push({...p.versions[0],version:2}),
  p=>p.metadata[0].worker_name='tampered',p=>p.artifacts[0].artifactText+=' ',p=>p.artifacts[0].artifactBytes++,p=>p.artifacts[0].sourceFingerprint='c'.repeat(64),
  p=>p.heads[0].period.employeeAuthUserId=owner,p=>p.entries[0].command.reason='changed',p=>p.usedBytes++,p=>p.actualBytes--,
  p=>p.heads[0].openedAt='2026-10-08T00:00:00.000002Z'];
 for(const change of changes){const {proof,expected}=fixture(),copy=structuredClone(proof);change(copy);assert.throws(()=>continuationRacesAssertFootprint(copy,expected));}
});
test('real service projects SQL sources before final gate and every response comes from actual role-checked SQL',()=>{
 has('executePeriodClosuresV2({...input','const final=name===rpcName&&(input.command?args.p_command!==null:true)',
  'reachGate({args,name});await gate','set local role service_role',"assert current_user='service_role'",'rpc_value:=${expression}',"${final?'':'rollback;'}",
  "const accepted=await holder.outcome",'pg_blocking_pids(pid)','wait_event_type=\'Lock\'','Date.now()+2500');
 ordered('holder.release();const accepted=await holder.outcome','waiter.release();let witnessed=false',"await holder.step('commit;')",'const rejected=await waiter.outcome');
 assert.doesNotMatch(source,/return\s*\{data:\s*\{|mock.*success|pg_sleep\(/i);
});
test('quota is known rejection then explicit original-number retry, never an unknown automatic POST',()=>{
 ordered("stage='quota_writer_race'","expectedError:'attendance_period_storage_limit'",'const full=verifyProof()',"stage='exact_projection_restore'",
  'races_restore_exact_committed_footprint',"projected=false;injectionBytes=null;verifyProof()", "stage='known_rejected_original_retry'",'command:sendB,moduleEnabled:true');
 has('physicallyFilledBudget:false','injectedQuotaProjection:true','knownRejectedOriginalNumberRetried:true');
});
test('CAS loser and cross-actor recovery races preserve exact final collection; no old account mutation',()=>{
 has("expectedError:'attendance_version_conflict'","expectedError:'attendance_access_denied'",'assert.equal(receipts.size,5)',
  'assert(!receipts.has(plan.losingReopen))','assert.deepEqual(proof(),beforeReplay)','assert.equal(saved.sourceChanged,false)');
 assert.doesNotMatch(source,/update public\.(?:merchants|merchant_enterprise|merchant_attendance_workers)|insert into public\./i);
});
test('bounded existing timeouts, exact sessions only and parent-owned disposal on every failure',()=>{
 has("set local lock_timeout='3s';set local statement_timeout='10s';",'assert(++steps<=100','await connection.close()',
  'for(const s of [...sessions])','await s.outcome','ownedSchemaCleanupRequired:true','committedSyntheticRows:true',
  "['definitions',()=>d.definitions(),definitions]","['catalog',()=>d.tableCatalog(),catalog]",'periodContinuationArchiveBytes(periodArchive())');
 assert.doesNotMatch(source,/drop schema|delete from|truncate|disable trigger|session_replication_role|setTimeout\([^\n]*25000|closeAll\(/i);
 assert.doesNotMatch(source,/d\.exec\(`begin;|d\.exec\('begin;/);
});
test('external snapshots and byte measurement use the same serialization and owned guard as live sessions',()=>{
 has('const execRead=sql=>d.exec(periodContinuationSerialization+d.guard+sql)',
  "protectedBefore=execRead('select '+protectedSql+';')","const proof=()=>JSON.parse(execRead('select '+proofSql+';'))",
  'const bytes=args=>Number(execRead(',"['old facts',()=>execRead('select '+protectedSql+';'),protectedBefore]");
 assert.equal(source.match(/d\.exec\(/g)?.length,1);has("error:'races_rpc_transport_or_guard'",'context:String(error?.stack??error)');
});
test('embedded SQL proof aliases cannot collide with any RPC DO local variable',()=>{
 const declaration=source.match(/do \$period_race_rpc\$ declare ([^\n]+);begin/)?.[1];assert(declaration);
 const locals=declaration.split(';').map(part=>part.trim().split(/\s+/)[0]);
 assert.deepEqual(locals,['rpc_value','rpc_failure','rpc_state','rpc_context','before_proof']);
 const proof=source.slice(source.indexOf('const proofSql='),source.indexOf('const {executePeriodClosuresV2}'));
 const aliases=[...proof.matchAll(/from public\.\w+\s+([a-z_]+)\s+where/g)].map(match=>match[1]);
 assert.deepEqual(aliases.sort(),['c','e','m']);for(const name of locals)assert(!aliases.includes(name));
 has('rpc_failure=message_text,rpc_state=returned_sqlstate,rpc_context=pg_exception_context',
  "'value',rpc_value,'error',rpc_failure,'sqlstate',rpc_state,'context',rpc_context",
  "=before_proof,'races_read_or_replay_changed_new_facts'");
 assert.doesNotMatch(declaration,/\b(?:v|e|st|cx|b)\s+(?:jsonb|text)\b/);
 assert.match(source,/do \$races_restore\$ begin/);
});
