//225 inert business probes. Caller owns both databases, dump/restore and cleanup.
//No connections, process startup, new writes, credentials or files are created here.
//RPC reads acquire row locks, so use checked ROLLBACK transactions, not READ ONLY.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './fixtures/attendance-outage-native.mjs';

const require=createRequire(import.meta.url),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const securityTables=Object.freeze({
 merchant_attendance_pin_credentials:"(to_jsonb(r)->>'enabled')='false'",
 merchant_attendance_terminals:"to_jsonb(r)->>'revoked_at' is not null",
 merchant_attendance_missing_delegation_revocations:'true',
 merchant_attendance_application_delegation_revocations:'true',
 merchant_attendance_schedule_delegation_revocations:'true',
 merchant_attendance_account_epochs:"(to_jsonb(r)->>'paused')='true'",
});
const copy=value=>JSON.parse(JSON.stringify(value));
function identity(ctx){
 assert(ctx?.d?.syntheticOnly===true&&ctx?.h?.syntheticOnly===true,'recovery_checks_synthetic_context_required');
 assert.equal(ctx.outageRelationsRacesFoundation?.phase,223,'recovery_checks_completed223_required');
 assert.match(ctx.scope?.schema??'',/^attendance_race_[a-f0-9]{32}$/);
 assert.equal(ctx.d.owned?.schema,ctx.scope.schema);assert.match(ctx.d.site,/^\d{8}$/);
 for(const value of [ctx.d.owner,ctx.h.workerId,ctx.h.employeeId,ctx.h.employeeAuthUserId,ctx.periodId])assert.match(value,uuid);
 return {schema:ctx.scope.schema,siteId:ctx.d.site,owner:ctx.d.owner,workerId:ctx.h.workerId,
  employeeId:ctx.h.employeeId,employeeAuthUserId:ctx.h.employeeAuthUserId,periodId:ctx.periodId};
}

export function attendanceRecoveryReadProbeSql({schema,names,expression,serviceRole=true}){
 assert.match(schema,/^attendance_race_[a-f0-9]{32}$/);assert.equal(typeof expression,'string');assert(expression.length>0);
 assert.equal(typeof serviceRole,'boolean');const hash=outageNativeFingerprintSql(names);
 return `begin;set local time zone 'UTC';set local datestyle='ISO, YMD';set local extra_float_digits=3;
 set local statement_timeout='15s';set local lock_timeout='3s';reset role;
 do $attendance_recovery_probe$ declare before_hash text;after_hash text;value jsonb;error_code text;error_state text;
 begin
  assert current_user='postgres','recovery_probe_owner_required';
  assert exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.oid='public.merchants'::regclass and n.nspname=${quote(schema)} and n.nspowner::regrole::text='postgres'),'recovery_probe_schema_required';
  before_hash:=${hash};
  begin ${serviceRole?'set local role service_role;':''}value:=(${expression});
  exception when others then get stacked diagnostics error_code=message_text,error_state=returned_sqlstate;end;
  reset role;after_hash:=${hash};assert before_hash=after_hash,'recovery_probe_read_changed_facts';
  perform set_config('faolla.recovery225_probe',jsonb_build_object('value',value,'error',error_code,'sqlState',error_state,
    'before',before_hash,'after',after_hash)::text,true);
 end;$attendance_recovery_probe$;
 select current_setting('faolla.recovery225_probe')::jsonb;rollback;`;
}
export async function runAttendanceRecoveryReadProbe(exec,options){
 assert.equal(typeof exec,'function');const value=JSON.parse(String(await exec(attendanceRecoveryReadProbeSql(options))).trim());
 assert.deepEqual(Object.keys(value).sort(),['after','before','error','sqlState','value']);
 assert.match(value.before,/^[0-9a-f]{32}$/);assert.equal(value.after,value.before,'recovery_probe_read_changed_facts');
 assert((value.error===null&&value.sqlState===null)||(typeof value.error==='string'&&typeof value.sqlState==='string'));
 return value;
}
export function assertAttendanceRecoveryArchive(value){
 assert(value&&typeof value.artifactText==='string');assert(Number.isSafeInteger(value.artifactBytes)&&value.artifactBytes>0);
 assert.equal(Buffer.byteLength(value.artifactText,'utf8'),value.artifactBytes,'recovery_archive_bytes');
 assert.equal(createHash('sha256').update(value.artifactText,'utf8').digest('hex'),value.artifactSha256,'recovery_archive_sha');
 assert.deepEqual(JSON.parse(value.artifactText),value.artifact,'recovery_archive_json');
 return {artifactText:value.artifactText,artifactBytes:value.artifactBytes,artifactSha256:value.artifactSha256};
}

function snapshotExpression(who,names){
 const site=quote(who.siteId),worker=quote(who.workerId);
 const security=Object.entries(securityTables).map(([name,revoked])=>quote(name)+','+(names.includes(name)?
  `(select jsonb_build_object('present',true,'rows',count(*),'inactiveOrRevoked',count(*) filter(where ${revoked}),
    'digest',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]')::text,'UTF8')),'hex'))
   from public.${name} r where merchant_id=${site})`:"jsonb_build_object('present',false,'rows',0,'inactiveOrRevoked',0,'digest',null)"));
 return `jsonb_build_object(
 'periods',(select coalesce(jsonb_agg(jsonb_build_object('periodId',p.period_id,'workerId',p.worker_id,'fromDate',p.from_date,
   'throughDate',p.through_date,'version',v.version) order by p.period_id,v.version),'[]') from public.merchant_attendance_period_closures p
   join public.merchant_attendance_period_versions v on v.merchant_id=p.merchant_id and v.period_id=p.period_id
   where p.merchant_id=${site} and p.worker_id=${worker}),
 'periodOperations',(select coalesce(jsonb_agg(jsonb_build_object('periodId',e.period_id,'operationId',e.operation_id,'actor',e.actor_auth_user_id,
   'access',case when e.actor_auth_user_id=${quote(who.owner)}::uuid then 'owner' else 'self' end) order by e.period_id,e.revision),'[]')
   from public.merchant_attendance_period_entries e join public.merchant_attendance_period_closures p using(merchant_id,period_id)
   where p.merchant_id=${site} and p.worker_id=${worker}),
 'outages',(select coalesce(jsonb_agg(jsonb_build_object('operationId',operation_id,'actor',actor_auth_user_id,'access',access) order by operation_id),'[]')
   from public.merchant_attendance_outage_operations where merchant_id=${site}),
 'relations',(select coalesce(jsonb_agg(jsonb_build_object('declarationId',declaration_id,'relatedDeclarationId',related_declaration_id,
   'operationId',operation_id,'actor',actor_auth_user_id,'revision',revision,'action',action) order by left_declaration_id,right_declaration_id,revision),'[]')
   from public.merchant_attendance_outage_relation_operations where merchant_id=${site}),
 'identity',(select jsonb_build_object('workerId',w.id,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,'workerVersion',w.version,
   'employeeVersion',e.version,'workerActive',w.active,'employeeStatus',e.status,'roleId',r.id,'roleStatus',r.status,'permissions',r.permissions,
   'generation',coalesce(ep.generation,0),'paused',coalesce(ep.paused,false),'suspensionId',ep.suspension_id)
   from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
   join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
   left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
   where w.merchant_id=${site} and w.id=${worker}),
 'security',jsonb_build_object(${security.join(',')}))`;
}

export function createAttendanceRecoveryBusinessPlan(who,snapshot){
 assert.match(who.siteId,/^\d{8}$/);for(const key of ['owner','workerId','employeeId','employeeAuthUserId','periodId'])assert.match(who[key],uuid);
 for(const key of ['periods','periodOperations','outages','relations'])assert(Array.isArray(snapshot[key])&&snapshot[key].length>0&&snapshot[key].length<=100,'recovery_checks_populated_bounded_'+key);
 assert.equal(snapshot.identity?.workerId,who.workerId);assert.equal(snapshot.identity.employeeId,who.employeeId);
 assert.equal(snapshot.identity.employeeAuthUserId,who.employeeAuthUserId);
 const result=[],base={siteId:who.siteId,access:'owner'},periodQuery=p=>({...base,workerId:p.workerId,fromDate:p.fromDate,throughDate:p.throughDate,
  mode:'export',periodId:p.periodId,operationId:null,version:p.version});
 for(const p of snapshot.periods){assert.match(p.periodId,uuid);assert.equal(p.workerId,who.workerId);assert(Number.isSafeInteger(p.version)&&p.version>0);
  result.push({kind:'period',query:periodQuery(p),actor:who.owner,pick:'archive'});}
 for(const o of snapshot.periodOperations){assert.match(o.operationId,uuid);assert.match(o.actor,uuid);assert(['owner','self'].includes(o.access));
  const p=snapshot.periods.find(p=>p.periodId===o.periodId);assert(p);
  result.push({kind:'period',query:{...periodQuery(p),access:o.access,mode:'recover',operationId:o.operationId,version:null},actor:o.actor,pick:'operation'});}
 for(const o of snapshot.outages){assert.match(o.operationId,uuid);assert.match(o.actor,uuid);assert(['owner','self'].includes(o.access));
  result.push({kind:'outage',query:{siteId:who.siteId,access:o.access,mode:'recover',operationId:o.operationId},actor:o.actor,pick:'receipt'});}
 const pairs=new Map();for(const o of snapshot.relations){
  for(const key of ['declarationId','relatedDeclarationId','operationId','actor'])assert.match(o[key],uuid);
  assert.notEqual(o.declarationId,o.relatedDeclarationId);assert(Number.isSafeInteger(o.revision)&&o.revision>0);assert(['apply','revoke'].includes(o.action));
  const q={...base,declarationId:o.declarationId,relatedDeclarationId:o.relatedDeclarationId,mode:'recover',operationId:o.operationId};
  result.push({kind:'relations',query:q,actor:o.actor,pick:'receipt'});
  const pair=[o.declarationId,o.relatedDeclarationId].sort().join(':');const prior=pairs.get(pair);if(!prior||prior.revision<o.revision)pairs.set(pair,o);
 }
 assert([...pairs.values()].some(o=>o.action==='revoke'),'recovery_checks_actual_revoked_relation_required');
 for(const o of pairs.values()){
  const q={...base,mode:'detail',declarationId:o.declarationId,relatedDeclarationId:o.relatedDeclarationId};
  result.push({kind:'relations',query:q,actor:who.owner,pick:'current',headAction:o.action,headRevision:o.revision});
  result.push({kind:'relations',query:{...q,access:'self'},actor:who.employeeAuthUserId,pick:'current',headAction:o.action,headRevision:o.revision});
 }
 const first=result.find(p=>p.kind==='relations'&&p.pick==='receipt');assert(first);
 result.push({...copy(first),actor:who.employeeAuthUserId,pick:'error',error:'attendance_access_denied'});
 result.push({...copy(first),query:{...first.query,declarationId:first.query.relatedDeclarationId,relatedDeclarationId:first.query.declarationId},pick:'error',error:'attendance_operation_conflict'});
 const rollback=snapshot.relations.find(o=>o.operationId==='00000000-0000-4000-8000-000223104012');assert(rollback,'recovery_checks_223_rollback_winner_required');
 result.push({kind:'relations',query:{...base,mode:'recover',declarationId:rollback.relatedDeclarationId,relatedDeclarationId:rollback.declarationId,
  operationId:'00000000-0000-4000-8000-000223104011'},actor:who.owner,pick:'error',error:'attendance_outage_relations_not_found'});
 return result;
}
function expression(probe){
 const name={period:'faolla_attendance_period_closure_v1',outage:'faolla_attendance_outage_v1',relations:'faolla_attendance_outage_relations_v1'}[probe.kind];assert(name);
 return `public.${name}(${json(probe.query)},${quote(probe.actor)},null,${probe.kind==='period'?'null,':''}false)`;
}
async function projected(probe,raw){
 if(probe.kind==='outage')return require('../src/lib/merchantAttendanceOutage.server.ts').projectOutageResult(raw,probe.query,probe.actor,null);
 if(probe.kind==='relations')return require('../src/lib/merchantAttendanceOutageRelations.server.ts').projectOutageRelationsResult(raw,probe.query,probe.actor,null);
 return require('../src/lib/merchantAttendancePeriodClosure.server.ts').executePeriodClosures({query:probe.query,authUserId:probe.actor,moduleEnabled:false},
  {rpc:async(name,args)=>{assert.equal(name,'faolla_attendance_period_closure_v1');assert.equal(args.p_command,null);assert.equal(args.p_artifact,null);
   assert.equal(args.p_allow_write,false);assert.deepEqual(args.p_query,probe.query);assert.equal(args.p_auth_user_id,probe.actor);return {data:raw,error:null};}});
}
async function probeValue(exec,config,probe){
 const packet=await runAttendanceRecoveryReadProbe(exec,{...config,expression:expression(probe)});
 if(probe.pick==='error'){assert.equal(packet.error,probe.error);assert.equal(packet.sqlState,'P0001');assert.equal(packet.value,null);return {error:packet.error};}
 assert.equal(packet.error,null,'recovery_business_rpc:'+probe.kind+':'+probe.query.mode+':'+packet.error);
 const parsed=await projected(probe,packet.value);
 if(probe.pick==='archive')return {...assertAttendanceRecoveryArchive(packet.value),period:parsed.period,artifactVersion:parsed.artifactVersion};
 if(probe.pick==='current'){assert.equal(parsed.current?.action,probe.headAction);assert.equal(parsed.revision,probe.headRevision);assert.equal(parsed.canWrite,false);
  return {revision:parsed.revision,current:parsed.current};}
 assert(parsed[probe.pick]);return copy(parsed[probe.pick]);
}

export async function captureAttendanceRecoveryBusinessBaseline(ctx){
 const who=identity(ctx);assert.equal(typeof ctx.native?.query,'function');assert.equal(typeof ctx.scope.sql,'function');
 const exec=sql=>ctx.native.query(ctx.scope.sql(sql)),names=ctx.d.inventory().slice().sort(),config={schema:who.schema,names};
 const packet=await runAttendanceRecoveryReadProbe(exec,{...config,expression:snapshotExpression(who,names),serviceRole:false});
 assert.equal(packet.error,null);const snapshot=packet.value,probes=createAttendanceRecoveryBusinessPlan(who,snapshot),expected=[];
 for(const probe of probes)expected.push(await probeValue(exec,config,probe));
 assert(expected.some(value=>value.artifactText===ctx.oldArchive.artifactText&&value.artifactSha256===ctx.oldArchive.artifactSha256),'recovery_checks_old155_archive_required');
 assert(probes.some(p=>p.pick==='archive'&&p.query.periodId===who.periodId),'recovery_checks_current_sealed_archive_required');
 const after=await runAttendanceRecoveryReadProbe(exec,{...config,expression:snapshotExpression(who,names),serviceRole:false});
 assert.equal(after.error,null);assert.equal(after.before,packet.before);assert.deepEqual(after.value,snapshot);
 return {protocol:'attendance-recovery-business-baseline-v1',who,names,factsHash:packet.before,snapshot,probes,expected};
}

export async function verifyAttendanceRecoveryNativeChecks(ctx,{restoredExec,baseline}){
 const who=identity(ctx);assert.equal(typeof restoredExec,'function');assert.equal(baseline?.protocol,'attendance-recovery-business-baseline-v1');
 assert.deepEqual(baseline.who,who);assert.deepEqual(baseline.probes,createAttendanceRecoveryBusinessPlan(who,baseline.snapshot));
 assert.equal(baseline.expected.length,baseline.probes.length);const config={schema:who.schema,names:baseline.names};
 const checkSnapshot=async()=>{const packet=await runAttendanceRecoveryReadProbe(restoredExec,{...config,expression:snapshotExpression(who,baseline.names),serviceRole:false});
  assert.equal(packet.error,null);assert.equal(packet.before,baseline.factsHash,'recovery_restored_business_facts_changed');assert.deepEqual(packet.value,baseline.snapshot);};
 await checkSnapshot();for(let i=0;i<baseline.probes.length;i++){
  const actual=await probeValue(restoredExec,config,baseline.probes[i]);assert.deepEqual(actual,baseline.expected[i],'recovery_restored_probe:'+i+':'+baseline.probes[i].kind);
 }await checkSnapshot();
 const counts=kind=>baseline.probes.filter(p=>p.pick===kind).length;
 const security=Object.fromEntries(Object.entries(baseline.snapshot.security).map(([name,value])=>[name,
  {present:value.present,rows:value.rows,inactiveOrRevoked:value.inactiveOrRevoked,status:!value.present?'not_installed':value.rows===0?'not_populated':'saved_state_equal',runtimeDenialTested:false}]));
 return {protocol:'attendance-recovery-business-checks-v1',archiveExports:counts('archive'),originalPeriodOperations:counts('operation'),
  originalOutageReceipts:baseline.probes.filter(p=>p.kind==='outage'&&p.pick==='receipt').length,
  originalRelationReceipts:baseline.probes.filter(p=>p.kind==='relations'&&p.pick==='receipt').length,
  ownerAndSelfRelationHeads:counts('current'),rejectedReads:counts('error'),targetProbeTransactions:baseline.probes.length+2,
  archiveBytesExact:true,originalReceiptsEqual:true,revokedRelationshipStillRevoked:true,currentIdentityAndPermissionStateEqual:true,
  pauseGeneration:baseline.snapshot.identity.generation,pauseState:baseline.snapshot.identity.paused,security,
  allProbesZeroFactWrites:true,allProbeTransactionsRolledBack:true,freshCommandsSent:0,realAuthentication:false,
  sourceWrites:false,callerOwnsRestoreAndCleanup:true};
}
