import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import revision from '../src/lib/merchantAttendanceRevision.ts';
import reports from '../src/lib/merchantAttendanceTimesheet.ts';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
async function check(context){
  const {query,connect,root,pass}=context;
  await withAttendanceConcurrencySandbox(context,async({sql})=>{
    const exec=s=>query(sql(s)),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
    for(const name of ['202609300087_merchant_attendance_period_report.sql','202610010091_merchant_attendance_revision_requests.sql'])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    const site='99990009',owner=id(1),auth=id(2),employee=id(3),role=id(4),worker=id(5),loc=id(6),oldRequest=id(7),oldOperation=id(8),other=id(9),otherAuth=id(10);
    const day=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10),at=(n,h)=>day(n)+'T'+h+':00.000000Z';
    const approved={startAt:at(4,'08:00'),endAt:at(4,'17:00'),breaks:[]},proposed={startAt:at(2,'08:00'),endAt:at(2,'15:00'),breaks:[]};
    exec(`begin;
      insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990008','${owner}');
      insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','Europe/Madrid');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${loc}','${site}','Synthetic location','Europe/Madrid');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Self',array['enterprise.view','attendance.self.view','attendance.self.request']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${employee}','${site}','${auth}','revision@example.test','Synthetic self','${role}','active'),('${other}','${site}','${otherAuth}','revision-other@example.test','Other self','${role}','active');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name) values('${worker}','${site}','${employee}','REVISION','Synthetic worker');
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
      insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
        ('${id(101)}','${site}','${worker}','${loc}','${id(201)}',1,'clock_in','web','${at(3,'08:00')}','Europe/Madrid','${employee}'),
        ('${id(102)}','${site}','${worker}','${loc}','${id(202)}',2,'clock_out','web','${at(3,'16:00')}','Europe/Madrid','${employee}');commit;`);
    const controls=(command)=>JSON.parse(exec(`set role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(command)},null,null,true);`));
    let controlsRevision=0,policyRevision=1,nonce=300;
    const control=(action,fields)=>{const op=id(nonce++);controls({action,operationId:op,expectedRevision:controlsRevision,expectedSettingsVersion:1,reason:'Synthetic revision rules',...fields});controlsRevision++;return op;};
    control('set_policy',{submissionWindowDays:365});
    exec(`set role service_role;select public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:oldRequest,operationId:null})},${json({action:'submit',operationId:oldRequest,expectedRevision:0,expectedPolicyRevision:1,reason:'Initial synthetic declaration',startEventId:id(101),expectedLastEventId:id(102),proposal:approved})},true);`);
    const oldEvidence=JSON.parse(exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${oldRequest}',null,null,true);`));assert.equal(oldEvidence.canApprove,true);
    exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${oldRequest}',${json({action:'approve',operationId:oldOperation,requestId:oldRequest,expectedRevision:1,expectedEvidence:oldEvidence.evidenceToken,reason:'Initial synthetic approval'})},null,true);`);
    const prepare={siteId:site,mode:'prepare',expectedWorkerId:worker,baseRequestId:oldRequest,requestId:null,operationId:null};
    const detail=(requestId,operationId=null)=>({...prepare,mode:'detail',requestId,operationId});
    const submit=(expectedRevision)=>({action:'submit',operationId:id(nonce++),expectedRevision,expectedBaseOperationId:oldOperation,expectedPolicyRevision:policyRevision,reason:'Request another review',proposal:proposed});
    const call=(q=prepare,c=null,who=auth,enabled=true)=>`public.faolla_attendance_revision_self_v1('${q.siteId}','${who}',${json({mode:q.mode,expectedWorkerId:q.expectedWorkerId,baseRequestId:q.baseRequestId,requestId:q.requestId,operationId:q.operationId})},${c?json(c):'null'},${enabled})`;
    const read=(q=prepare,c=null,who=auth,enabled=true)=>revision.parseAttendanceRevisionResult(JSON.parse(exec(`set role service_role;select ${call(q,c,who,enabled)};`)),{...q,operationId:c?.operationId??q.operationId});
    const send=(c,enabled=true)=>read(detail(c.action==='submit'?c.operationId:c.requestId),c,auth,enabled);
    const fingerprint=()=>exec(`select jsonb_build_object(${['events','correction_entries','correction_decisions','correction_effects','correction_rule_bindings'].map(t=>`'${t}',(select md5(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text) from public.merchant_attendance_${t} t)`).join(',')});`);
    const untouched=fingerprint();let r=read();assert.equal(r.base.workedUs,9*3600000000);assert.equal(r.canSubmit,true);assert.equal(r.revision,0);assert.equal(r.approvalAvailable,false);assert.equal(r.effectiveChanged,false);
    pass('real initial approval and fresh revision preparation retain original basis and nine-hour effective declaration');
    for(const who of [owner,otherAuth,id(99)])assert.throws(()=>read(prepare,null,who),/attendance_access_denied/);
    assert.throws(()=>read({...prepare,expectedWorkerId:id(99)}),/attendance_worker_changed/);
    assert.throws(()=>read({...prepare,baseRequestId:id(99)}),/attendance_revision_base_not_found/);
    assert.throws(()=>read({...prepare,siteId:'99990008'}),/attendance_settings_required/);
    for(const roleName of ['anon','authenticated'])assert.throws(()=>exec(`set role ${roleName};select ${call()};`),/permission denied/);
    pass('tenant, current employee binding, base ownership and public RPC ACL enforced');
    const noChange={...submit(0),proposal:approved};assert.throws(()=>send(noChange),/attendance_revision_unchanged/);
    for(const operationId of [oldRequest,oldOperation])assert.throws(()=>send({...submit(0),operationId}),/attendance_operation_conflict/);
    assert.throws(()=>send({...submit(0),expectedBaseOperationId:id(99)}),/attendance_revision_base_changed/);
    assert.throws(()=>send({...submit(0),expectedPolicyRevision:2}),/attendance_correction_policy_changed/);
    assert.throws(()=>send(submit(0),false),/attendance_platform_paused/);
    const first=submit(0);r=send(first);assert.equal(r.item.proposal.endAt,proposed.endAt);assert.equal(r.revision,1);assert.equal(r.canSubmit,false);assert.equal(r.canWithdraw,true);assert.deepEqual(r.receipt.command,first);
    assert.throws(()=>exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${first.operationId}',null,null,true);`),/attendance_correction_not_found/);
    assert.deepEqual(send(first).receipt,r.receipt);assert.deepEqual(read(detail(first.operationId,first.operationId)).receipt,r.receipt);
    assert.throws(()=>send({...first,reason:'Different content'}),/attendance_operation_conflict/);assert.throws(()=>send(submit(1)),/attendance_correction_pending/);
    pass('same-value/stale base/policy/paused submissions rejected; one active request and exact original-operation recovery');
    exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';`);
    assert.deepEqual(send(first,false).receipt,r.receipt);
    const withdraw={action:'withdraw',operationId:id(nonce++),requestId:first.operationId,expectedRevision:1,reason:'Withdraw new request only'};
    r=send(withdraw,false);assert.equal(r.item.status,'withdrawn');assert.equal(r.revision,2);assert.equal(r.canSubmit,false);assert.equal(r.canWithdraw,false);assert.deepEqual(send(withdraw,false).receipt,r.receipt);
    assert.equal(read(detail(first.operationId,first.operationId)).receipt.revision,1);assert.throws(()=>send(submit(2)),/attendance_access_denied/);
    exec(`update public.merchant_enterprise_roles set permissions=permissions||array['attendance.self.request'] where id='${role}';`);
    pass('pause or lost submit permission still permits own receipt read and withdrawal, without cancelling original approval');
    for(const n of [3,4,2]){
      const lockId=control('lock_period',{fromDate:day(n),throughDate:day(n)});
      assert.throws(()=>send(submit(2)),/attendance_correction_period_locked/);
      control('unlock_period',{periodId:lockId});
    }
    assert.equal(read().revision,2);pass('original, previous-approved and newly-proposed periods each independently block attempted move-around-lock');
    control('set_policy',{submissionWindowDays:0});policyRevision=controlsRevision;
    assert.throws(()=>send(submit(2)),/attendance_correction_window_expired/);assert(read().currentRules.issues.includes('window_expired'));
    control('set_policy',{submissionWindowDays:365});policyRevision=controlsRevision;
    const second=submit(2);r=send(second);assert.equal(r.revision,3);assert.equal(read(detail(first.operationId)).item.status,'withdrawn');assert.equal(read(detail(first.operationId)).pendingRequestId,second.operationId);
    const withdraw2={...withdraw,operationId:id(nonce++),requestId:second.operationId,expectedRevision:3};send(withdraw2);assert.equal(read().revision,4);
    pass('deadline remains anchored to original work date; explicit withdrawal permits new request while old history remains immutable');
    for(const roleName of ['anon','authenticated','service_role'])assert.throws(()=>exec(`set role ${roleName};select * from public.merchant_attendance_revision_requests;`),/permission denied/);
    for(const statement of ["update public.merchant_attendance_revision_requests set command='{}'",'delete from public.merchant_attendance_revision_requests','truncate public.merchant_attendance_revision_requests'])assert.throws(()=>exec(statement),/append.only/);
    assert.equal(fingerprint(),untouched);
    const rq={siteId:site,workerId:worker,fromDate:day(5),throughDate:day(1)},report=reports.parseAttendanceTimesheetResult(JSON.parse(exec(`set role service_role;select public.faolla_attendance_period_report_v1('${site}','${owner}',${json({workerId:worker,fromDate:rq.fromDate,throughDate:rq.throughDate})});`)),rq);
    assert.equal(report.totals.original.workedUs,8*3600000000);assert.equal(report.totals.selected.workedUs,9*3600000000);assert.equal(report.rows.length,1);
    pass('append-only revision ledger; original facts, first decisions and old report totals remain byte-for-byte unchanged');
    async function race(hold,waiting,check){
      const holder=connect(),reader=connect();let pending;
      try{
        const pid=Number(await holder.step('select pg_backend_pid();'));await holder.step(sql(hold));
        pending=reader.step(sql(waiting)).then(output=>({output}),error=>({error}));let blocked=false;const deadline=Date.now()+1800;
        while(Date.now()<deadline){blocked=query(`select count(*) from pg_stat_activity where application_name='${reader.name}' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';if(blocked)break;await new Promise(r=>setTimeout(r,15));}
        assert(blocked);await holder.step('commit;');await check(await pending);
      }finally{await Promise.all([holder.close(),reader.close()]);if(pending)await pending;}
    }
    const concurrent=submit(4);
    await race(`begin;set local role service_role;select ${call(detail(concurrent.operationId),concurrent)};`,`set role service_role;select ${call(detail(concurrent.operationId),concurrent)};`,o=>{assert(!o.error,String(o.error));assert.equal(revision.parseAttendanceRevisionResult(JSON.parse(o.output),detail(concurrent.operationId,concurrent.operationId)).receipt.revision,5);});
    assert.equal(exec('select count(*) from public.merchant_attendance_revision_requests;'),'5');pass('same operation concurrent submission serializes on exact settings PID and appends once');
    const withdraw3={...withdraw,operationId:id(nonce++),requestId:concurrent.operationId,expectedRevision:5};send(withdraw3);
    const fresh=submit(6);
    await race(`begin;update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';`,`set role service_role;select ${call(detail(fresh.operationId),fresh)};`,o=>assert.match(String(o.error),/attendance_access_denied/));
    exec(`update public.merchant_enterprise_roles set permissions=permissions||array['attendance.self.request'] where id='${role}';`);
    pass('role revocation committed before pending submission prevents a new ledger entry');
    const periodId=id(nonce++),periodCommand={action:'lock_period',operationId:periodId,expectedRevision:controlsRevision,expectedSettingsVersion:1,reason:'Concurrent lock',fromDate:day(2),throughDate:day(2)};
    const lockedRequest=submit(6);
    await race(`begin;set local role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(periodCommand)},null,null,true);`,`set role service_role;select ${call(detail(lockedRequest.operationId),lockedRequest)};`,o=>assert.match(String(o.error),/attendance_correction_period_locked/));
    controlsRevision++;control('unlock_period',{periodId});assert.equal(read().revision,6);
    pass('period lock committed first is rechecked after exact settings-lock wait and rejects new request');
    const policyCommand={action:'set_policy',operationId:id(nonce++),expectedRevision:controlsRevision,expectedSettingsVersion:1,reason:'Concurrent policy replacement',submissionWindowDays:365},stalePolicy=submit(6);
    await race(`begin;set local role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(policyCommand)},null,null,true);`,`set role service_role;select ${call(detail(stalePolicy.operationId),stalePolicy)};`,o=>assert.match(String(o.error),/attendance_correction_policy_changed/));
    controlsRevision++;policyRevision=controlsRevision;assert.equal(read().revision,6);
    pass('policy replacement committed first prevents stale prepared policy from creating a request');
    const winner=submit(6),loser=submit(6);
    await race(`begin;set local role service_role;select ${call(detail(winner.operationId),winner)};`,`set role service_role;select ${call(detail(loser.operationId),loser)};`,o=>assert.match(String(o.error),/attendance_version_conflict/));
    assert.equal(read().revision,7);assert.throws(()=>read(detail(loser.operationId)),/attendance_correction_not_found/);
    send({...withdraw,operationId:id(nonce++),requestId:winner.operationId,expectedRevision:7});assert.equal(send(winner,false).receipt.revision,7);
    pass('two different submissions cannot share a stale head; committed submission receipt recovers after withdrawal');
    await race(`begin;update public.merchant_attendance_workers set employee_id='${other}' where id='${worker}';`,`set role service_role;select ${call(prepare)};`,o=>assert.match(String(o.error),/attendance_access_denied/));
    assert.throws(()=>read(prepare,null,otherAuth),/attendance_revision_base_not_found/);
    exec(`update public.merchant_attendance_workers set employee_id='${employee}' where id='${worker}';`);
    assert.equal(exec('select count(*) from public.merchant_attendance_revision_requests;'),'8');assert.equal(fingerprint(),untouched);
    pass('rebind race blocks old employee and successor cannot read predecessor approved source');
  });
  pass('owned synthetic schema removed and existing baseline restored');
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
