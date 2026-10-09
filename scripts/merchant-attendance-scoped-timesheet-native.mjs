import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import report from '../src/lib/merchantAttendanceScopedTimesheet.ts';
import ownerReport from '../src/lib/merchantAttendanceTimesheet.ts';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';

async function check(context){
  const {query,connect,pass,root}=context;
  await withAttendanceConcurrencySandbox(context,async({sql})=>{
    const exec=s=>query(sql(s)),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    for(const name of ['202609300087_merchant_attendance_period_report.sql','202610010088_merchant_attendance_scoped_period_report.sql'])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    const site='99990009',owner=id(91000),auth=id(91001),employee=id(91002),role=id(91003),worker=id(91004),location=id(91005),location2=id(91006),worker2=id(91007);
    const managerAuth=id(91010),manager=id(91011),managerRole=id(91012),otherAuth=id(91013),otherEmployee=id(91014),grant=id(91015),grant2=id(91016);
    const now=Date.now(),day=n=>new Date(now-n*86400000).toISOString().slice(0,10),at=(n,h)=>`${day(n)}T${h}:00.000000Z`;
    const json=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
    const self={siteId:site,access:'self',fromDate:day(8),throughDate:day(1),expectedWorkerId:worker};
    const managed={siteId:site,access:'manager',fromDate:day(8),throughDate:day(1),workerId:worker,locationId:location};
    const rpcQuery=q=>({access:q.access,fromDate:q.fromDate,throughDate:q.throughDate,workerId:q.access==='manager'?q.workerId:null,locationId:q.access==='manager'?q.locationId:null,expectedWorkerId:q.access==='self'?q.expectedWorkerId:null});
    const call=(q=self,who=auth)=>`public.faolla_attendance_scoped_period_report_v1('${q.siteId}','${who}',${json(rpcQuery(q))})`;
    const raw=(q=self,who=auth)=>JSON.parse(exec(`set role service_role;select ${call(q,who)};`));
    const read=(q=self,who=auth)=>report.parseAttendanceScopedTimesheetResult(raw(q,who),q);
    const events=[
      [1,'clock_in',at(6,'08:00'),location,employee],[2,'clock_out',at(6,'16:00'),location,employee],
      [3,'clock_in',at(5,'08:00'),location2,employee],[4,'clock_out',at(5,'16:00'),location2,employee],
      [5,'clock_in',at(4,'08:00'),location,otherEmployee],[6,'clock_out',at(4,'16:00'),location,otherEmployee],
      [7,'clock_in',at(3,'08:00'),location,employee],[8,'clock_out',at(3,'16:00'),location,otherEmployee],
      [9,'clock_in',at(2,'08:00'),location,employee],[10,'clock_out',at(2,'16:00'),location2,employee],
      [11,'clock_in',at(1,'08:00'),location,null],[12,'clock_out',at(1,'16:00'),location,null],
      [13,'clock_in',at(1,'18:00'),location,employee],[14,'break_start',at(1,'20:00'),location,employee],
    ];
    const baseRoles=`array['enterprise.view','attendance.self.view','attendance.self.request']`;
    exec(`begin;
      insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990008','${id(91999)}');
      insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','Europe/Madrid');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${location}','${site}','Synthetic location A','Europe/Madrid'),('${location2}','${site}','Synthetic location B','Europe/Madrid');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic self',${baseRoles}),('${managerRole}','${site}','Synthetic manager',array['enterprise.view','attendance.records.view']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
        ('${employee}','${site}','${auth}','scoped-a@example.test','Synthetic A','${role}','active'),
        ('${manager}','${site}','${managerAuth}','scoped-m@example.test','Synthetic manager','${managerRole}','active'),
        ('${otherEmployee}','${site}','${otherAuth}','scoped-b@example.test','Synthetic B','${role}','active');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id) values
        ('${worker}','${site}','${employee}','SCOPED-A','Synthetic A','${location2}'),('${worker2}','${site}',null,'SCOPED-B','Synthetic unbound B',null);
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
      insert into public.merchant_attendance_scopes(merchant_id,employee_id,revision) values('${site}','${manager}',1);
      insert into public.merchant_attendance_scope_grants(merchant_id,employee_id,id,valid_from) values('${site}','${manager}','${grant}','2000-01-01Z'),('${site}','${manager}','${grant2}','2000-01-01Z');
      insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${manager}','${grant}','${worker}'),('${site}','${manager}','${grant2}','${worker2}');
      insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id) values('${site}','${manager}','${grant}','${location}'),('${site}','${manager}','${grant2}','${location2}');
      ${events.map(([n,action,t,loc,actor])=>`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id,break_paid)
        values('${id(91100+n)}','${site}','${worker}','${loc}','${id(91200+n)}',${n},'${action}','web','${t}','Europe/Madrid',${actor?`'${actor}'`:'null'},${action==='break_start'?'true':'null'});`).join('\n')}
      commit;`);
    let r=read();assert.equal(r.totals.selected.workedUs,24*3600000000);assert.equal(r.openSessionCount,1);assert.equal(r.rows.length,4);
    assert.deepEqual(r.rows.map(row=>row.startEventId),[1,3,9,13].map(n=>id(91100+n)));
    assert.equal(r.rows.at(-1).selected.totals,null);assert.equal('employeeId' in r,false);
    pass('self derives current worker and omits legacy/other/mixed attribution without estimating open breaks');
    r=read(managed,managerAuth);assert.equal(r.totals.selected.workedUs,32*3600000000);assert.equal(r.rows.length,5);assert.equal(r.locationId,location);assert.equal(r.scopeRevision,1);
    assert.deepEqual(r.rows.map(row=>row.startEventId),[1,5,7,11,13].map(n=>id(91100+n)));
    const managedRaw=JSON.stringify(raw(managed,managerAuth));assert(!managedRaw.includes(id(91103)));assert(!managedRaw.includes(id(91109)));assert(!managedRaw.includes(location2));
    assert.equal(r.coverage,'authorized-complete-sessions-v1');assert.equal(read({...managed,workerId:worker2,locationId:location2},managerAuth).rows.length,0);
    pass('manager sees complete same-location segments only; default location/inactive/unbound status do not rewrite history');
    for(const target of [{...managed,locationId:location2},{...managed,workerId:worker2},{...managed,workerId:id(91888)},{...managed,siteId:'99990008'}])assert.throws(()=>read(target,managerAuth),/attendance_access_denied/);
    for(const who of [owner,otherAuth,id(91889)])assert.throws(()=>read(managed,who),/attendance_access_denied/);
    assert.throws(()=>read({...self,expectedWorkerId:worker2}),/attendance_worker_changed/);
    for(const publicRole of ['anon','authenticated'])assert.throws(()=>exec(`set role ${publicRole};select ${call()};`),/permission denied/);
    for(const patch of [{access:'owner'},{workerId:worker2},{locationId:location2},{expectedWorkerId:'garbage'},{actorEmployeeId:employee}])assert.throws(()=>exec(`set role service_role;select public.faolla_attendance_scoped_period_report_v1('${site}','${auth}',${json({...rpcQuery(self),...patch})});`),/attendance_invalid_request/);
    pass('same-grant pair/tenant/role/ACL and target-injection boundaries hold on actual PostgreSQL');

    const req=id(91301),op=id(91302),proposal={startAt:at(7,'08:00'),endAt:at(7,'17:00'),breaks:[]};
    exec(`begin;set local role service_role;
      select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json({action:'set_policy',operationId:id(91303),expectedRevision:0,expectedSettingsVersion:1,reason:'Synthetic scope policy',submissionWindowDays:365})},null,null,true);
      select public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:req,operationId:null})},${json({action:'submit',operationId:req,expectedRevision:0,expectedPolicyRevision:1,reason:'Synthetic shifted declaration',startEventId:id(91101),expectedLastEventId:id(91102),proposal})},true);commit;`);
    const evidence=JSON.parse(exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${req}',null,null,true);`));assert.equal(evidence.canApprove,true);
    exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${req}',${json({requestId:req,operationId:op,action:'approve',expectedRevision:1,expectedEvidence:evidence.evidenceToken,reason:'Synthetic scope approval'})},null,true);`);
    assert.equal(read().totals.selected.workedUs,25*3600000000);assert.equal(read(managed,managerAuth).totals.selected.workedUs,33*3600000000);
    for(const [q,who] of [[self,auth],[managed,managerAuth]]){
      const moved=read({...q,fromDate:day(7),throughDate:day(7)},who);assert.equal(moved.totals.original.workedUs,0);assert.equal(moved.totals.selected.workedUs,9*3600000000);assert.equal(moved.rows[0].correction.operationId,op);
      const out=read({...q,fromDate:day(6),throughDate:day(6)},who);assert.equal(out.totals.original.workedUs,8*3600000000);assert.equal(out.totals.selected.workedUs,0);
    }
    const oq={siteId:site,workerId:worker,fromDate:day(8),throughDate:day(1)};
    const ownerRaw=JSON.parse(exec(`set role service_role;select public.faolla_attendance_period_report_v1('${site}','${owner}',${json({workerId:worker,fromDate:oq.fromDate,throughDate:oq.throughDate})});`));
    assert.equal(ownerReport.parseAttendanceTimesheetResult(ownerRaw,oq).totals.selected.workedUs,49*3600000000);
    pass('real approved moved-in/out effect replaces authorized original once, while established owner reader is unchanged');

    const hiddenReq=id(91310),hiddenProposal={startAt:at(6,'18:00'),endAt:at(6,'21:00'),breaks:[]};
    exec(`set role service_role;select public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:hiddenReq,operationId:null})},${json({action:'submit',operationId:hiddenReq,expectedRevision:0,expectedPolicyRevision:1,reason:'Synthetic other-location declaration',startEventId:id(91103),expectedLastEventId:id(91104),proposal:hiddenProposal})},true);`);
    const hiddenEvidence=JSON.parse(exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${hiddenReq}',null,null,true);`));assert.equal(hiddenEvidence.canApprove,true);
    exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${hiddenReq}',${json({requestId:hiddenReq,operationId:id(91311),action:'approve',expectedRevision:1,expectedEvidence:hiddenEvidence.evidenceToken,reason:'Synthetic outside-location approval'})},null,true);`);
    assert.equal(read({...self,fromDate:day(6),throughDate:day(6)}).totals.selected.workedUs,3*3600000000);
    const hiddenQuery={...managed,fromDate:day(6),throughDate:day(6)},hiddenManager=raw(hiddenQuery,managerAuth);
    assert.equal(hiddenManager.items.length,1);assert(!JSON.stringify(hiddenManager).includes(hiddenReq));assert.equal(report.parseAttendanceScopedTimesheetResult(hiddenManager,hiddenQuery).totals.selected.workedUs,0);
    pass('moved-in effect from another location is visible to its employee but never leaks to manager pair');

    const state=()=>exec(`select jsonb_build_object(${['events','correction_decisions','correction_effects','settings','workers','scopes','scope_grants','scope_workers','scope_locations'].map(name=>`'${name}',(select md5(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text) from public.merchant_attendance_${name} t)`).join(',')},'employees',(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.merchant_enterprise_employees t),'roles',(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.merchant_enterprise_roles t));`);
    const before=state();read();read(managed,managerAuth);assert.equal(state(),before);pass('read-only report leaves facts, decisions, bindings, roles and grants unchanged');
    exec(`update public.merchant_attendance_workers set employee_id='${otherEmployee}' where id='${worker}';`);
    assert.throws(()=>read(),/attendance_access_denied/);r=read(self,otherAuth);assert.equal(r.rows.length,1);assert.equal(r.rows[0].startEventId,id(91105));
    exec(`begin;update public.merchant_attendance_workers set employee_id=null where id='${worker}';update public.merchant_attendance_workers set employee_id='${employee}' where id='${worker2}';commit;`);
    assert.throws(()=>read(),/attendance_worker_changed/);assert.equal(read({...self,expectedWorkerId:null}).rows.length,0);
    exec(`begin;update public.merchant_attendance_workers set employee_id=null where id='${worker2}';update public.merchant_attendance_workers set employee_id='${employee}' where id='${worker}';commit;`);
    pass('rebinding cannot expose predecessor records; expected worker detects profile switch');
    for(const change of ["valid_until=clock_timestamp()-interval '1 second'","valid_from=clock_timestamp()+interval '1 day'"]){exec(`update public.merchant_attendance_scope_grants set ${change} where id='${grant}';`);assert.throws(()=>read(managed,managerAuth),/attendance_access_denied/);exec(`update public.merchant_attendance_scope_grants set valid_from='2000-01-01Z',valid_until=null where id='${grant}';`);}
    for(const table of ['merchant_enterprise_roles','merchant_enterprise_employees']){
      const target=table.endsWith('roles')?role:employee,disabled=table.endsWith('roles')?'archived':'disabled';exec(`update public.${table} set status='${disabled}' where id='${target}';`);assert.throws(()=>read(),/attendance_access_denied/);exec(`update public.${table} set status='active' where id='${target}';`);
    }
    pass('expired/future grants and disabled membership/role are rechecked on every report');

    async function race(name,hold,waitingSql,afterRelease){
      const holder=connect(),reader=connect();let pending;
      try{
        const pid=Number(await holder.step('select pg_backend_pid();'));await holder.step(sql(hold));
        pending=reader.step(sql(waitingSql)).then(output=>({output}),error=>({error}));
        let blocked=false;const deadline=Date.now()+1800;
        while(Date.now()<deadline){blocked=query(`select count(*) from pg_stat_activity where application_name='${reader.name}' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';if(blocked)break;await new Promise(r=>setTimeout(r,15));}
        assert.ok(blocked,`${name}: expected exact blocking PID`);await afterRelease?.beforeCommit?.();await holder.step('commit;');const observed=await pending;await afterRelease?.check?.(observed);pass(name);
      }finally{await Promise.all([holder.close(),reader.close()]);if(pending)await pending;}
    }
    const scopeCommand=(action,operationId,expectedRevision)=>({action,operationId,expectedRevision,grantId:grant,grant:action==='put'?{workerIds:[worker],locationIds:[location],validFrom:'2000-01-01T00:00:00.000Z',validUntil:null}:null});
    const scopeRpc=command=>`public.faolla_attendance_scopes_v1('${site}','${owner}','${manager}',${json(command)},null)`;
    await race('real scope-revoke transaction blocks report; committed revocation denies the waiting read',
      `begin;set local role service_role;select ${scopeRpc(scopeCommand('remove',id(91400),1))};`,`set role service_role;select ${call(managed,managerAuth)};`,{check:o=>assert.match(String(o.error),/attendance_access_denied/)});
    exec(`set role service_role;select ${scopeRpc(scopeCommand('put',id(91401),2))};`);
    await race('role revocation before report is serialized and cannot leak a pre-revocation result',
      `begin;update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${managerRole}';`,`set role service_role;select ${call(managed,managerAuth)};`,{check:o=>assert.match(String(o.error),/attendance_access_denied/)});
    exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.records.view'] where id='${managerRole}';`);
    await race('self rebind before read is serialized and blocks old employee access',
      `begin;update public.merchant_attendance_workers set employee_id='${otherEmployee}' where id='${worker}';`,`set role service_role;select ${call()};`,{check:o=>assert.match(String(o.error),/attendance_access_denied/)});
    exec(`update public.merchant_attendance_workers set employee_id='${employee}' where id='${worker}';`);
    // Capture expiry from DB; wait only until that concrete deadline, not a blind
    // timing assertion. The reader must first be observed waiting on the worker.
    const expiry=Date.parse(exec(`update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()+interval '1500 milliseconds' where id='${grant}' returning to_char(valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');`));
    await race('grant expiry during a blocked worker read is not extended by waiting',
      `begin;select id from public.merchant_attendance_workers where id='${worker}' for update;`,`set role service_role;select ${call(managed,managerAuth)};`,{beforeCommit:()=>new Promise(r=>setTimeout(r,Math.max(0,expiry-Date.now()+50))),check:o=>assert.match(String(o.error),/attendance_access_denied/)});
    exec(`update public.merchant_attendance_scope_grants set valid_until=null where id='${grant}';`);
    await race('read-first holds scope through its snapshot; revoke waits, and the next read is denied',
      `begin;set local role service_role;select ${call(managed,managerAuth)};`,`set role service_role;select ${scopeRpc(scopeCommand('remove',id(91402),3))};`,{check:o=>assert.ok(!o.error,String(o.error))});
    assert.throws(()=>read(managed,managerAuth),/attendance_access_denied/);
    pass('post-race reads do not reuse an earlier successful authorization');

    const bulkWorker=id(91500),bulkEmployee=id(91501),bulkAuth=id(91502),bulkGrant=id(91503);
    exec(`begin;insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${bulkEmployee}','${site}','${bulkAuth}','scoped-bulk@example.test','Synthetic bounded candidate','${role}','active');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name) values('${bulkWorker}','${site}','${bulkEmployee}','SCOPED-LIMIT','Synthetic bounded candidate');
      insert into public.merchant_attendance_scope_grants(merchant_id,employee_id,id,valid_from) values('${site}','${manager}','${bulkGrant}','2000-01-01Z');
      insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${manager}','${bulkGrant}','${bulkWorker}');
      insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id) values('${site}','${manager}','${bulkGrant}','${location}');commit;`);
    const bulk=(from,to,loc,actor)=>sql(`insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id)
      select '${site}','${bulkWorker}','${loc}',gen_random_uuid(),n,case when n%2=1 then 'clock_in' else 'clock_out' end,'web','${at(1,'00:00')}'::timestamptz+n*interval '1 second','Europe/Madrid','${actor}' from generate_series(${from},${to}) n;`);
    await context.querySteps(['begin;',...Array.from({length:4},(_,n)=>bulk(1+n*64,Math.min(204,(n+1)*64),location2,otherEmployee)),bulk(205,206,location,bulkEmployee),'commit;']);
    const bulkSelf={...self,expectedWorkerId:bulkWorker,fromDate:day(1),throughDate:day(1)},bulkManager={...managed,workerId:bulkWorker,fromDate:day(1),throughDate:day(1)};
    assert.equal(read(bulkSelf,bulkAuth).rows.length,1);assert.equal(read(bulkManager,managerAuth).rows.length,1);
    pass('102 unauthorized starts do not consume candidate limit or prevent one authorized session');
    await context.querySteps(['begin;',...Array.from({length:4},(_,n)=>bulk(207+n*64,Math.min(404,270+n*64),location,bulkEmployee)),'commit;']);
    assert.equal(read(bulkSelf,bulkAuth).rows.length,100);assert.equal(read(bulkManager,managerAuth).rows.length,100);
    exec(bulk(405,406,location,bulkEmployee));
    assert.throws(()=>read(bulkSelf,bulkAuth),/attendance_report_too_large/);assert.throws(()=>read(bulkManager,managerAuth),/attendance_report_too_large/);
    pass('scoped 100-start ceiling succeeds and 101 refuses rather than silently truncating totals');
  });
  pass('only this run-owned schema removed; existing public baseline restored');
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
