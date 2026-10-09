import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import revision from '../src/lib/merchantAttendanceRevision.ts';
import reviewApi from '../src/lib/merchantAttendanceRevisionReview.ts';
import reports from '../src/lib/merchantAttendanceTimesheet.ts';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
async function check(context){
  const {query,connect,root,pass}=context;
  await withAttendanceConcurrencySandbox(context,async({sql})=>{
    const exec=s=>query(sql(s)),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
    for(const name of ['202609300087_merchant_attendance_period_report.sql','202610010091_merchant_attendance_revision_requests.sql','202610010092_merchant_attendance_revision_review.sql'])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
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
    const requested=submit(0);send(requested);
    const reviewCall=(who=owner,request=requested.operationId,merchant=site)=>`public.faolla_attendance_revision_owner_review_v1('${merchant}','${who}','${request}')`;
    const inspect=(who=owner,request=requested.operationId)=>reviewApi.parseAttendanceRevisionReviewResult(JSON.parse(exec(`set role service_role;select ${reviewCall(who,request)};`)),{siteId:site,requestId:request});
    const sourceFingerprint=()=>exec(`select md5(jsonb_agg(to_jsonb(r) order by revision)::text) from public.merchant_attendance_revision_requests r;`);
    const sourceBefore=sourceFingerprint(),factsBefore=fingerprint();let r=inspect();const comparison=reviewApi.attendanceRevisionReviewComparison(r);
    assert.equal(r.checksPassed,true);assert.equal(r.rejectionChecksPassed,true);assert.equal(r.approvalAvailable,false);assert.equal(r.effectiveChanged,false);
    assert.equal(comparison.original.totals.workedUs,8*3600000000);assert.equal(comparison.approved.totals.workedUs,9*3600000000);assert.equal(comparison.requested.totals.workedUs,7*3600000000);assert.equal(comparison.changeFromApproved.workedUs,-2*3600000000);
    assert.equal(inspect().evidenceToken,r.evidenceToken);assert.equal(sourceFingerprint(),sourceBefore);assert.equal(fingerprint(),factsBefore);
    pass('real approved-source revision has separate raw eight, approved nine and proposed seven hours; stable fingerprint and no approval');
    for(const who of [auth,otherAuth,id(99)])assert.throws(()=>inspect(who),/attendance_access_denied/);
    assert.throws(()=>inspect(owner,id(99)),/attendance_correction_not_found/);assert.throws(()=>exec(`set role service_role;select ${reviewCall(owner,requested.operationId,'99990008')};`),/attendance_settings_required/);
    for(const name of ['anon','authenticated'])assert.throws(()=>exec(`set role ${name};select ${reviewCall()};`),/permission denied/);
    assert.throws(()=>exec(`set role service_role;select public.faolla_attendance_revision_bound_rules_v1('${site}',null,null,null,clock_timestamp());`),/permission denied/);
    pass('current owner only, tenant checks and service-only RPC ACL; private rules helper is not callable');
    const beforePolicy=r.evidenceToken;control('set_policy',{submissionWindowDays:0});policyRevision=controlsRevision;
    r=inspect();assert.equal(r.review.application.rules.policy.revision,1);assert.equal(r.review.application.rules.policy.submissionWindowDays,365);assert.equal(r.checksPassed,true);assert.notEqual(r.evidenceToken,beforePolicy);
    assert(read().currentRules.issues.includes('window_expired'));
    pass('review uses actual submission-bound policy even when latest policy now disallows a new request');
    for(const n of [3,4,2]){const prior=inspect().evidenceToken,periodId=control('lock_period',{fromDate:day(n),throughDate:day(n)});r=inspect();assert(r.blockers.includes('rule_period_locked'));assert.equal(r.checksPassed,false);assert.equal(r.rejectionChecksPassed,true);assert.notEqual(r.evidenceToken,prior);control('unlock_period',{periodId});assert.equal(inspect().checksPassed,true);}
    pass('current locks on original, old approved and proposed intervals independently block preflight and invalidate evidence');
    const neighbor=reviewApi.parseAttendanceRevisionReviewResult(JSON.parse(exec(`begin;
      insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id)
        values('${id(103)}','${site}','${worker}','${loc}','${id(203)}',3,'clock_in','web','${at(2,'14:00')}','Europe/Madrid','${employee}');
      set local role service_role;select ${reviewCall()};rollback;`)),{siteId:site,requestId:requested.operationId});
    assert(neighbor.blockers.includes('overlap_next'));assert.equal(neighbor.rejectionChecksPassed,true);assert.equal(fingerprint(),factsBefore);
    pass('new proposal cannot cross next raw clock-in; rolled-back synthetic boundary leaves original facts unchanged');
    exec(`update public.merchant_attendance_employment_periods set ends_on='${day(3)}' where merchant_id='${site}' and worker_id='${worker}';`);
    r=inspect();assert(r.blockers.includes('employment_gap'));assert.equal(r.rejectionChecksPassed,true);
    exec(`update public.merchant_attendance_employment_periods set ends_on=null where merchant_id='${site}' and worker_id='${worker}';`);
    exec(`update public.merchant_enterprise_employees set status='disabled' where id='${employee}';`);assert.equal(inspect().checksPassed,true);
    exec(`update public.merchant_enterprise_employees set status='active' where id='${employee}';`);
    pass('employment coverage uses new proposed dates; current owner retains historical inspection after requester deactivation');
    exec(`update public.merchant_attendance_workers set employee_id='${other}' where id='${worker}';`);r=inspect();assert(r.blockers.includes('binding_changed'));assert.equal(r.rejectionChecksPassed,false);
    exec(`update public.merchant_attendance_workers set employee_id='${employee}' where id='${worker}';`);
    exec(`update public.merchants set user_id='${auth}' where id='${site}';`);r=inspect(auth);assert(r.blockers.includes('self_review'));assert.equal(r.rejectionChecksPassed,false);assert.throws(()=>inspect(),/attendance_access_denied/);
    exec(`update public.merchants set user_id='${owner}' where id='${site}';`);
    pass('rebind is visible but blocked; owner cannot approve own application after ownership transfer');
    control('set_policy',{submissionWindowDays:365});policyRevision=controlsRevision;
    const oldToken=inspect().evidenceToken;
    exec(`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
      ('${id(103)}','${site}','${worker}','${loc}','${id(203)}',3,'clock_in','web','${at(1,'08:00')}','Europe/Madrid','${employee}'),
      ('${id(104)}','${site}','${worker}','${loc}','${id(204)}',4,'clock_out','web','${at(1,'16:00')}','Europe/Madrid','${employee}');`);
    assert.notEqual(inspect().evidenceToken,oldToken);assert.equal(inspect().checksPassed,true);
    // The old initial-request API can reuse a UUID from the independent revision
    // namespace. It must not make the revision appear already decided.
    const otherRequest=requested.operationId,otherProposal={startAt:at(2,'14:00'),endAt:at(2,'16:00'),breaks:[]};
    exec(`set role service_role;select public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:otherRequest,operationId:null})},${json({action:'submit',operationId:otherRequest,expectedRevision:0,expectedPolicyRevision:policyRevision,reason:'Other synthetic shift',startEventId:id(103),expectedLastEventId:id(104),proposal:otherProposal})},true);`);
    const otherPreflight=JSON.parse(exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${otherRequest}',null,null,true);`));assert.equal(otherPreflight.canApprove,true);
    exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${otherRequest}',${json({action:'approve',operationId:id(nonce++),requestId:otherRequest,expectedRevision:1,expectedEvidence:otherPreflight.evidenceToken,reason:'Other approved shift'})},null,true);`);
    r=inspect();assert.deepEqual(r.blockers,['effective_overlap']);assert.equal(r.checksPassed,false);assert.equal(r.rejectionChecksPassed,true);
    pass('excludes own old approval only; other approved overlap blocks, and cross-namespace UUID reuse never means already decided');
    const beforeRaces=fingerprint(),beforeRevisionRaces=sourceFingerprint(),lockId=id(nonce++),lockCommand={action:'lock_period',operationId:lockId,expectedRevision:controlsRevision,expectedSettingsVersion:1,reason:'Concurrent review lock',fromDate:day(4),throughDate:day(4)};
    await race(`begin;set local role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(lockCommand)},null,null,true);`,`set role service_role;select ${reviewCall()};`,o=>{assert(!o.error,String(o.error));const value=reviewApi.parseAttendanceRevisionReviewResult(JSON.parse(o.output),{siteId:site,requestId:requested.operationId});assert(value.blockers.includes('rule_period_locked'));});
    controlsRevision++;control('unlock_period',{periodId:lockId});
    pass('review waits for exact settings-lock owner and returns newly committed period blocker');
    await race(`begin;update public.merchant_attendance_employment_periods set ends_on='${day(3)}' where merchant_id='${site}' and worker_id='${worker}';`,`set role service_role;select ${reviewCall()};`,o=>{assert(!o.error,String(o.error));assert(JSON.parse(o.output).blockers.includes('employment_gap'));});
    exec(`update public.merchant_attendance_employment_periods set ends_on=null where merchant_id='${site}' and worker_id='${worker}';`);
    pass('concurrent employment change is serialized by worker lock and uses updated coverage');
    await race(`begin;update public.merchants set user_id='${otherAuth}' where id='${site}';`,`set role service_role;select ${reviewCall()};`,o=>assert.match(String(o.error),/attendance_access_denied/));
    exec(`update public.merchants set user_id='${owner}' where id='${site}';`);
    assert.equal(fingerprint(),beforeRaces);assert.equal(sourceFingerprint(),beforeRevisionRaces);
    pass('ownership transfer committed before read removes old owner access; review changes no facts or request rows');
    const withdrawal={action:'withdraw',operationId:id(nonce++),requestId:requested.operationId,expectedRevision:1,reason:'Synthetic withdrawal during review'};
    await race(`begin;set local role service_role;select ${call(detail(requested.operationId),withdrawal)};`,`set role service_role;select ${reviewCall()};`,o=>{assert(!o.error,String(o.error));const value=reviewApi.parseAttendanceRevisionReviewResult(JSON.parse(o.output),{siteId:site,requestId:requested.operationId});assert.equal(value.review.item.status,'withdrawn');assert.equal(value.rejectionChecksPassed,false);assert(value.blockers.includes('withdrawn'));});
    const rq={siteId:site,workerId:worker,fromDate:day(4),throughDate:day(4)},report=reports.parseAttendanceTimesheetResult(JSON.parse(exec(`set role service_role;select public.faolla_attendance_period_report_v1('${site}','${owner}',${json({workerId:worker,fromDate:rq.fromDate,throughDate:rq.throughDate})});`)),rq);
    assert.equal(report.totals.selected.workedUs,9*3600000000);assert.equal(report.rows.length,1);assert.equal(fingerprint(),beforeRaces);
    pass('withdrawal committed first blocks review eligibility, while report keeps old approved nine hours');
    async function race(hold,waiting,check){
      const holder=connect(),reader=connect();let pending;
      try{
        const pid=Number(await holder.step('select pg_backend_pid();'));await holder.step(sql(hold));
        pending=reader.step(sql(waiting)).then(output=>({output}),error=>({error}));let blocked=false;const deadline=Date.now()+1800;
        while(Date.now()<deadline){blocked=query(`select count(*) from pg_stat_activity where application_name='${reader.name}' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';if(blocked)break;await new Promise(r=>setTimeout(r,15));}
        assert(blocked);await holder.step('commit;');await check(await pending);
      }finally{await Promise.all([holder.close(),reader.close()]);if(pending)await pending;}
    }
  });
  pass('owned synthetic schema removed and existing baseline restored');
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
