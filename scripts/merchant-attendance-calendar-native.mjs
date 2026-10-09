// Synthetic local infrastructure. Only merchant/settings/locations are seeded;
// all normal calendar facts and receipts are created by the actual123 RPC.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',foreign='99990002',owner=id(99),other=id(98),locationId=id(301),inactiveLocationId=id(302),foreignLocationId=id(303);
const rpc='faolla_attendance_calendar_v1',migrationName='202610030123_merchant_attendance_calendar.sql';
const calendarTables=Object.freeze(['merchant_attendance_calendar_entries','merchant_attendance_calendar_operations']);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const labels=Object.freeze([
  'calendar installs/reapplies123 with unchanged owner/ACL/indexes/facts and no pre-created calendar or attendance facts',
  'calendar actual owner RPC creates company and location snapshots, permits overlapping labels and preserves cancellation history',
  'calendar context/detail/receipt envelopes stay separate from25+3 date-overlap pages with no private reasons in summaries',
  'calendar paused GET and original same-actor POST replay preserve historical snapshots without any repeated write',
  'calendar rechecks current owner/scope and keeps historical labels after settings/location timezone, name, version and activity changes',
  'calendar strictly validates dates, whole-day bounds, IANA skipped endpoints, versions, Unicode text and command/query shapes',
  'calendar two-connection exact-PID lock witness allows one cancellation and rejects its competing terminal without a second receipt',
  'calendar service-only RPC/private helper and append-only table ACLs reject direct API reads and record rewrites',
  'calendar reads preserve all facts; rollback probes restore their baseline and successful writes touch only two new tables',
]);
let phase='entry';
export const calendarQueryInput=(patch={})=>({siteId:site,locationId:null,fromDate:null,throughDate:null,entryId:null,operationId:null,beforeAt:null,beforeId:null,...patch});
export const calendarNativeCreate=(n,fromDate,throughDate,patch={})=>({operationId:id(n),action:'create',reason:'Synthetic calendar record',kind:'holiday',title:`Synthetic holiday ${n}`,
  fromDate,throughDate,expectedSettingsVersion:1,locationId:null,expectedLocationVersion:null,timeZone:'UTC',...patch});
export const calendarNativeCancel=(n,entryId,patch={})=>({operationId:id(n),action:'cancel',reason:'Synthetic calendar cancellation',entryId,expectedRevision:1,...patch});
const expression=(query=calendarQueryInput(),command=null,allow=false,actor=owner)=>
  `public.${rpc}(${typeof query==='string'?query:json(query)},'${actor}',${typeof command==='string'?command:json(command)},${allow===null?'null':allow?'true':'false'})`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'calendar_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
export function calendarNativeFailure(error){
  const text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
  const known=new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required','attendance_platform_paused','attendance_version_conflict','attendance_operation_conflict',
    'attendance_calendar_not_found','attendance_calendar_closed','attendance_calendar_location_inactive','attendance_calendar_invalid',
    'merchant_attendance_calendar_prerequisite_required','merchant_attendance_calendar_installation_conflict']);
  return {error:'calendar_native_failed',phase,code:known.has(code)?code:'local_check_failed',sourceLine:Number(text.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1]??0)||null};
}
export function calendarMigrationPlan(root,scope){
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
    then raise exception 'calendar_owned_schema_required';end if;end;$owned$;`;
}
export function calendarNativePlan(owned,tables,date){
  const guard=guardFor(owned);assert(Array.isArray(tables)&&tables.length>0&&new Set(tables).size===tables.length);
  for(const t of tables)assert(typeof t==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(t)&&t.length<=63);
  for(const t of ['merchants','merchant_attendance_settings','merchant_attendance_locations',...calendarTables])assert(tables.includes(t));
  assert(/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(date)&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date);
  const fromDate=new Date(Date.parse(date+'T00:00:00Z')+2*86400000).toISOString().slice(0,10),throughDate=new Date(Date.parse(date+'T00:00:00Z')+4*86400000).toISOString().slice(0,10);
  const fingerprint=selected=>`(select md5(jsonb_build_object(${selected.map(t=>`${quote(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${t} r)`).join(',')})::text))`;
  const seed=`begin;reset role;${guard}do $fresh$ begin assert not exists(select 1 from public.merchants),'calendar_fresh_namespace_required';end;$fresh$;
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${other}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',false,false),('${foreign}','UTC',false,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values
      ('${locationId}','${site}','合成日历地点','Europe/Madrid',true),('${inactiveLocationId}','${site}','合成停用地点','UTC',false),('${foreignLocationId}','${foreign}','Synthetic foreign','UTC',true);commit;`;
  return {site,foreign,owner,other,locationId,inactiveLocationId,foreignLocationId,date,fromDate,throughDate,guard,seed,
    fingerprint:fingerprint(tables),protectedFingerprint:fingerprint(tables.filter(t=>!calendarTables.includes(t))),labels:[...labels]};
}
export async function prepareCalendarNativeFixture(native,scope){
  phase='install';assert.equal(typeof native.query,'function');assert.equal(typeof native.querySteps,'function');
  const raw=source=>native.query(scope.sql(source)),owned=assertLifecycleSandbox(raw);assert.equal(owned.schema,scope.schema);const guard=guardFor(owned);
  const exec=source=>{assert.deepEqual(assertLifecycleSandbox(raw),owned,'calendar_namespace_changed');const start=/^(\s*begin(?:\s+read\s+only)?\s*;)/i;
    return raw(start.test(source)?source.replace(start,`$1reset role;${guard}\n`):`begin;reset role;${guard}\n${source}\ncommit;`);};
  const migration=calendarMigrationPlan(native.root,scope);exec(migration.body);
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const date=exec("select (clock_timestamp() at time zone 'UTC')::date::text;"),plan=calendarNativePlan(owned,inventory(),date);
  const fingerprint=()=>exec(`select ${calendarNativePlan(owned,inventory(),date).fingerprint};`);
  const protectedFingerprint=()=>exec(`select ${calendarNativePlan(owned,inventory(),date).protectedFingerprint};`);
  const installed=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.proname)
    from pg_proc p where p.oid in('public.${rpc}(jsonb,uuid,jsonb,boolean)'::regprocedure,'public.faolla_attendance_calendar_summary_v1(public.merchant_attendance_calendar_entries,integer)'::regprocedure)),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity) order by c.relname) from pg_class c where c.oid in(${calendarTables.map(t=>`'public.${t}'::regclass`).join(',')})),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=${quote(owned.schema)}));`);
  const empty=fingerprint(),definition=installed();exec(migration.body);assert.equal(installed(),definition,'calendar_reapply_changed_definition_acl');assert.equal(fingerprint(),empty,'calendar_reapply_changed_facts');
  phase='minimal-owned-seed';exec(plan.seed);
  const queryInput=calendarQueryInput,call=(query=queryInput(),command=null,allow=false,actor=owner)=>JSON.parse(exec(`set local role service_role;select ${expression(query,command,allow,actor)};`));
  const read=(patch={},actor=owner)=>call(queryInput(patch),null,false,actor);
  const create=(n,patch={})=>calendarNativeCreate(n,plan.fromDate,plan.throughDate,
    {...(patch.locationId?{expectedLocationVersion:1,timeZone:patch.locationId===locationId?'Europe/Madrid':'UTC'}:{}),...patch});
  return {site,foreign,owner,other,locationId,inactiveLocationId,foreignLocationId,fromDate:plan.fromDate,throughDate:plan.throughDate,
    exec,sql:scope.sql,owned,queryInput,read,call,create,cancel:calendarNativeCancel,fingerprint,protectedFingerprint,plan,syntheticOnly:true,seededCalendarEntries:0,seededAttendanceEvents:0};
}

export async function checkAttendanceCalendarNative(native,scope){
  const data=await prepareCalendarNativeFixture(native,scope),{exec,plan,call,queryInput:q,create,cancel}=data;
  const protectedBefore=data.protectedFingerprint();phase='actual-calendar-writers';
  const initial=data.read();assert.equal(initial.canCreate,true);assert.deepEqual([initial.locationId,initial.locationName,initial.locationVersion],[null,null,null]);assert.deepEqual(initial.items,[]);
  assert.equal(data.read({locationId}).timeZone,'Europe/Madrid');assert.equal(data.read({locationId:inactiveLocationId}).canCreate,false);
  const original=new Map();
  for(let n=1001;n<=1028;n++){const c=create(n),r=call(q(),c,true);assert.deepEqual(r.receipt.command,c);assert.equal(r.detail.status,'created');assert.deepEqual(r.items,[]);original.set(id(n),r.receipt);}
  for(let n=1101;n<=1102;n++){const c=create(n,{locationId,kind:n===1101?'holiday':'closure'}),r=call(q({locationId}),c,true);assert.equal(r.detail.locationName,'合成日历地点');assert.equal(r.detail.timeZone,'Europe/Madrid');original.set(id(n),r.receipt);}
  const cancellations=[{place:null,c:cancel(2001,id(1001))},{place:locationId,c:cancel(2002,id(1101))}],cancelReceipts=[];
  for(const {place,c} of cancellations){const r=call(q({locationId:place,entryId:c.entryId}),c,true);assert.equal(r.detail.status,'cancelled');assert.equal(r.detail.canCancel,false);assert.equal(r.detail.cancelReason,c.reason);cancelReceipts.push(r.receipt);}
  assert.equal(data.protectedFingerprint(),protectedBefore,'calendar_writes_changed_old_business');
  const baseline=data.fingerprint();phase='lists-and-historical-recovery';
  const range={fromDate:data.fromDate,throughDate:data.throughDate},all=[];let cursor=null,pages=0;
  do{const r=data.read({...range,...(cursor?{beforeAt:cursor.at,beforeId:cursor.id}:{})});assert(++pages<=2);all.push(...r.items);cursor=r.nextCursor;}while(cursor);
  assert.deepEqual(all.map(row=>row.entryId),Array.from({length:28},(_,n)=>id(1028-n)));assert.equal(pages,2);assert.equal(new Set(all.map(row=>row.entryId)).size,28);
  assert(all.every(row=>Object.keys(row).length===11&&!('reason' in row)));assert.equal(all.filter(row=>row.status==='cancelled').length,1);
  assert.deepEqual(data.read({...range,locationId}).items.map(row=>row.entryId),[id(1102),id(1101)]);
  assert.equal(data.read({fromDate:data.throughDate,throughDate:data.throughDate}).items.length,25,'inclusive last date still overlaps');
  const nextDay=new Date(Date.parse(data.throughDate+'T00:00:00Z')+86400000).toISOString().slice(0,10);assert.deepEqual(data.read({fromDate:nextDay,throughDate:nextDay}).items,[]);
  assert.deepEqual(data.read().items,[]);assert.equal(data.read({operationId:id(9999)}).receipt,null);
  for(const n of [1001,1002,1101,1102]){const place=n>=1100?locationId:null,c=create(n,{...(place?{locationId:place}:{}),...(n===1102?{kind:'closure'}:{})});
    assert.deepEqual(data.read({locationId:place,operationId:id(n)}).receipt,original.get(id(n)));assert.deepEqual(call(q({locationId:place}),c,false).receipt,original.get(id(n)));}
  for(let n=0;n<cancellations.length;n++){const {place,c}=cancellations[n];assert.deepEqual(data.read({locationId:place,operationId:c.operationId}).receipt,cancelReceipts[n]);assert.deepEqual(call(q({locationId:place,entryId:c.entryId}),c,false).receipt,cancelReceipts[n]);}
  assert.equal(data.read({operationId:id(1001)}).detail.status,'cancelled');assert.equal(data.read({operationId:id(1001)}).receipt.item.status,'created');
  assert.equal(data.fingerprint(),baseline,'calendar_reads_replays_changed_facts');
  const rollback=(setup,checks)=>exec(`begin;reset role;${setup}set local role service_role;do $checks$ declare a jsonb;b jsonb;begin ${checks} end;$checks$;rollback;`);
  const run=(c,place=c.action==='create'?c.locationId:null,allow=true,actor=owner)=>expression(q({locationId:place,entryId:c.action==='cancel'?c.entryId:null}),c,allow,actor);
  phase='permissions-and-version-fences';
  rollback('',[
    denied('attendance_platform_paused',run(create(3001),null,false)),denied('attendance_platform_paused',run(cancel(3002,id(1002)),null,false)),
    denied('attendance_operation_conflict',run(create(1001,{title:'Different original command'}),null,false)),
    denied('attendance_calendar_closed',run(cancel(3003,id(1001)))),denied('attendance_calendar_not_found',run(cancel(3004,id(9999)))),
    denied('attendance_version_conflict',run(create(3005,{expectedSettingsVersion:2}))),denied('attendance_version_conflict',run(create(3006,{locationId,expectedLocationVersion:2}))),
    denied('attendance_version_conflict',run(create(3007,{timeZone:'Europe/Madrid'}))),denied('attendance_calendar_location_inactive',run(create(3008,{locationId:inactiveLocationId}))),
    denied('attendance_calendar_not_found',expression(q({entryId:id(1102)}))),denied('attendance_calendar_not_found',expression(q({operationId:id(1102)}))),
    denied('attendance_calendar_not_found',expression(q({locationId:foreignLocationId}))),denied('attendance_access_denied',expression(q(),null,false,other)),
    denied('attendance_access_denied',expression(q({siteId:foreign}))),
  ].join('\n'));
  const oldLocal=original.get(id(1102));
  rollback(`update public.merchant_attendance_settings set time_zone='Pacific/Kiritimati',version=version+1 where merchant_id='${site}';
    update public.merchant_attendance_locations set name='Changed current place',time_zone='UTC',active=false,version=version+1 where id='${locationId}';`,
    `a:=${expression(q({locationId,operationId:id(1102)}))};assert a->'receipt'=${json(oldLocal)},'old operation preserves location snapshot';
      assert a->>'timeZone'='UTC' and a->>'locationName'='Changed current place' and a->'canCreate'='false'::jsonb,'context reflects current location';
      assert a->'detail'->>'timeZone'='Europe/Madrid' and a->'detail'->>'locationName'='合成日历地点','detail does not inherit current name/zone';
      a:=${run(create(1102,{locationId,kind:'closure'}),locationId,false)};assert a->'receipt'=${json(oldLocal)},'paused replay precedes current versions/activity';
      a:=${run(cancel(3101,id(1102)),locationId)};assert a->'detail'->>'status'='cancelled','inactive changed location can be cancelled';
      a:=${expression(q({operationId:id(1001)}))};assert a->'receipt'=${json(original.get(id(1001)))},'company receipt keeps original settings zone';`);
  rollback(`update public.merchants set user_id='${other}' where id='${site}';`,
    denied('attendance_access_denied',expression(q({operationId:id(1001)})))+
    `a:=${expression(q({operationId:id(1001)}),null,false,other)};assert a->'receipt'='null'::jsonb and a->'detail'='null'::jsonb,'other actor receipt is opaque';`+
    denied('attendance_operation_conflict',run(create(1001),null,false,other))+
    `a:=${run(cancel(3102,id(1002)),null,true,other)};assert a->'detail'->>'status'='cancelled','current new owner may cancel older record';`);
  rollback(`insert into public.merchants(id,user_id) values('99990003','${owner}');`,denied('attendance_settings_required',expression(q({siteId:'99990003'}))));
  phase='strict-shapes-dates-and-text';
  const invalidQueries=[null,{}, {...q(),extra:true},{...q(),fromDate:data.fromDate},{...q(),beforeAt:'2026-10-01T00:00:00.000000Z',beforeId:id(1001)},
    {...q(),...range,entryId:id(1001)},{...q(),...range,operationId:id(1001)},{...q(),fromDate:'2026-02-30',throughDate:'2026-02-30'},
    {...q(),fromDate:'2026-01-01',throughDate:'2027-01-02'},{...q(),locationId:3}];
  const invalidCommands=[{...create(4001),extra:1},create(4001,{title:' x'}),create(4001,{title:'x\u007f'}),create(4001,{title:'x\u0085'}),create(4001,{title:'x'.repeat(81)}),
    create(4001,{reason:'x\u0085'}),create(4001,{reason:'x'.repeat(201)}),create(4001,{reason:'x\u00a0'}),create(4001,{expectedSettingsVersion:1.5}),
    create(4001,{expectedLocationVersion:1}),create(4001,{locationId,expectedLocationVersion:null}),create(4001,{kind:'automatic_holiday'}),
    create(4001,{timeZone:'not-a-zone'}),create(4001,{fromDate:'2026-02-30'}),create(4001,{fromDate:'1999-12-31'}),
    create(4001,{fromDate:'2026-01-01',throughDate:'2027-01-02'}),{...cancel(4001,id(1002)),expectedRevision:2}];
  rollback('',invalidQueries.map(v=>denied('attendance_invalid_request',expression(v))).join('\n')+invalidCommands.map(c=>denied('attendance_invalid_request',run(c))).join('\n')+
    denied('attendance_invalid_request',expression(q(),null,null))+denied('attendance_invalid_request',expression(q(range),create(4001),true)));
  rollback(`update public.merchant_attendance_settings set time_zone='Pacific/Apia' where merchant_id='${site}';`,
    denied('attendance_invalid_request',run(create(4101,{fromDate:'2011-12-30',throughDate:'2011-12-31',timeZone:'Pacific/Apia'})))+
    denied('attendance_invalid_request',run(create(4102,{fromDate:'2011-12-29',throughDate:'2011-12-30',timeZone:'Pacific/Apia'})))+
    `a:=${run(create(4103,{fromDate:'2011-12-29',throughDate:'2011-12-31',timeZone:'Pacific/Apia'}))};assert a->'detail'->>'status'='created','internal skipped label does not invent paid time';`);
  rollback('',`a:=${run(create(4104,{fromDate:'2026-01-01',throughDate:'2027-01-01'}))};assert a->'detail'->>'status'='created','366 inclusive dates allowed';
    a:=${run(create(4105,{locationId,fromDate:'2026-03-29',throughDate:'2026-03-29'}))};assert a->'detail'->>'fromDate'='2026-03-29','DST23h day stays one local date';
    a:=${run(create(4106,{locationId,fromDate:'2026-10-25',throughDate:'2026-10-25'}))};assert a->'detail'->>'throughDate'='2026-10-25','DST25h day stays one local date';`);
  // New inconsistent synthetic operation only, rolled back; never rewrite an old row.
  rollback(`insert into public.merchant_attendance_calendar_operations(merchant_id,operation_id,entry_id,revision,action,actor_auth_user_id,command,snapshot,recorded_at)
    values('${site}','${id(4901)}','${id(1002)}',2,'cancel','${owner}',${json(cancel(4901,id(1002)))},'{}',clock_timestamp());`,
    denied('attendance_calendar_invalid',expression(q({entryId:id(1002)}))));
  assert.equal(data.fingerprint(),baseline,'calendar_rollback_probes_changed_facts');phase='acl-and-immutability';
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expression()};raise exception 'calendar_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  for(const role of ['anon','authenticated','service_role'])exec(`set local role ${role};do $tables$ begin ${calendarTables.map(t=>
    `assert not has_table_privilege(current_user,'public.${t}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'calendar_private_privilege_allowed';begin perform 1 from public.${t};raise exception 'calendar_private_read_allowed';exception when insufficient_privilege then null;end;`).join('\n')}end;$tables$;`);
  exec(`begin;reset role;do $immutable$ begin ${calendarTables.map(t=>`begin update public.${t} set merchant_id=merchant_id;raise exception 'calendar_update_allowed';exception when insufficient_privilege then null;end;
    begin delete from public.${t};raise exception 'calendar_delete_allowed';exception when insufficient_privilege then null;end;
    begin truncate public.${t} cascade;raise exception 'calendar_truncate_allowed';exception when insufficient_privilege then null;end;`).join('\n')}end;$immutable$;rollback;`);
  assert.equal(data.fingerprint(),baseline,'calendar_acl_checks_changed_facts');assert.equal(data.protectedFingerprint(),protectedBefore,'calendar_probes_changed_old_business');
  phase='actual-cancel-cas';assert.equal(typeof native.connect,'function');assert.deepEqual(assertLifecycleSandbox(s=>native.query(scope.sql(s))),data.owned);
  const race=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},
    `reset role;${plan.guard}set local role service_role;select ${run(cancel(5001,id(1002)))};`,
    `reset role;${plan.guard}set local role service_role;select ${run(cancel(5002,id(1002)))};`);
  assert.equal(race.witnessed,true);assert.equal(JSON.parse(race.left).detail.status,'cancelled');assert(race.right.error,'second terminal must fail');
  assert.equal(race.right.error.message.includes('attendance_calendar_closed'),true,'waiter must observe committed cancellation');
  assert.equal(exec(`select count(*) from public.merchant_attendance_calendar_entries where merchant_id='${site}';`),'30');
  assert.equal(exec(`select count(*) from public.merchant_attendance_calendar_operations where merchant_id='${site}';`),'33');
  assert.equal(exec(`select count(*) from public.merchant_attendance_calendar_operations where merchant_id='${site}' and operation_id='${id(5002)}';`),'0');
  const final=data.fingerprint();const recovered=data.read({operationId:id(1002)});assert.deepEqual(recovered.receipt,original.get(id(1002)));assert.equal(recovered.detail.status,'cancelled');
  assert.equal(data.fingerprint(),final,'calendar_final_read_changed_facts');assert.equal(data.protectedFingerprint(),protectedBefore,'calendar_race_changed_old_business');
  for(const label of labels)native.pass(label);return {checks:labels.length,entries:30,operations:33,exactLockWitnesses:1,syntheticOnly:true,allRollbackProbesRestored:true,callerOwnedNamespaceCleanup:true};
}
export async function runAttendanceCalendarNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceCalendarNative(native,scope)));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceCalendarNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(calendarNativeFailure(error)));process.exitCode=1;});
}
