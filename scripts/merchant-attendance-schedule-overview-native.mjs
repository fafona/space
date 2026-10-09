// Local synthetic preparation only; all planned shifts/cancellations use original099.
// The new120 RPC is read-only. Only the caller may run the owned reused cluster.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990001',foreign='99990002',owner=id(99),other=id(98),rpc='faolla_attendance_schedule_overview_v1';
const workers=Object.freeze([id(201),id(202),id(203)]),locations=Object.freeze([id(301),id(302),id(303)]),foreignWorker=id(204);
const names=Object.freeze(['合成总览员工甲','合成总览员工乙','合成总览员工丙']),zones=Object.freeze(['UTC','Europe/Madrid','Pacific/Kiritimati']);
const migrations=Object.freeze(['202610010099_merchant_attendance_schedule.sql','202610030120_merchant_attendance_schedule_overview.sql']);
const scheduleTables=Object.freeze(['merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_cancellations']);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const labels=Object.freeze([
  'schedule overview installs/reapplies120 without changing099 definition, owner, ACL, indexes or business facts',
  'schedule overview reads72 actual099 published shifts across3 workers/3 zones in50+22 ordered pages including a cancellation',
  'schedule overview keeps historical identity/location snapshots after current workers, employee binding and locations change',
  'schedule overview freezes publish/cancel revisions; real later publications yield an empty scanned page with a continuing cursor',
  'schedule overview permits revision0 empty snapshots and single-worker selection without inventing absence or totals',
  'schedule overview current-owner, tenant and worker selection checks deny unauthorized/foreign queries on every page',
  'schedule overview rejects malformed query/cursor/version and inconsistent synthetic stored facts without partial disclosure',
  'schedule overview service-only execute preserves all original table ACLs and denies direct schedule-table reads',
  'schedule overview all reads preserve every owned table; all negative and future-writer scenarios roll back exactly',
]);
let phase='entry';
export const scheduleOverviewQueryInput=(fromDate,throughDate,patch={})=>({siteId:site,workerIds:[...workers],fromDate,throughDate,revision:null,cursorDate:null,cursorStart:null,cursorId:null,...patch});
const expression=(query,actor=owner)=>`public.${rpc}(${typeof query==='string'?query:json(query)},'${actor}')`;
const denied=(code,expr)=>`begin perform ${expr};raise exception 'schedule_overview_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
const writer=(query,command,actor=owner)=>`public.faolla_attendance_schedule_v1(${json(query)},'${actor}',${json(command)},true)`;
export function scheduleOverviewNativeFailure(error){
  const text=error instanceof Error?error.message:'',code=text.match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
  const known=new Set(['attendance_invalid_request','attendance_access_denied','attendance_settings_required','attendance_schedule_overview_invalid',
    'attendance_schedule_past','attendance_schedule_overlap','attendance_version_conflict','merchant_attendance_schedule_overview_prerequisite_required']);
  return {error:'schedule_overview_native_failed',phase,code:known.has(code)?code:'local_check_failed',
    sourceLine:Number(text.match(/PL\/pgSQL function [^\r\n]*? line ([1-9][0-9]{0,5})\b/)?.[1]??0)||null};
}
export function scheduleOverviewMigrationPlan(root,scope){
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
    then raise exception 'schedule_overview_owned_schema_required';end if;end;$owned$;`;
}
export function scheduleOverviewNativePlan(owned,tables,fromDate){
  const guard=guardFor(owned);assert(Array.isArray(tables)&&tables.length>0&&new Set(tables).size===tables.length);
  for(const t of tables)assert(typeof t==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(t)&&t.length<=63);
  for(const t of ['merchants','merchant_attendance_settings',...scheduleTables])assert(tables.includes(t));
  assert(/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(fromDate)&&new Date(fromDate+'T00:00:00Z').toISOString().slice(0,10)===fromDate);
  const throughDate=new Date(Date.parse(fromDate+'T00:00:00Z')+3*86400000).toISOString().slice(0,10);
  const fingerprint=selected=>`(select md5(jsonb_build_object(${selected.map(t=>`${quote(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${t} r)`).join(',')})::text))`;
  const seed=`begin;reset role;${guard}do $fresh$ begin assert not exists(select 1 from public.merchants),'schedule_overview_fresh_namespace_required';end;$fresh$;
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${other}');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(30)}','${site}','Synthetic overview',array['enterprise.view','attendance.self.view']),('${id(40)}','${foreign}','Synthetic foreign',array['enterprise.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ${workers.map((_,n)=>`('${id(101+n)}','${site}','${id(1+n)}','overview-${n}@example.invalid',${quote(names[n])},'${id(30)}','active')`).join(',')},
      ('${id(104)}','${foreign}','${id(4)}','overview-foreign@example.invalid','Synthetic foreign','${id(40)}','active');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',false,false),('${foreign}','UTC',false,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values
      ${locations.map((loc,n)=>`('${loc}','${site}','合成总览地点${n+1}',${quote(zones[n])},true)`).join(',')},('${id(304)}','${foreign}','Synthetic foreign','UTC',true);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id) values
      ${workers.map((worker,n)=>`('${worker}','${site}','${id(101+n)}','OVERVIEW-${String.fromCharCode(65+n)}',${quote(names[n])},true,'${locations[n]}')`).join(',')},
      ('${foreignWorker}','${foreign}','${id(104)}','FOREIGN','Synthetic foreign',true,'${id(304)}');
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values
      ${workers.map(worker=>`('${site}','${worker}','2000-01-01')`).join(',')},('${foreign}','${foreignWorker}','2000-01-01');commit;`;
  const slots=Array.from({length:24},(_,n)=>{const start=Date.parse(fromDate+'T12:00:00Z')+n*1800000;return [new Date(start).toISOString(),new Date(start+900000).toISOString()];});
  return {site,foreign,owner,other,workers:[...workers],locations:[...locations],foreignWorker,names:[...names],zones:[...zones],fromDate,throughDate,guard,seed,slots,
    fingerprint:fingerprint(tables),protectedFingerprint:fingerprint(tables.filter(t=>!scheduleTables.includes(t))),labels:[...labels]};
}

export async function prepareScheduleOverviewNativeFixture(native,scope){
  phase='install';assert.equal(typeof native.query,'function');assert.equal(typeof native.querySteps,'function');
  const raw=source=>native.query(scope.sql(source)),owned=assertLifecycleSandbox(raw);assert.equal(owned.schema,scope.schema);const guard=guardFor(owned);
  const exec=source=>{assert.deepEqual(assertLifecycleSandbox(raw),owned,'schedule_overview_namespace_changed');const start=/^(\s*begin(?:\s+read\s+only)?\s*;)/i;
    return raw(start.test(source)?source.replace(start,`$1reset role;${guard}\n`):`begin;reset role;${guard}\n${source}\ncommit;`);};
  const migration=scheduleOverviewMigrationPlan(native.root,scope);for(const m of migration)exec(m.body);
  const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const fromDate=exec("select ((clock_timestamp() at time zone 'UTC')::date+2)::text;"),plan=scheduleOverviewNativePlan(owned,inventory(),fromDate);
  const fingerprint=()=>exec(`select ${scheduleOverviewNativePlan(owned,inventory(),fromDate).fingerprint};`);
  const protectedFingerprint=()=>exec(`select ${scheduleOverviewNativePlan(owned,inventory(),fromDate).protectedFingerprint};`);
  const installed=()=>exec(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.proname)
    from pg_proc p where p.oid in('public.${rpc}(jsonb,uuid)'::regprocedure,'public.faolla_attendance_schedule_v1(jsonb,uuid,jsonb,boolean)'::regprocedure)),
    'tableACL',(select jsonb_agg(jsonb_build_array(relname,relowner,relacl,relrowsecurity) order by relname) from pg_class where oid in(${scheduleTables.map(t=>`'public.${t}'::regclass`).join(',')})),
    'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=${quote(owned.schema)}));`);
  const empty=fingerprint(),definition=installed();exec(migration[1].body);assert.equal(installed(),definition);assert.equal(fingerprint(),empty);
  phase='minimal-owned-seed';exec(plan.seed);const protectedBefore=protectedFingerprint();
  const queryInput=(patch={})=>scheduleOverviewQueryInput(plan.fromDate,plan.throughDate,patch);
  const read=(patch={},actor=owner)=>JSON.parse(exec(`set local role service_role;select ${expression(queryInput(patch),actor)};`));
  const oldQuery=(workerIndex,patch={})=>({siteId:site,access:'owner',workerId:workers[workerIndex],fromDate:plan.fromDate,throughDate:plan.throughDate,operationId:null,...patch});
  const revision=()=>Number(exec(`select coalesce(max(revision),0) from public.merchant_attendance_schedule_commands where merchant_id='${site}';`));
  let operation=1000;
  const publish=(workerIndex,slots,patch={})=>{assert(Number.isInteger(workerIndex)&&workerIndex>=0&&workerIndex<workers.length);
    const command={operationId:id(++operation),expectedRevision:revision(),expectedSettingsVersion:1,reason:'Synthetic original099 publication',action:'publish',locationId:locations[workerIndex],timeZone:zones[workerIndex],slots,...patch};
    return JSON.parse(exec(`set local role service_role;select ${writer(oldQuery(workerIndex),command)};`));};
  const rows=(asOf=revision())=>{assert(Number.isSafeInteger(asOf)&&asOf>=0&&asOf<=9007199254740989);
    return JSON.parse(exec(`select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'workerId',s.worker_id,'workerName',s.worker_name,'locationId',s.location_id,'locationName',s.location_name,
    'timeZone',s.time_zone,'workDate',s.work_date,'startAt',to_char(s.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endAt',to_char(s.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revision',s.revision,'cancelled',c.revision is not null,'cancelRevision',c.revision)
    order by s.work_date,s.start_at,s.id),'[]') from public.merchant_attendance_schedule_slots s left join public.merchant_attendance_schedule_cancellations c on c.merchant_id=s.merchant_id and c.slot_id=s.id and c.revision<=${asOf}
    where s.merchant_id='${site}' and s.revision<=${asOf};`));};
  const cancel=(slotId,patch={})=>{const row=rows().find(row=>row.id===slotId);assert(row,'owned slot required');const workerIndex=workers.indexOf(row.workerId);assert(workerIndex>=0);
    const command={operationId:id(++operation),expectedRevision:revision(),expectedSettingsVersion:1,reason:'Synthetic original099 cancellation',action:'cancel',slotId,...patch};
    return JSON.parse(exec(`set local role service_role;select ${writer(oldQuery(workerIndex),command)};`));};
  assert.equal(read().revision,0);phase='original099-publication';for(let n=0;n<workers.length;n++)publish(n,plan.slots);cancel(rows()[0].id);
  assert.equal(protectedFingerprint(),protectedBefore,'schedule_overview_seed_writers_changed_unrelated_facts');
  const expectedRows=rows();assert.equal(expectedRows.length,72);assert.equal(expectedRows.filter(r=>r.cancelled).length,1);
  return {site,foreign,owner,other,workers:[...workers],locations:[...locations],foreignWorker,names:[...names],zones:[...zones],fromDate,throughDate:plan.throughDate,
    workerChoices:workers.map((worker,n)=>({id:worker,displayName:names[n],workerNo:`OVERVIEW-${String.fromCharCode(65+n)}`})),
    exec,sql:scope.sql,owned,queryInput,read,publish,cancel,rows,revision,oldQuery,fingerprint,protectedFingerprint,expectedRows,plan,syntheticOnly:true};
}

export async function checkAttendanceScheduleOverviewNative(native,scope){
  const data=await prepareScheduleOverviewNativeFixture(native,scope),{exec,plan,queryInput}=data,baseline=data.fingerprint();phase='bounded-read-cases';
  const all=[];let cursor=null,pages=0,pinned=null;const scans=[];
  do{const result=data.read({revision:pinned,...(cursor?{cursorDate:cursor.workDate,cursorStart:cursor.startAt,cursorId:cursor.slotId}:{})});
    assert(++pages<=3);pinned??=result.revision;assert.equal(result.revision,pinned);all.push(...result.items);scans.push(result.scanned);cursor=result.nextCursor;
  }while(cursor);
  assert.deepEqual(all,data.expectedRows);assert.deepEqual(scans,[50,22]);assert.equal(new Set(all.map(r=>r.id)).size,72);assert.equal(pinned,4);
  assert(all.some(r=>r.timeZone==='Pacific/Kiritimati'&&r.workDate!==r.startAt.slice(0,10)));
  assert(all.some((r,n)=>n&&r.workDate===all[n-1].workDate&&r.startAt===all[n-1].startAt));
  const zero=data.read({revision:0});assert.equal(zero.items.length,0);assert.equal(zero.scanned,50);assert(zero.nextCursor);
  const beforeCancel=data.read({revision:3});assert.equal(beforeCancel.items.some(r=>r.cancelled),false);
  for(const worker of workers)assert.deepEqual(data.read({workerIds:[worker]}).items,all.filter(r=>r.workerId===worker));
  const localDateBoundary=data.read({fromDate:'2000-01-01',throughDate:'2000-01-01',revision:4,
    cursorDate:'2000-01-01',cursorStart:'1999-12-31T12:00:00.000Z',cursorId:id(9990)});
  assert.equal(localDateBoundary.scanned,0);assert.deepEqual(localDateBoundary.items,[]);
  assert.equal(data.fingerprint(),baseline);
  const rollback=(setup,checks)=>exec(`begin;reset role;${setup}set local role service_role;do $checks$ declare a jsonb;b jsonb;q jsonb;total integer:=0;loops integer:=0;begin ${checks} end;$checks$;rollback;`);
  const originalFirst=data.read();
  rollback(`update public.merchant_attendance_workers set active=false,employee_id=null,display_name='Changed current name' where merchant_id='${site}';
    update public.merchant_attendance_locations set active=false,name='Changed current place' where merchant_id='${site}';
    update public.merchant_enterprise_employees set status='disabled' where merchant_id='${site}';`,
    `a:=${expression(queryInput())};assert a=${json(originalFirst)},'owner historical snapshots must not depend on current identity or activity';`);
  phase='future-snapshot-rollback';
  const earlySlots=Array.from({length:30},(_,n)=>{const start=Date.parse(data.fromDate+'T00:00:00Z')+n*120000;return [new Date(start).toISOString(),new Date(start+60000).toISOString()];});
  const newCommands=[0,1].map((n)=>writer(data.oldQuery(n),{operationId:id(5001+n),expectedRevision:4+n,expectedSettingsVersion:1,reason:'Synthetic later original099 publication',action:'publish',locationId:locations[n],timeZone:zones[n],slots:earlySlots}));
  const toCancel=all.find(r=>!r.cancelled&&r.workerId===workers[0]);
  const laterCancel=writer(data.oldQuery(0),{operationId:id(5003),expectedRevision:6,expectedSettingsVersion:1,reason:'Synthetic later original099 cancellation',action:'cancel',slotId:toCancel.id});
  const futureChecks=`a:=${expression(queryInput({revision:4}))};assert jsonb_array_length(a->'items')=0 and (a->>'scanned')::int=50 and a->'nextCursor'<>'null'::jsonb,'later rows must yield a bounded empty page';
    q:=${json(queryInput({revision:4}))};loop
      a:=public.${rpc}(q,'${owner}');total:=total+jsonb_array_length(a->'items');loops:=loops+1;assert loops<=4,'bounded page traversal';
      for b in select jsonb_array_elements(a->'items') loop
        assert ${json(all)} @> jsonb_build_array(b),'frozen snapshot must match original rows exactly';
      end loop;
      exit when a->'nextCursor'='null'::jsonb;
      q:=q||jsonb_build_object('cursorDate',a->'nextCursor'->'workDate','cursorStart',a->'nextCursor'->'startAt','cursorId',a->'nextCursor'->'slotId');
    end loop;assert total=72,'frozen snapshot complete';
    q:=${json(queryInput())};total:=0;loops:=0;loop
      a:=public.${rpc}(q,'${owner}');total:=total+jsonb_array_length(a->'items');loops:=loops+1;assert loops<=4;
      assert (a->>'revision')::int=7;
      exit when a->'nextCursor'='null'::jsonb;
      q:=q||jsonb_build_object('revision',7,'cursorDate',a->'nextCursor'->'workDate','cursorStart',a->'nextCursor'->'startAt','cursorId',a->'nextCursor'->'slotId');
    end loop;assert total=132,'fresh snapshot sees real later publications';`;
  await native.querySteps([`begin;reset role;${plan.guard}set local role service_role;do $writes$ begin perform ${newCommands[0]};perform ${newCommands[1]};perform ${laterCancel};end;$writes$;`,
    `do $future$ declare a jsonb;b jsonb;q jsonb;total integer:=0;loops integer:=0;begin ${futureChecks} end;$future$;rollback;`].map(scope.sql));
  assert.equal(data.fingerprint(),baseline);phase='authorization-and-invalid-input';
  rollback('',denied('attendance_access_denied',expression(queryInput(),other))+denied('attendance_access_denied',expression(queryInput({siteId:foreign})))+
    denied('attendance_access_denied',expression(queryInput({workerIds:[foreignWorker]})))+denied('attendance_access_denied',expression(queryInput({workerIds:[id(999)]}))));
  rollback(`update public.merchants set user_id='${other}' where id='${site}';`,denied('attendance_access_denied',expression(queryInput({revision:4,...{cursorDate:originalFirst.nextCursor.workDate,cursorStart:originalFirst.nextCursor.startAt,cursorId:originalFirst.nextCursor.slotId}}))));
  rollback(`insert into public.merchants(id,user_id) values('99990003','${owner}');`,denied('attendance_settings_required',expression(queryInput({siteId:'99990003'}))));
  const bad=[null,{},queryInput({extra:true}),queryInput({workerIds:[]}),queryInput({workerIds:[workers[1],workers[0]]}),queryInput({workerIds:[workers[0],workers[0]]}),
    queryInput({workerIds:Array.from({length:21},(_,n)=>id(201+n))}),queryInput({workerIds:[null]}),queryInput({workerIds:['not-a-uuid']}),
    queryInput({revision:-1}),queryInput({revision:5}),queryInput({revision:0.5}),queryInput({revision:'4'}),queryInput({revision:9007199254740990}),
    queryInput({fromDate:'2026-02-30'}),queryInput({throughDate:'2101-01-01'}),queryInput({fromDate:'2000-01-01',throughDate:'2000-02-01'}),
    queryInput({cursorId:all[0].id}),queryInput({cursorDate:all[0].workDate,cursorStart:all[0].startAt,cursorId:all[0].id}),
    queryInput({revision:4,cursorDate:all[0].workDate,cursorStart:all[0].startAt.replace(':00.000Z',':01.000Z'),cursorId:all[0].id})];
  rollback('',bad.map(q=>denied('attendance_invalid_request',expression(q))).join('\n'));
  // Deliberately inconsistent pre-existing rows are negative fixture inputs, not
  // successful application writes. Existing immutable rows/triggers are untouched.
  rollback(`insert into public.merchant_attendance_schedule_slots select merchant_id,'${id(9001)}',revision,worker_id,employee_id,worker_name,location_id,location_name,time_zone,work_date,start_at+interval '1 minute',end_at
    from public.merchant_attendance_schedule_slots where merchant_id='${site}' and id='${all[0].id}';`,denied('attendance_schedule_overview_invalid',expression(queryInput())));
  rollback(`insert into public.merchant_attendance_schedule_cancellations(merchant_id,slot_id,revision) values('${site}','${toCancel.id}',4);`,denied('attendance_schedule_overview_invalid',expression(queryInput())));
  phase='acl-and-fingerprint';
  for(const role of ['anon','authenticated'])exec(`set local role ${role};do $acl$ begin begin perform ${expression(queryInput())};raise exception 'schedule_overview_browser_execute_allowed';exception when insufficient_privilege then null;end;end;$acl$;`);
  for(const role of ['anon','authenticated','service_role'])exec(`set local role ${role};do $tables$ begin ${scheduleTables.map(t=>`assert not has_table_privilege(current_user,'public.${t}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');begin perform 1 from public.${t};raise exception 'schedule_overview_private_table_read_allowed';exception when insufficient_privilege then null;end;`).join('\n')}end;$tables$;`);
  assert.equal(data.fingerprint(),baseline,'schedule_overview_reads_or_rollback_changed_facts');
  for(const label of labels)native.pass(label);return {checks:labels.length,slots:72,cancellations:1,revision:4,syntheticOnly:true,scenarioChangesRolledBack:true};
}
export async function runAttendanceScheduleOverviewNative(args){return runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceScheduleOverviewNative(native,scope)));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceScheduleOverviewNative(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify(scheduleOverviewNativeFailure(error)));process.exitCode=1;});
}
