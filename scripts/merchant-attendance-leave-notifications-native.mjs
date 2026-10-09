// Local-only synthetic infrastructure; original leave and new capture/read RPCs
// produce all normal facts. Importing this file starts no database or browser.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareLeaveNativeFixture} from './merchant-attendance-leave-native.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',owner=id(99),employeeAuth=id(1),employeeId=id(101),workerId=id(201);
const migrationName='202610040125_merchant_attendance_leave_notifications.sql',wrapper='faolla_attendance_leave_notify_v1',rpc='faolla_attendance_leave_notifications_v1';
const noticeTables=Object.freeze(['merchant_attendance_leave_notifications','merchant_attendance_leave_notification_reads']);
const mutableFacts=Object.freeze(['merchant_attendance_leave_requests','merchant_attendance_leave_entries',...noticeTables]);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const labels=Object.freeze([
  'leave notifications installs/reapplies125 without any change to original122 functions, ACLs, indexes, triggers or facts and without seeded notifications',
  'only explicit fresh wrapper decisions capture original recipient identity, while original writes and exact old retries never backfill',
  'notification25+8 pages follow decision time rather than request submission time, preserve approval/cancellation separately and expose no reasons',
  'notification reads and details are side-effect-free; explicit read markers preserve the first timestamp and paused original recovery',
  'recipient membership, role and all four source identities are revalidated while inactive profiles and historical approvers remain readable',
  'malformed input, foreign sources and inconsistent source/read identity fail closed with all rollback probes restored',
  'a capture-only constraint failure rolls back both the new original decision and notification without deleting old facts',
  'three exact-PID two-connection witnesses prove wrapper-first capture, original-first no-backfill and single immutable read marker',
  'new tables/private helper/service-only RPC ACLs remain closed and all successful writes are limited to original append-only leave plus two new tables',
]);
let phase='entry';
export const leaveNotificationQuery=(patch={})=>({siteId:site,expectedEmployeeId:employeeId,expectedWorkerId:null,notificationId:null,beforeAt:null,beforeId:null,...patch});
export const leaveNotificationMark=notificationId=>({action:'mark_read',notificationId});
const expression=(name,query,command=null,allow=false,actor=employeeAuth)=>`public.${name}(${typeof query==='string'?query:json(query)},'${actor}',${typeof command==='string'?command:json(command)},${allow===null?'null':allow?'true':'false'})`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'leave_notifications_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
export function leaveNotificationsNativeFailure(error){
  const text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
  const known=new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required','attendance_platform_paused','attendance_worker_changed',
    'attendance_notification_not_found','attendance_notification_invalid','attendance_leave_invalid','attendance_leave_closed','attendance_operation_conflict',
    'merchant_attendance_leave_notifications_prerequisite_required','merchant_attendance_leave_notifications_installation_conflict']);
  return {error:'leave_notifications_native_failed',phase,code:known.has(code)?code:'local_check_failed',sourceLine:Number(text.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1]??0)||null};
}
export function leaveNotificationsMigrationPlan(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  const source=readFileSync(path.join(root,'scripts/supabase-migrations',migrationName),'utf8');
  const body=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''),statement=scope.sql(body);
  assert(!/\bpublic\./.test(statement));assert(!/search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(statement));return {name:migrationName,source,body,statement};
}
export function leaveNotificationsFingerprint(tables,exclude=[]){
  assert(Array.isArray(tables)&&tables.length>0&&new Set(tables).size===tables.length);
  for(const t of tables)assert(typeof t==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(t)&&t.length<=63);
  for(const t of exclude)assert(mutableFacts.includes(t));
  const selected=tables.filter(t=>!exclude.includes(t));assert(selected.length>0);
  return `(select md5(jsonb_build_object(${selected.map(t=>`${quote(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${t} r)`).join(',')})::text))`;
}
export async function prepareLeaveNotificationsNativeFixture(native,scope){
  phase='original-fixture';const base=await prepareLeaveNativeFixture(native,scope),{exec,owned}=base;
  assert.deepEqual(assertLifecycleSandbox(source=>native.query(scope.sql(source))),owned);assert.equal(owned.schema,scope.schema);
  const oldDefinition=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.proname)
      from pg_proc p where p.oid in('public.faolla_attendance_leave_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,'public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)'::regprocedure)),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity) order by c.relname) from pg_class c where c.oid in('public.merchant_attendance_leave_requests'::regclass,'public.merchant_attendance_leave_entries'::regclass)),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=${quote(owned.schema)} and tablename in('merchant_attendance_leave_requests','merchant_attendance_leave_entries')),
    'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where not tgisinternal and tgrelid in('public.merchant_attendance_leave_requests'::regclass,'public.merchant_attendance_leave_entries'::regclass)));`);
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const oldTables=inventory().filter(t=>t!=='faolla_schema_migrations'),oldFacts=exec(`select ${leaveNotificationsFingerprint(oldTables)};`),old=oldDefinition();
  phase='install125';const migration=leaveNotificationsMigrationPlan(native.root,scope);exec(migration.body);
  const fingerprint=()=>exec(`select ${leaveNotificationsFingerprint(inventory())};`);
  const protectedFingerprint=()=>exec(`select ${leaveNotificationsFingerprint(inventory(),mutableFacts)};`);
  assert.equal(oldDefinition(),old,'leave_notifications_changed_old_definition_acl');assert.equal(exec(`select ${leaveNotificationsFingerprint(oldTables)};`),oldFacts,'leave_notifications_install_changed_old_facts');
  const installation=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.proname)
    from pg_proc p where p.pronamespace=${owned.oid} and p.proname in('${wrapper}','${rpc}','faolla_attendance_leave_notification_detail_v1')),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity) order by c.relname) from pg_class c where c.oid in(${noticeTables.map(t=>`'public.${t}'::regclass`).join(',')})),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=${quote(owned.schema)}));`);
  const before=fingerprint(),defined=installation();exec(migration.body);assert.equal(installation(),defined,'leave_notifications_reapply_changed_installation');assert.equal(fingerprint(),before,'leave_notifications_reapply_changed_facts');assert.equal(oldDefinition(),old);
  const noticeQuery=leaveNotificationQuery,notices=(query=noticeQuery(),command=null,allow=false,actor=base.employeeAuth)=>JSON.parse(exec(`set local role service_role;select ${expression(rpc,query,command,allow,actor)};`));
  const notify=(query,command,allow=true,actor=base.owner)=>JSON.parse(exec(`set local role service_role;select ${expression(wrapper,query,command,allow,actor)};`));
  return {...base,noticeQuery,notices,notify,fingerprint,protectedFingerprint,sourceDefinition:oldDefinition,sourceDefinitionBaseline:old,syntheticOnly:true,seededNotifications:0,seededReadMarkers:0};
}

export async function checkAttendanceLeaveNotificationsNative(native,scope){
  const data=await prepareLeaveNotificationsNativeFixture(native,scope),{exec,queryInput:leaveQ,submit,action,call,notify,noticeQuery:q,notices}=data;
  const protectedBefore=data.protectedFingerprint(),original=new Map();phase='original-and-wrapper-decisions';
  assert.deepEqual(notices().items,[]);assert.equal(notices().workerId,workerId);
  const ownerQ=rid=>leaveQ('owner',{requestId:rid}),noteQ=nid=>q({expectedWorkerId:workerId,notificationId:nid});
  const wrapped=c=>notify(ownerQ(c.requestId),c),old=c=>call(ownerQ(c.requestId),c,true,owner);
  const capture=c=>expression(wrapper,ownerQ(c.requestId),c,true,owner),legacy=c=>expression('faolla_attendance_leave_v1',ownerQ(c.requestId),c,true,owner);
  const note=(nid,command=null,allow=false,actor=employeeAuth,patch={})=>expression(rpc,{...noteQ(nid),...patch},command,allow,actor);
  for(const n of [1001,1002,1003])call(leaveQ(),submit(n),true);
  const oldReject=action(2001,'reject',id(1001)),oldApprove=action(2002,'approve',id(1002));old(oldReject);old(oldApprove);
  assert.deepEqual(notices().items,[],'old writer never captures');notify(ownerQ(oldReject.requestId),oldReject,false);notify(ownerQ(oldApprove.requestId),oldApprove,false);
  assert.deepEqual(notices().items,[],'original receipt replay never backfills');
  const newCancel=action(2003,'cancel',id(1002));original.set(newCancel.operationId,wrapped(newCancel).receipt);
  for(let n=1101;n<=1130;n++)call(leaveQ(),submit(n),true);
  for(let n=1101;n<=1130;n++){const c=action(n+1000,n===1101?'approve':'reject',id(n));original.set(c.operationId,wrapped(c).receipt);}
  const cancelled=action(2201,'cancel',id(1101));original.set(cancelled.operationId,wrapped(cancelled).receipt);
  const olderNew=action(2004,'reject',id(1003));original.set(olderNew.operationId,wrapped(olderNew).receipt);
  const expected=[id(2004),id(2201),...Array.from({length:30},(_,n)=>id(2130-n)),id(2003)];
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_notifications;`),'33');assert.equal(data.protectedFingerprint(),protectedBefore);
  phase='decision-time-pages-and-read-only-details';let cursor=null,pages=0;const all=[],baseline=data.fingerprint();
  do{const result=notices(q({expectedWorkerId:workerId,...(cursor?{beforeAt:cursor.at,beforeId:cursor.id}:{})}));assert(++pages<=2);assert.equal(result.detail,null);all.push(...result.items);cursor=result.nextCursor;}while(cursor);
  assert.equal(pages,2);assert.deepEqual(all.map(i=>i.notificationId),expected);assert.equal(new Set(all.map(i=>i.notificationId)).size,33);
  assert(all.every(i=>Object.keys(i).length===9&&!('reason' in i)&&i.readAt===null));assert.equal(all[0].requestId,id(1003),'older submitted request has newest decision');
  const approval=notices(noteQ(id(2101))).detail;assert.equal(approval.type,'approved');assert.equal(approval.currentStatus,'cancelled');assert.equal(approval.currentRevision,3);
  const cancelDetail=notices(noteQ(id(2201))).detail;assert.equal(cancelDetail.type,'approval_cancelled');assert.equal(cancelDetail.revision,3);assert.equal(Object.keys(cancelDetail).length,11);
  for(const c of [oldReject,oldApprove,newCancel,cancelled,olderNew])notify(ownerQ(c.requestId),c,false);
  assert.equal(data.fingerprint(),baseline,'leave_notifications_GET_replay_wrote_facts');
  const rollback=(setup,checks)=>exec(`begin;reset role;${setup}set local role service_role;do $checks$ declare a jsonb;b jsonb;begin ${checks} end;$checks$;rollback;`);
  phase='identity-permissions-and-pause';
  rollback('',[
    denied('attendance_platform_paused',note(id(2102),leaveNotificationMark(id(2102)))),
    denied('attendance_notification_not_found',note(id(2001))),denied('attendance_notification_not_found',note(id(9999))),
    denied('attendance_access_denied',expression(rpc,q({expectedEmployeeId:id(102)}))),
    denied('attendance_worker_changed',expression(rpc,q({expectedWorkerId:id(202)}))),
    denied('attendance_access_denied',expression(rpc,q(),null,false,owner)),
    denied('attendance_notification_not_found',note(id(2102),null,false,data.otherAuth,{expectedEmployeeId:id(102),expectedWorkerId:id(202)})),
    denied('attendance_access_denied',expression(rpc,q({siteId:data.foreign}))),
    denied('attendance_access_denied',expression(wrapper,ownerQ(id(1001)),oldReject,true,data.other)),
    denied('attendance_operation_conflict',expression(wrapper,ownerQ(id(1001)),{...oldReject,reason:'replacement'},true,owner)),
  ].join('\n'));
  rollback(`update public.merchant_enterprise_employees set status='disabled' where id='${employeeId}';`,denied('attendance_access_denied',note(id(2102))));
  rollback(`update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${id(30)}';`,denied('attendance_access_denied',note(id(2102))));
  rollback(`update public.merchant_enterprise_roles set status='archived' where id='${id(30)}';`,denied('attendance_access_denied',note(id(2102))));
  rollback(`update public.merchant_attendance_workers set active=false where id='${workerId}';
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${id(30)}';`,
    `a:=${note(id(2102))};assert a->'detail'->>'type'='rejected','inactive self-view-only profile may read history';`);
  rollback(`update public.merchants set user_id='${data.other}' where id='${site}';`,
    `a:=${note(id(2101))};assert a->'detail'->>'type'='approved','historical approver need not remain owner';`);
  rollback(`update public.merchant_attendance_workers set employee_id=null where id='${workerId}';`,
    `a:=${expression(rpc,q())};assert a->'workerId'='null'::jsonb and a->'items'='[]'::jsonb,'unbound home is empty';`+denied('attendance_worker_changed',note(id(2102))));
  rollback(`update public.merchant_attendance_workers set employee_id=null where id in('${workerId}','${id(202)}');
    update public.merchant_attendance_workers set employee_id='${employeeId}' where id='${id(202)}';`,
    `a:=${expression(rpc,q())};assert a->'workerId'=${json(id(202))} and a->'items'='[]'::jsonb,'new worker does not inherit old notices';`+
    denied('attendance_worker_changed',note(id(2102)))+denied('attendance_notification_not_found',note(id(2102),null,false,employeeAuth,{expectedWorkerId:id(202)})));
  rollback(`update public.merchant_enterprise_employees set auth_user_id='${id(3)}' where id='${employeeId}';`,
    denied('attendance_access_denied',note(id(2102)))+
    `a:=${expression(rpc,q(),null,false,id(3))};assert a->'items'='[]'::jsonb,'same employee/worker new Auth cannot inherit notifications';`+
    denied('attendance_notification_not_found',note(id(2102),null,false,id(3))));
  phase='fresh-capture-after-recipient-rebinding';
  // Original122 permits reject/cancel after binding changes (only approve
  // requires current binding). Exercise that real path, not a fabricated source.
  const reboundReject=action(3401,'reject',id(1401)),reboundApprove=action(3402,'approve',id(1402)),reboundCancel=action(3403,'cancel',id(1402));
  const reboundScopes=[{actor:id(3),employee:employeeId,worker:id(202)},{actor:data.otherAuth,employee:id(102),worker:workerId}];
  exec(`begin;set local role service_role;
    select ${expression('faolla_attendance_leave_v1',leaveQ(),submit(1401),true,employeeAuth)};
    select ${expression('faolla_attendance_leave_v1',leaveQ(),submit(1402),true,employeeAuth)};
    select ${legacy(reboundApprove)};
    reset role;
    update public.merchant_attendance_workers set employee_id=null where id in('${workerId}','${id(202)}');
    update public.merchant_attendance_workers set employee_id='${id(102)}' where id='${workerId}';
    update public.merchant_attendance_workers set employee_id='${employeeId}' where id='${id(202)}';
    update public.merchant_enterprise_employees set auth_user_id='${id(3)}' where id='${employeeId}';
    set local role service_role;
    do $fresh_capture$ declare a jsonb;begin
      a:=${capture(reboundReject)};assert a->'receipt'->'item'->>'status'='rejected','fresh reject after rebind succeeds via original writer';
      a:=${capture(reboundCancel)};assert a->'receipt'->'item'->>'status'='cancelled','fresh cancellation after rebind succeeds via original writer';
      ${reboundScopes.map(s=>`a:=${expression(rpc,q({expectedEmployeeId:s.employee,expectedWorkerId:s.worker}),null,false,s.actor)};
        assert a->'items'='[]'::jsonb,'rebound recipient cannot inherit freshly captured notices';
        ${[reboundReject,reboundCancel].map(c=>denied('attendance_notification_not_found',note(c.operationId,null,false,s.actor,{expectedEmployeeId:s.employee,expectedWorkerId:s.worker}))+
          denied('attendance_notification_not_found',note(c.operationId,leaveNotificationMark(c.operationId),true,s.actor,{expectedEmployeeId:s.employee,expectedWorkerId:s.worker}))).join('\n')}`).join('\n')}
    end;$fresh_capture$;
    reset role;
    do $recipient_oracle$ begin
      assert (select count(*)=2 and bool_and(merchant_id='${site}' and worker_id='${workerId}' and employee_id='${employeeId}' and recipient_auth_user_id='${employeeAuth}'
        and ((notification_id='${reboundReject.operationId}' and request_id='${reboundReject.requestId}' and action='reject' and revision=2)
          or (notification_id='${reboundCancel.operationId}' and request_id='${reboundCancel.requestId}' and action='cancel' and revision=3)))
        from public.merchant_attendance_leave_notifications where notification_id in('${reboundReject.operationId}','${reboundCancel.operationId}')),
        'fresh capture uses original request four identities, never owner or current binding';
      assert not exists(select 1 from public.merchant_attendance_leave_notifications where notification_id='${reboundApprove.operationId}'),'original approval still has no notification';
      assert not exists(select 1 from public.merchant_attendance_leave_notification_reads where notification_id in('${reboundReject.operationId}','${reboundCancel.operationId}')),
        'rebound read rejections create no marker';
    end;$recipient_oracle$;
    update public.merchant_attendance_workers set employee_id=null where id in('${workerId}','${id(202)}');
    update public.merchant_attendance_workers set employee_id='${employeeId}' where id='${workerId}';
    update public.merchant_attendance_workers set employee_id='${id(102)}' where id='${id(202)}';
    update public.merchant_enterprise_employees set auth_user_id='${employeeAuth}' where id='${employeeId}';
    set local role service_role;
    do $original_recipient$ declare a jsonb;begin
      a:=${note(reboundReject.operationId)};assert a->'detail'->>'type'='rejected','restored original identity can read fresh rejection';
      a:=${note(reboundCancel.operationId)};assert a->'detail'->>'type'='approval_cancelled','restored original identity can read fresh cancellation';
    end;$original_recipient$;rollback;`);
  assert.equal(data.fingerprint(),baseline,'leave_notifications_precapture_rebind_probe_not_fully_rolled_back');
  phase='strict-input-and-read-integrity';
  const badQueries=[null,{}, {...q(),extra:true},{...q(),beforeAt:'2026-10-01T00:00:00.000000Z'},{...q(),notificationId:id(2102)},
    {...noteQ(id(2102)),beforeAt:'2026-10-01T00:00:00.000000Z',beforeId:id(2102)},
    {...q(),expectedWorkerId:workerId,beforeAt:'2026-10-01T00:00:00.000Z',beforeId:id(2102)}, {...q(),expectedEmployeeId:1}];
  rollback('',badQueries.map(query=>denied('attendance_invalid_request',expression(rpc,query))).join('\n')+
    denied('attendance_invalid_request',expression(wrapper,ownerQ(id(1001)),null,true,owner))+
    denied('attendance_invalid_request',expression(wrapper,leaveQ(),submit(9001),true,employeeAuth))+
    denied('attendance_invalid_request',expression(wrapper,ownerQ(id(1001)),{...oldReject,extra:1},true,owner))+
    denied('attendance_invalid_request',note(id(2102),{...leaveNotificationMark(id(2102)),readAt:'2026-10-01T00:00:00.000000Z'},true))+
    denied('attendance_invalid_request',note(id(2102),leaveNotificationMark(id(2103)),true))+
    denied('attendance_invalid_request',expression(rpc,q(),null,null)));
  // New synthetic inconsistent read only, rolled back; never rewrite original facts.
  rollback(`insert into public.merchant_attendance_leave_notification_reads(merchant_id,notification_id,worker_id,employee_id,recipient_auth_user_id,read_at)
    values('${site}','${id(2102)}','${workerId}','${id(102)}','${employeeAuth}',clock_timestamp());`,denied('attendance_notification_invalid',note(id(2102))));
  assert.equal(data.fingerprint(),baseline,'leave_notifications_rollback_changed_facts');
  phase='capture-failure-atomic-rollback';call(leaveQ(),submit(1301),true);const fault=action(2401,'reject',id(1301)),faultBefore=data.fingerprint();
  rollback(`alter table public.merchant_attendance_leave_notifications add constraint synthetic_capture_fault check(notification_id<>'${fault.operationId}');`,
    denied('attendance_leave_invalid',capture(fault))+
    `a:=public.faolla_attendance_leave_v1(${json(leaveQ('self',{requestId:id(1301)}))},'${employeeAuth}',null,false);
      assert a->'detail'->>'status'='submitted','failed capture leaves original request submitted';`);
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_entries where merchant_id='${site}' and operation_id='${fault.operationId}';`),'0');
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_notifications where merchant_id='${site}' and notification_id='${fault.operationId}';`),'0');assert.equal(data.fingerprint(),faultBefore);
  phase='actual-original-wrapper-lock-races';assert.equal(typeof native.connect,'function');assert.deepEqual(assertLifecycleSandbox(s=>native.query(scope.sql(s))),data.owned);
  const guarded=statement=>`reset role;${data.plan.guard}set local role service_role;${statement}`;
  const race=(left,right)=>lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},guarded(`select ${left};`),guarded(`select ${right};`));
  for(const n of [1201,1202])call(leaveQ(),submit(n),true);
  const first=action(2301,'reject',id(1201)),second=action(2302,'reject',id(1202));
  const wrappedFirst=await race(capture(first),legacy(first));assert.equal(wrappedFirst.witnessed,true);assert.equal(wrappedFirst.right.error,null);
  assert.deepEqual(JSON.parse(wrappedFirst.left).receipt,JSON.parse(wrappedFirst.right.output).receipt);
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_notifications where merchant_id='${site}' and notification_id='${first.operationId}';`),'1');
  const oldFirst=await race(legacy(second),capture(second));assert.equal(oldFirst.witnessed,true);assert.equal(oldFirst.right.error,null);
  assert.deepEqual(JSON.parse(oldFirst.left).receipt,JSON.parse(oldFirst.right.output).receipt);
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_notifications where merchant_id='${site}' and notification_id='${second.operationId}';`),'0');
  phase='actual-mark-read-race';const mark=leaveNotificationMark(id(2102));
  const marked=await race(note(mark.notificationId,mark,true),note(mark.notificationId,mark,true));assert.equal(marked.witnessed,true);assert.equal(marked.right.error,null);
  const firstRead=JSON.parse(marked.left).detail.readAt;assert(firstRead);assert.equal(JSON.parse(marked.right.output).detail.readAt,firstRead);
  assert.equal(notices(noteQ(mark.notificationId),mark,false).detail.readAt,firstRead,'paused exact mark replay preserves first timestamp');
  assert.equal(notices(noteQ(mark.notificationId)).detail.readAt,firstRead);
  const otherMark=leaveNotificationMark(id(2104));const normal=notices(noteQ(otherMark.notificationId),otherMark,true).detail;
  assert(normal.readAt>=normal.decidedAt);assert.equal(notices(noteQ(otherMark.notificationId),otherMark,true).detail.readAt,normal.readAt);
  phase='acl-and-immutable-ledgers';const final=data.fingerprint();
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expression(rpc,q())};raise exception 'notification_browser_execute_allowed';exception when insufficient_privilege then null;end;
    begin perform ${capture(first)};raise exception 'capture_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  for(const role of ['anon','authenticated','service_role'])exec(`set local role ${role};do $tables$ begin ${noticeTables.map(t=>
    `assert not has_table_privilege(current_user,'public.${t}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'notification_private_privilege_allowed';begin perform 1 from public.${t};raise exception 'notification_private_read_allowed';exception when insufficient_privilege then null;end;`).join('\n')}
    assert not has_function_privilege(current_user,'public.faolla_attendance_leave_notification_detail_v1(public.merchant_attendance_leave_notifications)','EXECUTE'),'notification_helper_execute_allowed';end;$tables$;`);
  exec(`begin;reset role;do $immutable$ begin ${noticeTables.map(t=>`begin update public.${t} set merchant_id=merchant_id;raise exception 'notification_update_allowed';exception when insufficient_privilege then null;end;
    begin delete from public.${t};raise exception 'notification_delete_allowed';exception when insufficient_privilege then null;end;
    begin truncate public.${t} cascade;raise exception 'notification_truncate_allowed';exception when insufficient_privilege then null;end;`).join('\n')}end;$immutable$;rollback;`);
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_requests;`),'36');assert.equal(exec(`select count(*) from public.merchant_attendance_leave_entries;`),'73');
  assert.equal(exec(`select count(*) from public.merchant_attendance_leave_notifications;`),'34');assert.equal(exec(`select count(*) from public.merchant_attendance_leave_notification_reads;`),'2');
  assert.equal(data.fingerprint(),final,'leave_notifications_final_reads_changed_facts');assert.equal(data.protectedFingerprint(),protectedBefore,'leave_notifications_changed_unrelated_business');
  assert.equal(data.sourceDefinition(),data.sourceDefinitionBaseline,'leave_notifications_changed_original_source_definition');
  for(const label of labels)native.pass(label);return {checks:labels.length,requests:36,entries:73,notifications:34,readMarkers:2,exactLockWitnesses:3,
    preCaptureRebindDecisions:2,preCaptureRebindRolledBack:true,syntheticOnly:true,allRollbackProbesRestored:true,callerOwnedNamespaceCleanup:true};
}
export async function runAttendanceLeaveNotificationsNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceLeaveNotificationsNative(native,scope)));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceLeaveNotificationsNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(leaveNotificationsNativeFailure(error)));process.exitCode=1;});
}
