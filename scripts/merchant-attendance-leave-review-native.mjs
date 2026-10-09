// Local owned-schema fixture only. Normal leave facts come exclusively from the
// original122 RPC; no database/browser starts merely by importing this module.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareLeaveNotificationsNativeFixture,leaveNotificationsFingerprint} from './merchant-attendance-leave-notifications-native.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',owner=id(99),rpc='faolla_attendance_leave_review_v1',migrationName='202610040126_merchant_attendance_leave_review.sql';
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const labels=Object.freeze([
  'leave review installs/reapplies126 with unchanged original122/125 functions, ACLs, indexes, triggers and business facts',
  'original writers create50 closed histories and6 future pending requests; no notification or forged normal leave source is seeded',
  'oldest-first candidate paging returns an empty50 page then6 pending summaries with exact scan cursor and no duplicates',
  'current-owner and tenant authorization is rechecked while inactive, unbound and renamed applicants retain historical summaries',
  'only50 candidates are interpreted; an invalid51st source is deferred then rejects its whole page without partial results',
  'live original withdrawal changes fresh review and original detail without a frozen snapshot or automatic decision',
  'exact query types/cursor bounds, browser execute and private source-table ACLs fail closed without changing grants',
  'all reads and rollback probes preserve complete business fingerprints and original source definitions',
]);
let phase='entry';
export const leaveReviewQuery=(patch={})=>({siteId:site,afterAt:null,afterId:null,...patch});
const expression=(query,actor=owner)=>`public.${rpc}(${json(query)},'${actor}')`;
const original=(query,command,actor)=>`public.faolla_attendance_leave_v1(${json(query)},'${actor}',${json(command)},true)`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'leave_review_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
export function leaveReviewNativeFailure(error){
  const text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
  const known=new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required','attendance_leave_review_invalid','attendance_leave_invalid',
    'merchant_attendance_leave_review_prerequisite_required','merchant_attendance_leave_review_installation_conflict']);
  return {error:'leave_review_native_failed',phase,code:known.has(code)?code:'local_check_failed',sourceLine:Number(text.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1]??0)||null};
}
export function leaveReviewMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  const source=readFileSync(path.join(root,'scripts/supabase-migrations',migrationName),'utf8');
  const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
  assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));return {name:migrationName,source,body,statement};
}
export function leaveReviewSeedPlan(data){
  assert.equal(data.site,site);assert.equal(data.owner,owner);assert.equal(data.employeeAuth,id(1));
  assert.equal(typeof data.queryInput,'function');assert.equal(typeof data.submit,'function');assert.equal(typeof data.action,'function');
  assert(/^20\d{2}-\d{2}-\d{2}T08:00:00\.000Z$/.test(data.time.startAt));
  const rows=[],statements=[];
  for(let n=1001;n<=1056;n++){
    const startAt=new Date(Date.parse(data.time.startAt)+(n-1001)*86400000).toISOString(),endAt=new Date(Date.parse(startAt)+8*3600000).toISOString();
    const command=data.submit(n,{startAt,endAt}),status=n>1050?'submitted':n===1001?'approved':n===1002?'withdrawn':n===1003?'cancelled':'rejected';
    statements.push(`perform ${original(data.queryInput(),command,data.employeeAuth)};`);
    if(n<=1050){
      const actionName=n===1001||n===1003?'approve':n===1002?'withdraw':'reject',access=actionName==='withdraw'?'self':'owner';
      const decision=data.action(n+1000,actionName,id(n));
      statements.push(`perform ${original(data.queryInput(access,{requestId:id(n)}),decision,access==='owner'?data.owner:data.employeeAuth)};`);
      if(n===1003)statements.push(`perform ${original(data.queryInput('owner',{requestId:id(n)}),data.action(3003,'cancel',id(n)),data.owner)};`);
    }
    rows.push({requestId:id(n),status,revision:status==='submitted'?1:status==='cancelled'?3:2,startAt,endAt});
  }
  // Small independent transactions stay within the existing runner timeouts.
  const batches=[];for(let n=0;n<statements.length;n+=10)batches.push(`set local role service_role;do $writers$ begin ${statements.slice(n,n+10).join('\n')} end;$writers$;`);
  return {rows,batches,closedIds:rows.slice(0,50).map(r=>r.requestId),pendingIds:rows.slice(50).map(r=>r.requestId)};
}
export async function prepareLeaveReviewNativeFixture(native,scope){
  phase='prior-fixture';const base=await prepareLeaveNotificationsNativeFixture(native,scope),{exec,owned}=base;
  assert.deepEqual(assertLifecycleSandbox(source=>native.query(scope.sql(source))),owned);assert.equal(owned.schema,scope.schema);
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const business=()=>exec(`select ${leaveNotificationsFingerprint(inventory().filter(t=>t!=='faolla_schema_migrations'))};`);
  const oldDefinition=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.oid)
      from pg_proc p where p.pronamespace=${owned.oid} and p.proname<>'${rpc}'),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity) order by c.relname) from pg_class c where c.relnamespace=${owned.oid} and c.relkind in('r','p')),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=${quote(owned.schema)}),
    'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace=${owned.oid}));`);
  const old=oldDefinition(),oldFacts=business(),migration=leaveReviewMigrationPlan(native.root,scope);phase='install126';exec(migration.body);
  assert.equal(oldDefinition(),old,'leave_review_changed_old_definition_acl');assert.equal(business(),oldFacts,'leave_review_install_changed_business');
  const installed=()=>exec(`select jsonb_build_array(pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) from pg_proc where oid='public.${rpc}(jsonb,uuid)'::regprocedure;`);
  const definition=installed(),before=base.fingerprint();exec(migration.body);
  assert.equal(installed(),definition,'leave_review_reapply_changed_installation');assert.equal(base.fingerprint(),before,'leave_review_reapply_changed_facts');assert.equal(oldDefinition(),old);
  const protectedBefore=base.protectedFingerprint();phase='original-writer-fixture';const plan=leaveReviewSeedPlan(base);for(const batch of plan.batches)exec(batch);
  // A separate legitimate foreign tenant request verifies the merchant predicate.
  base.call(base.queryInput('self',{siteId:base.foreign}),base.submit(1501,{expectedWorkerId:id(204)}),true,id(4));
  const rows=JSON.parse(exec(`select jsonb_agg(jsonb_build_object('requestId',request_id,'workerName',worker_name,
    'startAt',to_char(start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endAt',to_char(end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'timeZone',time_zone,'submittedAt',to_char(submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by submitted_at,request_id)
    from public.merchant_attendance_leave_requests where merchant_id='${site}';`));
  assert.deepEqual(rows.map(r=>r.requestId),plan.rows.map(r=>r.requestId));
  const allRows=rows.map((r,n)=>({...r,revision:plan.rows[n].revision,status:plan.rows[n].status}));
  for(let n=0;n<rows.length;n++){assert.equal(rows[n].startAt,plan.rows[n].startAt);assert.equal(rows[n].endAt,plan.rows[n].endAt);}
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_notifications;`),'0');
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_notification_reads;`),'0');assert.equal(base.protectedFingerprint(),protectedBefore);
  const reviewQuery=leaveReviewQuery,review=(query=reviewQuery(),actor=base.owner)=>JSON.parse(exec(`set local role service_role;select ${expression(query,actor)};`));
  return {...base,reviewQuery,review,expectedRows:allRows.filter(r=>r.status==='submitted'),allRows,closedIds:plan.closedIds,pendingIds:plan.pendingIds,
    pageBoundary:{at:allRows[49].submittedAt,id:allRows[49].requestId},reviewSourceDefinition:oldDefinition,reviewSourceBaseline:old,
    originalWriterRequests:57,originalWriterEntries:108,seededReviewFacts:0};
}

export async function checkAttendanceLeaveReviewNative(native,scope){
  const data=await prepareLeaveReviewNativeFixture(native,scope),{exec,reviewQuery:q,review,owner,site,employeeAuth,workerId,employeeId}=data;
  const baseline=data.fingerprint(),protectedBefore=data.protectedFingerprint();phase='candidate-pages';
  const first=review();assert.deepEqual(Object.keys(first).sort(),['protocol','siteId','ownerId','items','scanned','nextCursor'].sort());
  assert.equal(first.protocol,'leave-review-v1');assert.equal(first.ownerId,owner);assert.equal(first.siteId,site);assert.equal(first.scanned,50);
  assert.deepEqual(first.items,[]);assert.deepEqual(first.nextCursor,data.pageBoundary);
  const after=q({afterAt:first.nextCursor.at,afterId:first.nextCursor.id}),second=review(after);
  assert.equal(second.scanned,6);assert.equal(second.nextCursor,null);assert.deepEqual(second.items,data.expectedRows);
  assert.equal(new Set(second.items.map(r=>r.requestId)).size,6);assert(second.items.every(r=>Object.keys(r).length===8&&r.status==='submitted'&&r.revision===1));
  assert(second.items.every(r=>r.endAt>r.submittedAt.slice(0,23)+'Z'),'leave_review_future_intervals_required');
  const exactLast=review(q({afterAt:data.allRows[5].submittedAt,afterId:data.allRows[5].requestId}));assert.equal(exactLast.scanned,50);assert.equal(exactLast.nextCursor,null);assert.deepEqual(exactLast.items,data.expectedRows);
  const empty=review(q({afterAt:data.allRows.at(-1).submittedAt,afterId:data.allRows.at(-1).requestId}));assert.equal(empty.scanned,0);assert.deepEqual(empty.items,[]);assert.equal(empty.nextCursor,null);
  assert.deepEqual(review(after),second);assert.equal(data.fingerprint(),baseline,'leave_review_GET_changed_facts');
  const rollback=(setup,checks)=>exec(`begin;reset role;${setup}set local role service_role;do $checks$ declare a jsonb;begin ${checks} end;$checks$;rollback;`);
  phase='authorization-and-historical-identities';
  rollback('',denied('attendance_access_denied',expression(q(),employeeAuth))+denied('attendance_access_denied',expression(q(),data.other))+
    denied('attendance_access_denied',expression(q({siteId:data.foreign})))+
    `a:=${expression(q({siteId:data.foreign}),data.other)};assert jsonb_array_length(a->'items')=1 and a->'items'->0->>'requestId'='${id(1501)}','legitimate foreign owner gets only foreign request';`);
  rollback(`update public.merchants set user_id='${data.other}' where id='${site}';`,
    denied('attendance_access_denied',expression(after))+`a:=${expression(after,data.other)};assert a->'items'=${json(data.expectedRows)},'current replacement owner sees history';`);
  rollback(`update public.merchant_attendance_workers set employee_id=null,active=false,display_name='Renamed current worker' where id='${workerId}';
    update public.merchant_enterprise_employees set status='disabled' where id='${employeeId}';
    update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${id(30)}';`,
    `a:=${expression(after)};assert a->'items'=${json(data.expectedRows)},'owner history ignores present worker/member labels and binding';`);
  rollback(`insert into public.merchants(id,user_id) values('99990003','${owner}');`,denied('attendance_settings_required',expression(q({siteId:'99990003'}))));
  assert.equal(data.fingerprint(),baseline,'leave_review_authorization_probes_not_restored');
  phase='bounded-invalid-source';
  // Deliberately invalid NEW synthetic terminal row, never a claimed successful
  // writer result: revision3 without revision2. No old row or trigger is changed.
  const broken=data.action(4901,'cancel',data.pendingIds[0]);
  rollback(`insert into public.merchant_attendance_leave_entries(merchant_id,operation_id,request_id,revision,action,actor_auth_user_id,command,snapshot,recorded_at)
    select merchant_id,'${broken.operationId}',request_id,3,'cancel','${owner}',${json(broken)},'{}'::jsonb,clock_timestamp()
    from public.merchant_attendance_leave_requests where merchant_id='${site}' and request_id='${broken.requestId}';`,
    `a:=${expression(q())};assert a->'items'='[]'::jsonb and a->'scanned'='50'::jsonb,'51st candidate must not be interpreted';`+
    denied('attendance_leave_invalid',expression(after)));
  assert.equal(data.fingerprint(),baseline,'leave_review_bad_source_probe_not_restored');
  phase='live-original-withdrawal';
  const withdrawal=data.action(4902,'withdraw',data.pendingIds[0]);
  rollback('',`a:=${original(data.queryInput('self',{requestId:withdrawal.requestId}),withdrawal,employeeAuth)};
    assert a->'detail'->>'status'='withdrawn','actual withdrawal closes pending';
    a:=${expression(after)};assert a->'items'=${json(data.expectedRows.slice(1))} and a->'scanned'='6'::jsonb,'fresh scan sees withdrawal without snapshot';
    a:=public.faolla_attendance_leave_v1(${json(data.queryInput('owner',{requestId:withdrawal.requestId}))},'${owner}',null,false);
    assert a->'detail'->'canApprove'='false'::jsonb and a->'detail'->'canReject'='false'::jsonb,'original detail rechecks current terminal';`);
  assert.deepEqual(review(after),second);assert.equal(data.fingerprint(),baseline,'leave_review_withdraw_probe_not_restored');
  phase='strict-input-and-acl';
  const bad=[null,{},[],{...q(),extra:true},{...q(),siteId:99990001},{...q(),afterId:id(1)},{...q(),afterAt:first.nextCursor.at},
    {...after,afterAt:'2026-02-30T00:00:00.000000Z'},{...after,afterAt:'2026-10-04T00:00:00.000Z'},{...after,afterAt:true},{...after,afterId:1},
    {...after,afterId:'00000000-0000-0000-0000-000000000001'}];
  rollback('',bad.map(v=>denied('attendance_invalid_request',expression(v))).join('\n'));
  exec(`begin;reset role;do $acl$ declare r text;t text;begin
    foreach r in array array['anon','authenticated'] loop assert not has_function_privilege(r,'public.${rpc}(jsonb,uuid)','EXECUTE'),'leave_review_browser_execute_allowed';end loop;
    assert has_function_privilege('service_role','public.${rpc}(jsonb,uuid)','EXECUTE'),'leave_review_service_execute_missing';
    foreach r in array array['anon','authenticated','service_role'] loop
      foreach t in array array['merchant_attendance_leave_requests','merchant_attendance_leave_entries','merchant_attendance_leave_notifications','merchant_attendance_leave_notification_reads'] loop
        assert not has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE'),'leave_review_private_source_allowed';end loop;
      assert not has_function_privilege(r,'public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)','EXECUTE'),'leave_review_private_helper_allowed';
    end loop;
  end;$acl$;rollback;`);
  exec(`begin;set local role anon;do $browser$ begin begin perform ${expression(q())};raise exception 'leave_review_anon_accepted';exception when insufficient_privilege then null;end;end;$browser$;rollback;`);
  phase='final-fingerprints';assert.equal(data.fingerprint(),baseline,'leave_review_read_or_rollback_changed_facts');assert.equal(data.protectedFingerprint(),protectedBefore);
  assert.equal(data.reviewSourceDefinition(),data.reviewSourceBaseline);assert.equal(data.sourceDefinition(),data.sourceDefinitionBaseline);
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_requests;`),'57');assert.equal(exec(`select count(*) from public.merchant_attendance_leave_entries;`),'108');
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_notifications;`),'0');assert.equal(exec(`select count(*) from public.merchant_attendance_leave_notification_reads;`),'0');
  for(const label of labels)native.pass(label);
  return {checks:labels.length,requests:57,entries:108,closedCandidates:50,pending:6,pages:2,notifications:0,readMarkers:0,
    readOnlyFactsUnchanged:true,allRollbackProbesRestored:true,syntheticOnly:true,callerOwnedNamespaceCleanup:true};
}
export async function runAttendanceLeaveReviewNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceLeaveReviewNative(native,scope)));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceLeaveReviewNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(leaveReviewNativeFailure(error)));process.exitCode=1;});
}
