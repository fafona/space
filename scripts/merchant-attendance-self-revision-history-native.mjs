// Local synthetic acceptance, never a production runner. Raw attendance seeds
// are explicitly synthetic; correction roots and all follow-up states are made
// by the original RPC implementations, not fabricated terminal ledger rows.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',foreign='99990002',owner=id(99),authUserId=id(1),employeeId=id(101),workerId=id(201),place=id(301);
const otherAuth=id(2),otherEmployee=id(102),otherWorker=id(202),foreignAuth=id(3),foreignOwner=id(98);
const rpc='faolla_attendance_self_revision_history_v1',quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const roots=Object.freeze([id(501),id(502)]);
const expected=Object.freeze({all:[id(900),...Array.from({length:51},(_,n)=>id(1102-2*n)),id(702),id(701)],
  submitted:[id(900)],approved:[id(701)],rejected:[id(702)],withdrawn:Array.from({length:51},(_,n)=>id(1102-2*n))});
const migrationNames=Object.freeze(['202609300079_merchant_attendance_self_context.sql','202609300087_merchant_attendance_period_report.sql','202610010088_merchant_attendance_scoped_period_report.sql',
  '202610010090_merchant_attendance_period_export.sql','202610010091_merchant_attendance_revision_requests.sql',
  '202610010092_merchant_attendance_revision_review.sql','202610010093_merchant_attendance_versioned_reports.sql',
  '202610010094_merchant_attendance_revision_decision_core.sql','202610010095_merchant_attendance_revision_cycles.sql',
  '202610010097_merchant_attendance_revision_history.sql','202610030116_merchant_attendance_self_revision_history.sql']);
const labels=Object.freeze([
  'self revision history crosses two actual approved roots with all four actual follow-up states',
  'self revision history scans54 identity-bound submissions once in50+4 pages with exact microsecond cursors',
  'self revision status filtering retains an empty first50 page and advances to the exact older approved result',
  'self revision asOf retains prior state after an actual later withdrawal while a fresh read sees it',
  'self revision paused view-only inactive-worker reads remain available and current employee/role revocation denies',
  'self revision current-worker pin rejects stale binding and a replacement binding inherits no former identity history',
  'self revision null historical identities remain forbidden by original ledger constraints, with no constraint weakening',
  'self revision malformed/future cursor, foreign identity, browser execute and private-table access fail closed',
  'self revision all service reads preserve every owned business table and every synthetic native change rolls back',
]);
let phase='entry';
const queryInput=(patch={})=>({expectedWorkerId:workerId,status:'all',asOf:null,cursorAt:null,cursorId:null,...patch});
const expression=(q=queryInput(),auth=authUserId,tenant=site)=>`public.${rpc}('${tenant}','${auth}',${typeof q==='string'?q:json(q)})`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'self_revision_unexpected_acceptance';
  exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
const rows=table=>`(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t)`;

export function selfRevisionHistoryNativeFailure(error){
  const text=error instanceof Error?error.message:'';
  const code=text.match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
  const allowed=new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required','attendance_worker_changed',
    'attendance_revision_history_invalid','attendance_revision_history_too_large','attendance_revision_unchanged','attendance_revision_base_changed',
    'attendance_version_conflict','attendance_correction_policy_changed','attendance_correction_window_closed',
    'merchant_attendance_self_revision_history_prerequisite_required','merchant_attendance_self_revision_history_index_postcondition_failed',
    'merchant_attendance_self_revision_history_registry_postcondition_failed','merchant_attendance_self_revision_history_acl_postcondition_failed']);
  const line=text.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1];
  return {error:'self_revision_history_native_failed',phase,code:allowed.has(code)?code:'local_check_failed',sourceLine:line?Number(line):null};
}

export function selfRevisionHistoryMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));
  assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  return migrationNames.map(name=>{
    const source=readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8');
    const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
    const statement=scope.sql(body);assert(!/\bpublic\./.test(statement));
    assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));
    return {name,source,body,statement};
  });
}

function ownedGuard(owned){
  assert(owned&&/^attendance_race_[a-f0-9]{32}$/.test(owned.schema)&&owned.owner==='postgres');
  assert(Number.isSafeInteger(owned.oid)&&owned.oid>0&&Number.isSafeInteger(owned.tableOid)&&owned.tableOid>0);
  assert(/^faolla-synthetic-concurrency:[a-f0-9-]{36}$/.test(owned.marker));
  return `do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
    and n.nspname=${quote(owned.schema)} and n.nspowner::regrole::text='postgres'
    and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)})
    then raise exception 'self_revision_native_owned_schema_required';end if;end;$owned$;`;
}

/** Pure construction only: this function never contacts a database. */
export function selfRevisionHistoryNativePlan(owned,tables,{now=Date.now()}={}){
  const guard=ownedGuard(owned);assert(Number.isFinite(now));
  assert(Array.isArray(tables)&&tables.length>0&&new Set(tables).size===tables.length);
  for(const table of tables)assert(typeof table==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(table)&&table.length<=63);
  for(const table of ['merchants','merchant_enterprise_employees','merchant_enterprise_roles','merchant_attendance_workers',
    'merchant_attendance_events','merchant_attendance_revision_requests','merchant_attendance_revision_decisions',
    'merchant_attendance_correction_entries','merchant_attendance_correction_effects'])assert(tables.includes(table));
  const fingerprint=`(select md5(jsonb_build_object(${tables.map(t=>`${quote(t)},${rows(t)}`).join(',')})::text))`;
  const at=(days,hour)=>new Date(now-days*86400000).toISOString().slice(0,10)+`T${hour}:00:00.000123Z`;
  const subjects=[{site,owner,auth:authUserId,employee:employeeId,worker:workerId,role:id(30),place},
    {site,owner,auth:otherAuth,employee:otherEmployee,worker:otherWorker,role:id(30),place},
    {site:foreign,owner:foreignOwner,auth:foreignAuth,employee:id(103),worker:id(298),role:id(31),place:id(398)}];
  const bases=[{...subjects[0],root:id(501),decision:id(601),event:10001,sequence:1,days:8},
    {...subjects[0],root:id(502),decision:id(602),event:10003,sequence:3,days:6},
    {...subjects[1],root:id(503),decision:id(603),event:10005,sequence:1,days:8},
    {...subjects[2],root:id(504),decision:id(604),event:10007,sequence:1,days:8}];
  const proposal=(base,hours)=>({startAt:at(base.days,'08'),endAt:at(base.days,String(8+hours).padStart(2,'0')),breaks:[]});
  const selfQuery=(base,request=null)=>({mode:request?'detail':'prepare',expectedWorkerId:base.worker,baseRequestId:base.root,requestId:request,operationId:null});
  const self=(base,request,cmd='null')=>`public.faolla_attendance_revision_self_v2('${base.site}','${base.auth}',${json(selfQuery(base,request))},${cmd},true)`;
  //095's original cycle functions are private. Only fixture construction runs
  // those originals as the owned schema owner; the new list is always tested
  // under service_role. This is SQL evidence, not HTTP/SDK authorization proof.
  const submit=(base,request,hours)=>`p:=${self(base,null)};
    c:=jsonb_build_object('action','submit','operationId','${request}','expectedRevision',(p->>'revision')::bigint,
      'expectedBaseOperationId','${base.decision}','expectedEffectiveOperationId',p->'current'->>'operationId',
      'expectedPolicyRevision',1,'reason','Synthetic cross-root follow-up','proposal',${json(proposal(base,hours))});
    a:=${self(base,request,'c')};`;
  const withdraw=(base,request,op)=>`c:=jsonb_build_object('action','withdraw','operationId','${op}','requestId','${request}',
    'expectedRevision',(a->>'revision')::bigint,'reason','Synthetic bounded history withdrawal');
    perform ${self(base,request,'c')};`;
  const decide=(base,request,op,action)=>`r:=public.faolla_attendance_revision_decide_v2('${base.site}','${base.owner}','${request}',null,null,true);
    c:=jsonb_build_object('action','${action}','operationId','${op}','requestId','${request}',
      'expectedRevision',(r->'review'->>'submittedRevision')::bigint,'expectedEvidence',r->>'evidenceToken',
      'expectedBaseOperationId',r->'current'->>'operationId','reason','Synthetic real terminal decision');
    perform public.faolla_attendance_revision_decide_v2('${base.site}','${base.owner}','${request}',c,null,true);`;
  const write=body=>`do $actual$ declare p jsonb;c jsonb;a jsonb;r jsonb;begin ${body} end;$actual$;`;
  const seed=[`begin;reset role;${guard}
    do $fresh$ begin assert not exists(select 1 from public.merchants),'self_revision_native_fresh_namespace_required';end;$fresh$;
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${foreignOwner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',false,false),('${foreign}','UTC',false,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values
      ('${place}','${site}','Synthetic self revision location','UTC',false),('${id(398)}','${foreign}','Synthetic foreign location','UTC',false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
      ('${id(30)}','${site}','Synthetic self revision role',array['enterprise.view','attendance.self.view','attendance.self.request']),
      ('${id(31)}','${foreign}','Synthetic foreign role',array['enterprise.view','attendance.self.view','attendance.self.request']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ${subjects.map(s=>`('${s.employee}','${s.site}','${s.auth}','revision-${s.auth.slice(-3)}@example.test','Synthetic revision employee','${s.role}','active')`).join(',')};
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values
      ${subjects.map(s=>`('${s.worker}','${s.site}','${s.employee}','REVISION-${s.worker.slice(-3)}','Synthetic revision worker','${s.place}',false)`).join(',')};
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values
      ${subjects.map(s=>`('${s.site}','${s.worker}','2000-01-01')`).join(',')};
    -- Eight synthetic pre-existing punches, not evidence of a real user punch.
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
      ${bases.flatMap(b=>[0,1].map(n=>`('${id(b.event+n)}','${b.site}','${b.worker}','${b.place}','${id(b.event+10000+n)}',${b.sequence+n},'${n?'clock_out':'clock_in'}','web','${at(b.days,n?'16':'08')}','UTC','${b.employee}')`)).join(',')};`,
    `set local role service_role;${write([subjects[0],subjects[2]].map((s,n)=>`perform public.faolla_attendance_correction_controls_v2('${s.site}','${s.owner}',${json({action:'set_policy',operationId:id(800+n),expectedRevision:0,expectedSettingsVersion:1,reason:'Synthetic correction window',submissionWindowDays:365})},null,null,true);`).join('\n'))}reset role;`,
    ...bases.map(b=>`set local role service_role;${write(`perform public.faolla_attendance_correction_self_v3('${b.site}','${b.auth}',${json({mode:'detail',expectedWorkerId:b.worker,requestId:b.root,operationId:null})},${json({action:'submit',operationId:b.root,expectedRevision:0,expectedPolicyRevision:1,reason:'Synthetic original request',startEventId:id(b.event),expectedLastEventId:id(b.event+1),proposal:proposal(b,9)})},true);
      r:=public.faolla_attendance_correction_decide_v1('${b.site}','${b.owner}','${b.root}',null,null,true);
      assert r->>'canApprove'='true','synthetic_original_must_be_approvable';
      c:=jsonb_build_object('action','approve','operationId','${b.decision}','requestId','${b.root}','expectedRevision',1,'expectedEvidence',r->>'evidenceToken','reason','Synthetic original approval');
      perform public.faolla_attendance_correction_decide_v1('${b.site}','${b.owner}','${b.root}',c,null,true);`)}reset role;`),
    write(submit(bases[0],id(701),7)+decide(bases[0],id(701),id(1701),'approve')),
    write(submit(bases[0],id(702),6)+decide(bases[0],id(702),id(1702),'reject')),
    ...Array.from({length:11},(_,batch)=>write(Array.from({length:Math.min(5,51-batch*5)},(_,offset)=>{
      const n=batch*5+offset+1;return submit(bases[0],id(1000+2*n),6)+withdraw(bases[0],id(1000+2*n),id(1001+2*n));
    }).join('\n'))),
    write(submit(bases[1],id(900),7)+submit(bases[2],id(910),7)+submit(bases[3],id(911),7)),
    `update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${id(30)}';
      create temp table self_revision_read_baseline(value text) on commit drop;
      insert into self_revision_read_baseline values(${fingerprint});`];
  const readCheck=code=>`update self_revision_read_baseline set value=${fingerprint};
    set local role service_role;do $read$ declare a jsonb;b jsonb;r jsonb;q jsonb;k integer:=0;ids uuid[]:=array[]::uuid[];begin
      assert current_user='service_role','self_revision_service_role_required';${code}
    end;$read$;reset role;
    do $unchanged$ begin assert (select value from self_revision_read_baseline)=${fingerprint},'self_revision_read_changed_business_facts';end;$unchanged$;`;
  const array=ids=>`array[${ids.map(v=>`${quote(v)}::uuid`).join(',')}]`;
  const pagedQuery=(status='all')=>`jsonb_build_object('expectedWorkerId','${workerId}','status','${status}','asOf',a->>'asOf',
    'cursorAt',a->'nextCursor'->>'recordedAt','cursorId',a->'nextCursor'->>'requestId')`;
  const steps=[readCheck(`a:=${expression()};assert a->>'protocol'='self-revision-history-v1' and a->>'readOnly'='true','protocol';
    assert a->>'siteId'='${site}' and a->>'workerId'='${workerId}' and a->>'employeeId'='${employeeId}','current binding';
    assert a->>'scanned'='50' and jsonb_array_length(a->'items')=50 and a->'nextCursor'<>'null'::jsonb,'first50';
    assert a->'items'->0->>'requestId'='${id(900)}' and a->'items'->0->>'rootRequestId'='${roots[1]}','second root newest';
    assert (select count(distinct value->>'rootRequestId') from jsonb_array_elements(a->'items'))=2,'cross-root list';
    assert not exists(select 1 from jsonb_array_elements(a->'items') t where t->>'workerId'<>'${workerId}' or t->>'employeeId'<>'${employeeId}'),'only current identity';`),
    readCheck(`a:=${expression()};loop
      k:=k+1;assert k<=2,'bounded expected two pages';
      for r in select value from jsonb_array_elements(a->'items') loop
        assert (select count(*) from jsonb_object_keys(r))=13,'exact thirteen item fields';
        assert r->>'submittedAt' ~ '\\.[0-9]{6}Z$','microsecond timestamps';
        ids:=array_append(ids,(r->>'requestId')::uuid);
      end loop;
      exit when a->'nextCursor'='null'::jsonb;
      assert a->'nextCursor'->>'recordedAt'=a->'items'->49->>'submittedAt' and a->'nextCursor'->>'requestId'=a->'items'->49->>'requestId','last scanned cursor';
      q:=${pagedQuery()};b:=${expression('q')};assert b->'asOf'=a->'asOf','pinned asOf';a:=b;
    end loop;assert ids=${array(expected.all)} and k=2 and a->>'scanned'='4','exact54 order without omissions/duplicates';
    assert (select array_agg(distinct value->>'status' order by value->>'status') from jsonb_array_elements(a->'items'))=array['approved','rejected','withdrawn'],'terminal tail states';`),
    readCheck(`a:=${expression(queryInput({status:'approved'}))};
      assert a->'items'='[]'::jsonb and a->>'scanned'='50' and a->'nextCursor'<>'null'::jsonb,'empty nonfinal status page';
      b:=${expression(pagedQuery('approved'))};assert b->>'scanned'='4' and b->'nextCursor'='null'::jsonb and jsonb_array_length(b->'items')=1
        and b->'items'->0->>'requestId'='${id(701)}' and b->'items'->0->>'status'='approved','older approved result';
      a:=${expression(queryInput({status:'submitted'}))};assert jsonb_array_length(a->'items')=1 and a->'items'->0->>'requestId'='${id(900)}','submitted filter';`),
    `savepoint later_terminal;
      set local role service_role;do $capture$ begin perform set_config('faolla.self_revision_asof',${expression()}::text,true);end;$capture$;reset role;
      ${write(`a:=${self(bases[1],id(900))};${withdraw(bases[1],id(900),id(1900))}`)}`,
    readCheck(`b:=current_setting('faolla.self_revision_asof')::jsonb;
      q:=${json(queryInput())}||jsonb_build_object('asOf',b->>'asOf');a:=${expression('q')};
      assert a=b,'same asOf excludes subsequent terminal write exactly';
      a:=${expression()};assert a->'items'->0->>'status'='withdrawn','fresh asOf observes actual later withdrawal';`),
    'rollback to savepoint later_terminal;',
    `savepoint employee_disabled;update public.merchant_enterprise_employees set status='disabled' where id='${employeeId}';`,
    readCheck(denied('attendance_access_denied',expression())), 'rollback to savepoint employee_disabled;',
    `savepoint role_off;update public.merchant_enterprise_roles set status='archived' where id='${id(30)}';`,
    readCheck(denied('attendance_access_denied',expression())), 'rollback to savepoint role_off;',
    `savepoint role_view;update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${id(30)}';`,
    readCheck(denied('attendance_access_denied',expression())), 'rollback to savepoint role_view;',
    `savepoint binding_change;update public.merchant_attendance_workers set employee_id=null where id='${workerId}';
      update public.merchant_attendance_workers set employee_id='${employeeId}' where id='${otherWorker}';
      update public.merchant_attendance_workers set employee_id='${otherEmployee}' where id='${workerId}';`,
    readCheck(`${denied('attendance_worker_changed',expression())}
      a:=${expression(queryInput({expectedWorkerId:otherWorker}))};assert a->'items'='[]'::jsonb and a->>'scanned'='0' and a->'nextCursor'='null'::jsonb,'new binding inherits no former applicant data';
      a:=${expression(queryInput(),otherAuth)};assert a->'items'='[]'::jsonb and a->>'scanned'='0','replacement employee inherits none';`),
    'rollback to savepoint binding_change;',
    `savepoint auth_change;update public.merchant_enterprise_employees set auth_user_id='${id(88)}' where id='${employeeId}';`,
    readCheck(`${denied('attendance_access_denied',expression())}
      a:=${expression(queryInput(),id(88))};assert a->'items'='[]'::jsonb and a->>'scanned'='0','same employee different account inherits none';`),
    'rollback to savepoint auth_change;',
    ...['merchant_attendance_correction_entries','merchant_attendance_revision_requests'].flatMap(table=>['employee_id','actor_auth_user_id'].map(column=>`do $nonnull$ declare r public.${table}%rowtype;begin
      select * into r from public.${table} where merchant_id='${site}' and action='submit' limit 1;
      r.${column}:=null;
      begin insert into public.${table} select (r).*;raise exception 'self_revision_null_identity_accepted';
      exception when not_null_violation then null;end;end;$nonnull$;`)),
    readCheck(`${denied('attendance_access_denied',expression(queryInput(),owner))}
      ${denied('attendance_access_denied',expression(queryInput(),authUserId,foreign))}
      ${denied('attendance_worker_changed',expression(queryInput({expectedWorkerId:otherWorker})))}
      ${[null,{}, {...queryInput(),extra:true},{...queryInput(),status:'pending'},{...queryInput(),expectedWorkerId:1},
        {...queryInput(),asOf:'2000-01-01T00:00:00.000Z'},{...queryInput(),asOf:'2100-01-01T00:00:00.000000Z'},
        {...queryInput(),cursorAt:'2000-01-01T00:00:00.000000Z'},{...queryInput(),cursorId:id(900)},
        {...queryInput(),cursorId:id(900),cursorAt:'2000-01-01T00:00:00.000000Z'},
        {...queryInput(),asOf:'2000-01-01T00:00:00.000000Z',cursorAt:'2001-01-01T00:00:00.000000Z',cursorId:id(900)}]
        .map(q=>denied('attendance_invalid_request',expression(q))).join('\n')}`),
    ...['anon','authenticated'].map(role=>`set local role ${role};do $acl$ begin begin perform ${expression()};
      raise exception 'self_revision_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;reset role;`),
    `set local role service_role;do $private$ begin ${['merchant_attendance_revision_requests','merchant_attendance_revision_decisions','merchant_attendance_correction_entries','merchant_attendance_correction_effects']
      .map(table=>`begin perform 1 from public.${table};raise exception 'self_revision_private_table_read_allowed';exception when insufficient_privilege then null;end;`).join('\n')}
      end;$private$;reset role;`,
    `do $facts$ begin
      assert (select count(*) from public.merchant_attendance_events)=8,'only eight synthetic prestate events';
      assert (select count(*) from public.merchant_attendance_correction_entries)=4,'four actual first requests';
      assert (select count(*) from public.merchant_attendance_correction_effects)=4,'four actual first approvals';
      assert (select count(*) from public.merchant_attendance_revision_requests where action='submit')=56,'54 own and two unrelated actual submissions';
      assert (select count(*) from public.merchant_attendance_revision_requests where action='withdraw')=51,'actual withdrawal count';
      assert (select count(*) from public.merchant_attendance_revision_decisions)=2,'actual approve and reject decisions';
      assert (select count(*) from public.merchant_attendance_effect_versions)=1,'only actual follow-up approval effect';
    end;$facts$;select ${json(labels)};rollback;`];
  return {site,foreign,owner,authUserId,employeeId,workerId,place,roots:[...roots],expected:structuredClone(expected),guard,fingerprint,seed,steps,labels:[...labels]};
}

function install(native,scope){
  phase='install';assert.equal(typeof native.query,'function');assert.equal(typeof native.querySteps,'function');
  const raw=s=>native.query(scope.sql(s)),owned=assertLifecycleSandbox(raw);assert.equal(scope.schema,owned.schema);
  const guard=ownedGuard(owned);
  const exec=source=>{
    assert.deepEqual(assertLifecycleSandbox(raw),owned,'self_revision_namespace_changed');
    const start=/^(\s*begin(?:\s+read\s+only)?\s*;)/i;
    return raw(start.test(source)?source.replace(start,`$1reset role;${guard}\n`):`begin;reset role;${guard}\n${source}\ncommit;`);
  };
  exec(`do $absent$ begin assert to_regclass('public.merchant_attendance_revision_requests') is null
    and to_regprocedure('public.${rpc}(text,uuid,jsonb)') is null,'self_revision_fresh_dependencies_required';end;$absent$;`);
  const migrations=selfRevisionHistoryMigrationPlan(native.root,scope);
  for(const migration of migrations){phase=path.basename(migration.name,'.sql');exec(migration.body);}
  const tables=JSON.parse(exec(`select coalesce(jsonb_agg(relname order by relname),'[]'::jsonb) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const plan=selfRevisionHistoryNativePlan(owned,tables),before=exec(`select ${plan.fingerprint};`);
  const installed=()=>exec(`select jsonb_build_object('function',pg_get_functiondef(p.oid),'owner',p.proowner::regrole::text,'acl',p.proacl,
    'index',pg_get_indexdef('public.attendance_revision_self_identity_history_idx'::regclass)) from pg_proc p where p.oid='public.${rpc}(text,uuid,jsonb)'::regprocedure;`);
  const first=installed();phase='reapply116';exec(migrations.at(-1).body);
  assert.equal(installed(),first,'self_revision_reapply_changed_function_owner_acl_index');
  assert.equal(exec(`select ${plan.fingerprint};`),before,'self_revision_reapply_changed_facts');
  return {owned,plan,exec,before};
}

// Reusable live fixture for a caller-owned browser scope. It commits explicit
// synthetic prestate and original SQL writer calls only into that exact scope;
// the caller's existing namespace finally is responsible for its removal.
export async function prepareSelfRevisionHistoryNativeFixture(native,scope){
  const {owned,plan,exec}=install(native,scope);phase='fixture-seed';
  await native.querySteps([...plan.seed,'commit;'].map(scope.sql));
  const fingerprint=()=>exec(`select ${plan.fingerprint};`);
  return {site,owner,authUserId,employeeId,workerId,place,roots:[...roots],expected:structuredClone(expected),
    exec,owned,fingerprint,queryInput,syntheticOnly:true};
}

export async function checkAttendanceSelfRevisionHistoryNative(native,scope){
  const {plan,exec,before}=install(native,scope);phase='seed-and-read-cases';
  const output=await native.querySteps([...plan.seed,...plan.steps].map(scope.sql));
  assert.deepEqual(JSON.parse(output),labels,'self_revision_all_assertions_required');phase='rollback-oracle';
  assert.equal(exec(`select ${plan.fingerprint};`),before,'self_revision_native_changes_not_rolled_back');
  for(const label of labels)native.pass(label);
  return {checks:labels.length,seedRolledBack:true,syntheticOnly:true,ownSubmissions:54,roots:2,reportWrites:0};
}

export async function runAttendanceSelfRevisionHistoryNative(args){
  return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,
    scope=>checkAttendanceSelfRevisionHistoryNative(native,scope)));
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  runAttendanceSelfRevisionHistoryNative(process.argv.slice(2)).catch(error=>{
    console.error(JSON.stringify(selfRevisionHistoryNativeFailure(error)));process.exitCode=1;
  });
}
