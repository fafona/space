// Local synthetic base rows only. Every normal group/assignment and receipt is
// written by124, never a simulated RPC result or pre-created attendance fact.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',foreign='99990002',owner=id(99),other=id(98),workerId=id(201),otherWorkerId=id(202),inactiveWorkerId=id(203),foreignWorkerId=id(204);
const rpc='faolla_attendance_groups_v1',migrationName='202610030124_merchant_attendance_groups.sql';
const changed=Object.freeze(['merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations']);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const labels=Object.freeze([
  'groups installs/reapplies124 with unchanged owner/ACL/indexes/facts and zero seeded groups, assignments or clock facts',
  'groups actual owner RPC creates28 groups and30 assignments, preserving original worker/name/employee/date snapshots',
  'groups and assignment25+3 UUID pages include inactive/cancelled history and date-label filters without pretending historical as-of',
  'groups end preserves earlier dates, subsequent cross-group labels are allowed, and cancellation retains complete three-step history',
  'groups paused original GET/POST recovery retains historical receipts and rejects replacement/cross-ledger operation IDs',
  'groups rechecks owner, scope, activity and version while historical end/cancel remain possible after worker/group changes',
  'groups validates strict shapes, trimmed Unicode, inclusive dates, real IANA endpoints and immutable stored history',
  'groups two-connection exact-PID witness serializes conflicting same-worker cross-group assignments to one success',
  'groups service-only RPC/private helpers and ledgers reject direct reads/rewrites; all read and rollback fingerprints remain unchanged',
]);
let phase='entry';
export const groupsQueryInput=(patch={})=>({siteId:site,view:'context',groupId:null,workerId:null,onDate:null,assignmentId:null,operationId:null,cursorId:null,...patch});
export const groupsNativeSave=(n,patch={})=>({operationId:id(n),action:'save_group',groupId:id(n),expectedRevision:0,name:`Synthetic group ${n}`,description:'',active:true,reason:'Synthetic group definition',...patch});
export const groupsNativeAssign=(n,groupId,worker,patch={})=>({operationId:id(n),action:'assign',groupId,workerId:worker,expectedGroupRevision:1,expectedWorkerVersion:1,expectedSettingsVersion:1,timeZone:'UTC',startsOn:'2026-01-01',endsOn:null,reason:'Synthetic assignment',...patch});
export const groupsNativeEnd=(n,assignmentId,endsOn,patch={})=>({operationId:id(n),action:'end',assignmentId,expectedRevision:1,endsOn,reason:'Synthetic assignment end',...patch});
export const groupsNativeCancel=(n,assignmentId,patch={})=>({operationId:id(n),action:'cancel',assignmentId,expectedRevision:1,reason:'Synthetic whole-interval cancellation',...patch});
const expression=(query=groupsQueryInput(),command=null,allow=false,actor=owner)=>`public.${rpc}(${typeof query==='string'?query:json(query)},'${actor}',${typeof command==='string'?command:json(command)},${allow===null?'null':allow?'true':'false'})`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'groups_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
export function groupsNativeFailure(error){
  const text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
  const known=new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required','attendance_platform_paused','attendance_version_conflict','attendance_operation_conflict',
    'attendance_group_not_found','attendance_group_inactive','attendance_group_worker_inactive','attendance_group_overlap','attendance_group_closed','attendance_group_invalid',
    'merchant_attendance_groups_prerequisite_required','merchant_attendance_groups_installation_conflict']);
  return {error:'groups_native_failed',phase,code:known.has(code)?code:'local_check_failed',sourceLine:Number(text.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1]??0)||null};
}
export function groupsMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  const source=readFileSync(path.join(root,'scripts/supabase-migrations',migrationName),'utf8');
  const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
  assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));return {name:migrationName,source,body,statement};
}
function guardFor(owned){
  assert(owned&&/^attendance_race_[a-f0-9]{32}$/.test(owned.schema)&&owned.owner==='postgres');
  assert(Number.isSafeInteger(owned.oid)&&owned.oid>0&&Number.isSafeInteger(owned.tableOid)&&owned.tableOid>0);
  assert(/^faolla-synthetic-concurrency:[a-f0-9-]{36}$/.test(owned.marker));
  return `do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid} and n.nspname=${quote(owned.schema)}
    and n.nspowner::regrole::text='postgres' and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)})
    then raise exception 'groups_owned_schema_required';end if;end;$owned$;`;
}
export function groupsNativePlan(owned,tables){
  const guard=guardFor(owned);assert(Array.isArray(tables)&&tables.length>0&&new Set(tables).size===tables.length);
  for(const t of tables)assert(typeof t==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(t)&&t.length<=63);
  for(const t of ['merchants','merchant_attendance_settings','merchant_attendance_workers',...changed])assert(tables.includes(t));
  const fingerprint=selected=>`(select md5(jsonb_build_object(${selected.map(t=>`${quote(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${t} r)`).join(',')})::text))`;
  const seed=`begin;reset role;${guard}do $fresh$ begin assert not exists(select 1 from public.merchants),'groups_fresh_namespace_required';end;$fresh$;
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${other}');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(30)}','${site}','Synthetic group readers',array['enterprise.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${id(101)}','${site}','${id(1)}','employee-a@example.test','合成归组员工甲','${id(30)}','active'),
      ('${id(102)}','${site}','${id(2)}','employee-b@example.test','合成归组员工乙','${id(30)}','active');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',false,false),('${foreign}','UTC',false,false);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active) values
      ('${workerId}','${site}','${id(101)}','GROUP-A','合成归组员工甲',true),('${otherWorkerId}','${site}','${id(102)}','GROUP-B','合成归组员工乙',true),
      ('${inactiveWorkerId}','${site}',null,'GROUP-INACTIVE','合成停用档案',false),('${foreignWorkerId}','${foreign}',null,'FOREIGN','Synthetic foreign',true);commit;`;
  return {site,foreign,owner,other,workerId,otherWorkerId,inactiveWorkerId,foreignWorkerId,guard,seed,
    fingerprint:fingerprint(tables),protectedFingerprint:fingerprint(tables.filter(t=>!changed.includes(t))),labels:[...labels]};
}
export async function prepareGroupsNativeFixture(native,scope){
  phase='install';assert.equal(typeof native.query,'function');assert.equal(typeof native.querySteps,'function');
  const raw=source=>native.query(scope.sql(source)),owned=assertLifecycleSandbox(raw);assert.equal(owned.schema,scope.schema);const guard=guardFor(owned);
  const exec=source=>{assert.deepEqual(assertLifecycleSandbox(raw),owned,'groups_namespace_changed');const start=/^(\s*begin(?:\s+read\s+only)?\s*;)/i;
    return raw(start.test(source)?source.replace(start,`$1reset role;${guard}\n`):`begin;reset role;${guard}\n${source}\ncommit;`);};
  const migration=groupsMigrationPlan(native.root,scope);exec(migration.body);
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const plan=groupsNativePlan(owned,inventory());
  const fingerprint=()=>exec(`select ${groupsNativePlan(owned,inventory()).fingerprint};`);
  const protectedFingerprint=()=>exec(`select ${groupsNativePlan(owned,inventory()).protectedFingerprint};`);
  const installed=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.proname)
    from pg_proc p where p.pronamespace=${owned.oid} and p.proname like 'faolla_attendance_group%'),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity) order by c.relname) from pg_class c where c.oid in(${changed.map(t=>`'public.${t}'::regclass`).join(',')})),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=${quote(owned.schema)}));`);
  const empty=fingerprint(),definition=installed();exec(migration.body);assert.equal(installed(),definition,'groups_reapply_changed_definition_acl');assert.equal(fingerprint(),empty,'groups_reapply_changed_facts');
  phase='minimal-owned-seed';exec(plan.seed);
  const queryInput=groupsQueryInput,call=(query=queryInput(),command=null,allow=false,actor=owner)=>JSON.parse(exec(`set local role service_role;select ${expression(query,command,allow,actor)};`));
  const read=(patch={},actor=owner)=>call(queryInput(patch),null,false,actor);
  return {site,foreign,owner,other,workerId,otherWorkerId,inactiveWorkerId,foreignWorkerId,exec,sql:scope.sql,owned,queryInput,read,call,
    save:groupsNativeSave,assign:groupsNativeAssign,end:groupsNativeEnd,cancel:groupsNativeCancel,fingerprint,protectedFingerprint,plan,syntheticOnly:true,seededGroups:0,seededAssignments:0,seededAttendanceEvents:0};
}

export async function checkAttendanceGroupsNative(native,scope){
  const data=await prepareGroupsNativeFixture(native,scope),{exec,plan,call,queryInput:q,save,assign,end,cancel}=data;
  const protectedBefore=data.protectedFingerprint(),original=new Map();phase='actual-group-assignment-writers';
  assert.deepEqual(data.read().items,[]);assert.deepEqual(data.read({view:'groups'}).items,[]);assert.equal(data.read({workerId}).worker.employeeId,id(101));
  const commandQuery=(c,groupId=null,worker=null)=>q(c.action==='save_group'?{groupId:c.expectedRevision?c.groupId:null}:
    {groupId:c.groupId??groupId,workerId:c.workerId??worker,assignmentId:c.assignmentId??null});
  const write=(c,g=null,w=null,allow=true,actor=owner)=>call(commandQuery(c,g,w),c,allow,actor);
  const expr=(c,g=null,w=null,allow=true,actor=owner)=>expression(commandQuery(c,g,w),c,allow,actor);
  for(let n=1001;n<=1028;n++){const c=save(n),r=write(c);assert.deepEqual(r.receipt.command,c);assert.equal(r.group.revision,1);original.set(id(n),r.receipt);}
  const day=i=>new Date(Date.UTC(2026,0,1+i*2)).toISOString().slice(0,10);
  for(let i=0;i<28;i++){const c=assign(2001+i,id(1001),workerId,{startsOn:day(i),endsOn:day(i)}),r=write(c);
    assert.equal(r.detail.employeeId,id(101));assert.equal(r.detail.groupName,'Synthetic group 1001');assert.equal(r.detail.workerName,'合成归组员工甲');original.set(c.operationId,r.receipt);}
  const long=assign(2101,id(1001),otherWorkerId),ended=end(3101,id(2101),'2026-03-31');
  original.set(long.operationId,write(long).receipt);const endResult=write(ended,id(1001),otherWorkerId);assert.equal(endResult.detail.status,'ended');assert.equal(endResult.detail.history[0].item.endsOn,null);
  const next=assign(2102,id(1002),otherWorkerId,{startsOn:'2026-04-01'});original.set(next.operationId,write(next).receipt);
  write(end(3102,id(2102),'2026-04-30'),id(1002),otherWorkerId);
  const terminal=cancel(3103,id(2102),{expectedRevision:2}),cancelled=write(terminal,id(1002),otherWorkerId);
  assert.equal(cancelled.detail.revision,3);assert.deepEqual(cancelled.detail.history.map(h=>h.command.action),['assign','end','cancel']);assert.equal(cancelled.detail.endsOn,'2026-04-30');
  write(cancel(3201,id(2001)),id(1001),workerId);
  const rename=save(1201,{groupId:id(1001),expectedRevision:1,name:'Renamed inactive group',active:false});write(rename);
  assert.equal(data.protectedFingerprint(),protectedBefore,'groups_writes_changed_old_business');
  phase='pages-history-and-replay';const baseline=data.fingerprint();
  const walk=patch=>{let cursor=null,pages=0;const all=[];do{const r=data.read({...patch,cursorId:cursor});assert(++pages<=3);all.push(...r.items);cursor=r.nextCursor;}while(cursor);return {all,pages};};
  const groups=walk({view:'groups'});assert.equal(groups.pages,2);assert.deepEqual(groups.all.map(r=>r.groupId),Array.from({length:28},(_,n)=>id(1028-n)));assert.equal(groups.all.filter(r=>!r.active).length,1);
  const members=walk({view:'members',groupId:id(1001),workerId});assert.equal(members.pages,2);assert.deepEqual(members.all.map(r=>r.assignmentId),Array.from({length:28},(_,n)=>id(2028-n)));
  assert(members.all.every(r=>Object.keys(r).length===14&&r.groupName==='Synthetic group 1001'));assert.equal(members.all.filter(r=>r.status==='cancelled').length,1);
  assert.deepEqual(data.read({view:'members',workerId:otherWorkerId,onDate:'2026-03-31'}).items.map(r=>r.assignmentId),[id(2101)]);
  assert.deepEqual(data.read({view:'members',workerId:otherWorkerId,onDate:'2026-04-01'}).items.map(r=>r.assignmentId),[id(2102)]); // Cancelled records remain visible, explicitly labelled.
  assert.deepEqual(data.read({view:'members',workerId:otherWorkerId,onDate:'2026-05-01'}).items,[]);
  assert.equal(data.read({operationId:id(9999)}).receipt,null);
  assert.deepEqual(data.read({operationId:id(1001)}).receipt,original.get(id(1001)));assert.equal(data.read({operationId:id(1001)}).group.name,rename.name);
  assert.deepEqual(write(save(1001),null,null,false).receipt,original.get(id(1001)));
  for(const [c,g,w] of [[assign(2001,id(1001),workerId,{startsOn:day(0),endsOn:day(0)}),id(1001),workerId],[long,id(1001),otherWorkerId],[next,id(1002),otherWorkerId]]){
    const r=data.read({groupId:g,workerId:w,operationId:c.operationId});assert.deepEqual(r.receipt,original.get(c.operationId));assert.deepEqual(write(c,null,null,false).receipt,original.get(c.operationId));}
  assert.equal(data.read({groupId:id(1002),workerId:otherWorkerId,operationId:next.operationId}).detail.status,'cancelled');
  assert.deepEqual(write(terminal,id(1002),otherWorkerId,false).receipt,cancelled.receipt);assert.equal(data.fingerprint(),baseline,'groups_reads_replays_changed_facts');
  const rollback=(setup,checks)=>exec(`begin;reset role;${setup}set local role service_role;do $checks$ declare a jsonb;b jsonb;begin ${checks} end;$checks$;rollback;`);
  phase='authorization-overlap-and-cross-ledger-fences';
  rollback('',[
    denied('attendance_platform_paused',expr(save(4001),null,null,false)),denied('attendance_platform_paused',expr(cancel(4002,id(2002)),id(1001),workerId,false)),
    denied('attendance_group_inactive',expr(assign(4003,id(1001),otherWorkerId,{expectedGroupRevision:2,startsOn:'2027-01-01'}))),
    denied('attendance_group_worker_inactive',expr(assign(4004,id(1002),inactiveWorkerId))),
    denied('attendance_group_overlap',expr(assign(4005,id(1002),otherWorkerId,{startsOn:'2026-03-31',endsOn:'2026-03-31'}))),
    denied('attendance_group_overlap',expr(assign(4006,id(1002),workerId,{startsOn:day(1),endsOn:day(1)}))),
    denied('attendance_version_conflict',expr(save(4007,{groupId:id(1001),expectedRevision:1}))),
    denied('attendance_version_conflict',expr(assign(4008,id(1002),workerId,{expectedSettingsVersion:2,startsOn:'2027-01-01'}))),
    denied('attendance_version_conflict',expr(assign(4009,id(1002),workerId,{expectedWorkerVersion:2,startsOn:'2027-01-01'}))),
    denied('attendance_version_conflict',expr(assign(4010,id(1002),workerId,{expectedGroupRevision:2,startsOn:'2027-01-01'}))),
    denied('attendance_version_conflict',expr(assign(4011,id(1002),workerId,{timeZone:'Europe/Madrid',startsOn:'2027-01-01'}))),
    denied('attendance_group_closed',expr(end(4012,id(2101),'2026-04-01'),id(1001),otherWorkerId)),
    denied('attendance_group_closed',expr(cancel(4013,id(2102),{expectedRevision:2}),id(1002),otherWorkerId)),
    denied('attendance_group_closed',expr(end(4014,id(2002),'2026-04-01'),id(1001),workerId)),
    denied('attendance_operation_conflict',expr(save(1001,{name:'replacement'}),null,null,false)),
    denied('attendance_operation_conflict',expr(assign(1002,id(1002),workerId,{startsOn:'2027-01-01'}))),
    denied('attendance_operation_conflict',expr(save(2002))),
    denied('attendance_group_not_found',expression(q({groupId:id(1002),workerId,operationId:id(2002)}))),
    denied('attendance_group_not_found',expression(q({workerId:foreignWorkerId}))),
    denied('attendance_group_not_found',expression(q({operationId:rename.operationId}))),
    denied('attendance_access_denied',expression(q(),null,false,other)),denied('attendance_access_denied',expression(q({siteId:foreign}))),
  ].join('\n'));
  rollback(`update public.merchant_attendance_workers set display_name='Changed current name',worker_no='CHANGED',employee_id=null,active=false,version=version+1 where id='${workerId}';
    update public.merchant_attendance_settings set time_zone='Pacific/Kiritimati',version=version+1 where merchant_id='${site}';`,
    `a:=${expression(q({groupId:id(1001),workerId,operationId:id(2002)}))};assert a->'receipt'=${json(original.get(id(2002)))},'snapshot does not inherit current name/binding/zone';
      assert a->'worker'->>'workerName'='Changed current name' and a->'worker'->'employeeId'='null'::jsonb,'current context stays distinct';
      a:=${expr(cancel(4101,id(2002)),id(1001),workerId)};assert a->'detail'->>'status'='cancelled','inactive profile/group and changed settings permit cancellation';`);
  rollback(`select ${expr(assign(4102,id(1002),workerId,{startsOn:'2027-01-01'}))};
    update public.merchant_attendance_workers set active=false,version=version+1 where id='${workerId}';`,
    `a:=${expr(save(4103,{groupId:id(1002),expectedRevision:1,active:false}))};
      a:=${expr(end(4104,id(4102),'2027-01-31'),id(1002),workerId)};assert a->'detail'->>'status'='ended','worker/group inactivity does not prevent ending';`);
  rollback(`update public.merchants set user_id='${other}' where id='${site}';`,denied('attendance_access_denied',expression(q({operationId:id(1001)})))+
    `a:=${expression(q({operationId:id(1001)}),null,false,other)};assert a->'receipt'='null'::jsonb and a->'group'='null'::jsonb,'new owner cannot inherit old actor receipt';`+
    denied('attendance_operation_conflict',expr(save(1001),null,null,false,other))+
    `a:=${expr(cancel(4105,id(2002)),id(1001),workerId,true,other)};assert a->'detail'->>'status'='cancelled','new current owner may explicitly cancel';`);
  phase='strict-shapes-dates-and-stored-facts';
  const badQueries=[null,{}, {...q(),extra:true},{...q(),view:'groups',workerId},{...q(),view:'members'},{...q(),assignmentId:id(2002)},
    {...q(),cursorId:id(1002)},{...q(),view:'members',workerId,onDate:'2026-02-30'},{...q(),view:'members',workerId,onDate:'1999-12-31'}];
  const badCommands=[{...save(4201),extra:true},save(4201,{name:' x'}),save(4201,{name:'x\u0085'}),save(4201,{description:'x\u007f'}),save(4201,{description:'x\u00a0'}),
    save(4201,{name:'x'.repeat(81)}),save(4201,{reason:'x'.repeat(201)}),save(4201,{active:1}),save(4201,{expectedRevision:1.5}),save(4201,{groupId:id(4202)}),
    assign(4201,id(1002),workerId,{startsOn:'2026-02-30'}),assign(4201,id(1002),workerId,{startsOn:'2101-01-01'}),assign(4201,id(1002),workerId,{endsOn:'2025-12-31'}),
    assign(4201,id(1002),workerId,{expectedWorkerVersion:0}),assign(4201,id(1002),workerId,{timeZone:'not-a-zone'}),end(4201,id(2101),'2026-04-01',{expectedRevision:2})];
  rollback('',badQueries.map(v=>denied('attendance_invalid_request',expression(v))).join('\n')+
    badCommands.map(c=>denied('attendance_invalid_request',expr(c,id(1002),workerId))).join('\n')+denied('attendance_invalid_request',expression(q(),null,null))+
    denied('attendance_invalid_request',expression(q({view:'groups'}),save(4201),true)));
  rollback(`update public.merchant_attendance_settings set time_zone='Pacific/Apia' where merchant_id='${site}';
    update public.merchant_attendance_workers set active=true where id='${inactiveWorkerId}';`,
    denied('attendance_invalid_request',expr(assign(4301,id(1002),workerId,{startsOn:'2011-12-30',endsOn:'2011-12-31',timeZone:'Pacific/Apia'})))+
    `a:=${expr(assign(4302,id(1002),workerId,{startsOn:'2011-12-29',endsOn:'2011-12-31',timeZone:'Pacific/Apia'}))};assert a->'detail'->>'status'='assigned','internal skipped day has no payroll meaning';
      a:=${expr(assign(4303,id(1002),inactiveWorkerId,{startsOn:'2011-12-29',timeZone:'Pacific/Apia'}))};`+
    denied('attendance_invalid_request',expr(end(4304,id(4303),'2011-12-30'),id(1002),inactiveWorkerId)));
  // A new synthetic inconsistent operation, always rolled back, never an old-row rewrite.
  rollback(`insert into public.merchant_attendance_group_assignment_operations(merchant_id,operation_id,assignment_id,revision,action,actor_auth_user_id,command,snapshot,recorded_at)
    values('${site}','${id(1002)}','${id(2002)}',2,'cancel','${owner}',${json(cancel(1002,id(2002)))},'{}',clock_timestamp());`,
    denied('attendance_group_invalid',expression(q({operationId:id(1002)}))));
  assert.equal(data.fingerprint(),baseline,'groups_rollback_probes_changed_facts');phase='acl-and-immutability';
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expression()};raise exception 'groups_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  for(const role of ['anon','authenticated','service_role'])exec(`set local role ${role};do $tables$ begin ${changed.map(t=>
    `assert not has_table_privilege(current_user,'public.${t}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'groups_private_privilege_allowed';begin perform 1 from public.${t};raise exception 'groups_private_read_allowed';exception when insufficient_privilege then null;end;`).join('\n')}
    assert not has_function_privilege(current_user,'public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)','EXECUTE'),'groups_helper_execute_allowed';end;$tables$;`);
  exec(`begin;reset role;do $immutable$ begin ${changed.filter(t=>t.endsWith('_operations')).map(t=>`begin update public.${t} set merchant_id=merchant_id;raise exception 'groups_update_allowed';exception when insufficient_privilege then null;end;
    begin delete from public.${t};raise exception 'groups_delete_allowed';exception when insufficient_privilege then null;end;
    begin truncate public.${t} cascade;raise exception 'groups_truncate_allowed';exception when insufficient_privilege then null;end;`).join('\n')}end;$immutable$;rollback;`);
  assert.equal(data.fingerprint(),baseline,'groups_acl_checks_changed_facts');assert.equal(data.protectedFingerprint(),protectedBefore,'groups_probes_changed_old_business');
  phase='actual-cross-group-overlap-race';assert.equal(typeof native.connect,'function');assert.deepEqual(assertLifecycleSandbox(s=>native.query(scope.sql(s))),data.owned);
  const left=assign(5001,id(1003),otherWorkerId,{startsOn:'2026-05-01'}),right=assign(5002,id(1004),otherWorkerId,{startsOn:'2026-05-01'});
  const race=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},
    `reset role;${plan.guard}set local role service_role;select ${expr(left)};`,`reset role;${plan.guard}set local role service_role;select ${expr(right)};`);
  assert.equal(race.witnessed,true);assert.equal(JSON.parse(race.left).detail.status,'assigned');assert(race.right.error,'cross-group competitor must fail');
  assert.equal(race.right.error.message.includes('attendance_group_overlap'),true,'waiter must observe committed cross-group assignment');
  assert.equal(exec(`select count(*) from public.merchant_attendance_groups where merchant_id='${site}';`),'28');
  assert.equal(exec(`select count(*) from public.merchant_attendance_group_operations where merchant_id='${site}';`),'29');
  assert.equal(exec(`select count(*) from public.merchant_attendance_group_assignments where merchant_id='${site}';`),'31');
  assert.equal(exec(`select count(*) from public.merchant_attendance_group_assignment_operations where merchant_id='${site}';`),'35');
  assert.equal(exec(`select count(*) from public.merchant_attendance_group_assignment_operations where merchant_id='${site}' and operation_id='${right.operationId}';`),'0');
  const final=data.fingerprint();assert.deepEqual(write(left,null,null,false).receipt.command,left);assert.equal(data.fingerprint(),final,'groups_final_replay_changed_facts');
  assert.equal(data.protectedFingerprint(),protectedBefore,'groups_race_changed_old_business');
  for(const label of labels)native.pass(label);return {checks:labels.length,groups:28,groupOperations:29,assignments:31,assignmentOperations:35,exactLockWitnesses:1,syntheticOnly:true,allRollbackProbesRestored:true,callerOwnedNamespaceCleanup:true};
}
export async function runAttendanceGroupsNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceGroupsNative(native,scope)));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceGroupsNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(groupsNativeFailure(error)));process.exitCode=1;});
}
