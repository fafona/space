// Local synthetic acceptance only. Historical rows and same-ID/time collision
// fixtures below are explicitly seeded, never described as real user requests.
// Existing125 original RPC writers supply correction/revision terminal states;
// additional missing terminal states use the unchanged103 RPC implementation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {prepareSelfRevisionHistoryNativeFixture} from './merchant-attendance-self-revision-history-native.mjs';

const site='99990001',foreign='99990002',owner=id(99),place=id(301),rpc='faolla_attendance_owner_backlog_v1';
const ids=Object.freeze({oldEmployee:id(898),oldAuth:id(898),oldWorker:id(898),oldPending:id(86000),tie:id(88000),
  missingEmployee:id(104),missingAuth:id(4),missingWorker:id(204),missingRole:id(34),
  approved:id(88101),withdrawn:id(88102),rejected:id(88103),pending:id(88104),revised:id(88105)});
const migrations=Object.freeze(['202610010089_merchant_attendance_scoped_report_context.sql',
  '202610010096_merchant_attendance_current_correction_decisions.sql','202610010098_merchant_attendance_revision_application_access.sql',
  '202610010099_merchant_attendance_schedule.sql','202610010100_merchant_attendance_missing_requests.sql',
  '202610010101_merchant_attendance_unified_report.sql','202610010102_merchant_attendance_unified_export.sql',
  '202610010103_merchant_attendance_missing_revisions.sql','202610030117_merchant_attendance_owner_backlog.sql']);
const labels=Object.freeze([
  'owner backlog scans an empty first50 historical terminal candidates and reaches pending work older than31days',
  'owner backlog merges all three sources exactly once and each kind remains independently pageable',
  'owner backlog same microsecond and UUID across three kinds advances by the complete ordered cursor',
  'owner backlog fixed asOf excludes an actual later withdrawal while a fresh query observes it',
  'owner backlog remains readable when paused or historical staff are inactive or rebound',
  'owner backlog rechecks current owner and tenant on every page and rejects malformed cursors',
  'owner backlog fails closed on inconsistent terminal identity without hiding ledger corruption',
  'owner backlog browser execute and private table reads remain denied with repeatable migration ACLs',
  'owner backlog reads preserve all owned business tables and all scenario mutations roll back',
]);
let phase='entry';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export const ownerBacklogQueryInput=(patch={})=>({kind:'all',asOf:null,cursorAt:null,cursorKind:null,cursorId:null,...patch});
const expr=(q=ownerBacklogQueryInput(),actor=owner,merchant=site)=>`public.${rpc}('${merchant}','${actor}',${typeof q==='string'?q:json(q)})`;
const denied=(code,expression)=>`begin perform ${expression};raise exception 'owner_backlog_unexpected_acceptance';
  exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
const nextQuery=(kind='all')=>`jsonb_build_object('kind','${kind}','asOf',a->>'asOf','cursorAt',a->'nextCursor'->>'recordedAt',
  'cursorKind',a->'nextCursor'->>'kind','cursorId',a->'nextCursor'->>'requestId')`;

export function ownerBacklogNativeFailure(error){
  const text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
  const allowed=new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required',
    'attendance_owner_backlog_invalid','attendance_owner_backlog_too_large','attendance_missing_conflict',
    'attendance_missing_basis_changed','attendance_missing_revision_stale','attendance_correction_policy_changed',
    'merchant_attendance_owner_backlog_prerequisite_required','merchant_attendance_owner_backlog_registry_postcondition_failed',
    'merchant_attendance_owner_backlog_acl_postcondition_failed']);
  return {error:'owner_backlog_native_failed',phase,code:allowed.has(code)?code:'local_check_failed',
    sourceLine:Number(text.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1]??0)||null};
}

export function ownerBacklogMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  return migrations.map(name=>{
    const source=readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8');
    const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
    assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));
    return {name,source,body,statement};
  });
}

function ownedGuard(owned){
  assert(owned&&/^attendance_race_[a-f0-9]{32}$/.test(owned.schema)&&owned.owner==='postgres');
  assert(Number.isSafeInteger(owned.oid)&&owned.oid>0&&Number.isSafeInteger(owned.tableOid)&&owned.tableOid>0);
  assert(/^faolla-synthetic-concurrency:[a-f0-9-]{36}$/.test(owned.marker));
  return `do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
    and n.nspname=${quote(owned.schema)} and n.nspowner::regrole::text='postgres' and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)})
    then raise exception 'owner_backlog_owned_schema_required';end if;end;$owned$;`;
}

/** Pure construction only; original125 setup has already populated the scope. */
export function ownerBacklogNativePlan(owned,tables,{now=Date.now()}={}){
  const guard=ownedGuard(owned);assert(Number.isFinite(now));
  assert(Array.isArray(tables)&&tables.length>0&&new Set(tables).size===tables.length);
  for(const table of tables)assert(typeof table==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(table)&&table.length<=63);
  for(const table of ['merchants','merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_requests','merchant_attendance_missing_entries'])assert(tables.includes(table));
  const fingerprint=`(select md5(jsonb_build_object(${tables.map(t=>`${quote(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${t} r)`).join(',')})::text))`;
  const day=n=>new Date(now-n*86400000).toISOString().slice(0,10),at=(n,h)=>`${day(n)}T${String(h).padStart(2,'0')}:00:00.000123Z`;
  const oldAt=at(60,20),proposal=(n,end=16)=>({startAt:at(n,8),endAt:at(n,end),breaks:[]});
  const missingQuery=(access='self',requestId=null)=>({siteId:site,access,fromDate:day(10),throughDate:day(0),requestId,operationId:null,beforeAt:null,beforeId:null});
  const missingCall=(requestId,command=null,access='self',actor=ids.missingAuth)=>
    `public.faolla_attendance_missing_v1(${json(missingQuery(access,requestId))},'${actor}',${typeof command==='string'?command:json(command)},true)`;
  const missingCommand=(requestId,n)=>({action:'submit',operationId:requestId,expectedWorkerId:ids.missingWorker,
    expectedSettingsVersion:1,expectedPolicyRevision:1,locationId:place,timeZone:'UTC',proposal:proposal(n),reason:'Synthetic original missing declaration'});
  const actualMissing=(requestId,n,terminal,operation)=>`do $actual_missing$ declare r jsonb;c jsonb;begin
    r:=${missingCall(null,missingCommand(requestId,n))};
    ${terminal?`r:=${missingCall(requestId,null,terminal==='withdraw'?'self':'owner',terminal==='withdraw'?ids.missingAuth:owner)};
      c:=jsonb_build_object('action','${terminal}','operationId','${operation}','requestId','${requestId}','expectedRevision',1,'reason','Synthetic real terminal');
      ${terminal==='withdraw'?'':"c:=c||jsonb_build_object('evidenceToken',r->'detail'->>'evidenceToken');"}
      perform ${missingCall(requestId,'c',terminal==='withdraw'?'self':'owner',terminal==='withdraw'?ids.missingAuth:owner)};`:''}
    end;$actual_missing$;`;
  const oldSubmit=(n,start=89000,requestId=id(84000+n),recorded=`'${oldAt}'::timestamptz+interval '${n*2} microseconds'`)=>{
    const revision=start===89000?n*2-1:1,command={action:'submit',operationId:requestId,expectedRevision:revision-1,reason:'Synthetic pre-existing historical declaration',
      startEventId:id(start),expectedLastEventId:id(start+1),proposal:proposal(start===89000?100:start===89002?99:98)};
    return `insert into public.merchant_attendance_correction_entries(merchant_id,worker_id,employee_id,start_event_id,revision,request_id,operation_id,actor_auth_user_id,action,reason,proposal,basis,command,recorded_at)
      values('${site}','${ids.oldWorker}','${ids.oldEmployee}','${id(start)}',${revision},'${requestId}','${requestId}','${ids.oldAuth}','submit',
      'Synthetic pre-existing historical declaration',${json(command.proposal)},jsonb_set(public.faolla_attendance_correction_basis_v1('${site}','${ids.oldAuth}','${id(start)}','${ids.oldWorker}','${ids.oldEmployee}'),'{asOf}',to_jsonb(to_char((${recorded}) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))),${json(command)},${recorded});`;
  };
  const seed=[`begin;reset role;${guard}
    do $fresh$ begin assert not exists(select 1 from public.merchant_attendance_workers where id in('${ids.oldWorker}','${ids.missingWorker}')),'owner_backlog_extra_seed_must_be_absent';end;$fresh$;
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${ids.missingRole}','${site}','Synthetic missing request role',array['enterprise.view','attendance.self.view','attendance.self.request']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${ids.oldEmployee}','${site}','${ids.oldAuth}','backlog-old@example.test','Synthetic historical employee','${id(30)}','active'),
      ('${ids.missingEmployee}','${site}','${ids.missingAuth}','backlog-missing@example.test','Synthetic missing employee','${ids.missingRole}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values
      ('${ids.oldWorker}','${site}','${ids.oldEmployee}','BACKLOG-OLD','Synthetic historical worker','${place}',false),
      ('${ids.missingWorker}','${site}','${ids.missingEmployee}','BACKLOG-MISSING','Synthetic missing worker','${place}',true);
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${ids.oldWorker}','2000-01-01'),('${site}','${ids.missingWorker}','2000-01-01');
    update public.merchant_attendance_locations set active=true where merchant_id='${site}' and id='${place}';
    -- Six explicitly synthetic historical raw punches, not an actual user clock.
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
      ${Array.from({length:6},(_,n)=>`('${id(89000+n)}','${site}','${ids.oldWorker}','${place}','${id(89500+n)}',${n+1},'${n%2?'clock_out':'clock_in'}','web','${at(100-Math.floor(n/2),n%2?16:8)}','UTC','${ids.oldEmployee}')`).join(',')};`,
    ...Array.from({length:5},(_,batch)=>Array.from({length:10},(_,offset)=>{
      const n=batch*10+offset+1;
      return oldSubmit(n)+`insert into public.merchant_attendance_correction_entries(merchant_id,worker_id,employee_id,start_event_id,revision,request_id,operation_id,actor_auth_user_id,action,reason,command,recorded_at)
        values('${site}','${ids.oldWorker}','${ids.oldEmployee}','${id(89000)}',${n*2},'${id(84000+n)}','${id(85000+n)}','${ids.oldAuth}','withdraw','Synthetic pre-existing historical withdrawal',
        ${json({action:'withdraw',operationId:id(85000+n),requestId:id(84000+n),expectedRevision:n*2-1,reason:'Synthetic pre-existing historical withdrawal'})},'${oldAt}'::timestamptz+interval '${n*2+1} microseconds');`;
    }).join('\n')),
    oldSubmit(51,89002,ids.oldPending),
    `set local role service_role;${actualMissing(ids.approved,4,'approve',id(88201))}reset role;`,
    `set local role service_role;${actualMissing(ids.withdrawn,3,'withdraw',id(88202))}reset role;`,
    `set local role service_role;${actualMissing(ids.rejected,2,'reject',id(88203))}reset role;`,
    `set local role service_role;${actualMissing(ids.pending,1)}
      do $actual_revise$ begin perform ${missingCall(null,{...missingCommand(ids.revised,4),action:'revise',supersedesRequestId:ids.approved,expectedApprovalOperationId:id(88201),proposal:proposal(4,15)})};end;$actual_revise$;reset role;`,
    `-- Deliberate synthetic cross-ledger collision: same timestamp AND UUID.
      do $tie$ declare t timestamptz:=clock_timestamp();r public.merchant_attendance_revision_requests%rowtype;n bigint;begin
        ${oldSubmit(1,89004,ids.tie,'t')}
        select * into r from public.merchant_attendance_revision_requests where merchant_id='${site}' and base_request_id='${id(501)}' and action='submit' order by revision desc limit 1;
        select max(revision)+1 into n from public.merchant_attendance_revision_requests where merchant_id='${site}' and base_request_id='${id(501)}';
        insert into public.merchant_attendance_revision_requests(merchant_id,base_request_id,worker_id,employee_id,revision,request_id,operation_id,actor_auth_user_id,action,policy_revision,base_operation_id,command,recorded_at)
        values(r.merchant_id,r.base_request_id,r.worker_id,r.employee_id,n,'${ids.tie}','${ids.tie}',r.actor_auth_user_id,'submit',r.policy_revision,r.base_operation_id,
          r.command||jsonb_build_object('operationId','${ids.tie}','expectedRevision',n-1),t);
        insert into public.merchant_attendance_missing_requests(merchant_id,request_id,worker_id,employee_id,actor_auth_user_id,worker_name,location_id,location_name,time_zone,proposal,reason,policy_revision,deadline_at,start_at,end_at,submitted_at)
        values('${site}','${ids.tie}','${ids.missingWorker}','${ids.missingEmployee}','${ids.missingAuth}','Synthetic missing worker','${place}','Synthetic self revision location','UTC',
          ${json(proposal(6))},'Synthetic pre-existing collision',1,t+interval '365 days','${at(6,8)}','${at(6,16)}',t);
        insert into public.merchant_attendance_missing_entries(merchant_id,operation_id,request_id,revision,action,actor_auth_user_id,command,recorded_at)
        values('${site}','${ids.tie}','${ids.tie}',1,'submit','${ids.missingAuth}',${json(missingCommand(ids.tie,6))},t);
      end;$tie$;
      update public.merchant_attendance_locations set active=false where merchant_id='${site}' and id='${place}';
      update public.merchant_attendance_workers set active=false where merchant_id='${site}' and id='${ids.missingWorker}';
      commit;`];
  const expectedIds={correction:[ids.oldPending,ids.tie],revision:[id(900),id(910),ids.tie],missing:[ids.pending,ids.revised,ids.tie]};
  const oracle=`select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'requestId',request_id,'submittedAt',to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by recorded_at,rank,request_id),'[]'::jsonb) from (
    select 'correction' kind,1 rank,request_id,recorded_at from public.merchant_attendance_correction_entries where merchant_id='${site}' and action='submit' and request_id in(${expectedIds.correction.map(quote).join(',')})
    union all select 'revision',2,request_id,recorded_at from public.merchant_attendance_revision_requests where merchant_id='${site}' and action='submit' and request_id in(${expectedIds.revision.map(quote).join(',')})
    union all select 'missing',3,request_id,submitted_at from public.merchant_attendance_missing_requests where merchant_id='${site}' and request_id in(${expectedIds.missing.map(quote).join(',')})
    ) expected;`;
  const withdrawSql=`set local role service_role;do $withdraw$ begin perform ${missingCall(ids.pending,{action:'withdraw',operationId:id(88204),requestId:ids.pending,expectedRevision:1,reason:'Synthetic actual later withdrawal'})};end;$withdraw$;reset role;`;
  return {site,foreign,owner,place,ids:{...ids},guard,fingerprint,seed,oracle,expectedIds,oldAt,withdrawSql,labels:[...labels]};
}

async function prepare(native,scope){
  phase='existing125-fixture';const prior=await prepareSelfRevisionHistoryNativeFixture(native,scope);
  const raw=s=>native.query(scope.sql(s)),owned=assertLifecycleSandbox(raw);assert.deepEqual(owned,prior.owned);assert.equal(scope.schema,owned.schema);
  const exec=source=>{assert.deepEqual(assertLifecycleSandbox(raw),owned,'owner_backlog_namespace_changed');return prior.exec(source);};
  const migrationPlan=ownerBacklogMigrationPlan(native.root,scope);
  for(const migration of migrationPlan){phase=path.basename(migration.name,'.sql');exec(migration.body);}
  const tables=JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const plan=ownerBacklogNativePlan(owned,tables),before=exec(`select ${plan.fingerprint};`);
  const installed=()=>exec(`select jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner::regrole::text,'acl',p.proacl) from pg_proc p where p.oid='public.${rpc}(text,uuid,jsonb)'::regprocedure;`);
  const definition=installed();phase='reapply117';exec(migrationPlan.at(-1).body);
  assert.equal(installed(),definition,'owner_backlog_reapply_changed_owner_acl_definition');assert.equal(exec(`select ${plan.fingerprint};`),before,'owner_backlog_reapply_changed_facts');
  phase='synthetic-history-and-original-missing-writers';await native.querySteps(plan.seed.map(scope.sql));
  const expectedRows=JSON.parse(exec(plan.oracle));assert.equal(expectedRows.length,8,'owner_backlog_eight_expected_pending');
  const pair=row=>({kind:row.kind,requestId:row.requestId});
  const expected={all:expectedRows.map(pair),...Object.fromEntries(['correction','revision','missing'].map(kind=>[kind,expectedRows.filter(r=>r.kind===kind).map(pair)]))};
  const fingerprint=()=>exec(`select ${plan.fingerprint};`),asOf=exec(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');`);
  const read=(patch={})=>JSON.parse(exec(`set local role service_role;select ${expr(ownerBacklogQueryInput(patch))};`));
  return {site,foreign,owner,place,exec,owned,tables,fingerprint,queryInput:ownerBacklogQueryInput,expected,expectedRows,ids:{...ids},asOf,read,plan,syntheticOnly:true};
}

export async function prepareOwnerBacklogNativeFixture(native,scope){return prepare(native,scope);}

export async function checkAttendanceOwnerBacklogNative(native,scope){
  const data=await prepare(native,scope),{exec,plan,expected}=data;phase='read-only-cases';
  const before=data.fingerprint(),all=[];let query=ownerBacklogQueryInput(),first=null,pages=0;
  do{
    const page=data.read(query);pages++;assert(pages<=10,'owner_backlog_bounded_pages');
    assert.deepEqual(Object.keys(page).sort(),['protocol','readOnly','siteId','ownerId','asOf','items','scanned','nextCursor'].sort());
    assert.equal(page.protocol,'owner-backlog-v1');assert.equal(page.readOnly,true);assert.equal(page.ownerId,owner);
    if(!first){first=page;assert.equal(page.scanned,50);assert.deepEqual(page.items,[]);assert(page.nextCursor);}
    assert.equal(page.asOf,first.asOf);
    for(const item of page.items){assert.deepEqual(Object.keys(item).sort(),['kind','requestId','workerId','workerName','workerNo','submittedAt','proposedStartAt','proposedEndAt','status'].sort());assert.equal(item.status,'submitted');all.push({kind:item.kind,requestId:item.requestId});}
    query=page.nextCursor?ownerBacklogQueryInput({asOf:page.asOf,cursorAt:page.nextCursor.recordedAt,cursorKind:page.nextCursor.kind,cursorId:page.nextCursor.requestId}):null;
  }while(query);
  assert.deepEqual(all,expected.all);assert(Date.parse(data.expectedRows[0].submittedAt)<Date.now()-31*86400000);
  for(const kind of ['correction','revision','missing']){
    const found=[];let page=data.read({kind}),count=0;
    while(true){assert(++count<=10);found.push(...page.items.map(r=>({kind:r.kind,requestId:r.requestId})));if(!page.nextCursor)break;
      page=data.read({kind,asOf:page.asOf,cursorAt:page.nextCursor.recordedAt,cursorKind:page.nextCursor.kind,cursorId:page.nextCursor.requestId});}
    assert.deepEqual(found,expected[kind]);
  }
  const tie=data.expectedRows.filter(r=>r.requestId===ids.tie);assert.deepEqual(tie.map(r=>r.kind),['correction','revision','missing']);assert.equal(new Set(tie.map(r=>r.submittedAt)).size,1);
  for(let n=0;n<3;n++){
    const page=data.read({asOf:first.asOf,cursorAt:tie[n].submittedAt,cursorKind:tie[n].kind,cursorId:ids.tie});
    assert.deepEqual(page.items.map(r=>({kind:r.kind,requestId:r.requestId})),tie.slice(n+1).map(r=>({kind:r.kind,requestId:r.requestId})));
  }
  assert.equal(data.fingerprint(),before,'owner_backlog_service_reads_changed_facts');
  const mutationRead=(prepareSql,checks)=>`begin;reset role;${plan.guard}${prepareSql}
    create temp table backlog_before(value text) on commit drop;insert into backlog_before values(${plan.fingerprint});
    set local role service_role;do $check$ declare a jsonb;b jsonb;q jsonb;begin ${checks} end;$check$;reset role;
    do $unchanged$ begin assert (select value from backlog_before)=${plan.fingerprint},'owner_backlog_read_mutated_business_facts';end;$unchanged$;rollback;`;
  const pendingRow=data.expectedRows.find(r=>r.requestId===ids.pending),afterQuery=ownerBacklogQueryInput({kind:'missing',asOf:first.asOf});
  exec(mutationRead(plan.withdrawSql,`a:=${expr(afterQuery)};assert exists(select 1 from jsonb_array_elements(a->'items') r where r->>'requestId'='${ids.pending}'),'pinned asOf keeps previous pending';
    a:=${expr(ownerBacklogQueryInput({kind:'missing'}))};assert not exists(select 1 from jsonb_array_elements(a->'items') r where r->>'requestId'='${ids.pending}'),'fresh read sees actual terminal';`));
  assert(pendingRow);
  exec(mutationRead(`update public.merchant_enterprise_employees set status='disabled' where id='${ids.oldEmployee}';
    update public.merchant_attendance_workers set employee_id=null where id='${ids.oldWorker}';`,
  `a:=${expr(ownerBacklogQueryInput({kind:'correction',asOf:first.asOf,cursorAt:plan.oldAt,cursorKind:'correction',cursorId:id(84050)}))};
    q:=${nextQuery('correction')};if a->'nextCursor'<>'null'::jsonb then a:=${expr('q')};end if;
    assert exists(select 1 from jsonb_array_elements(a->'items') r where r->>'requestId'='${ids.oldPending}'),'inactive rebound historic backlog visible';`));
  exec(mutationRead(`update public.merchants set user_id='${id(98)}' where id='${site}';`,denied('attendance_access_denied',expr(ownerBacklogQueryInput({asOf:first.asOf,cursorAt:first.nextCursor.recordedAt,cursorKind:first.nextCursor.kind,cursorId:first.nextCursor.requestId})))));
  const invalid=[null,{}, {...ownerBacklogQueryInput(),extra:1},{...ownerBacklogQueryInput(),kind:'pending'},
    {...ownerBacklogQueryInput(),asOf:'2000-01-01T00:00:00.000Z'},{...ownerBacklogQueryInput(),asOf:'2100-01-01T00:00:00.000000Z'},
    {...ownerBacklogQueryInput(),cursorAt:plan.oldAt},{...ownerBacklogQueryInput(),cursorKind:'correction'},
    {...ownerBacklogQueryInput(),cursorAt:plan.oldAt,cursorKind:'correction',cursorId:ids.tie},
    {...ownerBacklogQueryInput(),kind:'missing',asOf:first.asOf,cursorAt:plan.oldAt,cursorKind:'correction',cursorId:ids.tie},
    {...ownerBacklogQueryInput(),asOf:plan.oldAt,cursorAt:first.asOf,cursorKind:'correction',cursorId:ids.tie}];
  exec(mutationRead('',denied('attendance_access_denied',expr(ownerBacklogQueryInput(),id(1)))+
    denied('attendance_access_denied',expr(ownerBacklogQueryInput(),owner,foreign))+invalid.map(q=>denied('attendance_invalid_request',expr(q))).join('\n')));
  const corrupt=`insert into public.merchant_attendance_correction_entries(merchant_id,worker_id,employee_id,start_event_id,revision,request_id,operation_id,actor_auth_user_id,action,reason,command,recorded_at)
    values('${site}','${ids.oldWorker}','${ids.oldEmployee}','${id(89002)}',2,'${ids.oldPending}','${id(89999)}','${id(2)}','withdraw','Synthetic inconsistent historical identity','{}',clock_timestamp());`;
  // The corruption lies beyond the first50 candidates: explicitly advance once.
  exec(mutationRead(corrupt,`a:=${expr(ownerBacklogQueryInput({kind:'correction'}))};q:=${nextQuery('correction')};${denied('attendance_owner_backlog_invalid',expr('q'))}`));
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expr()};raise exception 'owner_backlog_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  exec(`set local role service_role;do $private$ begin ${['merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_requests','merchant_attendance_missing_entries'].map(t=>`begin perform 1 from public.${t};raise exception 'owner_backlog_private_table_read_allowed';exception when insufficient_privilege then null;end;`).join('\n')}end;$private$;`);
  assert.equal(data.fingerprint(),before,'owner_backlog_scenarios_not_rolled_back');
  for(const label of labels)native.pass(label);
  return {checks:labels.length,scannedPages:pages,pending:8,scenarioChangesRolledBack:true,syntheticOnly:true,callerOwnedNamespaceCleanup:true};
}

export async function runAttendanceOwnerBacklogNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceOwnerBacklogNative(native,scope)));}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  runAttendanceOwnerBacklogNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(ownerBacklogNativeFailure(error)));process.exitCode=1;});
}
