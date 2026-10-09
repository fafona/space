import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import revision from '../src/lib/merchantAttendanceRevision.ts';
import reports from '../src/lib/merchantAttendanceTimesheet.ts';
import decisionApi from '../src/lib/merchantAttendanceRevisionDecision.ts';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
async function check(context){
  const {query,connect,root,pass}=context;
  await withAttendanceConcurrencySandbox(context,async({sql})=>{
    const exec=s=>query(sql(s)),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
    for(const name of ['202609300087_merchant_attendance_period_report.sql','202610010088_merchant_attendance_scoped_period_report.sql','202610010090_merchant_attendance_period_export.sql','202610010091_merchant_attendance_revision_requests.sql','202610010092_merchant_attendance_revision_review.sql','202610010093_merchant_attendance_versioned_reports.sql','202610010094_merchant_attendance_revision_decision_core.sql'])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
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
    let requested=submit(0);send(requested);
    const factsBefore=fingerprint();
    // No application EXECUTE grant: invoke this candidate core as the owned
    // sandbox database owner, retaining its real current-owner/business checks.
    const decisionSql=(command=null,operation=null,enabled=true,who=owner,request=requested.operationId)=>`public.faolla_attendance_revision_decide_v1('${site}','${who}','${request}',${command?json(command):'null'},${operation?`'${operation}'`:'null'},${enabled})`;
    const decode=(text,operationId=null)=>decisionApi.parseRevisionDecisionResult(JSON.parse(text),{siteId:site,requestId:requested.operationId,operationId});
    const inspect=(enabled=true,who=owner)=>decode(exec(`select ${decisionSql(null,null,enabled,who)};`));
    const decide=(command,enabled=true)=>decode(exec(`select ${decisionSql(command,null,enabled)};`),command.operationId);
    const command=(action='approve',r=inspect())=>({action,requestId:requested.operationId,operationId:id(nonce++),expectedRevision:r.review.review.item.revision,expectedEvidence:r.evidenceToken,expectedBaseOperationId:r.current.operationId,reason:'Synthetic revision decision'});
    const counts=()=>exec("select jsonb_build_array((select count(*) from public.merchant_attendance_revision_decisions),(select count(*) from public.merchant_attendance_effect_versions));");
    const report=()=>{const q={siteId:site,workerId:worker,fromDate:day(5),throughDate:day(1)};return reports.parseAttendanceTimesheetResult(JSON.parse(exec(`set role service_role;select public.faolla_attendance_period_report_v2('${site}','${owner}',${json({workerId:worker,fromDate:q.fromDate,throughDate:q.throughDate})});`)),q,'raw-and-approved-v2');};
    let r=inspect();assert.equal(r.canApprove,true);assert.equal(r.canReject,true);assert.equal(r.decision,null);assert.equal(r.current.revision,1);
    assert.equal(inspect().evidenceToken,r.evidenceToken);assert.equal(inspect(false).canApprove,false);assert.equal(report().totals.selected.workedUs,9*3600000000);
    for(const who of [auth,otherAuth,id(99)])assert.throws(()=>inspect(true,who),/attendance_access_denied/);
    for(const roleName of ['anon','authenticated','service_role']){
      assert.throws(()=>exec(`set role ${roleName};select ${decisionSql()};`),/permission denied/);
      assert.throws(()=>exec(`set role ${roleName};select public.faolla_attendance_revision_owner_review_v2('${site}','${owner}','${requested.operationId}');`),/permission denied/);
      assert.throws(()=>exec(`set role ${roleName};select * from public.merchant_attendance_revision_decisions;`),/permission denied/);
    }
    pass('private decision core only, actual owner required, stable preflight, default-off returns no write availability');
    const fresh=command();assert.throws(()=>decide(fresh,false),/attendance_platform_paused/);
    for(const patch of [{expectedRevision:2},{expectedEvidence:'f'.repeat(32)},{expectedBaseOperationId:id(99)},{operationId:oldOperation},{operationId:requested.operationId}])
      assert.throws(()=>decide({...fresh,...patch}),/attendance_version_conflict|attendance_correction_evidence_changed|attendance_revision_base_changed|attendance_operation_conflict/);
    for(const patch of [{extra:true},{expectedRevision:'1'},{action:'delete'},{reason:' '},{requestId:id(99)}])assert.throws(()=>decide({...fresh,...patch}),/attendance_invalid_request/);
    assert.equal(counts(),'[0, 0]');assert.equal(fingerprint(),factsBefore);
    pass('paused, stale evidence/base/request versions, malformed commands and cross-namespace operation reuse cause no writes');
    const beforeRules=command();control('set_policy',{submissionWindowDays:365});policyRevision=controlsRevision;
    assert.throws(()=>decide(beforeRules),/attendance_correction_evidence_changed/);assert.equal(inspect().review.review.application.rules.policy.revision,1);
    pass('policy change invalidates optimistic evidence without rewriting submission-bound policy');
    const locked=control('lock_period',{fromDate:day(4),throughDate:day(4)});r=inspect();assert.equal(r.canApprove,false);assert.equal(r.canReject,true);
    assert(r.blockers.includes('rule_period_locked'));assert.throws(()=>decide(command('approve',r)),/attendance_correction_decision_blocked/);
    const reject=command('reject',r),rejection=connect();
    try{
      const rejected=decode(await rejection.step(sql(`begin;select ${decisionSql(reject)};`)),reject.operationId);
      await rejection.step('set constraints all immediate;');
      assert.equal(rejected.decision.action,'reject');assert.equal(rejected.current.operationId,oldOperation);assert.equal(rejected.current.revision,1);assert.equal(rejected.effectiveChanged,false);
      const replay=decode(await rejection.step(sql(`select ${decisionSql(reject,null,false)};`)),reject.operationId);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,rejected.receipt);
      await assert.rejects(rejection.step(sql(`set local role service_role;select ${call(detail(requested.operationId),{action:'withdraw',operationId:id(nonce++),requestId:requested.operationId,expectedRevision:1,reason:'Attempt withdrawal after decision'})};`)),/attendance_report_version_required/);
    }finally{await rejection.close();}
    assert.equal(counts(),'[0, 0]');control('unlock_period',{periodId:locked});
    pass('locked intervals prevent approval but allow rejection; rejection leaves hours unchanged, replays while paused and blocks legacy withdrawal');
    exec(`update public.merchant_attendance_workers set employee_id='${other}' where id='${worker}';`);r=inspect();assert.equal(r.canReject,false);assert(r.blockers.includes('binding_changed'));
    assert.throws(()=>decide(command('reject',r)),/attendance_correction_decision_blocked/);exec(`update public.merchant_attendance_workers set employee_id='${employee}' where id='${worker}';`);
    exec(`update public.merchants set user_id='${auth}' where id='${site}';`);r=inspect(true,auth);assert.equal(r.canApprove,false);assert.equal(r.canReject,false);assert(r.blockers.includes('self_review'));
    assert.throws(()=>inspect(),/attendance_access_denied/);exec(`update public.merchants set user_id='${owner}' where id='${site}';`);
    pass('rebound identity and new owner reviewing own application cannot approve or reject');
    const beforeLock=command(),periodId=id(nonce++),lockCommand={action:'lock_period',operationId:periodId,expectedRevision:controlsRevision,expectedSettingsVersion:1,reason:'Synthetic concurrent lock',fromDate:day(2),throughDate:day(2)};
    await race(`begin;set local role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(lockCommand)},null,null,true);`,`select ${decisionSql(beforeLock)};`,o=>assert.match(String(o.error),/attendance_correction_evidence_changed/));
    controlsRevision++;control('unlock_period',{periodId});assert.equal(counts(),'[0, 0]');
    pass('approval waiting on exact settings owner observes committed period lock and rejects stale evidence');
    const beforeWithdraw=command(),withdrawal={action:'withdraw',operationId:id(nonce++),requestId:requested.operationId,expectedRevision:1,reason:'Withdraw before approval'};
    await race(`begin;set local role service_role;select ${call(detail(requested.operationId),withdrawal)};`,`select ${decisionSql(beforeWithdraw)};`,o=>assert.match(String(o.error),/attendance_version_conflict/));
    assert.equal(inspect().canReject,false);assert.equal(counts(),'[0, 0]');requested=submit(2);send(requested);
    pass('withdrawal committed first prevents approval; untouched base can accept the existing withdraw-and-resubmit flow');
    for(const overlapNow of [true,false]){
      const overlapProbe=connect(),otherRoot=id(nonce++),otherApproval=id(nonce++),otherRequest=id(nonce++);
      const near={startAt:at(2,'14:00'),endAt:at(2,'16:00'),breaks:[]},far={startAt:at(1,'08:00'),endAt:at(1,'17:00'),breaks:[]};
      try{
        await overlapProbe.step(sql(`begin;insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
          ('${id(103)}','${site}','${worker}','${loc}','${id(203)}',3,'clock_in','web','${at(1,'08:00')}','Europe/Madrid','${employee}'),
          ('${id(104)}','${site}','${worker}','${loc}','${id(204)}',4,'clock_out','web','${at(1,'16:00')}','Europe/Madrid','${employee}');
          set local role service_role;select public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:otherRoot,operationId:null})},${json({action:'submit',operationId:otherRoot,expectedRevision:0,expectedPolicyRevision:policyRevision,reason:'Another synthetic shift',startEventId:id(103),expectedLastEventId:id(104),proposal:overlapNow?far:near})},true);`));
        const first=JSON.parse(await overlapProbe.step(sql(`select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${otherRoot}',null,null,true);`)));assert.equal(first.canApprove,true);
        await overlapProbe.step(sql(`select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${otherRoot}',${json({action:'approve',operationId:otherApproval,requestId:otherRoot,expectedRevision:1,expectedEvidence:first.evidenceToken,reason:'Another initial approval'})},null,true);`));
        const otherQuery={mode:'detail',expectedWorkerId:worker,baseRequestId:otherRoot,requestId:otherRequest,operationId:null};
        await overlapProbe.step(sql(`select public.faolla_attendance_revision_self_v1('${site}','${auth}',${json(otherQuery)},${json({action:'submit',operationId:otherRequest,expectedRevision:0,expectedBaseOperationId:otherApproval,expectedPolicyRevision:policyRevision,reason:'Another revision',proposal:overlapNow?near:far})},true);reset role;`));
        const ready=JSON.parse(await overlapProbe.step(sql(`select ${decisionSql(null,null,true,owner,otherRequest)};`)));assert.equal(ready.canApprove,true);
        const otherCommand={action:'approve',operationId:id(nonce++),requestId:otherRequest,expectedRevision:1,expectedEvidence:ready.evidenceToken,expectedBaseOperationId:otherApproval,reason:'Approve other revision'};
        const otherResult=decisionApi.parseRevisionDecisionResult(JSON.parse(await overlapProbe.step(sql(`select ${decisionSql(otherCommand,null,true,owner,otherRequest)};`))),{siteId:site,requestId:otherRequest,operationId:otherCommand.operationId});assert.equal(otherResult.current.revision,2);
        await overlapProbe.step('set constraints all immediate;');
        const currentCheck=decode(await overlapProbe.step(sql(`select ${decisionSql()};`)));
        assert.equal(currentCheck.blockers.includes('effective_overlap'),overlapNow);assert.equal(currentCheck.canApprove,!overlapNow);assert.equal(currentCheck.canReject,true);
        if(overlapNow)await assert.rejects(overlapProbe.step(sql(`select ${decisionSql(command('approve',currentCheck))};`)),/attendance_correction_decision_blocked/);
      }finally{await overlapProbe.close();}
      assert.equal(fingerprint(),factsBefore);assert.equal(counts(),'[0, 0]');
    }
    pass('actual other-shift revised versions block new overlap and remove superseded false overlap; both transactions roll back cleanly');
    exec(`create function public.faolla_test_revision_effect_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic_effect_write_failure';end; $$;
      create trigger synthetic_effect_failure before insert on public.merchant_attendance_effect_versions for each row execute function public.faolla_test_revision_effect_failure();`);
    const failAtomically=command();
    try{assert.throws(()=>decide(failAtomically),/synthetic_effect_write_failure/);assert.equal(counts(),'[0, 0]');assert.equal(fingerprint(),factsBefore);}
    finally{exec('drop trigger synthetic_effect_failure on public.merchant_attendance_effect_versions;drop function public.faolla_test_revision_effect_failure();');}
    pass('injected version-write failure rolls back its preceding approval receipt; no partial decision/effective state');
    const beforeTransfer=command();
    await race(`begin;update public.merchants set user_id='${otherAuth}' where id='${site}';`,`select ${decisionSql(beforeTransfer)};`,o=>assert.match(String(o.error),/attendance_access_denied/));
    exec(`update public.merchants set user_id='${owner}' where id='${site}';`);assert.equal(counts(),'[0, 0]');
    pass('ownership transfer committed before waiting approval removes old principal authority');
    // Deferred storage consistency is tested separately from business authorization.
    const c=command(),bareDecision=`insert into public.merchant_attendance_revision_decisions(merchant_id,request_id,operation_id,base_request_id,worker_id,action,actor_auth_user_id,request_revision,base_operation_id,evidence_token,reason,command,recorded_at)
      values('${site}','${requested.operationId}','${c.operationId}','${oldRequest}','${worker}','approve','${owner}',3,'${oldOperation}','${c.expectedEvidence}','${c.reason}',${json(c)},clock_timestamp());`;
    assert.throws(()=>exec('begin;'+bareDecision+'commit;'),/attendance_revision_decision_effect_mismatch/);assert.equal(counts(),'[0, 0]');
    pass('deferred constraint refuses an approval receipt without its matching effective node');
    const approve=command();let decidedResult;
    await race(`begin;select ${decisionSql(approve)};`,`select ${decisionSql(approve)};`,(o,held)=>{
      assert(!o.error,String(o.error));decidedResult=decode(held,approve.operationId);const replay=decode(o.output,approve.operationId);
      assert.equal(decidedResult.effectiveChanged,true);assert.equal(decidedResult.replayed,false);assert.equal(decidedResult.current.revision,2);
      assert.equal(replay.replayed,true);assert.equal(replay.effectiveChanged,false);assert.deepEqual(replay.receipt,decidedResult.receipt);
    });
    assert.equal(counts(),'[1, 1]');assert.equal(report().totals.selected.workedUs,7*3600000000);assert.equal(report().totals.original.workedUs,8*3600000000);
    assert.equal(decidedResult.current.operationId,approve.operationId);assert.equal(decidedResult.current.lineage.previousOperationId,oldOperation);
    assert.equal(fingerprint(),factsBefore);
    pass('concurrent identical approval waits for exact transaction PID, commits one decision plus node, and replaces nine hours with seven');
    const recovered=decode(exec(`select ${decisionSql(null,approve.operationId,false)};`),approve.operationId);assert.deepEqual(recovered.receipt,decidedResult.receipt);assert.equal(recovered.replayed,true);assert.equal(recovered.canApprove,false);
    const repeated=decide(approve,false);assert.equal(repeated.replayed,true);assert.equal(repeated.effectiveChanged,false);
    for(const patch of [{reason:'changed reason'},{action:'reject'},{expectedEvidence:'f'.repeat(32)}])assert.throws(()=>decide({...approve,...patch}),/attendance_operation_conflict/);
    assert.throws(()=>decide({...approve,operationId:id(nonce++)}),/attendance_correction_decided/);
    assert.equal(decode(exec(`select ${decisionSql(null,id(998),false)};`),id(998)).receipt,null);assert.equal(counts(),'[1, 1]');
    pass('same operation restores exact receipt while paused, unknown receipt stays unknown, changed command/new terminal decision is refused');
    assert.throws(()=>read(),/attendance_report_version_required/);
    assert.throws(()=>exec(`set role service_role;select ${call(detail(requested.operationId),{action:'withdraw',operationId:id(nonce++),requestId:requested.operationId,expectedRevision:3,reason:'Attempt late withdrawal'})};`),/attendance_report_version_required/);
    for(const table of ['merchant_attendance_revision_decisions','merchant_attendance_effect_versions'])for(const statement of [`update public.${table} set reason='rewrite'`,`delete from public.${table}`,`truncate public.${table}`])assert.throws(()=>exec(statement),/append.only|immutable|foreign key/i);
    assert.equal(counts(),'[1, 1]');assert.equal(fingerprint(),factsBefore);
    pass('terminal decision cannot be withdrawn or rewritten; original raw facts and first approval remain unchanged');
    exec(`update public.merchants set user_id='${otherAuth}' where id='${site}';`);
    assert.throws(()=>decide(approve,false),/attendance_access_denied/);
    const newOwner=decode(exec(`select ${decisionSql(null,approve.operationId,false,otherAuth)};`),approve.operationId);assert.equal(newOwner.receipt,null);assert.equal(newOwner.decision.operationId,approve.operationId);
    assert.throws(()=>exec(`select ${decisionSql(approve,null,false,otherAuth)};`),/attendance_operation_conflict/);
    pass('ownership transfer removes old owner access; new owner may inspect decision but cannot replay another actor operation');
    async function race(hold,waiting,check){
      const holder=connect(),reader=connect();let pending;
      try{
        const pid=Number(await holder.step('select pg_backend_pid();'));const held=await holder.step(sql(hold));
        pending=reader.step(sql(waiting)).then(output=>({output}),error=>({error}));let blocked=false;const deadline=Date.now()+1800;
        while(Date.now()<deadline){blocked=query(`select count(*) from pg_stat_activity where application_name='${reader.name}' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';if(blocked)break;await new Promise(r=>setTimeout(r,15));}
        assert(blocked);await holder.step('commit;');await check(await pending,held);
      }finally{await Promise.all([holder.close(),reader.close()]);if(pending)await pending;}
    }
  });
  pass('owned synthetic namespace removed and original baseline restored');
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
