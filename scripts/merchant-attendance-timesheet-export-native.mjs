import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import exports from '../src/lib/merchantAttendanceTimesheetExport.ts';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
async function check(context){
  const {query,connect,pass,root}=context;
  await withAttendanceConcurrencySandbox(context,async({sql,schema})=>{
    const exec=s=>query(sql(s)),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
    for(const name of ['202609300087_merchant_attendance_period_report.sql','202610010088_merchant_attendance_scoped_period_report.sql','202610010090_merchant_attendance_period_export.sql'])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    const site='99990009',owner=id(1),auth=id(2),employee=id(3),role=id(4),worker=id(5),loc=id(6),managerAuth=id(7),manager=id(8),managerRole=id(9),grant=id(10),worker2=id(11);
    const day=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
    exec(`begin;
      insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990008','${owner}');
      insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','Europe/Madrid');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${loc}','${site}','Synthetic location','Europe/Madrid');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Self',array['enterprise.view','attendance.self.view']),('${managerRole}','${site}','Manager',array['enterprise.view','attendance.records.view']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
        ('${employee}','${site}','${auth}','export-self@example.test','Synthetic self','${role}','active'),('${manager}','${site}','${managerAuth}','export-manager@example.test','Synthetic manager','${managerRole}','active');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name) values('${worker}','${site}','${employee}','EXPORT','Synthetic worker'),('${worker2}','${site}',null,'OTHER','Synthetic other');
      insert into public.merchant_attendance_scopes(merchant_id,employee_id,revision) values('${site}','${manager}',1);
      insert into public.merchant_attendance_scope_grants(merchant_id,employee_id,id,valid_from) values('${site}','${manager}','${grant}','2000-01-01Z');
      insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${manager}','${grant}','${worker}');
      insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id) values('${site}','${manager}','${grant}','${loc}');
      insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id)
        values('${id(101)}','${site}','${worker}','${loc}','${id(201)}',1,'clock_in','web','${day(3)}T08:00Z','Europe/Madrid','${employee}'),
        ('${id(102)}','${site}','${worker}','${loc}','${id(202)}',2,'clock_out','web','${day(3)}T16:00Z','Europe/Madrid','${employee}');commit;`);
    let next=300;
    const cmd=(access='owner')=>({siteId:site,operationId:id(next++),query:{access,workerId:access==='self'?null:worker,locationId:access==='manager'?loc:null,expectedWorkerId:access==='self'?worker:null,
      fromDate:day(5),throughDate:day(1),expectedTimeZone:'Europe/Madrid',expectedScopeRevision:access==='manager'?1:null}});
    const actor=c=>c.query.access==='owner'?owner:c.query.access==='self'?auth:managerAuth;
    const call=(c,who=actor(c))=>`public.faolla_attendance_period_export_v1('${c.siteId}','${who}','${c.operationId}',${json(c.query)})`;
    const read=(c,who=actor(c))=>exports.parseTimesheetExportSource(JSON.parse(exec(`set role service_role;select ${call(c,who)};`)),c);
    const count=()=>exec('select count(*) from public.merchant_attendance_report_exports;');
    for(const access of ['self','manager'])assert.throws(()=>read(cmd(access)),/attendance_export_denied/);
    assert.equal(count(),'0');
    for(const permission of ['attendance.self.export','attendance.reports.export'])assert.equal(exec(`select public.faolla_valid_merchant_enterprise_permissions_v1(array['enterprise.view','${permission}']);`),'f');
    exec(`update public.merchant_enterprise_roles set permissions=permissions||array[case when id='${role}' then 'attendance.self.export' else 'attendance.reports.export' end] where id in ('${role}','${managerRole}');`);
    pass('view permission alone cannot export; new permissions require dependencies and no default role backfill');
    const fingerprint=()=>exec(`select jsonb_build_object(${['events','correction_effects','workers','scopes','scope_grants'].map(t=>`'${t}',(select md5(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text) from public.merchant_attendance_${t} t)`).join(',')});`);
    const before=fingerprint(),commands=['owner','self','manager'].map(cmd);
    for(const c of commands){const r=read(c);assert.equal(r.replayed,false);assert.equal(r.report.totals.selected.workedUs,8*3600000000);assert.match(r.receipt.sourceSha256,/^[a-f0-9]{64}$/);
      assert.equal(r.receipt.downloadConfirmed,false);assert.equal(r.receipt.status,'source_read');assert(exports.buildTimesheetExportCsv(r.report,r.receipt).includes('来源读取SHA256'));
      const replay=read(c);assert.equal(replay.replayed,true);assert.equal(replay.report,null);assert.deepEqual(replay.receipt,r.receipt);
    }
    assert.equal(count(),'3');assert.equal(fingerprint(),before);
    pass('actual PostgreSQL SHA256, owner/self/manager fresh sources, immutable receipts, safe replay and unchanged attendance facts');
    for(const c of commands)assert.throws(()=>read({...c,query:{...c.query,fromDate:day(4)}}),/attendance_operation_conflict/);
    assert.throws(()=>read({...commands[0],siteId:'99990008'}),/attendance_settings_required/);
    const stale=cmd('manager');assert.throws(()=>read({...stale,query:{...stale.query,expectedScopeRevision:2}}),/attendance_version_conflict/);
    const zone=cmd();assert.throws(()=>read({...zone,query:{...zone.query,expectedTimeZone:'UTC'}}),/attendance_report_zone_changed/);
    assert.throws(()=>read({...cmd('manager'),query:{...cmd('manager').query,workerId:worker2}}),/attendance_access_denied/);
    assert.equal(count(),'3');pass('operation conflicts, cross-tenant, stale scope/timezone and unauthorized pairs create no receipt');
    for(const roleName of ['anon','authenticated'])assert.throws(()=>exec(`set role ${roleName};select ${call(cmd())};`),/permission denied/);
    for(const roleName of ['anon','authenticated','service_role'])for(const statement of ['select *','delete'])assert.throws(()=>exec(`set role ${roleName};${statement} from public.merchant_attendance_report_exports;`),/permission denied/);
    for(const statement of ["update public.merchant_attendance_report_exports set source_sha256=repeat('b',64)",'delete from public.merchant_attendance_report_exports','truncate public.merchant_attendance_report_exports'])assert.throws(()=>exec(statement),/append.only|immutable/i);
    const columns=exec(`select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_schema='${schema}' and table_name='merchant_attendance_report_exports';`);
    assert.equal(columns,'merchant_id,operation_id,actor_auth_user_id,actor_employee_id,access,query,worker_id,location_id,as_of,recorded_at,source_sha256,source_bytes,session_count');
    assert(!exec('select to_jsonb(t) from public.merchant_attendance_report_exports t limit 1;').includes('Synthetic worker'));
    pass('RPC service-only, no direct table access, append-only receipt and no stored CSV/name payload');
    exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';`);
    assert.throws(()=>read(commands[1]),/attendance_export_denied/);
    exec(`update public.merchant_enterprise_roles set permissions=permissions||array['attendance.self.export'] where id='${role}';
      begin;update public.merchant_attendance_workers set employee_id=null where id='${worker}';update public.merchant_attendance_workers set employee_id='${employee}' where id='${worker2}';commit;`);
    assert.throws(()=>read(commands[1]),/attendance_worker_changed/);
    exec(`begin;update public.merchant_attendance_workers set employee_id=null where id='${worker2}';update public.merchant_attendance_workers set employee_id='${employee}' where id='${worker}';commit;`);
    pass('replays reauthorize current export permission and cannot follow a rebound self profile');
    async function race(hold,pendingSql,check,beforeCommit){
      const holder=connect(),reader=connect();let pending;
      try{
        const pid=Number(await holder.step('select pg_backend_pid();'));const held=await holder.step(sql(hold));
        pending=reader.step(sql(pendingSql)).then(output=>({output}),error=>({error}));
        let blocked=false;const deadline=Date.now()+1800;
        while(Date.now()<deadline){blocked=query(`select count(*) from pg_stat_activity where application_name='${reader.name}' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';if(blocked)break;await new Promise(r=>setTimeout(r,15));}
        assert(blocked,'exact blocking PID');await beforeCommit?.();await holder.step('commit;');await check(await pending,held);
      }finally{await Promise.all([holder.close(),reader.close()]);if(pending)await pending;}
    }
    const concurrent=cmd();
    await race(`begin;set local role service_role;select ${call(concurrent)};`,`set role service_role;select ${call(concurrent)};`,(observed,held)=>{
      assert(!observed.error,String(observed.error));const a=exports.parseTimesheetExportSource(JSON.parse(held),concurrent),b=exports.parseTimesheetExportSource(JSON.parse(observed.output),concurrent);
      assert.equal(a.replayed,false);assert.equal(b.replayed,true);assert.equal(b.report,null);assert.deepEqual(a.receipt,b.receipt);
    });assert.equal(count(),'4');pass('concurrent same operation waits for exact unique-key owner and inserts one receipt, no duplicate contents');
    const expiry=exec(`update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()+interval '1.4 seconds' where id='${grant}' returning valid_until::text;`),expiring=cmd('manager');
    await race(`begin;set local role service_role;select ${call(expiring)};`,`set role service_role;select ${call(expiring)};`,observed=>assert.match(String(observed.error),/attendance_access_denied/),async()=>{
      const deadline=Date.now()+2200;while(exec(`select clock_timestamp()>='${expiry}'::timestamptz;`)!=='t'){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,20));}
    });assert.equal(count(),'5');
    exec(`update public.merchant_attendance_scope_grants set valid_until=null where id='${grant}';`);
    pass('grant expires while duplicate waits on exact unique-key PID; replay cannot deliver after expiry');
    const revoked=cmd('manager');
    await race(`begin;update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.records.view'] where id='${managerRole}';`,`set role service_role;select ${call(revoked)};`,observed=>assert.match(String(observed.error),/attendance_export_denied/));
    assert.equal(count(),'5');pass('export permission revocation serializes before waiting export and produces no receipt');
    exec(`update public.merchant_enterprise_roles set permissions=permissions||array['attendance.reports.export'] where id='${managerRole}';`);
    await race(`begin;update public.merchant_attendance_scopes set revision=2 where merchant_id='${site}';delete from public.merchant_attendance_scope_grants where merchant_id='${site}';`,`set role service_role;select ${call(cmd('manager'))};`,observed=>assert.match(String(observed.error),/attendance_access_denied/));
    assert.equal(count(),'5');pass('scope revocation before export hides sources and creates no export receipt');
    exec(`update public.merchants set user_id='${id(99)}' where id='${site}';`);assert.throws(()=>read(commands[0]),/attendance_access_denied/);
    pass('owner transfer prevents replay of earlier export receipt');
  });
  pass('owned test namespace removed; existing baseline restored');
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
