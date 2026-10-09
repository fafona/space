// Inert on import. The root-owned reuse runner supplies the stopped synthetic
// PG; this checker creates only one identity-checked disposable namespace.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';

export const schedulePublicationEvidenceMigration='202610050136_merchant_attendance_schedule_publication_evidence.sql';
export const schedulePublicationEvidenceLabels=Object.freeze([
  '136 installs its valid concurrent index in separate transaction phases; old definitions ACLs and facts remain unchanged',
  'actual schedule service dispatch keeps off/outside-list publications on099 and captures exactly one or32 immutable slots when enabled',
  'GET cancellation exact replay and pre-enable operation replay do not create or replace publication evidence',
  'disabled unbound current employee cannot publish; original receipt replay preserves previously captured identity without backfill',
  'evidence insertion failure rolls back original099 command and slots inside the failed statement, not only outer cleanup',
  'two actual connections witness duplicate/stale and current identity/configuration serialization by exact blocking backend PID',
  '101 actual planned slots suppress the query list but keep the exact bounded publication evidence and original receipt',
  'private helpers and all append-only tables reject direct writes; reapplying136 preserves saved evidence and every original definition',
]);
const site='99990001',owner=id(99),employee=id(101),auth=id(1),worker=id(201),location=id(301);
const oldRpc='faolla_attendance_schedule_v1',newRpc='faolla_attendance_schedule_evidenced_v1';
const evidence='merchant_attendance_schedule_publication_evidence';
const scheduleTables=['merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_cancellations'];
const flags=['FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_ENABLED','FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_SITE_IDS'];
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
let phase='entry';

export function schedulePublicationEvidenceFailure(error){
  const code=(error instanceof Error?error.message:'').match(/(?:ERROR:\s+|^)((?:attendance|merchant_attendance)_[a-z_]+)(?=\r?\n|$)/)?.[1];
  return {error:'schedule_publication_evidence_native_failed',phase,code:code??'local_check_failed'};
}
export function schedulePublicationEvidenceExpression(name,args){
  assert([oldRpc,newRpc].includes(name));
  assert(args&&Object.getPrototypeOf(args)===Object.prototype);
  assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);
  assert.equal(typeof args.p_allow_write,'boolean');
  assert.match(args.p_auth_user_id,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  return `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args.p_allow_write})`;
}
export function schedulePublicationEvidenceSlots(date,count=1,offset=0){
  assert(typeof date==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(date));
  const base=Date.parse(date+'T00:00:00.000Z');assert(Number.isFinite(base)&&new Date(base).toISOString().slice(0,10)===date);
  assert(Number.isSafeInteger(count)&&count>=1&&count<=32&&Number.isSafeInteger(offset)&&offset>=0&&offset+count<=720);
  return Array.from({length:count},(_,n)=>[new Date(base+(offset+n)*120000).toISOString(),new Date(base+(offset+n)*120000+60000).toISOString()]);
}
// Preserve ALL transaction boundaries. In particular, do not place concurrent
// index construction inside the namespace fixture's usual BEGIN wrapper.
export function schedulePublicationEvidenceMigrationSql(root,scope){
  assert(typeof root==='string'&&path.isAbsolute(root));
  assert(scope&&/^attendance_race_[a-f0-9]{32}$/.test(scope.schema)&&typeof scope.sql==='function');
  const source=readFileSync(path.join(root,'scripts/supabase-migrations',schedulePublicationEvidenceMigration),'utf8');
  assert.match(source,/commit;\s*[\s\S]*?create index concurrently if not exists attendance_schedule_publication_idx/);
  const statement=scope.sql(source);assert(!/\bpublic\./.test(statement));return statement;
}
function ownedGuard(owned){
  assert(owned&&/^attendance_race_[a-f0-9]{32}$/.test(owned.schema)&&owned.owner==='postgres');
  assert(Number.isSafeInteger(owned.oid)&&owned.oid>0&&Number.isSafeInteger(owned.tableOid)&&owned.tableOid>0);
  assert(/^faolla-synthetic-concurrency:[a-f0-9-]{36}$/.test(owned.marker));
  return `do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid} and n.nspname=${quote(owned.schema)}
    and n.nspowner::regrole::text='postgres' and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)})
    then raise exception 'schedule_publication_owned_schema_required';end if;end;$owned$;`;
}
const rejection=(expression,code)=>`begin perform ${expression};raise exception 'schedule_publication_unexpected_acceptance';
  exception when sqlstate 'P0001' then if sqlerrm<>${quote(code)} then raise;end if;end;`;

export async function checkAttendanceSchedulePublicationEvidence(native){
  let summary;
  const previous=flags.map(key=>[key,process.env[key]]);
  try{
    await withAttendanceConcurrencySandbox(native,async scope=>{
      phase='minimal-install';
      const raw=source=>native.query(scope.sql(source)),owned=assertLifecycleSandbox(raw),guard=ownedGuard(owned);
      assert.equal(owned.schema,scope.schema);
      const verify=()=>assert.deepEqual(assertLifecycleSandbox(raw),owned,'schedule_publication_namespace_changed');
      const exec=source=>{verify();const start=/^(\s*begin\s*;)/i;return raw(start.test(source)?source.replace(start,`$1reset role;${guard}`):`begin;reset role;${guard}${source}\ncommit;`);};
      verify();raw(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610010099_merchant_attendance_schedule.sql'),'utf8'));
      const inventory=()=>JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
      const fingerprint=(tables=inventory())=>{
        assert(tables.length>0&&tables.every(t=>/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(t)));
        return exec(`select md5(jsonb_object_agg(name,rows order by name)::text) from (${tables.map(t=>`select ${quote(t)} name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${t} r) rows`).join(' union all ')}) all_tables;`);
      };
      const catalog=(oldOnly=false)=>exec(`select jsonb_build_object(
        'functions',(select jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid) from pg_proc p where p.pronamespace=${owned.oid} and p.prokind='f' ${oldOnly?`and p.oid=any(${quote(oldOids.functions)}::oid[])`:''}),
        'tables',(select jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relowner,c.relacl,c.relrowsecurity,(select jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),(select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid)) order by c.oid) from pg_class c where c.relnamespace=${owned.oid} and c.relkind in('r','p') ${oldOnly?`and c.oid=any(${quote(oldOids.tables)}::oid[])`:''}),
        'indexes',(select jsonb_agg(jsonb_build_array(i.indexrelid,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) order by i.indexrelid) from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace=${owned.oid} ${oldOnly?`and i.indexrelid=any(${quote(oldOids.indexes)}::oid[])`:''}),
        'triggers',(select jsonb_agg(jsonb_build_array(t.oid,pg_get_triggerdef(t.oid)) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and not t.tgisinternal ${oldOnly?`and t.oid=any(${quote(oldOids.triggers)}::oid[])`:''}));`);
      const oldOids=JSON.parse(exec(`select jsonb_build_object('functions',(select array_agg(oid order by oid)::text from pg_proc where pronamespace=${owned.oid} and prokind='f'),
        'tables',(select array_agg(oid order by oid)::text from pg_class where relnamespace=${owned.oid} and relkind in('r','p')),
        'indexes',(select array_agg(i.indexrelid order by i.indexrelid)::text from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace=${owned.oid}),
        'triggers',(select array_agg(t.oid order by t.oid)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and not t.tgisinternal));`));
      const originalTables=inventory(),oldCatalog=catalog(true),preInstall=fingerprint(originalTables.filter(t=>t!=='faolla_schema_migrations'));
      const migration=schedulePublicationEvidenceMigrationSql(native.root,scope);
      const install=()=>{verify();raw(`reset role;${guard}`);native.query(migration);verify();};
      // Simulate only a VALID orphan from an interrupted prior installation.
      // It is created concurrently outside any transaction, not by changing
      // system catalogs or disabling constraints. 136 must adopt the same OID.
      verify();raw('create index concurrently attendance_schedule_publication_idx on public.merchant_attendance_schedule_slots(merchant_id,revision,id);');
      const orphanIndex=exec("select 'public.attendance_schedule_publication_idx'::regclass::oid;");
      install();
      assert.equal(exec("select 'public.attendance_schedule_publication_idx'::regclass::oid;"),orphanIndex,'136_replaced_valid_orphan_index');
      assert.deepEqual(inventory(),[...originalTables,evidence].sort());
      assert.equal(catalog(true),oldCatalog,'schedule_publication_install_changed_old_catalog');
      assert.equal(fingerprint(originalTables.filter(t=>t!=='faolla_schema_migrations')),preInstall);
      assert.equal(exec(`select indisvalid and indisready and indislive from pg_index where indexrelid='public.attendance_schedule_publication_idx'::regclass;`),'t');
      const installed=catalog(),empty=fingerprint();install();assert.equal(catalog(),installed);assert.equal(fingerprint(),empty);
      // Run the exact prerequisite block against a temporary wrong same-name
      // index. Never execute the migration COMMIT/CIC phases in this rollback
      // probe; no invalid-index catalog surgery or automatic DROP is used.
      const preflight=readFileSync(path.join(native.root,'scripts/supabase-migrations',schedulePublicationEvidenceMigration),'utf8')
        .match(/do \$schedule_publication_prerequisites\$[\s\S]*?\$schedule_publication_prerequisites\$;/)?.[0];
      assert(preflight);
      exec(`begin;alter index public.attendance_schedule_publication_idx rename to qa_schedule_publication_saved_idx;
        create index attendance_schedule_publication_idx on public.merchant_attendance_schedule_slots(merchant_id,id,revision);
        do $wrong_index$ begin begin execute ${quote(preflight)};raise exception 'wrong_index_accepted';
          exception when sqlstate 'P0001' then if sqlerrm<>'merchant_attendance_schedule_publication_index_conflict' then raise;end if;end;end;$wrong_index$;rollback;`);
      assert.equal(catalog(),installed);assert.equal(fingerprint(),empty);
      native.pass(schedulePublicationEvidenceLabels[0]);

      phase='minimal-seed';
      exec(`do $fresh$ begin assert not exists(select 1 from public.merchants),'schedule_publication_fresh_namespace_required';end;$fresh$;
        insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990002','${id(98)}');
        insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(30)}','${site}','Synthetic publication',array['enterprise.view','attendance.self.view']);
        insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
          ('${employee}','${site}','${auth}','publication@example.invalid','合成排班员工','${id(30)}','active');
        insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','UTC');
        insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${location}','${site}','合成排班地点','UTC',true);
        insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id) values
          ('${worker}','${site}','${employee}','PUB-01','合成排班员工',true,'${location}');
        insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');`);
      const day=exec("select ((clock_timestamp() at time zone 'UTC')::date+2)::text;"),date=n=>new Date(Date.parse(day+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
      const q={siteId:site,access:'owner',workerId:worker,fromDate:day,throughDate:date(14),operationId:null};
      const protectedTables=inventory().filter(t=>![...scheduleTables,evidence].includes(t)),protectedBefore=fingerprint(protectedTables);
      const revision=()=>Number(exec(`select coalesce(max(revision),0) from public.merchant_attendance_schedule_commands where merchant_id='${site}';`));
      const counts=()=>JSON.parse(exec(`select jsonb_build_object('commands',(select count(*) from public.merchant_attendance_schedule_commands),'slots',(select count(*) from public.merchant_attendance_schedule_slots),'cancellations',(select count(*) from public.merchant_attendance_schedule_cancellations),'evidence',(select count(*) from public.${evidence}));`));
      let op=1000,serviceCalls=0;const names=[];
      const publish=(dayOffset,count=1,offset=0,patch={})=>({operationId:id(++op),expectedRevision:revision(),expectedSettingsVersion:1,reason:'合成发布身份依据',action:'publish',locationId:location,timeZone:'UTC',slots:schedulePublicationEvidenceSlots(date(dayOffset),count,offset),...patch});
      const args=(command=null,query=q,who=owner,allow=true)=>({p_query:query,p_auth_user_id:who,p_command:command,p_allow_write:allow});
      const expression=(command=null,query=q,name=newRpc,who=owner,allow=true)=>schedulePublicationEvidenceExpression(name,args(command,query,who,allow));
      const require=createRequire(import.meta.url),{executeAttendanceSchedule}=require('../src/lib/merchantAttendanceSchedule.server.ts');
      const service={rpc:async(name,input)=>{
        serviceCalls++;names.push(name);
        try{return {data:JSON.parse(exec(`set local role service_role;select ${schedulePublicationEvidenceExpression(name,input)};`)),error:null};}
        catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
      }};
      const run=(command=null,query=q,allowWrite=true,authUserId=owner)=>executeAttendanceSchedule({query,command,authUserId,allowWrite},service);
      const assertRejected=async(command,code,query=q,who=owner,allow=true)=>{
        const before=fingerprint();await assert.rejects(run(command,query,allow,who),error=>error?.code===code||error?.message===code);assert.equal(fingerprint(),before,'rejected_publication_changed_facts');
      };
      const evidenceRow=operationId=>JSON.parse(exec(`select to_jsonb(t) from public.${evidence} t where operation_id='${operationId}';`));
      const checkEvidence=(command,expected={})=>{
        const row=evidenceRow(command.operationId);
        assert.deepEqual(Object.keys(row).sort(),['actor_auth_user_id','capture_policy','employee_auth_user_id','employee_id','identity_status','location_id','location_version','merchant_id','operation_id','published_at','recorded_at','revision','settings_version','slots','time_zone','worker_id','worker_version'].sort());
        for(const [key,value]of Object.entries({merchant_id:site,revision:command.expectedRevision+1,operation_id:command.operationId,actor_auth_user_id:owner,worker_id:worker,employee_id:employee,employee_auth_user_id:auth,identity_status:'bound',worker_version:1,location_id:location,location_version:1,settings_version:command.expectedSettingsVersion,time_zone:'UTC',capture_policy:'publish-identity-context-v1',...expected}))assert.equal(row[key],value,key);
        const original=JSON.parse(exec(`select jsonb_build_object('publishedAt',c.recorded_at,'slots',(select jsonb_agg(jsonb_build_object('id',s.id,'workDate',s.work_date,'startAt',to_char(s.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endAt',to_char(s.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by s.id) from public.merchant_attendance_schedule_slots s where s.merchant_id=c.merchant_id and s.revision=c.revision)) from public.merchant_attendance_schedule_commands c where c.operation_id='${command.operationId}';`));
        assert.equal(row.published_at,original.publishedAt);assert.deepEqual(row.slots,original.slots);assert.equal(row.slots.length,command.slots.length);
        assert.equal(exec(`select recorded_at>=published_at from public.${evidence} where operation_id='${command.operationId}';`),'t');return row;
      };
      const enabled=(value='1',sites=site)=>{process.env[flags[0]]=value;process.env[flags[1]]=sites;};
      phase='actual-service-dispatch';enabled('0');const off=publish(0);await run(off);assert.equal(names.at(-1),oldRpc);
      enabled('1','99990002');const outside=publish(1);await run(outside);assert.equal(names.at(-1),oldRpc);
      assert.equal(counts().evidence,0);enabled();const single=publish(2);const singleResult=await run(single);assert.equal(names.at(-1),newRpc);checkEvidence(single);
      const bulk=publish(3,32);await run(bulk);checkEvidence(bulk);assert.deepEqual(counts(),{commands:4,slots:35,cancellations:0,evidence:2});
      native.pass(schedulePublicationEvidenceLabels[1]);

      phase='replays-read-cancel';const savedSingle=evidenceRow(single.operationId),savedBulk=evidenceRow(bulk.operationId);
      const noWrites=fingerprint();assert.equal((await run()).revision,4);assert.equal(names.at(-1),oldRpc);
      assert.deepEqual((await run(single,q,false)).receipt,singleResult.receipt);assert.equal(names.at(-1),newRpc);
      await run(off,q,false);await run(outside,q,false);assert.equal(fingerprint(),noWrites,'replay_backfilled_or_replaced_evidence');
      const cancel={operationId:id(++op),expectedRevision:revision(),expectedSettingsVersion:1,reason:'合成取消保持原发布依据',action:'cancel',slotId:singleResult.entries.find(e=>e.revision===3).id};
      const cancelled=await run(cancel);assert.equal(names.at(-1),oldRpc);assert.equal(cancelled.entries.find(e=>e.id===cancel.slotId).cancelled,true);
      assert.equal(counts().evidence,2);assert.deepEqual(evidenceRow(single.operationId),savedSingle);assert.deepEqual(evidenceRow(bulk.operationId),savedBulk);
      const afterCancel=fingerprint();await run(null,{...q,operationId:single.operationId},false);await run(cancel,q,false);assert.equal(fingerprint(),afterCancel);
      await assertRejected({...single,reason:'different body'},'attendance_operation_conflict');await assertRejected({...single,operationId:id(++op)},'attendance_version_conflict');
      await assertRejected(publish(4),'attendance_access_denied',q,id(98));await assertRejected(publish(4),'attendance_platform_paused',q,owner,false);
      native.pass(schedulePublicationEvidenceLabels[2]);

      phase='unbound-current-replay';const beforeUnbound=fingerprint();
      exec(`begin;update public.merchant_enterprise_employees set status='disabled',auth_user_id=null where id='${employee}';
        set local role service_role;do $unbound$ declare replay jsonb;begin ${rejection(expression(publish(4)),'attendance_schedule_worker_invalid')}
          replay:=${expression(single,q,newRpc,owner,false)};assert replay->'receipt'=${json(singleResult.receipt)},'unbound_changed_original_receipt';
          perform ${expression(off,q,newRpc,owner,false)};
        end;$unbound$;reset role;
        do $preserved$ begin assert (select to_jsonb(t) from public.${evidence} t where operation_id='${single.operationId}')=${json(savedSingle)},'unbound_replay_replaced_identity';
          assert not exists(select 1 from public.${evidence} where operation_id='${off.operationId}'),'unbound_backfilled_old_operation';end;$preserved$;rollback;`);
      assert.equal(fingerprint(),beforeUnbound);native.pass(schedulePublicationEvidenceLabels[3]);

      phase='atomic-snapshot-failure';const failed=publish(4),beforeFailure=fingerprint(),beforeCounts=counts();
      exec(`begin;alter table public.${evidence} add constraint qa_schedule_publication_forced_failure check(false) not valid;
        set local role service_role;do $failure$ begin begin perform ${expression(failed)};raise exception 'snapshot_failure_not_observed';
          exception when check_violation then if sqlerrm not like '%qa_schedule_publication_forced_failure%' then raise;end if;end;end;$failure$;
        reset role;do $atomic$ begin
          assert not exists(select 1 from public.merchant_attendance_schedule_commands where operation_id='${failed.operationId}'),'snapshot_failure_left_command';
          assert (select count(*) from public.merchant_attendance_schedule_slots)=${beforeCounts.slots},'snapshot_failure_left_slots';
          assert (select count(*) from public.${evidence})=${beforeCounts.evidence},'snapshot_failure_left_evidence';
        end;$atomic$;rollback;`);
      assert.equal(fingerprint(),beforeFailure);assert.equal(catalog(),installed);native.pass(schedulePublicationEvidenceLabels[4]);

      phase='two-connection-races';
      const race=async(holder,waiter)=>{verify();const result=await lifecycleRace(nativeScope(native,scope),`reset role;${guard}${holder}`,`reset role;${guard}${waiter}`);assert.equal(result.witnessed,true);return result;};
      const duplicate=publish(4),beforeDuplicate=counts();
      const dup=await race(`set local role service_role;select ${expression(duplicate)};`,`set local role service_role;select ${expression(duplicate)};`);
      assert.equal(dup.right.error,null);assert.deepEqual(JSON.parse(dup.left).receipt,JSON.parse(dup.right.output).receipt);checkEvidence(duplicate);
      assert.equal(counts().commands,beforeDuplicate.commands+1);assert.equal(counts().evidence,beforeDuplicate.evidence+1);
      const first=publish(5),stale=publish(6);const versionRace=await race(`set local role service_role;select ${expression(first)};`,`set local role service_role;do $stale$ begin ${rejection(expression(stale),'attendance_version_conflict')}end;$stale$;`);
      assert.equal(versionRace.right.error,null);checkEvidence(first);assert.equal(exec(`select count(*) from public.merchant_attendance_schedule_commands where operation_id='${stale.operationId}';`),'0');
      const changedIdentity=publish(6);const identityRace=await race(`update public.merchant_enterprise_employees set auth_user_id='${id(3)}' where id='${employee}';update public.merchant_attendance_workers set version=2 where id='${worker}';`,
        `set local role service_role;select ${expression(changedIdentity)};`);
      assert.equal(identityRace.right.error,null);checkEvidence(changedIdentity,{employee_auth_user_id:id(3),worker_version:2});
      exec(`update public.merchant_enterprise_employees set auth_user_id='${auth}' where id='${employee}';update public.merchant_attendance_workers set version=1 where id='${worker}';`);
      const staleConfig=publish(7);const configRace=await race(`update public.merchant_attendance_settings set version=2 where merchant_id='${site}';update public.merchant_attendance_locations set version=2 where id='${location}';`,
        `set local role service_role;do $config$ begin ${rejection(expression(staleConfig),'attendance_version_conflict')}end;$config$;`);
      assert.equal(configRace.right.error,null);assert.equal(exec(`select count(*) from public.merchant_attendance_schedule_commands where operation_id='${staleConfig.operationId}';`),'0');
      const newConfig=publish(7,1,0,{expectedSettingsVersion:2});await run(newConfig);checkEvidence(newConfig,{location_version:2});
      exec(`update public.merchant_attendance_settings set version=1 where merchant_id='${site}';update public.merchant_attendance_locations set version=1 where id='${location}';`);
      assert.deepEqual(evidenceRow(single.operationId),savedSingle);assert.deepEqual(evidenceRow(bulk.operationId),savedBulk);assert.equal(fingerprint(protectedTables),protectedBefore);
      native.pass(schedulePublicationEvidenceLabels[5]);

      phase='limited-query-list';const denseQ={...q,fromDate:date(10),throughDate:date(10)};let denseLast,denseResult,offset=0;
      for(const count of [32,32,32,5]){denseLast=publish(10,count,offset);denseResult=await run(denseLast,denseQ);checkEvidence(denseLast);offset+=count;}
      assert.equal(offset,101);assert.equal(denseResult.rangeLimited,true);assert.deepEqual(denseResult.entries,[]);assert.equal(denseResult.receipt.operationId,denseLast.operationId);
      assert.equal(evidenceRow(denseLast.operationId).slots.length,5);
      const beforeDenseReplay=fingerprint(),recovered=await run(null,{...denseQ,operationId:denseLast.operationId},false);
      assert.equal(recovered.rangeLimited,true);assert.deepEqual(recovered.receipt,denseResult.receipt);await run(denseLast,denseQ,false);assert.equal(fingerprint(),beforeDenseReplay);
      native.pass(schedulePublicationEvidenceLabels[6]);

      phase='private-append-only-reapply';const baseline=fingerprint();
      for(const role of ['anon','authenticated','service_role']){
        for(const table of [...scheduleTables,evidence]){
          assert.equal(exec(`select has_table_privilege('${role}','public.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');`),'f');
          exec(`set local role ${role};do $acl$ begin begin execute 'insert into public.${table} default values';raise exception 'direct_write_accepted';exception when insufficient_privilege then null;end;end;$acl$;`);
        }
        for(const signature of ['faolla_attendance_schedule_publication_slots_v1(jsonb)','faolla_attendance_schedule_publication_guard_v1()'])assert.equal(exec(`select has_function_privilege('${role}','public.${signature}','EXECUTE');`),'f');
        assert.equal(exec(`select has_function_privilege('${role}','public.${newRpc}(jsonb,uuid,jsonb,boolean)','EXECUTE');`),role==='service_role'?'t':'f');
        exec(`set local role ${role};do $acl$ begin begin perform public.faolla_attendance_schedule_publication_slots_v1('[]');raise exception 'private_helper_accepted';exception when insufficient_privilege then null;end;end;$acl$;`);
      }
      for(const table of [...scheduleTables,evidence])for(const statement of [`update public.${table} set merchant_id=merchant_id`,`delete from public.${table}`,`truncate public.${table} cascade`]){
        exec(`do $immutable$ begin begin execute ${quote(statement)};raise exception 'append_only_rewrite_accepted';exception when insufficient_privilege then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;end;$immutable$;`);
      }
      assert.equal(fingerprint(),baseline);install();assert.equal(fingerprint(),baseline,'136_reapply_changed_saved_evidence');assert.equal(catalog(),installed);assert.equal(catalog(true),oldCatalog);
      assert.equal(fingerprint(protectedTables),protectedBefore,'publication_changed_unrelated_business_facts');
      assert.deepEqual(counts(),{commands:13,slots:140,cancellations:1,evidence:10});
      assert.equal(exec('select count(*) from public.merchant_attendance_events;'),'0');
      native.pass(schedulePublicationEvidenceLabels[7]);
      summary={groups:schedulePublicationEvidenceLabels.length,serviceRpcCalls:serviceCalls,actualConnectionRaces:4,...counts(),syntheticOnly:true,realAuth:false,
        newCluster:false,productionAccess:false,browser:false,unboundSuccessfulPublishClaimed:false,original099DefinitionUnchanged:true,
        nullableUnboundContractReachable:false,invalidIndexCatalogFabricated:false,validOrphanIndexAdopted:true,wrongIndexRejectedInRollback:true,
        allOriginalBusinessFactsOutsideOwnedScheduleUnchanged:true,callerOwnedNamespaceCleanup:true};
    });
    return summary;
  }finally{for(const [key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
function nativeScope(native,scope){return {connect:native.connect,query:native.query,sql:scope.sql};}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceLabelsReuse(process.argv.slice(2),checkAttendanceSchedulePublicationEvidence).catch(error=>{console.error(schedulePublicationEvidenceFailure(error));process.exitCode=1;});
}
