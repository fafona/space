// Owned local fixture only. Synthetic identities/configuration are seeded;
// every leave request/decision/receipt is produced by the actual new RPC.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',foreign='99990002',owner=id(99),other=id(98),employeeAuth=id(1),employeeId=id(101),workerId=id(201),otherAuth=id(2);
const rpc='faolla_attendance_leave_v1',tablesChanged=Object.freeze(['merchant_attendance_leave_requests','merchant_attendance_leave_entries']);
const migrations=Object.freeze(['202610030121_merchant_attendance_leave_permission.sql','202610030122_merchant_attendance_leave_requests.sql']);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const labels=Object.freeze([
  'leave installs/reapplies122 with unchanged owner/ACL/indexes/facts and no pre-created requests or attendance events',
  'leave actual self submissions and owner approve/reject/cancel plus self withdrawal retain complete immutable histories',
  'leave all-status owner/self lists page25+3 once, omit reasons, and return exact detail and historical operation snapshots',
  'leave paused GET and exact same-actor POST recovery do not repeat writes; every fresh action including withdrawal is paused',
  'leave current member/role/four-identity fences and current owner deny unauthorized and rebound access without inherited receipts',
  'leave approval rechecks binding/employment/overlap; two exact-PID lock races reject a competing overlapping approval and same-request withdrawal',
  'leave rejects stale settings, wrong worker, malformed commands, invalid intervals and owner self-review with no writes',
  'leave past/future and end-exclusive employment boundaries use actual RPC; inactive worker/view-only reads and withdrawal rules remain explicit',
  'leave API table privileges and browser execute remain closed; append-only tables reject rewrites and rollback probes restore all facts',
]);
let phase='entry';
export const leaveQueryInput=(access='self',patch={})=>({siteId:site,access,requestId:null,operationId:null,beforeAt:null,beforeId:null,...patch});
export const leaveNativeSubmit=(n,startAt,endAt,patch={})=>({operationId:id(n),action:'submit',reason:'Synthetic leave request',expectedWorkerId:workerId,expectedSettingsVersion:1,timeZone:'UTC',startAt,endAt,...patch});
export const leaveNativeAction=(n,action,requestId,patch={})=>({operationId:id(n),action,reason:'Synthetic leave decision',requestId,expectedRevision:action==='cancel'?2:1,...patch});
const expression=(query,command=null,allow=false,actor=query?.access==='owner'?owner:employeeAuth)=>
  `public.${rpc}(${typeof query==='string'?query:json(query)},'${actor}',${typeof command==='string'?command:json(command)},${allow===null?'null':allow?'true':'false'})`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'leave_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
export function leaveNativeFailure(error){
  const text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
  const known=new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required','attendance_platform_paused','attendance_version_conflict','attendance_operation_conflict','attendance_worker_changed',
    'attendance_leave_not_found','attendance_leave_closed','attendance_leave_overlap','attendance_leave_binding_changed','attendance_leave_outside_employment','attendance_leave_invalid',
    'merchant_attendance_leave_prerequisite_required','merchant_attendance_leave_installation_conflict']);
  return {error:'leave_native_failed',phase,code:known.has(code)?code:'local_check_failed',sourceLine:Number(text.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1]??0)||null};
}
export function leaveMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  return migrations.map(name=>{const source=readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8');
    const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
    assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));return {name,source,body,statement};});
}
function guardFor(owned){
  assert(owned&&/^attendance_race_[a-f0-9]{32}$/.test(owned.schema)&&owned.owner==='postgres');
  assert(Number.isSafeInteger(owned.oid)&&owned.oid>0&&Number.isSafeInteger(owned.tableOid)&&owned.tableOid>0);
  assert(/^faolla-synthetic-concurrency:[a-f0-9-]{36}$/.test(owned.marker));
  return `do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid} and n.nspname=${quote(owned.schema)}
    and n.nspowner::regrole::text='postgres' and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)})
    then raise exception 'leave_owned_schema_required';end if;end;$owned$;`;
}
export function leaveNativePlan(owned,tables,date){
  const guard=guardFor(owned);assert(Array.isArray(tables)&&tables.length>0&&new Set(tables).size===tables.length);
  for(const t of tables)assert(typeof t==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(t)&&t.length<=63);
  for(const t of ['merchants','merchant_attendance_settings',...tablesChanged])assert(tables.includes(t));
  assert(/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(date)&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date);
  const at=(days,hour)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000+hour*3600000).toISOString();
  const time={startAt:at(2,8),endAt:at(2,16),nextStartAt:at(2,16),nextEndAt:at(2,17),pastStartAt:at(-40,8),pastEndAt:at(-40,16)};
  const fingerprint=selected=>`(select md5(jsonb_build_object(${selected.map(t=>`${quote(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${t} r)`).join(',')})::text))`;
  const seed=`begin;reset role;${guard}do $fresh$ begin assert not exists(select 1 from public.merchants),'leave_fresh_namespace_required';end;$fresh$;
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${other}');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
      ('${id(30)}','${site}','Synthetic leave applicants',array['enterprise.view','attendance.self.view','attendance.self.leave']),
      ('${id(40)}','${foreign}','Synthetic foreign',array['enterprise.view','attendance.self.view','attendance.self.leave']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${employeeId}','${site}','${employeeAuth}','employee-a@example.test','合成请假员工甲','${id(30)}','active'),
      ('${id(102)}','${site}','${otherAuth}','employee-b@example.test','合成请假员工乙','${id(30)}','active'),
      ('${id(199)}','${site}','${owner}','owner-entry@example.test','合成负责人本人','${id(30)}','active'),
      ('${id(104)}','${foreign}','${id(4)}','foreign@example.test','Synthetic foreign','${id(40)}','active');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',false,false),('${foreign}','UTC',false,false);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active) values
      ('${workerId}','${site}','${employeeId}','LEAVE-A','合成请假员工甲',true),('${id(202)}','${site}','${id(102)}','LEAVE-B','合成请假员工乙',true),
      ('${id(299)}','${site}','${id(199)}','LEAVE-OWNER','合成负责人本人',true),('${id(204)}','${foreign}','${id(104)}','FOREIGN','Synthetic foreign',true);
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values
      ('${site}','${workerId}','2000-01-01'),('${site}','${id(202)}','2000-01-01'),('${site}','${id(299)}','2000-01-01'),('${foreign}','${id(204)}','2000-01-01');commit;`;
  return {site,foreign,owner,other,employeeAuth,employeeId,workerId,otherAuth,date,time,guard,seed,
    fingerprint:fingerprint(tables),protectedFingerprint:fingerprint(tables.filter(t=>!tablesChanged.includes(t))),labels:[...labels]};
}
export async function prepareLeaveNativeFixture(native,scope){
  phase='install';assert.equal(typeof native.query,'function');assert.equal(typeof native.querySteps,'function');
  const raw=source=>native.query(scope.sql(source)),owned=assertLifecycleSandbox(raw);assert.equal(owned.schema,scope.schema);const guard=guardFor(owned);
  const exec=source=>{assert.deepEqual(assertLifecycleSandbox(raw),owned,'leave_namespace_changed');const start=/^(\s*begin(?:\s+read\s+only)?\s*;)/i;
    return raw(start.test(source)?source.replace(start,`$1reset role;${guard}\n`):`begin;reset role;${guard}\n${source}\ncommit;`);};
  const migration=leaveMigrationPlan(native.root,scope);for(const m of migration)exec(m.body);
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const date=exec("select (clock_timestamp() at time zone 'UTC')::date::text;"),plan=leaveNativePlan(owned,inventory(),date);
  const fingerprint=()=>exec(`select ${leaveNativePlan(owned,inventory(),date).fingerprint};`);
  const protectedFingerprint=()=>exec(`select ${leaveNativePlan(owned,inventory(),date).protectedFingerprint};`);
  const installed=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.proname)
    from pg_proc p where p.oid in('public.${rpc}(jsonb,uuid,jsonb,boolean)'::regprocedure,'public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)'::regprocedure)),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity) order by c.relname) from pg_class c where c.oid in(${tablesChanged.map(t=>`'public.${t}'::regclass`).join(',')})),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=${quote(owned.schema)}));`);
  const empty=fingerprint(),definition=installed();exec(migration[1].body);assert.equal(installed(),definition,'leave_reapply_changed_definition_acl');assert.equal(fingerprint(),empty,'leave_reapply_changed_facts');
  phase='minimal-owned-seed';exec(plan.seed);
  const queryInput=leaveQueryInput,call=(query,command=null,allow=false,actor=query?.access==='owner'?owner:employeeAuth)=>JSON.parse(exec(`set local role service_role;select ${expression(query,command,allow,actor)};`));
  const read=(access='self',patch={},actor=access==='owner'?owner:employeeAuth)=>call(queryInput(access,patch),null,false,actor);
  const submit=(n,patch={})=>leaveNativeSubmit(n,plan.time.startAt,plan.time.endAt,patch),action=leaveNativeAction;
  return {site,foreign,owner,other,employeeAuth,employeeId,workerId,otherAuth,exec,sql:scope.sql,owned,queryInput,read,call,submit,action,time:plan.time,
    fingerprint,protectedFingerprint,plan,syntheticOnly:true,seededLeaveRequests:0,seededAttendanceEvents:0};
}

export async function checkAttendanceLeaveNative(native,scope){
  const data=await prepareLeaveNativeFixture(native,scope),{exec,plan,call,queryInput:q,submit,action}=data;
  const protectedBefore=data.protectedFingerprint();phase='actual-leave-writers';
  assert.deepEqual(data.read().items,[]);assert.equal(data.read().canSubmit,true);assert.equal(data.read('owner').canSubmit,false);
  const original=new Map();
  for(let n=1001;n<=1028;n++){
    const c=submit(n,n===1028?{startAt:data.time.pastStartAt,endAt:data.time.pastEndAt}:{}),r=call(q(),c,true);
    assert.deepEqual(r.receipt.command,c);assert.equal(r.detail.status,'submitted');assert.equal(r.detail.history.length,1);original.set(id(n),r.receipt);
  }
  const commands=[action(2001,'approve',id(1001)),action(2002,'cancel',id(1001)),action(2003,'reject',id(1002)),action(2004,'withdraw',id(1003)),action(2005,'approve',id(1004))];
  const receipts=[];
  for(const c of commands){const access=c.action==='withdraw'?'self':'owner',r=call(q(access,{requestId:c.requestId}),c,true);receipts.push(r.receipt);assert.deepEqual(r.receipt.command,c);}
  assert.deepEqual(data.read('self',{requestId:id(1001)}).detail.history.map(h=>h.action),['submit','approve','cancel']);
  assert.equal(data.read('self',{requestId:id(1001)}).detail.canCancel,false);assert.equal(data.read('owner',{requestId:id(1004)}).detail.canCancel,true);
  assert.equal(data.protectedFingerprint(),protectedBefore,'leave_writers_changed_old_business');
  const baseline=data.fingerprint();phase='lists-and-historical-recovery';
  for(const access of ['self','owner']){
    const all=[];let cursor=null,pages=0;
    do{const r=data.read(access,cursor?{beforeAt:cursor.at,beforeId:cursor.id}:{});assert(++pages<=2);all.push(...r.items);cursor=r.nextCursor;}while(cursor);
    assert.equal(pages,2);assert.deepEqual(all.map(r=>r.requestId),Array.from({length:28},(_,n)=>id(1028-n)));
    assert(all.every(r=>Object.keys(r).length===8&&!('reason' in r)));assert.equal(new Set(all.map(r=>r.requestId)).size,28);
    assert.deepEqual(new Set(all.map(r=>r.status)),new Set(['submitted','withdrawn','approved','rejected','cancelled']));
  }
  assert.deepEqual(data.read('self',{},otherAuth).items,[]);
  assert.equal(data.read('owner',{operationId:id(1001)}).receipt,null);assert.equal(data.read('self',{operationId:id(9999)}).receipt,null);
  for(const n of [1001,1002,1003,1004]){
    assert.deepEqual(data.read('self',{operationId:id(n)}).receipt,original.get(id(n)));
    assert.deepEqual(call(q(),submit(n),false).receipt,original.get(id(n)));
  }
  for(let i=0;i<commands.length;i++){
    const c=commands[i],access=c.action==='withdraw'?'self':'owner';
    assert.deepEqual(data.read(access,{operationId:c.operationId}).receipt,receipts[i]);
    assert.deepEqual(call(q(access,{requestId:c.requestId}),c,false).receipt,receipts[i]);
  }
  assert.equal(data.fingerprint(),baseline,'leave_reads_replays_changed_facts');
  const rollback=(setup,checks)=>exec(`begin;reset role;${setup}set local role service_role;do $checks$ declare a jsonb;b jsonb;begin ${checks} end;$checks$;rollback;`);
  const run=(c,access=c.action==='submit'||c.action==='withdraw'?'self':'owner',allow=true,actor=access==='owner'?owner:employeeAuth)=>expression(q(access,{requestId:c.action==='submit'?null:c.requestId}),c,allow,actor);
  phase='paused-and-invalid-cases';
  rollback('',[
    denied('attendance_platform_paused',run(submit(3001),'self',false)),
    ...['withdraw','approve','reject'].map((a,n)=>denied('attendance_platform_paused',run(action(3002+n,a,id(1005)),a==='withdraw'?'self':'owner',false))),
    denied('attendance_platform_paused',run(action(3005,'cancel',id(1004)),'owner',false)),
    denied('attendance_operation_conflict',run(submit(1001,{reason:'different original content'}),'self',false)),
    denied('attendance_leave_closed',run(action(3006,'approve',id(1002)))),
    denied('attendance_leave_overlap',run(action(3007,'approve',id(1005)))),
    denied('attendance_version_conflict',run(submit(3008,{expectedSettingsVersion:2}))),
    denied('attendance_version_conflict',run(submit(3009,{timeZone:'Europe/Madrid'}))),
    denied('attendance_worker_changed',run(submit(3010,{expectedWorkerId:id(202)}))),
    denied('attendance_access_denied',expression(q('owner'),null,false,employeeAuth)),
    denied('attendance_access_denied',expression(q('owner',{siteId:foreign}))),
    denied('attendance_leave_not_found',expression(q('self',{requestId:id(1001)}),null,false,otherAuth)),
    denied('attendance_operation_conflict',run(submit(1001),'self',true,otherAuth)),
    `a:=${expression(q('self',{operationId:id(1001)}),null,false,otherAuth)};assert a->'receipt'='null'::jsonb,'other actor operation stays opaque';`,
  ].join('\n'));
  const invalidQueries=[null,{}, {...q(),extra:true},{...q(),access:'manager'},{...q(),beforeAt:'2026-10-01T00:00:00.000000Z'},
    {...q(),beforeAt:'2026-10-01T00:00:00.000000Z',beforeId:id(1001),requestId:id(1001)}, {...q(),operationId:3}];
  const invalidCommands=[{...submit(4001),extra:1},submit(4001,{reason:' x'}),submit(4001,{reason:'x\u0085'}),submit(4001,{reason:'x\u007f'}),submit(4001,{reason:'x'.repeat(201)}),
    submit(4001,{expectedSettingsVersion:1.5}),submit(4001,{timeZone:'not-a-zone'}),submit(4001,{endAt:data.time.startAt}),
    submit(4001,{endAt:new Date(Date.parse(data.time.startAt)+367*86400000).toISOString()}),submit(4001,{startAt:data.time.startAt.replace(':00.000Z',':01.000Z')}),
    submit(4001,{startAt:'1999-12-31T00:00:00.000Z'}),{...action(4001,'cancel',id(1004)),expectedRevision:1}];
  rollback('',invalidQueries.map(v=>denied('attendance_invalid_request',expression(v))).join('\n')+invalidCommands.map(c=>denied('attendance_invalid_request',run(c))).join('\n')+
    denied('attendance_invalid_request',expression(q(),null,null)));
  phase='current-identity-and-employment';
  rollback(`update public.merchants set user_id='${other}' where id='${site}';`,denied('attendance_access_denied',expression(q('owner',{operationId:id(2001)})))+
    `a:=${expression(q('owner',{operationId:id(2001)}),null,false,other)};assert a->'receipt'='null'::jsonb,'new owner does not inherit old operation';`);
  for(const setup of [`update public.merchant_enterprise_employees set status='disabled' where id='${employeeId}';`,
    `update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${id(30)}';`]){
    rollback(setup,denied('attendance_access_denied',expression(q('self',{operationId:id(1001)})))+denied('attendance_access_denied',run(submit(1001),'self',false)));
  }
  rollback(`update public.merchant_attendance_workers set employee_id=null where id='${workerId}';update public.merchant_attendance_workers set employee_id='${employeeId}' where id='${id(202)}';`,
    `a:=${expression(q())};assert a->'items'='[]'::jsonb,'new worker must not inherit old requests';`+
    denied('attendance_leave_not_found',expression(q('self',{operationId:id(1001)})))+
    denied('attendance_leave_binding_changed',run(action(4101,'approve',id(1005))))+
    `a:=${run(action(4102,'reject',id(1005)))};assert a->'detail'->>'status'='rejected','owner may reject stale binding';
     a:=${run(action(4103,'cancel',id(1004)))};assert a->'detail'->>'status'='cancelled','owner may cancel stale binding';`);
  rollback(`update public.merchant_attendance_employment_periods set starts_on='2099-01-01' where merchant_id='${site}' and worker_id='${workerId}';`,
    denied('attendance_leave_outside_employment',run(submit(4104)))+denied('attendance_leave_outside_employment',run(action(4105,'approve',id(1005)))));
  rollback(`update public.merchant_attendance_workers set active=false where id='${workerId}';`,
    `a:=${expression(q('self',{operationId:id(1001)}))};assert a->'canSubmit'='false'::jsonb and a->'receipt'<>'null'::jsonb,'inactive worker retains reads';
     a:=${run(action(4106,'withdraw',id(1005)))};assert a->'detail'->>'status'='withdrawn','inactive worker may withdraw with current permission';`+
    denied('attendance_access_denied',run(submit(4107))));
  rollback(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${id(30)}';`,
    `a:=${expression(q('self',{operationId:id(1001)}))};assert a->'canSubmit'='false'::jsonb and a->'receipt'<>'null'::jsonb,'view-only retains receipts';`+
    denied('attendance_access_denied',run(submit(4108)))+denied('attendance_access_denied',run(action(4109,'withdraw',id(1005))))+
    `a:=${run(action(4110,'cancel',id(1004)))};a:=${run(action(4111,'approve',id(1005)))};assert a->'detail'->>'status'='approved','owner approval does not require current self.leave';`);
  phase='positive-boundaries-and-self-review';
  const own=submit(4201,{expectedWorkerId:id(299)});
  rollback('',`a:=${run(own,'self',true,owner)};assert a->'detail'->>'status'='submitted';`+
    denied('attendance_access_denied',run(action(4202,'approve',id(4201))))+denied('attendance_access_denied',run(action(4203,'reject',id(4201)))));
  const midnight=submit(4204,{startAt:'2026-01-01T23:00:00.000Z',endAt:'2026-01-02T00:00:00.000Z'});
  rollback(`update public.merchant_attendance_employment_periods set starts_on='2026-01-01',ends_on='2026-01-01' where merchant_id='${site}' and worker_id='${workerId}';`,
    `a:=${run(midnight)};assert a->'detail'->>'status'='submitted','exclusive midnight end does not require next-day employment';`);
  rollback(`update public.merchant_attendance_settings set time_zone='Pacific/Apia' where merchant_id='${site}';
    update public.merchant_attendance_employment_periods set ends_on='2011-12-29' where merchant_id='${site}' and worker_id='${workerId}';
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on,ends_on) values('${site}','${workerId}','2011-12-31','2011-12-31');`,
    `a:=${run(submit(4209,{timeZone:'Pacific/Apia',startAt:'2011-12-29T10:00:00.000Z',endAt:'2011-12-31T10:00:00.000Z'}))};
    assert a->'detail'->>'status'='submitted','an entirely skipped civil day must not require employment coverage';`);
  rollback('',`a:=${run(submit(4205,{startAt:data.time.nextStartAt,endAt:data.time.nextEndAt}))};a:=${run(action(4206,'approve',id(4205)))};
    assert a->'detail'->>'status'='approved','touching endpoints do not overlap';
    a:=${run(action(4207,'cancel',id(1004)))};a:=${run(action(4208,'approve',id(1005)))};assert a->'detail'->>'status'='approved','cancel releases approved interval';
    a:=${run(submit(4210,{startAt:'2026-01-01T00:00:00.000Z',endAt:'2027-01-02T00:00:00.000Z'}))};assert a->'detail'->>'status'='submitted','exact366 UTC days allowed';`);
  assert.equal(data.fingerprint(),baseline,'leave_negative_and_writer_probes_not_rolled_back');phase='acl-and-immutability';
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expression(q())};raise exception 'leave_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  for(const role of ['anon','authenticated','service_role'])exec(`set local role ${role};do $tables$ begin ${tablesChanged.map(t=>
    `assert not has_table_privilege(current_user,'public.${t}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'leave_private_privilege_allowed';begin perform 1 from public.${t};raise exception 'leave_private_read_allowed';exception when insufficient_privilege then null;end;`).join('\n')}end;$tables$;`);
  exec(`begin;reset role;do $immutable$ begin ${tablesChanged.map(t=>`begin update public.${t} set merchant_id=merchant_id;raise exception 'leave_update_allowed';exception when insufficient_privilege then null;end;
    begin delete from public.${t};raise exception 'leave_delete_allowed';exception when insufficient_privilege then null;end;
    begin truncate public.${t} cascade;raise exception 'leave_truncate_allowed';exception when insufficient_privilege then null;end;`).join('\n')}end;$immutable$;rollback;`);
  assert.equal(data.fingerprint(),baseline,'leave_acceptance_changed_baseline');assert.equal(data.protectedFingerprint(),protectedBefore,'leave_acceptance_changed_old_tables');
  phase='actual-lock-races';assert.equal(typeof native.connect,'function');
  call(q('owner',{requestId:id(1004)}),action(8101,'cancel',id(1004)),true);
  const race=async(first,second)=>{
    assert.deepEqual(assertLifecycleSandbox(s=>native.query(scope.sql(s))),data.owned,'leave_race_namespace_changed');
    return lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},
      `reset role;${plan.guard}set local role service_role;select ${first};`,
      `reset role;${plan.guard}set local role service_role;select ${second};`);
  };
  const overlapRace=await race(run(action(8102,'approve',id(1005))),run(action(8103,'approve',id(1006))));
  assert.equal(overlapRace.witnessed,true);assert.equal(JSON.parse(overlapRace.left).detail.status,'approved');
  assert(overlapRace.right.error,'competing overlap must fail');assert.equal(overlapRace.right.error.message.includes('attendance_leave_overlap'),true,'waiter must re-read committed approved interval');
  const sameRequestRace=await race(run(action(8104,'approve',id(1028))),run(action(8105,'withdraw',id(1028))));
  assert.equal(sameRequestRace.witnessed,true);assert.equal(JSON.parse(sameRequestRace.left).detail.status,'approved');
  assert(sameRequestRace.right.error,'competing terminal must fail');assert.equal(sameRequestRace.right.error.message.includes('attendance_leave_closed'),true,'waiter must re-read committed terminal');
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_entries where merchant_id='${site}';`),'36');
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_entries where merchant_id='${site}' and operation_id in('${id(8103)}','${id(8105)}');`),'0');
  assert.equal(data.protectedFingerprint(),protectedBefore,'leave_races_changed_old_business');
  const final=data.fingerprint();assert.equal(data.read('owner',{requestId:id(1006)}).detail.status,'submitted');assert.equal(data.read('self',{requestId:id(1028)}).detail.status,'approved');
  assert.equal(data.fingerprint(),final,'leave_final_reads_changed_facts');
  for(const label of labels)native.pass(label);
  return {checks:labels.length,requests:28,entries:36,exactLockWitnesses:2,statuses:['submitted','withdrawn','approved','rejected','cancelled'],syntheticOnly:true,allRollbackProbesRestored:true,callerOwnedNamespaceCleanup:true};
}
export async function runAttendanceLeaveNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceLeaveNative(native,scope)));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceLeaveNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(leaveNativeFailure(error)));process.exitCode=1;});
}
