import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import parser from '../src/lib/merchantAttendanceScopedTimesheetContext.ts';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
async function check(context){
  const {query,connect,pass,root}=context;
  await withAttendanceConcurrencySandbox(context,async({sql})=>{
    const exec=s=>query(sql(s)),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    exec(readFileSync(path.join(root,'scripts/supabase-migrations/202610010089_merchant_attendance_scoped_report_context.sql'),'utf8'));
    const site='99990009',owner=id(1),auth=id(2),employee=id(3),role=id(4),managerAuth=id(5),manager=id(6),managerRole=id(7),loc=id(8),loc2=id(9),grant=id(10),grant2=id(11),overlap=id(12);
    exec(`begin;
      insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990008','${owner}');
      insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','Europe/Madrid');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${loc}','${site}','Synthetic A','Europe/Madrid'),('${loc2}','${site}','Synthetic B','UTC');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Self',array['enterprise.view','attendance.self.view']),('${managerRole}','${site}','Manager',array['enterprise.view','attendance.records.view']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
        ('${employee}','${site}','${auth}','self@example.test','Self','${role}','active'),('${manager}','${site}','${managerAuth}','manager@example.test','Manager','${managerRole}','active');
      ${Array.from({length:28},(_,n)=>`insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active) values('${id(100+n)}','${site}',${n===0?"'"+employee+"'":"null"},'W-${n}','Synthetic worker ${n}',false);`).join('\n')}
      insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name) values('${id(900)}','${site}','HIDDEN','Private ungranted');
      insert into public.merchant_attendance_scopes(merchant_id,employee_id,revision) values('${site}','${manager}',1);
      insert into public.merchant_attendance_scope_grants(merchant_id,employee_id,id,valid_from) values('${site}','${manager}','${grant}','2000-01-01Z'),('${site}','${manager}','${grant2}','2000-01-01Z'),('${site}','${manager}','${overlap}','2000-01-01Z');
      ${Array.from({length:27},(_,n)=>`insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${manager}','${grant}','${id(100+n)}');`).join('\n')}
      insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${manager}','${grant2}','${id(127)}'),('${site}','${manager}','${overlap}','${id(100)}');
      insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id) values('${site}','${manager}','${grant}','${loc}'),('${site}','${manager}','${grant2}','${loc2}'),('${site}','${manager}','${overlap}','${loc}');
      commit;`);
    const self={siteId:site,access:'self',search:'',cursor:null,scopeRevision:null},managed={...self,access:'manager'};
    const call=(q=managed,who=managerAuth)=>`public.faolla_attendance_scoped_report_context_v1('${q.siteId}','${who}','${JSON.stringify({access:q.access,search:q.search,cursor:q.cursor,scopeRevision:q.scopeRevision}).replaceAll("'","''")}'::jsonb)`;
    const read=(q=managed,who=managerAuth)=>parser.parseScopedContext(JSON.parse(exec(`set role service_role;select ${call(q,who)};`)),q);
    const mine=read(self,auth);assert.equal(mine.worker.id,id(100));assert.equal(mine.items.length,0);assert.equal(mine.timeZone,'Europe/Madrid');assert.equal(mine.accessValidUntil,null);
    pass('self context reveals only server-derived own inactive profile and merchant timezone');
    const first=read();assert.equal(first.items.length,25);assert(first.nextCursor);assert.equal(first.items[0].workerId,id(100));
    const second=read({...managed,cursor:first.nextCursor,scopeRevision:first.scopeRevision});assert.equal(second.items.length,3);assert.equal(second.nextCursor,null);
    const all=[...first.items,...second.items];assert.equal(new Set(all.map(parser.scopedPairKey)).size,28);
    assert(all.every(p=>p.workerId===id(127)?p.locationId===loc2:p.locationId===loc));assert(!JSON.stringify(all).includes('employeeId'));
    assert.equal(read({...managed,search:'HIDDEN'}).items.length,0);assert.equal(read({...managed,search:'Synthetic B'}).items.length,1);
    pass('25+1 keyset paging, duplicate grants, same-grant pairs, inactive labels and private-name exclusion');
    for(const who of [auth,owner,id(999)])assert.throws(()=>read(managed,who),/attendance_access_denied/);
    assert.throws(()=>read({...managed,siteId:'99990008'}),/attendance_access_denied/);
    for(const publicRole of ['anon','authenticated'])assert.throws(()=>exec(`set role ${publicRole};select ${call()};`),/permission denied/);
    for(const patch of [{workerId:id(900)},{authUserId:owner},{search:'\nsecret'}])assert.throws(()=>exec(`set role service_role;select public.faolla_attendance_scoped_report_context_v1('${site}','${managerAuth}','${JSON.stringify({access:'manager',search:'',cursor:null,scopeRevision:null,...patch})}'::jsonb);`),/attendance_invalid_request/);
    exec(`update public.merchant_attendance_scopes set revision=2 where merchant_id='${site}';`);
    assert.throws(()=>read({...managed,cursor:first.nextCursor,scopeRevision:1}),/attendance_version_conflict/);
    assert.equal(read().scopeRevision,2);
    pass('service ACL, tenant, caller role, strict input and stale scope cursor rejected');
    exec(`update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()-interval '1 second' where id='${grant2}';`);
    assert.equal(read({...managed,search:'Synthetic B'}).items.length,0);
    exec(`update public.merchant_attendance_scope_grants set valid_until=null,valid_from=clock_timestamp()+interval '1 hour' where id='${grant2}';`);
    assert.equal(read({...managed,search:'Synthetic B'}).items.length,0);
    exec(`update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()+interval '1 hour',valid_from='2000-01-01Z' where id='${grant2}';`);
    assert(read().accessValidUntil);
    pass('future and expired grants excluded and finite selector deadline is returned');
    const holder=connect(),reader=connect();let pending;
    try{
      const pid=Number(await holder.step('select pg_backend_pid();'));await holder.step(sql(`begin;update public.merchant_attendance_scopes set revision=3 where merchant_id='${site}';delete from public.merchant_attendance_scope_grants where merchant_id='${site}';`));
      pending=reader.step(sql(`set role service_role;select ${call()};`)).then(output=>({output}),error=>({error}));
      let blocked=false;const deadline=Date.now()+1800;
      while(Date.now()<deadline){blocked=query(`select count(*) from pg_stat_activity where application_name='${reader.name}' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';if(blocked)break;await new Promise(r=>setTimeout(r,15));}
      assert(blocked);await holder.step('commit;');const observed=await pending;assert(!observed.error,String(observed.error));
      const result=parser.parseScopedContext(JSON.parse(observed.output),managed);assert.equal(result.scopeRevision,3);assert.equal(result.items.length,0);
    }finally{await Promise.all([holder.close(),reader.close()]);if(pending)await pending;}
    pass('selector waits for exact scope writer PID and cannot publish names after committed revoke');
    exec(`update public.merchant_enterprise_employees set status='disabled' where id='${employee}';`);
    assert.throws(()=>read(self,auth),/attendance_access_denied/);
    const count=()=>exec(`select (select count(*) from public.merchant_attendance_events)::text||':'||(select count(*) from public.merchant_attendance_scope_grants)::text;`);
    const before=count();read();assert.equal(count(),before);
    pass('disabled self denied and context never creates attendance events or grants');
  });
  pass('owned schema removed and pre-existing public baseline restored');
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
