// Owned local synthetic fixture only. Existing125 seeds use original writers;
// additional historical/tie rows below are explicitly synthetic pre-existing data.
// New-list acceptance always executes as service_role and never changes facts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {prepareSelfRevisionHistoryNativeFixture} from './merchant-attendance-self-revision-history-native.mjs';

const site='99990001',foreign='99990002',owner=id(99),authUserId=id(1),employeeId=id(101),workerId=id(201),place=id(301);
const rpc='faolla_attendance_self_requests_v1',quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const ids=Object.freeze({tie:id(88000),old:id(88100),approved:id(88101),withdrawn:id(88102),rejected:id(88103),pending:id(88104),revised:id(88105),
  correctionRejected:id(88301),correctionWithdrawn:id(88302),correctionPending:id(88303)});
const migrations=Object.freeze(['202610010089_merchant_attendance_scoped_report_context.sql',
  '202610010096_merchant_attendance_current_correction_decisions.sql','202610010098_merchant_attendance_revision_application_access.sql',
  '202610010099_merchant_attendance_schedule.sql','202610010100_merchant_attendance_missing_requests.sql',
  '202610010101_merchant_attendance_unified_report.sql','202610010102_merchant_attendance_unified_export.sql',
  '202610010103_merchant_attendance_missing_revisions.sql','202610030118_merchant_attendance_self_requests.sql']);
const labels=Object.freeze([
  'self requests reads all three sources and four states for one current employee/worker, with an independent68-row oracle',
  'self requests uses50+18 bounded pages and an empty first50 approved-revision page without losing older results',
  'self requests orders same microsecond/UUID across kinds and includes a synthetic declaration older than31days',
  'self requests pinned asOf excludes an actual later withdrawal and a fresh read sees the new terminal',
  'self requests paused view-only inactive-worker reads succeed while current membership and role revocation deny',
  'self requests employee/worker/auth changes reject old pins and never inherit former identity submissions',
  'self requests inconsistent roots, start-event identity and missing lineage fail the whole page; null ledger identities remain constrained',
  'self requests malformed queries, foreign subjects and browser execute are rejected; four request ledgers stay private while061 event SELECT is preserved',
  'self requests reapplication preserves owner/index/ACL and all reads preserve every owned business table; scenario mutations roll back',
]);
let phase='entry';
export const selfRequestsQueryInput=(patch={})=>({expectedEmployeeId:employeeId,expectedWorkerId:workerId,kind:'all',status:'all',asOf:null,cursorAt:null,cursorKind:null,cursorId:null,...patch});
const expr=(q=selfRequestsQueryInput(),actor=authUserId,merchant=site)=>`public.${rpc}('${merchant}','${actor}',${typeof q==='string'?q:json(q)})`;
const denied=(code,expression)=>`begin perform ${expression};raise exception 'self_requests_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;

export function selfRequestsNativeFailure(error){
  const text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
  const allowed=new Set(['attendance_invalid_request','attendance_access_denied','attendance_worker_changed','attendance_settings_required',
    'attendance_self_requests_invalid','attendance_self_requests_too_large','attendance_missing_conflict','attendance_missing_basis_changed',
    'attendance_missing_revision_stale','attendance_correction_policy_changed','merchant_attendance_self_requests_prerequisite_required']);
  return {error:'self_requests_native_failed',phase,code:allowed.has(code)?code:'local_check_failed',
    sourceLine:Number(text.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1]??0)||null};
}
export function selfRequestsMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  return migrations.map(name=>{const source=readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8');
    const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
    assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));return {name,source,body,statement};});
}
function ownedGuard(owned){
  assert(owned&&/^attendance_race_[a-f0-9]{32}$/.test(owned.schema)&&owned.owner==='postgres');
  assert(Number.isSafeInteger(owned.oid)&&owned.oid>0&&Number.isSafeInteger(owned.tableOid)&&owned.tableOid>0);
  assert(/^faolla-synthetic-concurrency:[a-f0-9-]{36}$/.test(owned.marker));
  return `do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
    and n.nspname=${quote(owned.schema)} and n.nspowner::regrole::text='postgres' and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)})
    then raise exception 'self_requests_owned_schema_required';end if;end;$owned$;`;
}

/** Pure SQL construction; existing125 prepare has supplied only its lawful seed. */
export function selfRequestsNativePlan(owned,tables,{now=Date.now()}={}){
  const guard=ownedGuard(owned);assert(Number.isFinite(now));assert(Array.isArray(tables)&&tables.length>0&&new Set(tables).size===tables.length);
  for(const t of tables)assert(typeof t==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(t)&&t.length<=63);
  for(const t of ['merchants','merchant_attendance_events','merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_requests','merchant_attendance_missing_entries'])assert(tables.includes(t));
  const fingerprint=`(select md5(jsonb_build_object(${tables.map(t=>`${quote(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${t} r)`).join(',')})::text))`;
  const day=n=>new Date(now-n*86400000).toISOString().slice(0,10),at=(n,h)=>`${day(n)}T${String(h).padStart(2,'0')}:00:00.000123Z`;
  const proposal=(n,end=16,start=8)=>({startAt:at(n,start),endAt:at(n,end),breaks:[]});
  const missingQuery=(access='self',requestId=null)=>({siteId:site,access,fromDate:day(10),throughDate:day(0),requestId,operationId:null,beforeAt:null,beforeId:null});
  const missingCall=(requestId,command=null,access='self',actor=authUserId)=>`public.faolla_attendance_missing_v1(${json(missingQuery(access,requestId))},'${actor}',${typeof command==='string'?command:json(command)},true)`;
  const missingCommand=(requestId,n)=>({action:'submit',operationId:requestId,expectedWorkerId:workerId,expectedSettingsVersion:1,expectedPolicyRevision:1,locationId:place,timeZone:'UTC',proposal:proposal(n),reason:'Synthetic actual missing declaration'});
  const actualMissing=(requestId,n,terminal,operation)=>`do $actual_missing$ declare r jsonb;c jsonb;begin
    r:=${missingCall(null,missingCommand(requestId,n))};
    ${terminal?`r:=${missingCall(requestId,null,terminal==='withdraw'?'self':'owner',terminal==='withdraw'?authUserId:owner)};
      c:=jsonb_build_object('action','${terminal}','operationId','${operation}','requestId','${requestId}','expectedRevision',1,'reason','Synthetic actual terminal');
      ${terminal==='withdraw'?'':"c:=c||jsonb_build_object('evidenceToken',r->'detail'->>'evidenceToken');"}
      perform ${missingCall(requestId,'c',terminal==='withdraw'?'self':'owner',terminal==='withdraw'?authUserId:owner)};`:''}
    end;$actual_missing$;`;
  const correction=(requestId,rev,terminal,operation)=>{
    const command={action:'submit',operationId:requestId,expectedRevision:rev-1,expectedPolicyRevision:1,reason:'Synthetic actual correction',startEventId:id(89000),expectedLastEventId:id(89001),proposal:proposal(5,17)};
    const query={mode:'detail',expectedWorkerId:workerId,requestId,operationId:null};
    return `do $actual_correction$ declare r jsonb;c jsonb;begin
      perform public.faolla_attendance_correction_self_v3('${site}','${authUserId}',${json(query)},${json(command)},true);
      ${terminal==='reject'?`r:=public.faolla_attendance_correction_decide_v2('${site}','${owner}','${requestId}',null,null,true);
        c:=jsonb_build_object('action','reject','operationId','${operation}','requestId','${requestId}','expectedRevision',${rev},'expectedEvidence',r->>'evidenceToken','reason','Synthetic actual rejection');
        perform public.faolla_attendance_correction_decide_v2('${site}','${owner}','${requestId}',c,null,true);`:
    terminal==='withdraw'?`perform public.faolla_attendance_correction_self_v3('${site}','${authUserId}',${json(query)},${json({action:'withdraw',operationId:operation,requestId,expectedRevision:rev,reason:'Synthetic actual withdrawal'})},true);`:''}
    end;$actual_correction$;`;
  };
  const syntheticMissing=(requestId,n,time)=>`insert into public.merchant_attendance_missing_requests(merchant_id,request_id,worker_id,employee_id,actor_auth_user_id,worker_name,location_id,location_name,time_zone,proposal,reason,policy_revision,deadline_at,start_at,end_at,submitted_at)
    values('${site}','${requestId}','${workerId}','${employeeId}','${authUserId}','Synthetic revision worker','${place}','Synthetic self revision location','UTC',${json(proposal(n))},'Synthetic pre-existing declaration',1,(${time})+interval '365 days','${at(n,8)}','${at(n,16)}',${time});
    insert into public.merchant_attendance_missing_entries(merchant_id,operation_id,request_id,revision,action,actor_auth_user_id,command,recorded_at)
    values('${site}','${requestId}','${requestId}',1,'submit','${authUserId}',${json(missingCommand(requestId,n))},${time});`;
  const seed=[`begin;reset role;${guard}
    do $fresh$ begin assert not exists(select 1 from public.merchant_attendance_events where id='${id(89000)}')
      and not exists(select 1 from public.merchant_attendance_missing_requests),'self_requests_extra_seed_absent';end;$fresh$;
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.request'] where id='${id(30)}';
    update public.merchant_attendance_workers set active=true where merchant_id='${site}' and id='${workerId}';
    update public.merchant_attendance_locations set active=true where merchant_id='${site}' and id='${place}';
    -- Four synthetic raw events, never described as actual employee punches.
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
      ${[0,1,2,3].map(n=>`('${id(89000+n)}','${site}','${workerId}','${place}','${id(89500+n)}',${5+n},'${n%2?'clock_out':'clock_in'}','web','${at(n<2?5:1,n<2?(n%2?16:8):(n%2?19:18))}','UTC','${employeeId}')`).join(',')};`,
    `set local role service_role;${correction(ids.correctionRejected,1,'reject',id(88401))}reset role;`,
    `set local role service_role;${correction(ids.correctionWithdrawn,2,'withdraw',id(88402))}reset role;`,
    `set local role service_role;${correction(ids.correctionPending,4)}reset role;`,
    `set local role service_role;${actualMissing(ids.approved,4,'approve',id(88201))}reset role;`,
    `set local role service_role;${actualMissing(ids.withdrawn,3,'withdraw',id(88202))}reset role;`,
    `set local role service_role;${actualMissing(ids.rejected,2,'reject',id(88203))}reset role;`,
    `set local role service_role;${actualMissing(ids.pending,1)}
      do $revise$ begin perform ${missingCall(null,{...missingCommand(ids.revised,4),action:'revise',supersedesRequestId:ids.approved,expectedApprovalOperationId:id(88201),proposal:proposal(4,15)})};end;$revise$;reset role;`,
    syntheticMissing(ids.old,70,`'${at(60,20)}'::timestamptz`),
    `-- Explicit synthetic cross-source same-time and same-UUID collision.
      do $ties$ declare t timestamptz:=clock_timestamp();r public.merchant_attendance_revision_requests%rowtype;n bigint;begin
        insert into public.merchant_attendance_correction_entries(merchant_id,worker_id,employee_id,start_event_id,revision,request_id,operation_id,actor_auth_user_id,action,reason,proposal,basis,command,recorded_at)
        values('${site}','${workerId}','${employeeId}','${id(89002)}',1,'${ids.tie}','${ids.tie}','${authUserId}','submit','Synthetic pre-existing collision',${json(proposal(1,19,18))},
          public.faolla_attendance_correction_basis_v1('${site}','${authUserId}','${id(89002)}','${workerId}','${employeeId}'),
          ${json({action:'submit',operationId:ids.tie,expectedRevision:0,startEventId:id(89002),expectedLastEventId:id(89003),proposal:proposal(1,19,18),reason:'Synthetic pre-existing collision'})},t);
        select * into r from public.merchant_attendance_revision_requests where merchant_id='${site}' and base_request_id='${id(501)}' and action='submit' order by revision desc limit 1;
        select max(revision)+1 into n from public.merchant_attendance_revision_requests where merchant_id='${site}' and base_request_id='${id(501)}';
        insert into public.merchant_attendance_revision_requests(merchant_id,base_request_id,worker_id,employee_id,revision,request_id,operation_id,actor_auth_user_id,action,policy_revision,base_operation_id,command,recorded_at)
        values(r.merchant_id,r.base_request_id,r.worker_id,r.employee_id,n,'${ids.tie}','${ids.tie}',r.actor_auth_user_id,'submit',r.policy_revision,r.base_operation_id,r.command||jsonb_build_object('operationId','${ids.tie}','expectedRevision',n-1),t);
        ${syntheticMissing(ids.tie,20,'t')}
      end;$ties$;
      update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${id(30)}';
      update public.merchant_attendance_workers set active=false where merchant_id='${site}' and id='${workerId}';
      update public.merchant_attendance_locations set active=false where merchant_id='${site}' and id='${place}';commit;`];
  // A closed list of IDs/statuses/terminal operation IDs, NEVER inferred from118.
  const oracleCases=[
    ...[501,502].map(n=>({kind:'correction',requestId:id(n),status:'approved',closedOp:id(n+100)})),
    {kind:'correction',requestId:ids.correctionRejected,status:'rejected',closedOp:id(88401)},
    {kind:'correction',requestId:ids.correctionWithdrawn,status:'withdrawn',closedOp:id(88402)},
    {kind:'correction',requestId:ids.correctionPending,status:'submitted'},
    {kind:'revision',requestId:id(701),status:'approved',closedOp:id(1701)},
    {kind:'revision',requestId:id(702),status:'rejected',closedOp:id(1702)},
    ...Array.from({length:51},(_,n)=>({kind:'revision',requestId:id(1002+2*n),status:'withdrawn',closedOp:id(1003+2*n)})),
    {kind:'revision',requestId:id(900),status:'submitted'},
    ...['correction','revision','missing'].map(kind=>({kind,requestId:ids.tie,status:'submitted'})),
    ...[['approved',88201],['withdrawn',88202],['rejected',88203],['pending',null],['revised',null],['old',null]].map(([key,op])=>({kind:'missing',requestId:ids[key],status:op?key:'submitted',...(op?{closedOp:id(op)}:{})})),
  ];
  assert.equal(oracleCases.length,68);
  const oracle=`select coalesce(jsonb_agg(row order by at desc,rank desc,request desc),'[]'::jsonb) from (${oracleCases.map(o=>{
    const rank={correction:1,revision:2,missing:3}[o.kind],table={correction:'correction_entries',revision:'revision_requests',missing:'missing_requests'}[o.kind];
    const time=o.kind==='missing'?'submitted_at':'recorded_at',root=o.kind==='correction'?'r.request_id':o.kind==='revision'?'r.base_request_id':'coalesce(r.root_request_id,r.request_id)';
    const start=o.kind==='correction'?"r.proposal->>'startAt'":o.kind==='revision'?"r.command->'proposal'->>'startAt'":"to_char(r.start_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')";
    const end=o.kind==='correction'?"r.proposal->>'endAt'":o.kind==='revision'?"r.command->'proposal'->>'endAt'":"to_char(r.end_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')";
    const terminalTable=o.kind==='missing'?'missing_entries':o.kind==='correction'?(o.status==='withdrawn'?'correction_entries':'correction_decisions'):(o.status==='withdrawn'?'revision_requests':'revision_decisions');
    const closed=o.closedOp?`(select to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.merchant_attendance_${terminalTable} where merchant_id='${site}' and operation_id='${o.closedOp}')`:'null';
    return `select r.${time} at,${rank} rank,r.request_id request,jsonb_build_object('kind','${o.kind}','requestId',r.request_id,'rootRequestId',${root},'workerId','${workerId}','employeeId','${employeeId}',
      'workerName','Synthetic revision worker','workerNo','REVISION-201','submittedAt',to_char(r.${time} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'proposedStartAt',${start},'proposedEndAt',${end},'status','${o.status}','closedAt',${closed}) row
      from public.merchant_attendance_${table} r where r.merchant_id='${site}' and r.request_id='${o.requestId}'${o.kind==='missing'?'':" and r.action='submit'"}`;
  }).join('\nunion all\n')}) independent_oracle;`;
  const withdrawSql=`set local role service_role;do $later$ begin perform ${missingCall(ids.pending,{action:'withdraw',operationId:id(88204),requestId:ids.pending,expectedRevision:1,reason:'Synthetic actual later withdrawal'})};end;$later$;reset role;`;
  return {site,foreign,owner,authUserId,employeeId,workerId,place,ids:{...ids},guard,fingerprint,seed,oracle,oracleCases,withdrawSql,oldAt:at(60,20),labels:[...labels]};
}

export async function prepareSelfRequestsNativeFixture(native,scope){
  phase='existing125-lawful-seed';const prior=await prepareSelfRevisionHistoryNativeFixture(native,scope);
  const raw=s=>native.query(scope.sql(s)),owned=assertLifecycleSandbox(raw);assert.deepEqual(owned,prior.owned);assert.equal(scope.schema,owned.schema);
  const exec=source=>{assert.deepEqual(assertLifecycleSandbox(raw),owned,'self_requests_namespace_changed');return prior.exec(source);};
  const migrationPlan=selfRequestsMigrationPlan(native.root,scope);
  for(const migration of migrationPlan){phase=path.basename(migration.name,'.sql');exec(migration.body);}
  const tables=JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const plan=selfRequestsNativePlan(owned,tables),before=exec(`select ${plan.fingerprint};`);
  const installed=()=>exec(`select jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner::regrole::text,'acl',p.proacl,
    'correctionIndex',pg_get_indexdef('public.attendance_correction_self_identity_history_idx'::regclass),
    'missingIndex',pg_get_indexdef('public.attendance_missing_self_identity_history_idx'::regclass)) from pg_proc p where p.oid='public.${rpc}(text,uuid,jsonb)'::regprocedure;`);
  const first=installed();phase='reapply118';exec(migrationPlan.at(-1).body);assert.equal(installed(),first,'self_requests_reapply_changed_owner_acl_index');assert.equal(exec(`select ${plan.fingerprint};`),before,'self_requests_reapply_changed_facts');
  phase='same-worker-original-writers-and-explicit-history';await native.querySteps(plan.seed.map(scope.sql));
  const expectedRows=JSON.parse(exec(plan.oracle));assert.equal(expectedRows.length,68,'self_requests_independent_oracle_count');
  const expected=(kind='all',status='all')=>expectedRows.filter(r=>(kind==='all'||r.kind===kind)&&(status==='all'||r.status===status));
  const fingerprint=()=>exec(`select ${plan.fingerprint};`),asOf=exec(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');`);
  const read=(patch={})=>JSON.parse(exec(`set local role service_role;select ${expr(selfRequestsQueryInput(patch))};`));
  return {site,foreign,owner,authUserId,employeeId,workerId,place,exec,owned,fingerprint,queryInput:selfRequestsQueryInput,expectedRows,expected,asOf,read,plan,ids:{...ids},syntheticOnly:true};
}

export async function checkAttendanceSelfRequestsNative(native,scope){
  const data=await prepareSelfRequestsNativeFixture(native,scope),{exec,plan}=data,before=data.fingerprint();phase='bounded-read-cases';
  const walk=(kind='all',status='all')=>{const items=[],pages=[];let q={kind,status},first=null;
    do{const page=data.read(q);assert(pages.length<10,'self_requests_bounded_walk');pages.push(page);if(!first)first=page;assert.equal(page.asOf,first.asOf);
      assert.deepEqual(Object.keys(page).sort(),['protocol','readOnly','siteId','employeeId','workerId','asOf','items','scanned','nextCursor'].sort());
      assert.equal(page.protocol,'self-requests-v1');assert.equal(page.readOnly,true);assert.equal(page.employeeId,employeeId);assert.equal(page.workerId,workerId);
      items.push(...page.items);q=page.nextCursor?{kind,status,asOf:page.asOf,cursorAt:page.nextCursor.recordedAt,cursorKind:page.nextCursor.kind,cursorId:page.nextCursor.requestId}:null;
    }while(q);assert.deepEqual(items,data.expected(kind,status));return pages;};
  const pages=walk();assert.deepEqual(pages.map(p=>p.scanned),[50,18]);
  for(const kind of ['correction','revision','missing'])for(const status of ['all','submitted','approved','rejected','withdrawn'])walk(kind,status);
  const empty=data.read({kind:'revision',status:'approved'});assert.equal(empty.scanned,50);assert.deepEqual(empty.items,[]);assert(empty.nextCursor);
  const ties=data.expectedRows.filter(r=>r.requestId===ids.tie);assert.deepEqual(ties.map(r=>r.kind),['missing','revision','correction']);assert.equal(new Set(ties.map(r=>r.submittedAt)).size,1);
  for(let n=0;n<3;n++){const page=data.read({asOf:data.asOf,cursorAt:ties[n].submittedAt,cursorKind:ties[n].kind,cursorId:ids.tie});assert.deepEqual(page.items.slice(0,2-n).map(r=>r.kind),ties.slice(n+1).map(r=>r.kind));}
  assert(Date.parse(data.expectedRows.find(r=>r.requestId===ids.old).submittedAt)<Date.now()-31*86400000);
  assert.equal(data.fingerprint(),before,'self_requests_reads_changed_facts');
  const mutationRead=(setup,checks)=>`begin;reset role;${plan.guard}${setup}
    create temp table self_requests_before(value text) on commit drop;insert into self_requests_before values(${plan.fingerprint});
    set local role service_role;do $check$ declare a jsonb;b jsonb;q jsonb;begin ${checks} end;$check$;reset role;
    do $unchanged$ begin assert (select value from self_requests_before)=${plan.fingerprint},'self_requests_read_mutated_facts';end;$unchanged$;rollback;`;
  exec(mutationRead(plan.withdrawSql,`a:=${expr(selfRequestsQueryInput({kind:'missing',asOf:data.asOf}))};assert exists(select 1 from jsonb_array_elements(a->'items') r where r->>'requestId'='${ids.pending}' and r->>'status'='submitted'),'pinned asOf retains original state';
    a:=${expr(selfRequestsQueryInput({kind:'missing'}))};assert exists(select 1 from jsonb_array_elements(a->'items') r where r->>'requestId'='${ids.pending}' and r->>'status'='withdrawn'),'fresh asOf sees actual terminal';`));
  for(const setup of [`update public.merchant_enterprise_employees set status='disabled' where id='${employeeId}';`,
    `update public.merchant_enterprise_roles set status='archived' where id='${id(30)}';`,
    `update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${id(30)}';`])exec(mutationRead(setup,denied('attendance_access_denied',expr())));
  exec(mutationRead(`update public.merchant_attendance_workers set employee_id=null where id='${workerId}';update public.merchant_attendance_workers set employee_id='${employeeId}' where id='${id(202)}';update public.merchant_attendance_workers set employee_id='${id(102)}' where id='${workerId}';`,
    denied('attendance_worker_changed',expr())+`a:=${expr(selfRequestsQueryInput({expectedWorkerId:id(202)}))};assert a->'items'='[]'::jsonb and a->>'scanned'='0','replacement worker inherits none';`));
  exec(mutationRead(`update public.merchant_enterprise_employees set auth_user_id='${id(88)}' where id='${employeeId}';`,denied('attendance_access_denied',expr())+
    `a:=${expr(selfRequestsQueryInput(),id(88))};assert a->'items'='[]'::jsonb and a->>'scanned'='0','replacement auth inherits none';`));
  // Inconsistent synthetic rows exist only inside these rollback transactions.
  const badRevision=`insert into public.merchant_attendance_revision_requests(merchant_id,base_request_id,worker_id,employee_id,revision,request_id,operation_id,actor_auth_user_id,action,policy_revision,base_operation_id,command,recorded_at)
    select merchant_id,base_request_id,'${workerId}','${employeeId}',revision+1,'${id(89990)}','${id(89990)}','${authUserId}','submit',policy_revision,base_operation_id,command,clock_timestamp()
    from public.merchant_attendance_revision_requests where merchant_id='${site}' and request_id='${id(910)}' and action='submit';`;
  exec(mutationRead(badRevision,denied('attendance_self_requests_invalid',expr(selfRequestsQueryInput({kind:'revision'})))));
  for(const actor of ['null',`'${id(102)}'`]){
    const badStart=`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id)
      select '${id(89991)}',merchant_id,worker_id,location_id,'${id(89992)}',999,'clock_in','web',occurred_at,'UTC',${actor} from public.merchant_attendance_events where id='${id(89002)}';
      insert into public.merchant_attendance_correction_entries(merchant_id,worker_id,employee_id,start_event_id,revision,request_id,operation_id,actor_auth_user_id,action,reason,proposal,basis,command,recorded_at)
      select merchant_id,worker_id,employee_id,'${id(89991)}',1,'${id(89993)}','${id(89993)}',actor_auth_user_id,'submit',reason,proposal,basis,command,clock_timestamp() from public.merchant_attendance_correction_entries where merchant_id='${site}' and request_id='${ids.tie}' and action='submit';`;
    exec(mutationRead(badStart,denied('attendance_self_requests_invalid',expr(selfRequestsQueryInput({kind:'correction'})))));
  }
  const badMissing=`insert into public.merchant_attendance_missing_requests select (jsonb_populate_record(null::public.merchant_attendance_missing_requests,to_jsonb(r)||jsonb_build_object('request_id','${id(89994)}','supersedes_request_id','${ids.approved}','supersedes_operation_id','${id(88201)}','root_request_id','${ids.old}','submitted_at',clock_timestamp(),'deadline_at',clock_timestamp()+interval '365 days'))).* from public.merchant_attendance_missing_requests r where merchant_id='${site}' and request_id='${ids.revised}';
    insert into public.merchant_attendance_missing_entries(merchant_id,operation_id,request_id,revision,action,actor_auth_user_id,command,recorded_at)
      select merchant_id,request_id,request_id,1,'submit',actor_auth_user_id,'{}',submitted_at from public.merchant_attendance_missing_requests where merchant_id='${site}' and request_id='${id(89994)}';`;
  exec(mutationRead(badMissing,denied('attendance_self_requests_invalid',expr(selfRequestsQueryInput({kind:'missing'})))));
  for(const table of ['merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_requests'])for(const column of ['employee_id','actor_auth_user_id'])
    exec(`begin;reset role;${plan.guard}do $nonnull$ declare r public.${table}%rowtype;begin select * into r from public.${table} where merchant_id='${site}' limit 1;r.${column}:=null;
      begin insert into public.${table} select (r).*;raise exception 'self_requests_null_identity_allowed';exception when not_null_violation then null;end;end;$nonnull$;rollback;`);
  const invalid=[null,{}, {...selfRequestsQueryInput(),extra:1},{...selfRequestsQueryInput(),kind:'pending'},{...selfRequestsQueryInput(),status:'approve'},
    {...selfRequestsQueryInput(),expectedEmployeeId:null},{...selfRequestsQueryInput(),expectedWorkerId:1},
    {...selfRequestsQueryInput(),asOf:'2000-01-01T00:00:00.000Z'},{...selfRequestsQueryInput(),asOf:'2100-01-01T00:00:00.000000Z'},
    {...selfRequestsQueryInput(),cursorAt:plan.oldAt},{...selfRequestsQueryInput(),cursorKind:'correction'},
    {...selfRequestsQueryInput(),cursorAt:plan.oldAt,cursorKind:'missing',cursorId:ids.old},
    {...selfRequestsQueryInput(),kind:'revision',asOf:data.asOf,cursorAt:plan.oldAt,cursorKind:'missing',cursorId:ids.old}];
  exec(mutationRead('',denied('attendance_access_denied',expr(selfRequestsQueryInput({expectedEmployeeId:id(102)})))+
    denied('attendance_access_denied',expr(selfRequestsQueryInput(),owner))+denied('attendance_access_denied',expr(selfRequestsQueryInput(),authUserId,foreign))+
    invalid.map(q=>denied('attendance_invalid_request',expr(q))).join('\n')));
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expr()};raise exception 'self_requests_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  exec(`set local role service_role;do $private$ begin
    assert has_table_privilege(current_user,'public.merchant_attendance_events','SELECT'),'self_requests_original_event_select_revoked';
    perform 1 from public.merchant_attendance_events limit 1;
    ${['merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_requests','merchant_attendance_missing_entries'].map(t=>`begin perform 1 from public.${t};raise exception 'self_requests_private_table_read_allowed';exception when insufficient_privilege then null;end;`).join('\n')}end;$private$;`);
  assert.equal(data.fingerprint(),before,'self_requests_scenario_changes_not_rolled_back');for(const label of labels)native.pass(label);
  return {checks:labels.length,candidates:68,pages:2,scenarioChangesRolledBack:true,syntheticOnly:true,callerOwnedNamespaceCleanup:true};
}
export async function runAttendanceSelfRequestsNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceSelfRequestsNative(native,scope)));}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  runAttendanceSelfRequestsNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(selfRequestsNativeFailure(error)));process.exitCode=1;});
}
