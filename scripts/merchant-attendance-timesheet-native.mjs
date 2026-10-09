import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import report from '../src/lib/merchantAttendanceTimesheet.ts';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';

async function check(context){
  const {query,connect,pass,root}=context;
  await withAttendanceConcurrencySandbox(context,async({sql})=>{
    const exec=s=>query(sql(s)),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    exec(readFileSync(path.join(root,'scripts/supabase-migrations/202609300087_merchant_attendance_period_report.sql'),'utf8'));
    const site='99990009',owner=id(81000),auth=id(81001),employee=id(81002),role=id(81003),worker=id(81004),location=id(81005),other=id(81006);
    const now=Date.now(),day=n=>new Date(now-n*86400000).toISOString().slice(0,10),at=(n,h)=>`${day(n)}T${h}:00.000000Z`;
    const json=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
    const proposal={startAt:at(5,'08:00'),endAt:at(5,'17:00'),breaks:[{startAt:at(5,'12:00'),endAt:at(5,'12:30'),paid:true}]};
    const req=id(81030),op=id(81040),pending=id(81031);
    const self=(request,command)=>`public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:request,operationId:null})},${json(command)},true)`;
    const decide=(command=null)=>`public.faolla_attendance_correction_decide_v1('${site}','${owner}','${req}',${command?json(command):'null'},null,true)`;
    const reportQuery=(from=day(7),through=day(1),target=worker)=>({siteId:site,workerId:target,fromDate:from,throughDate:through});
    const call=(q=reportQuery(),who=owner)=>`public.faolla_attendance_period_report_v1('${q.siteId}','${who}',${json({workerId:q.workerId,fromDate:q.fromDate,throughDate:q.throughDate})})`;
    const read=(q=reportQuery(),who=owner)=>{const raw=JSON.parse(exec(`set role service_role;select ${call(q,who)};`));return report.parseAttendanceTimesheetResult(raw,q);};
    const rawHash=()=>exec(`select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.merchant_attendance_events e;`);
    exec(`begin;
      insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990008','${other}');
      insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','Europe/Madrid');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${location}','${site}','Synthetic timesheet','Europe/Madrid');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic timesheet',array['enterprise.view','attendance.self.view','attendance.self.request']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
        values('${employee}','${site}','${auth}','timesheet@example.test','Synthetic timesheet','${role}','active');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id)
        values('${worker}','${site}','${employee}','SHEET','Synthetic timesheet','${location}');
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
      ${[[1,'clock_in',at(6,'08:00')],[2,'clock_out',at(6,'16:00')],[3,'clock_in',at(3,'08:00')],[4,'clock_out',at(3,'16:00')],[5,'clock_in',at(2,'08:00')]].map(([n,action,t])=>`
        insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id)
        values('${id(81100+n)}','${site}','${worker}','${location}','${id(81200+n)}',${n},'${action}','web','${t}','Europe/Madrid','${employee}');`).join('\n')}
      set local role service_role;
      select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json({action:'set_policy',operationId:id(81050),expectedRevision:0,expectedSettingsVersion:1,reason:'Synthetic policy',submissionWindowDays:365})},null,null,true);
      select ${self(req,{action:'submit',operationId:req,expectedRevision:0,expectedPolicyRevision:1,reason:'Move synthetic shift',startEventId:id(81103),expectedLastEventId:id(81104),proposal})};
      select ${self(pending,{action:'submit',operationId:pending,expectedRevision:0,expectedPolicyRevision:1,reason:'Unapproved synthetic shift',startEventId:id(81101),expectedLastEventId:id(81102),proposal:{startAt:at(6,'08:00'),endAt:at(6,'20:00'),breaks:[]}})};
      commit;`);
    const hash=rawHash(),before=read();assert.equal(before.totals.original.workedUs,16*3600000000);assert.deepEqual(before.totals.selected,before.totals.original);
    assert.equal(before.openSessionCount,1);assert.equal(before.rows.length,3);assert.equal(before.rows.at(-1).selected.totals,null);
    assert.equal(read(reportQuery(day(10),day(9))).rows.length,0);
    pass('real SQL returns raw-only totals for pending requests, no estimated open shift and empty ranges');

    // Actual decision transaction held open while report waits for the SAME PID.
    const initial=JSON.parse(exec(`set role service_role;select ${decide()};`));assert.equal(initial.canApprove,true);
    const command={requestId:req,operationId:op,action:'approve',expectedRevision:1,expectedEvidence:initial.evidenceToken,reason:'Synthetic report approval'};
    const holder=connect(),reader=connect();let waiting;
    try{
      const pid=Number(await holder.step('select pg_backend_pid();'));
      await holder.step(sql(`begin;set local role service_role;select ${decide(command)};`));
      waiting=reader.step(sql(`set role service_role;select ${call()};`)).then(output=>({output}),error=>({error}));
      let locked=false;const deadline=Date.now()+2000;
      while(Date.now()<deadline){locked=query(`select count(*) from pg_stat_activity where application_name='${reader.name}' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';if(locked)break;await new Promise(r=>setTimeout(r,15));}
      assert.ok(locked,'timesheet exact approval blocker not observed');await holder.step('commit;');
      const observed=await waiting;assert.ok(!observed.error,String(observed.error));
      const parsed=report.parseAttendanceTimesheetResult(JSON.parse(observed.output),reportQuery());assert.equal(parsed.totals.selected.workedUs,16.5*3600000000);assert.equal(parsed.rows[1].correction.operationId,op);
    }finally{await Promise.all([holder.close(),reader.close()]);if(waiting)await waiting;}
    pass('real two-connection approval/report serialization sees complete newly committed effect, not a partial snapshot');
    const movedIn=read(reportQuery(day(5),day(5))),movedOut=read(reportQuery(day(3),day(3)));
    assert.equal(movedIn.rows.length,1);assert.equal(movedIn.rows[0].startEventId,id(81103));assert.equal(movedIn.totals.original.workedUs,0);
    assert.equal(movedIn.totals.selected.workedUs,8.5*3600000000);assert.equal(movedIn.totals.selected.paidBreakUs,.5*3600000000);
    assert.equal(movedOut.totals.original.workedUs,8*3600000000);assert.equal(movedOut.totals.selected.workedUs,0);
    assert.equal(rawHash(),hash);pass('moved-in approval found despite a different preceding raw shift; moved-out original replaced without double counting');

    for(const principal of [auth,other])assert.throws(()=>read(reportQuery(),principal),/attendance_access_denied/);
    assert.throws(()=>read({...reportQuery(),siteId:'99990008'}),/attendance_access_denied/);
    assert.throws(()=>read(reportQuery(day(7),day(1),id(81999))),/attendance_worker_not_found/);
    for(const roleName of ['anon','authenticated'])assert.throws(()=>exec(`set role ${roleName};select ${call()};`),/permission denied/);
    for(const patch of [{access:'owner'},{authUserId:owner},{asOf:'2026-01-01'}])assert.throws(()=>exec(`set role service_role;select public.faolla_attendance_period_report_v1('${site}','${owner}',${json({...reportQuery(),siteId:undefined,...patch})});`),/attendance_invalid_request/);
    assert.throws(()=>read(reportQuery(day(35),day(1))),/attendance_invalid_request/);
    exec(`update public.merchants set user_id='${other}' where id='${site}';`);assert.throws(()=>read(),/attendance_access_denied/);
    assert.equal(read(reportQuery(),other).totals.selected.workedUs,16.5*3600000000);
    exec(`update public.merchants set user_id='${owner}' where id='${site}';`);
    pass('current owner rechecked after transfer; employee/other merchant/public roles cannot read or inject scope');

    // Independent raw workers cover unusual calendars without fabricated auth bindings.
    for(const [n,zone,date,start,end,hours] of [[1,'Europe/Madrid','2026-03-29','2026-03-28T23:00:00Z','2026-03-29T22:00:00Z',23],
      [2,'Europe/Madrid','2025-10-26','2025-10-25T22:00:00Z','2025-10-26T23:00:00Z',25]]){
      const target=id(82000+n);exec(`insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name) values('${target}','${site}','DST${n}','Synthetic DST');
        insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone) values
        ('${id(82100+n)}','${site}','${target}','${location}','${id(82200+n)}',1,'clock_in','web','${start}','${zone}'),
        ('${id(82300+n)}','${site}','${target}','${location}','${id(82400+n)}',2,'clock_out','web','${end}','${zone}');`);
      const r=read(reportQuery(date,date,target));assert.equal(r.employeeId,null);assert.equal(r.totals.selected.workedUs,hours*3600000000);
    }
    pass('SQL boundaries and TS projection agree on 23/25-hour Madrid days; unbound inactive history remains readable by owner');
    const micro=id(82500);exec(`insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name) values('${micro}','${site}','MICRO','Synthetic microseconds');
      insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone) values
      ('${id(82501)}','${site}','${micro}','${location}','${id(82511)}',1,'clock_in','web','2026-03-29T21:59:59.999999Z','Europe/Madrid'),
      ('${id(82502)}','${site}','${micro}','${location}','${id(82512)}',2,'clock_out','web','2026-03-29T22:00:00.000001Z','Europe/Madrid');`);
    assert.equal(read(reportQuery('2026-03-29','2026-03-29',micro)).totals.selected.workedUs,1);
    assert.equal(read(reportQuery('2026-03-30','2026-03-30',micro)).totals.selected.workedUs,1);
    pass('native PostgreSQL microseconds survive half-open midnight clipping on both adjacent dates');
    const busy=id(82600);exec(`insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name) values('${busy}','${site}','BUSY','Synthetic bound');
      insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone)
      select '${site}','${busy}','${location}',gen_random_uuid(),n,case when n%2=1 then 'clock_in' else 'clock_out' end,'web',
      '${at(1,'08:00')}'::timestamptz+n*interval '1 second','Europe/Madrid' from generate_series(1,200) n;`);
    assert.equal(read(reportQuery(day(1),day(1),busy)).rows.length,100);
    exec(`insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone)
      select '${site}','${busy}','${location}',gen_random_uuid(),n,case when n%2=1 then 'clock_in' else 'clock_out' end,'web',
      '${at(1,'08:00')}'::timestamptz+n*interval '1 second','Europe/Madrid' from generate_series(201,202) n;`);
    assert.throws(()=>read(reportQuery(day(1),day(1),busy)),/attendance_report_too_large/);
    pass('100 candidate boundary succeeds; 101 fails explicitly instead of returning partial totals');
    // Keep every real CHECK constraint and the 10s SQL deadline. Large fixture
    // setup is chunked in one transaction, not sped up by bypassing validation.
    const many=id(82700);
    await context.querySteps([sql(`begin;insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name) values('${many}','${site}','MANY','Synthetic event bound');`),
      ...Array.from({length:63},(_,n)=>sql(`insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,break_paid)
        select '${site}','${many}','${location}',gen_random_uuid(),n,case when n%2002=1 then 'clock_in' when n%2002=0 then 'clock_out' when n%2=0 then 'break_start' else 'break_end' end,'web',
        '${at(1,'08:00')}'::timestamptz+n*interval '1 millisecond','Europe/Madrid',case when n%2002<>0 and n%2=0 then false else null end from generate_series(${n*64+1},${Math.min(4004,(n+1)*64)}) n;`)),
      'commit;']);
    assert.throws(()=>read(reportQuery(day(1),day(1),many)),/attendance_report_too_large/);
    pass('combined 4000-event ceiling rejects excess even when individual shifts fit');
    const state=()=>exec(`select jsonb_build_object(${['events','correction_decisions','correction_effects','settings','workers'].map(name=>`'${name}',(select md5(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text) from public.merchant_attendance_${name} t)`).join(',')},
      'roles',(select md5(jsonb_agg(to_jsonb(r) order by id)::text) from public.merchant_enterprise_roles r));`);
    const finalState=state();read();assert.equal(state(),finalState);pass('read RPC does not change raw data, decisions, permissions or capture configuration');
  });
  pass('all run-owned synthetic data and migration removed, original public baseline restored');
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(error=>{console.error(error);process.exitCode=1;});
