//241 INERT. Real124/191 RPCs; private192 getter as owned postgres, not Auth.
//Future instants select sources only. All writes, including disclosed settings /
//binding probes, are inside ONE owned transaction with unconditional rollback.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {operationalRulesNativeDocument,operationalRulesNativeQuery} from './attendance-operational-rules-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(241600000+n);
export const operationalSourceNativeIds=Object.freeze({groups:[uid(1),uid(2),uid(3)],assignments:[uid(11),uid(12),uid(13),uid(14)]});
const groupTables=['merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations'];
const ledgerTables=['merchant_attendance_operational_rule_streams','merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_publications'];

export function operationalSourceNativeDocuments(location,employee,auth){
 const enterprise=operationalRulesNativeDocument(location,employee,auth),group=structuredClone(enterprise),personal=structuredClone(enterprise);
 enterprise.correctionWindow.value.days=30;group.correctionWindow.value.days=14;personal.correctionWindow.value.days=7;
 enterprise.timesheetCycle.value={kind:'weekly',weekStartsOn:1};group.timesheetCycle.value={kind:'monthly'};personal.timesheetCycle.value={kind:'manual'};
 return [enterprise,group,personal];
}
export function operationalSourceOldRowsSql(names,site,scopes,mask={}){
 const streams=scopes.map(s=>`${json(s)} is not distinct from r.scope`).join(' or ');
 return '(select md5(jsonb_object_agg(n,v order by n)::text) from ('+names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  let exclude='false';
  if(ledgerTables.includes(name))exclude=name.endsWith('_publications')?
   `r.stream_key in (${scopes.map(s=>`public.faolla_attendance_operational_rule_scope_v1(${json(s)})::text`).join(',')})`:`(${streams})`;
  else if(groupTables.includes(name))exclude=`r.${name.includes('assignment')?'assignment_id':'group_id'} in (${operationalSourceNativeIds[name.includes('assignment')?'assignments':'groups'].map(quote).join(',')})`;
  const projection=mask[name];let row='to_jsonb(r)';
  if(projection){assert(typeof projection.where==='string');assert(projection.columns.every(k=>/^[a-z_]+$/.test(k)));
   row=`case when ${projection.where} then to_jsonb(r)-array[${projection.columns.map(quote).join(',')}] else to_jsonb(r) end`;}
  const where=exclude==='false'?'':` where not(r.merchant_id=${quote(site)} and (${exclude}))`;
  return `select ${quote(name)} n,(select coalesce(jsonb_agg(v order by v::text),'[]') from (select ${row} v from public.${name} r${where}) s) v`;
 }).join(' union all ')+') old_rows)';
}

export async function verifyOperationalSourceNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'operational_source_owned_synthetic_required');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 assert.equal(d.owned.schema,scope.schema);assert.equal(d.owned.owner,'postgres');
 const {executeOperationalRuleLedger}=require('../../src/lib/merchantAttendanceOperationalRuleLedger.server.ts');
 const {executeGroups}=require('../../src/lib/merchantAttendanceGroups.server.ts');
 const {parseOperationalRuleSource,resolveOperationalRuleSource}=require('../../src/lib/merchantAttendanceOperationalRuleSource.ts');
 const names=d.inventory(),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
 const savedArchive=periodContinuationArchiveBytes(await archive()),savedPeriod=periodContinuationArchiveBytes(await periodArchive());
 const scopes=[{kind:'enterprise'},{kind:'group',groupId:operationalSourceNativeIds.groups[0]},
  {kind:'personal',workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId}];
 const fullHash=outageNativeFingerprintSql(names),oldHash=operationalSourceOldRowsSql(names,d.site,scopes),site=quote(d.site);
 const prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000});
 let steps=0,reads=0,writes=0,rejections=0,sourceReads=0,serial=100,stage='begin',lastRpc=null,lastStepFailure=null,rolledBack=false;
 const step=async(label,sql)=>{stage=label;assert(++steps<=120,'operational_source_max120_steps');
  try{return await connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));}
  catch(error){lastStepFailure=String(error?.stack??error).slice(0,12000);throw error;}};
 const call=async(label,expression,{write=false,role='service_role'}={})=>{
  assert(['postgres','service_role'].includes(role));
  const r=JSON.parse(await step(label,`do $ops241_call$ declare b text;o text;rpc_value jsonb;e text;s text;c text;begin
   b:=${fullHash};o:=${oldHash};begin set local role ${role};assert current_user=${quote(role)};rpc_value:=${expression};
   set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics e=message_text,s=returned_sqlstate,c=pg_exception_context;end;reset role;
   assert ${oldHash}=o,'operational_source_RPC_changed_old_rows';
   if e is not null or ${!write} then assert ${fullHash}=b,'operational_source_read_or_reject_changed_facts';end if;
   perform set_config('faolla.ops241_result',jsonb_build_object('value',rpc_value,'error',e,'sqlstate',s,'context',c)::text,true);
  end;$ops241_call$;select current_setting('faolla.ops241_result')::jsonb;`));
  lastRpc=r;if(r.error)rejections++;else if(write)writes++;else reads++;return r;
 };
 const service={rpc:async(name,args)=>{
  assert(['faolla_attendance_groups_v1','faolla_attendance_operational_rules_v1'].includes(name));
  assert.deepEqual(Object.keys(args).sort(),['p_query','p_auth_user_id','p_command','p_allow_write'].sort());
  assert.equal(args.p_query.siteId,d.site);assert.equal(args.p_auth_user_id,d.owner);
  const r=await call('RPC_'+name+'_'+(args.p_command?.action??args.p_query.mode??args.p_query.view),
   `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args.p_allow_write})`,{write:args.p_command!==null});
  return {data:r.value,error:r.error?{message:r.error}:null};
 }};
 const ledger=(sc,mode='detail',patch={},command=null)=>executeOperationalRuleLedger({query:operationalRulesNativeQuery(d.site,sc,mode,patch),command,authUserId:d.owner,allowWrite:true},service);
 const gq=patch=>({siteId:d.site,view:'context',groupId:null,workerId:null,onDate:null,assignmentId:null,operationId:null,cursorId:null,...patch});
 const group=(q,c=null)=>executeGroups({query:q,command:c,authUserId:d.owner,allowWrite:true},service);
 const sourceExpression=(at,employee=h.employeeId,auth=h.employeeAuthUserId)=>`public.faolla_attendance_operational_source_v1(${site},${quote(h.workerId)},${quote(employee)},${quote(auth)},${quote(at)}::timestamptz)`;
 const source=async(at)=>{
  const r=await call('private_source',sourceExpression(at),{role:'postgres'});assert.equal(r.error,null,JSON.stringify(r));sourceReads++;
  const expected={siteId:d.site,workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,at};
  assert.deepEqual(await parseOperationalRuleSource(r.value,expected),r.value);
  const p=await resolveOperationalRuleSource(r.value,expected);assert.deepEqual(p.source,r.value);
  assert.equal(p.candidate.applied,false);assert.equal(p.candidate.authorityChecked,false);assert.equal(p.candidate.candidateOnly,true);return p;
 };
 const denySource=async(label,expression,error,role='postgres')=>{const r=await call(label,expression,{role});assert.equal(r.error,error,JSON.stringify(r));return r;};
 const savepoint=async name=>{assert(/^[a-z0-9_]+$/.test(name));return step('save_'+name,`savepoint ${name};select ${fullHash};`);};
 const restore=async(name,before)=>assert.equal(await step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};select ${fullHash};`),before);
 const setup=async(label,table,where,columns,sql)=>{
  const protectedHash=operationalSourceOldRowsSql(names,d.site,scopes,{[table]:{where,columns}});
  await step(label,`do $ops241_setup$ declare b text;begin assert current_user='postgres';b:=${protectedHash};${sql}
   assert found,'operational_source_setup_exact_row_required';set constraints all immediate;set constraints all deferred;
   assert ${protectedHash}=b,'operational_source_setup_changed_unapproved_fields';end;$ops241_setup$;select 1;`);
 };
 const make=(sc,revision,action,patch)=>({siteId:d.site,scope:sc,operationId:uid(++serial),expectedRevision:revision,action,reason:'Synthetic241 source-only future choice, not business adoption',...patch});
 try{
  const profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';
   do $ops241_pre$ begin assert current_user='postgres';
    assert exists(select 1 from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
      where w.merchant_id=${site} and w.id=${quote(h.workerId)} and w.employee_id=${quote(h.employeeId)} and e.auth_user_id=${quote(h.employeeAuthUserId)} and w.active and e.status='active');
    assert not exists(select 1 from public.merchant_attendance_group_assignments where merchant_id=${site} and worker_id=${quote(h.workerId)}),'operational_source_requires_unassigned_synthetic_worker';
    ${ledgerTables.map(t=>`assert not exists(select 1 from public.${t} where merchant_id=${site}),'operational_source_requires_empty_new_ledger';`).join(' ')}
    assert not exists(select 1 from public.merchant_attendance_groups where merchant_id=${site} and group_id in(${operationalSourceNativeIds.groups.map(quote).join(',')}));
    assert not exists(select 1 from public.merchant_attendance_group_assignments where merchant_id=${site} and assignment_id in(${operationalSourceNativeIds.assignments.map(quote).join(',')}));
   end;$ops241_pre$;
   select jsonb_build_object('beforeHash',${oldHash},'location',(select id from public.merchant_attendance_locations where merchant_id=${site} and active order by id limit 1),
    'day',(select to_char((clock_timestamp() at time zone time_zone)::date+3,'YYYY-MM-DD') from public.merchant_attendance_settings where merchant_id=${site}),
    'baseline',(select jsonb_build_object('operationId',operation_id,'revision',revision,'recordedAt',to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'submissionWindowDays',payload->'submissionWindowDays','timeZone',payload->'timeZone') from public.merchant_attendance_correction_controls where merchant_id=${site} and action='set_policy' order by recorded_at desc,revision desc limit 1));`));
  assert(profile.location&&profile.baseline&&profile.day,'operational_source_real_baseline_required');
  const day=n=>new Date(Date.parse(profile.day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const beforeAt=day(-1)+'T12:00:00.000000Z',empty=await source(beforeAt);
  assert.deepEqual(empty.source.layers,{enterprise:null,group:null,personal:null});assert.equal(empty.source.groupAssignmentRef,null);
  assert.deepEqual(empty.source.baselineCorrectionPolicyRef,profile.baseline);assert.equal(empty.candidate.fields.timesheetCycle.state,'unconfigured');
  for(const groupId of operationalSourceNativeIds.groups)await group(gq({}),{operationId:groupId,action:'save_group',groupId,expectedRevision:0,
   name:'Synthetic241 source group '+groupId.slice(-2),description:'',active:true,reason:'Synthetic241 actual124 group'});
  const assign=async(assignmentId,groupId,startsOn,endsOn)=>{
   const q=gq({groupId,workerId:h.workerId}),current=await group(q);
   const command={operationId:assignmentId,action:'assign',groupId,workerId:h.workerId,expectedGroupRevision:current.group.revision,
    expectedWorkerVersion:current.worker.version,expectedSettingsVersion:current.settingsVersion,timeZone:current.timeZone,startsOn,endsOn,reason:'Synthetic241 actual124 assignment'};
   const result=await group(q,command);assert.deepEqual(result.receipt.command,command);return result;
  };
  await assign(operationalSourceNativeIds.assignments[0],scopes[1].groupId,day(0),day(10));
  const documents=operationalSourceNativeDocuments(profile.location,h.employeeId,h.employeeAuthUserId),publications=[];
  for(let n=0;n<scopes.length;n++){
   const sc=scopes[n],first=(await ledger(sc)).data;assert.equal(first.revision,0);assert(first.context);
   await ledger(sc,'detail',{},make(sc,0,'save_draft',{expectedContext:first.context,rules:documents[n]}));
   const preview=(await ledger(sc,'preview',{sourceDraftRevision:1,effectiveOn:day(0),endsOn:n===2?day(2):null})).data;
   const command=make(sc,1,'publish',{sourceDraftRevision:1,effectiveOn:preview.effectiveOn,endsOn:preview.endsOn,previewFingerprint:preview.previewFingerprint});
   await ledger(sc,'detail',{},command);publications.push((await ledger(sc)).data.nextPublication);
  }
  assert(publications.every(Boolean));
  const at=publications[2].effectiveAt,chosen=await source(at);
  assert.deepEqual(chosen.source.layers.enterprise.rules,documents[0]);assert.deepEqual(chosen.source.layers.group.rules,documents[1]);assert.deepEqual(chosen.source.layers.personal.rules,documents[2]);
  assert.equal(chosen.source.groupAssignmentRef.assignmentId,operationalSourceNativeIds.assignments[0]);
  assert.deepEqual(chosen.candidate.fields.timesheetCycle.value,{kind:'manual'});assert.deepEqual(chosen.candidate.fields.correctionWindow.value,{days:7});
  assert.equal(chosen.candidate.fields.correctionWindow.constrainedDays,Math.min(7,profile.baseline.submissionWindowDays));
  assert.deepEqual(chosen.candidate.fields.locationScope.value,[profile.location]);
  const expired=await source(publications[2].endsAt);assert.equal(expired.source.layers.personal,null);
  assert.deepEqual(expired.candidate.fields.timesheetCycle.value,{kind:'monthly'});
  const personal=scopes[2],withdraw=make(personal,2,'withdraw',{publishedRevision:2});await ledger(personal,'detail',{},withdraw);
  const revoked=await source(at);assert.equal(revoked.source.layers.personal,null);assert.equal(revoked.source.layers.group.operationId,publications[1].operationId);
  await denySource('wrong_auth',sourceExpression(at,h.employeeId,uid(9000)),'attendance_operational_source_identity_changed');
  await denySource('wrong_employee',sourceExpression(at,uid(9001)),'attendance_operational_source_identity_changed');
  const acl=await denySource('private_service_EXECUTE',sourceExpression(at),`permission denied for function faolla_attendance_operational_source_v1`,'service_role');assert.equal(acl.sqlstate,'42501');

  //124 permits a nullable saved employee. Capture such a real assignment while
  //only this synthetic worker binding is temporarily null; do not rewrite its
  //immutable command/snapshot to manufacture an old identity.
  const oldIdentity=await savepoint('ops241_identity');
  await setup('synthetic_worker_unbind','merchant_attendance_workers',`r.merchant_id=${site} and r.id=${quote(h.workerId)}`,['employee_id','version'],
   `update public.merchant_attendance_workers set employee_id=null,version=version+1 where merchant_id=${site} and id=${quote(h.workerId)} and employee_id=${quote(h.employeeId)};`);
  const legacy=await assign(operationalSourceNativeIds.assignments[1],scopes[1].groupId,day(40),day(40));assert.equal(legacy.detail.employeeId,null);
  await setup('synthetic_worker_restore_binding','merchant_attendance_workers',`r.merchant_id=${site} and r.id=${quote(h.workerId)}`,['employee_id','version'],
   `update public.merchant_attendance_workers set employee_id=${quote(h.employeeId)},version=version+1 where merchant_id=${site} and id=${quote(h.workerId)} and employee_id is null;`);
  await denySource('legacy_assignment_not_fallback',sourceExpression(day(40)+'T12:00:00.000000Z'),'attendance_operational_source_identity_changed');
  await restore('ops241_identity',oldIdentity);

  //Adjacent civil dates do not overlap under124, yet the two REAL saved-zone
  //assignments overlap in UTC. Settings edits are disclosed setup, not business
  //configuration requests; all original settings fields and versions roll back.
  const zones=await savepoint('ops241_zones');
  const setZone=zone=>setup('synthetic_saved_zone_'+zone,'merchant_attendance_settings',`r.merchant_id=${site}`,['time_zone','version'],
   `update public.merchant_attendance_settings set time_zone=${quote(zone)},version=version+1 where merchant_id=${site};`);
  await setZone('Pacific/Pago_Pago');
  const west=await assign(operationalSourceNativeIds.assignments[2],operationalSourceNativeIds.groups[1],day(20),day(20));
  await setZone('Pacific/Kiritimati');
  const east=await assign(operationalSourceNativeIds.assignments[3],operationalSourceNativeIds.groups[2],day(21),day(21));
  assert.equal(west.detail.timeZone,'Pacific/Pago_Pago');assert.equal(east.detail.timeZone,'Pacific/Kiritimati');
  const overlap=day(21)+'T00:00:00.000000Z';
  await denySource('two_saved_zones_ambiguous',sourceExpression(overlap),'attendance_operational_source_ambiguous');
  await restore('ops241_zones',zones);
  assert.equal(await step('original_rows_before_rollback',`select ${oldHash};`),profile.beforeHash);
  await step('rollback','rollback;');rolledBack=true;
  return {phase:241,groups:['no_layers_and_existing_baseline','real_three_scope_publications','personal_expiry_and_withdrawal',
   'identity_and_private_ACL','old_nullable_assignment_identity','two_saved_timezones_ambiguous'],steps,reads,writes,rejections,sourceReads,
   fixtureSetup:{groupsViaRealRpc:3,assignmentsViaRealRpc:4,ledgerPublicationsViaRealRpc:3,settingsZoneUpdates:2,workerBindingUpdates:2,
    syntheticIdentityAndZoneSetup:true,futureInstantsSelectionOnly:true},rollbackRestored:true,oldFactsUnchanged:true,oldArchivesUnchanged:true,
   getterRole:'owned_postgres',actualAuthenticatedGetter:false,ruleAdoption:false,production:false};
 }catch(error){throw new Error('operational_source_native_stage:'+stage+':'+(error?.stack??error)+':'+JSON.stringify({lastRpc,lastStepFailure}));}
 finally{
  try{if(!rolledBack)await connection.step('rollback;');}finally{await connection.close();}
  assert.equal(d.fingerprint(),baseline);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),savedArchive);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),savedPeriod);
 }
}
