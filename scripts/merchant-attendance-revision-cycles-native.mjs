import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import revision from '../src/lib/merchantAttendanceRevision.ts';
import cycles from '../src/lib/merchantAttendanceRevisionCycle.ts';
import approval from '../src/lib/merchantAttendanceRevisionApproval.ts';
import decisionService from '../src/lib/merchantAttendanceRevisionDecision.server.ts';
import cycleService from '../src/lib/merchantAttendanceRevisionCycle.server.ts';
import reports from '../src/lib/merchantAttendanceTimesheet.ts';
import reportService from '../src/lib/merchantAttendanceTimesheet.server.ts';
import scopedService from '../src/lib/merchantAttendanceScopedTimesheet.server.ts';
import exportService from '../src/lib/merchantAttendanceTimesheetExport.server.ts';
import reportBrowser from '../src/lib/merchantAttendanceTimesheetResponse.ts';
import scopedBrowser from '../src/lib/merchantAttendanceScopedTimesheetResponse.ts';
import currentCorrection from '../src/lib/merchantAttendanceCurrentCorrectionDecision.server.ts';
import currentHttp from '../src/app/api/merchant-enterprise/attendance/correction-decisions/route-handler.ts';
import currentResponse from '../src/lib/merchantAttendanceCurrentCorrectionResponse.ts';
import currentBrowser from '../src/lib/merchantAttendanceCorrectionDecisionClient.ts';
import cycleHttp from '../src/app/api/merchant-enterprise/attendance/revision-requests/route-handler.ts';
import cycleBrowser from '../src/lib/merchantAttendanceRevisionCycleClient.ts';
import contextHttp from '../src/app/api/merchant-enterprise/attendance/corrections/context/route-handler.ts';
import contextService from '../src/lib/merchantAttendanceSelfContext.server.ts';
import approvalHttp from '../src/app/api/merchant-enterprise/attendance/revision-decisions/route-handler.ts';
import approvalReviewHttp from '../src/app/api/merchant-enterprise/attendance/revision-reviews/route-handler.ts';
import approvalBrowser from '../src/lib/merchantAttendanceRevisionApprovalClient.ts';
import historyProtocol from '../src/lib/merchantAttendanceRevisionHistory.ts';
import historyService from '../src/lib/merchantAttendanceRevisionHistory.server.ts';
import historyHttp from '../src/app/api/merchant-enterprise/attendance/revision-history/route-handler.ts';
import historyBrowser from '../src/lib/merchantAttendanceRevisionHistoryClient.ts';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {checkAttendanceApplicationAccess} from './merchant-attendance-application-access-native.mjs';
async function check(context){
  const {query,connect,root,pass}=context;
  await withAttendanceConcurrencySandbox(context,async({sql})=>{
    const exec=s=>query(sql(s)),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
    for(const name of ['202609300087_merchant_attendance_period_report.sql','202610010088_merchant_attendance_scoped_period_report.sql','202610010090_merchant_attendance_period_export.sql','202610010091_merchant_attendance_revision_requests.sql','202610010092_merchant_attendance_revision_review.sql','202610010093_merchant_attendance_versioned_reports.sql','202610010094_merchant_attendance_revision_decision_core.sql','202610010095_merchant_attendance_revision_cycles.sql','202610010096_merchant_attendance_current_correction_decisions.sql'])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    exec(readFileSync(path.join(root,'scripts/supabase-migrations/202609300079_merchant_attendance_self_context.sql'),'utf8'));
    exec(readFileSync(path.join(root,'scripts/supabase-migrations/202610010097_merchant_attendance_revision_history.sql'),'utf8'));
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
    const factsBefore=fingerprint(),legacy=requested;
    const selfSql=(q=prepare,c=null,who=auth,enabled=true)=>call(q,c,who,enabled).replace('faolla_attendance_revision_self_v1','faolla_attendance_revision_self_v2');
    const self=(q=prepare,c=null,who=auth,enabled=true)=>cycles.parseRevisionCycleResult(JSON.parse(exec(`select ${selfSql(q,c,who,enabled)};`)),{...q,operationId:c?.operationId??q.operationId});
    const decisionSql=(request,command=null,operation=null,enabled=true,who=owner)=>`public.faolla_attendance_revision_decide_v2('${site}','${who}','${request}',${command?json(command):'null'},${operation?`'${operation}'`:'null'},${enabled})`;
    const inspect=request=>approval.parseRevisionApprovalResult(JSON.parse(exec(`select ${decisionSql(request)};`)),{siteId:site,requestId:request,operationId:null});
    const decideCommand=(request,action='approve')=>{const r=inspect(request);return {requestId:request,operationId:id(nonce++),action,expectedRevision:r.review.submittedRevision,expectedEvidence:r.evidenceToken,expectedBaseOperationId:r.current.operationId,reason:'Synthetic continuous decision'};};
    const decide=(c)=>approval.parseRevisionApprovalResult(JSON.parse(exec(`select ${decisionSql(c.requestId,c)};`)),{siteId:site,requestId:c.requestId,operationId:c.operationId});
    const proposal=hours=>({startAt:at(2,'08:00'),endAt:at(2,String(8+hours).padStart(2,'0')+':00'),breaks:[]});
    const next=(hours,r=self())=>({action:'submit',operationId:id(nonce++),expectedRevision:r.revision,expectedBaseOperationId:oldOperation,expectedEffectiveOperationId:r.current.operationId,expectedPolicyRevision:1,reason:'Next synthetic revision',proposal:proposal(hours)});
    const sendCycle=(c,enabled=true)=>self(detail(c.action==='submit'?c.operationId:c.requestId),c,auth,enabled);
    const report=()=>{const q={siteId:site,workerId:worker,fromDate:day(5),throughDate:day(1)};return reports.parseAttendanceTimesheetResult(JSON.parse(exec(`set role service_role;select public.faolla_attendance_period_report_v2('${site}','${owner}',${json({workerId:worker,fromDate:q.fromDate,throughDate:q.throughDate})});`)),q,'raw-and-approved-v2');};
    const counts=()=>JSON.parse(exec("select jsonb_build_array((select count(*) from public.merchant_attendance_revision_decisions),(select count(*) from public.merchant_attendance_effect_versions));"));
    let r=self();assert.equal(r.protocol,'revision-self-v2');assert.equal(r.pendingRequestId,legacy.operationId);assert.equal(r.canSubmit,false);assert.equal(r.canWithdraw,false);
    assert.equal(self(detail(legacy.operationId)).item.status,'submitted');
    for(const roleName of ['anon','authenticated','service_role']){
      assert.throws(()=>exec(`set role ${roleName};select ${selfSql()};`),/permission denied/);
      assert.throws(()=>exec(`set role ${roleName};select ${decisionSql(legacy.operationId)};`),/permission denied/);
      assert.throws(()=>exec(`set role ${roleName};select public.faolla_attendance_revision_owner_review_v3('${site}','${owner}','${legacy.operationId}');`),/permission denied/);
      assert.throws(()=>exec(`set role ${roleName};select public.faolla_attendance_revision_effect_at_v1('${site}','${oldRequest}','${oldOperation}',clock_timestamp());`),/permission denied/);
    }
    assert.throws(()=>self(prepare,null,otherAuth),/attendance_access_denied/);
    pass('private cycle protocol reads existing pending request; application roles cannot invoke helpers or writers');
    const compatibility=connect();
    try{
      const undo={action:'withdraw',operationId:id(nonce++),requestId:legacy.operationId,expectedRevision:1,reason:'Synthetic compatibility check'};
      await compatibility.step(sql(`begin;select ${call(detail(legacy.operationId),undo)};`));
      const fresh={...next(6,r),expectedRevision:2};
      const submitted=cycles.parseRevisionCycleResult(JSON.parse(await compatibility.step(sql(`select ${selfSql(detail(fresh.operationId),fresh)};`))),detail(fresh.operationId,fresh.operationId));
      assert.equal(submitted.current.revision,1);assert.equal(submitted.item.submittedRevision,3);
      for(const expression of [call(),`public.faolla_attendance_revision_owner_review_v1('${site}','${owner}','${fresh.operationId}')`,
        `public.faolla_attendance_revision_decide_v1('${site}','${owner}','${fresh.operationId}',null,null,true)`]){
        await compatibility.step(sql(`do $$ begin begin perform ${expression};raise exception 'synthetic_expected_version_refusal';exception when raise_exception then if sqlerrm<>'attendance_report_version_required' then raise;end if;end;end $$;`));
      }
      await compatibility.step('rollback;');
    }finally{await compatibility.close();}
    assert.deepEqual(counts(),[0,0]);assert.equal(self().revision,1);
    pass('new source-captured request works before any revision approval; all old protocols refuse it even without terminal decisions or version nodes');
    const firstApproval=decideCommand(legacy.operationId);decide(firstApproval);
    const first=self(detail(legacy.operationId));assert.equal(first.item.status,'approved');assert.equal(first.item.basedOn.revision,1);assert.equal(first.item.decisionEffect.revision,2);
    assert.equal(first.canWithdraw,false);assert.equal(first.canSubmit,true);assert.equal(first.pendingRequestId,null);assert.equal(first.revision,1);
    assert.equal(self(detail(legacy.operationId,legacy.operationId),null,auth,false).receipt.command.expectedEffectiveOperationId,undefined);
    const legacyReplay=self(detail(legacy.operationId),legacy,auth,false);assert.equal(legacyReplay.item.status,'approved');assert.equal(legacyReplay.receipt.operationId,legacy.operationId);
    pass('approved legacy request exposes terminal state and immutable outcome; original seven-field operation recovers while paused');
    const second=next(6);assert.equal(second.expectedRevision,1);r=sendCycle(second);assert.equal(r.item.submittedRevision,2);assert.equal(r.item.basedOn.revision,2);assert.equal(r.item.status,'submitted');
    assert.throws(()=>sendCycle({...second,operationId:id(nonce++)}),/attendance_version_conflict/);
    assert.throws(()=>exec(`select public.faolla_attendance_revision_decide_v1('${site}','${owner}','${second.operationId}',null,null,true);`),/attendance_report_version_required/);
    const secondReview=inspect(second.operationId);assert.equal(secondReview.review.base.revision,2);assert.equal(secondReview.review.base.operationId,firstApproval.operationId);
    const secondApproval=decideCommand(second.operationId);decide(secondApproval);
    assert.equal(self().current.revision,3);assert.equal(self().current.workedUs,6*3600000000);assert.equal(self().canSubmit,true);
    const firstAgain=self(detail(legacy.operationId));assert.deepEqual(firstAgain.item,first.item);assert.equal(firstAgain.current.revision,3);
    assert.equal(report().totals.selected.workedUs,6*3600000000);assert.equal(report().rows.length,1);
    pass('consecutive submit revisions 1 and 2 need no fake withdrawal; second approval creates version 3 without changing earlier history');
    const third=next(5);sendCycle(third);const rejection=decideCommand(third.operationId,'reject');decide(rejection);
    r=self(detail(third.operationId));assert.equal(r.item.status,'rejected');assert.equal(r.item.decisionEffect,null);assert.equal(r.current.revision,3);assert.equal(r.canSubmit,true);
    assert.throws(()=>sendCycle({action:'withdraw',operationId:id(nonce++),requestId:third.operationId,expectedRevision:r.revision,reason:'Late withdrawal'}),/attendance_correction_closed/);
    const fourth=next(5);sendCycle(fourth);const withdrawn={action:'withdraw',operationId:id(nonce++),requestId:fourth.operationId,expectedRevision:4,reason:'Withdraw pending revision'};
    r=sendCycle(withdrawn,false);assert.equal(r.item.status,'withdrawn');assert.equal(r.item.revision,5);assert.equal(r.current.revision,3);assert.equal(r.canSubmit,false);
    assert.equal(self(detail(fourth.operationId,fourth.operationId)).receipt.action,'submit');assert.equal(self(detail(fourth.operationId,withdrawn.operationId)).receipt.action,'withdraw');
    assert.equal(self().canSubmit,true);assert.equal(self().pendingRequestId,null);
    pass('rejection releases pending state without changing hours; identical proposal can resubmit, and paused withdrawal keeps separate receipts');
    const fifth=next(4);assert.equal(fifth.expectedRevision,5);
    for(const patch of [{expectedEffectiveOperationId:oldOperation},{expectedBaseOperationId:firstApproval.operationId},{expectedPolicyRevision:2}])assert.throws(()=>sendCycle({...fifth,...patch}),/attendance_revision_base_changed|attendance_correction_policy_changed/);
    assert.throws(()=>sendCycle({...fifth,proposal:self().current.proposal}),/attendance_revision_unchanged/);
    assert.throws(()=>sendCycle({...fifth,operationId:firstApproval.operationId}),/attendance_operation_conflict/);
    assert.throws(()=>sendCycle({...fifth,expectedEffectiveOperationId:undefined}),/attendance_invalid_request/);
    const lock=control('lock_period',{fromDate:day(2),throughDate:day(2)});assert.equal(self().canSubmit,false);assert.throws(()=>sendCycle(fifth),/attendance_correction_period_locked/);control('unlock_period',{periodId:lock});
    r=sendCycle(fifth);assert.equal(r.item.basedOn.revision,3);const fifthApproval=decideCommand(fifth.operationId);decide(fifthApproval);
    assert.equal(self().current.revision,4);assert.equal(report().totals.selected.workedUs,4*3600000000);assert.deepEqual(counts(),[4,3]);
    pass('actual current predecessor, root, policy, changed proposal and current-period locks are mandatory; third approval creates version 4');
    const rejectedAgain=self(detail(third.operationId));assert.equal(rejectedAgain.item.status,'rejected');assert.equal(rejectedAgain.item.basedOn.revision,3);assert.equal(rejectedAgain.current.revision,4);
    const oldApprovalRecovery=approval.parseRevisionApprovalResult(JSON.parse(exec(`select ${decisionSql(legacy.operationId,null,firstApproval.operationId,false)};`)),{siteId:site,requestId:legacy.operationId,operationId:firstApproval.operationId});assert.equal(oldApprovalRecovery.receipt.operationId,firstApproval.operationId);assert.equal(oldApprovalRecovery.current.revision,4);
    assert.equal(oldApprovalRecovery.review.base.revision,1);assert.equal(oldApprovalRecovery.review.requestState,'approved');
    const previousOutcome=self(detail(second.operationId));assert.equal(previousOutcome.item.decisionEffect.revision,3);assert.equal(previousOutcome.current.revision,4);
    pass('historical approved/rejected details retain captured source and own outcome while current source advances');
    const a=next(3),b=next(2);let submitted;
    await race(`begin;select ${selfSql(detail(a.operationId),a)};`,`select ${selfSql(detail(b.operationId),b)};`,(o,held)=>{assert.match(String(o.error),/attendance_version_conflict/);submitted=cycles.parseRevisionCycleResult(JSON.parse(held),detail(a.operationId,a.operationId));});
    assert.equal(submitted.item.revision,7);assert.equal(self().pendingRequestId,a.operationId);
    exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';`);
    assert.equal(self().canSubmit,false);assert.equal(self(detail(a.operationId)).canWithdraw,true);assert.equal(self(detail(a.operationId,a.operationId),null,auth,false).receipt.operationId,a.operationId);
    const cancel={action:'withdraw',operationId:id(nonce++),requestId:a.operationId,expectedRevision:7,reason:'Cancel without submit permission'};sendCycle(cancel,false);
    exec(`update public.merchant_enterprise_roles set permissions=permissions||array['attendance.self.request'] where id='${role}';`);
    pass('concurrent new submissions serialize to one pending request; loss of request permission still permits own view, recovery and withdrawal');
    const sixth=next(3);sendCycle(sixth);const sixthApproval=decideCommand(sixth.operationId),lateCancel={action:'withdraw',operationId:id(nonce++),requestId:sixth.operationId,expectedRevision:9,reason:'Concurrent cancellation'};
    await race(`begin;select ${decisionSql(sixth.operationId,sixthApproval)};`,`select ${selfSql(detail(sixth.operationId),lateCancel)};`,o=>assert.match(String(o.error),/attendance_correction_closed/));
    assert.equal(self().current.revision,5);assert.equal(self(detail(sixth.operationId)).item.status,'approved');
    const seventh=next(2);sendCycle(seventh);const seventhApproval=decideCommand(seventh.operationId),earlyCancel={action:'withdraw',operationId:id(nonce++),requestId:seventh.operationId,expectedRevision:10,reason:'Cancel before decision'};
    await race(`begin;select ${selfSql(detail(seventh.operationId),earlyCancel)};`,`select ${decisionSql(seventh.operationId,seventhApproval)};`,o=>assert.match(String(o.error),/attendance_version_conflict/));
    assert.equal(self().current.revision,5);assert.equal(self(detail(seventh.operationId)).item.status,'withdrawn');assert.equal(self().revision,11);
    pass('both approval-versus-withdrawal commit orders are safe: winner remains authoritative, loser cannot rewrite terminal state');
    const recovered=self(detail(a.operationId,a.operationId),null,auth,false);assert.equal(recovered.item.status,'withdrawn');assert.equal(recovered.current.revision,5);assert.equal(recovered.receipt.revision,7);
    assert.equal(sendCycle(a,false).receipt.operationId,a.operationId);assert.throws(()=>sendCycle({...a,reason:'different'},false),/attendance_operation_conflict/);
    assert.equal(self(detail(a.operationId,id(998)),null,auth,false).receipt,null);
    exec(`update public.merchant_attendance_workers set employee_id='${other}' where id='${worker}';`);
    assert.throws(()=>self(),/attendance_access_denied/);assert.throws(()=>self(prepare,null,otherAuth),/attendance_revision_base_not_found/);
    exec(`update public.merchant_attendance_workers set employee_id='${employee}' where id='${worker}';`);
    assert.equal(fingerprint(),factsBefore);assert.equal(report().totals.original.workedUs,8*3600000000);assert.equal(report().totals.selected.workedUs,3*3600000000);
    assert.equal(report().rows[0].correction.revision,5);assert.deepEqual(counts(),[5,4]);
    pass('old operation recovery stays exact after many cycles; revoked/rebound identity cannot recover, raw facts remain unchanged');
    // Owned sandbox adapter only. Application roles remain denied above; this is
    // real protocol/executor validation, not an enabled HTTP/application RPC.
    const candidateService={rpc:async(name,args)=>{
      try{
        let expression;
        if(name==='faolla_attendance_revision_self_v2')expression=`public.${name}('${args.p_site_id}','${args.p_auth_user_id}',${json(args.p_query)},${args.p_command?json(args.p_command):'null'},${args.p_platform_enabled})`;
        else if(name==='faolla_attendance_self_context_v1')expression=`public.${name}('${args.p_site_id}','${args.p_auth_user_id}')`;
        else if(name==='faolla_attendance_revision_history_v1')expression=`public.${name}('${args.p_site_id}','${args.p_auth_user_id}',${json(args.p_query)})`;
        else if(name==='faolla_attendance_revision_owner_review_v3')expression=`public.${name}('${args.p_site_id}','${args.p_auth_user_id}','${args.p_request_id}')`;
        else if(['faolla_attendance_revision_decide_v2','faolla_attendance_correction_decide_v2'].includes(name))expression=`public.${name}('${args.p_site_id}','${args.p_auth_user_id}','${args.p_request_id}',${args.p_command?json(args.p_command):'null'},${args.p_operation_id?`'${args.p_operation_id}'`:'null'},${args.p_allow_write})`;
        else throw Error('synthetic unexpected RPC');
        return {data:JSON.parse(exec(`${name==='faolla_attendance_self_context_v1'?'set role service_role;':''}select ${expression};`)),error:null};
      }catch(e){const code=String(e).match(/attendance_(?:access_denied|platform_paused|operation_conflict|version_conflict|revision_base_changed|worker_changed|revision_base_not_found|invalid_request)/)?.[0]??'synthetic RPC failure';return {data:null,error:{message:code}};}
    }};
    const ownerInput={query:{siteId:site,requestId:legacy.operationId,operationId:firstApproval.operationId},command:null,authUserId:owner,allowWrite:false};
    const ownerRecovered=await decisionService.executeRevisionDecision(ownerInput,candidateService);
    assert.equal(ownerRecovered.current.revision,5);assert.equal(ownerRecovered.receipt.operationId,firstApproval.operationId);assert.equal(ownerRecovered.replayed,true);
    assert.equal((await decisionService.executeRevisionApprovalReview({query:{siteId:site,requestId:third.operationId},authUserId:owner},candidateService)).requestState,'rejected');
    assert.equal((await cycleService.executeRevisionCycle({query:detail(a.operationId,a.operationId),command:null,authUserId:auth,moduleEnabled:false},candidateService)).item.status,'withdrawn');
    await assert.rejects(decisionService.executeRevisionDecision({...ownerInput,authUserId:otherAuth},candidateService),/attendance_access_denied/);
    const eighth=next(2);
    assert.equal((await cycleService.executeRevisionCycle({query:detail(eighth.operationId),command:eighth,authUserId:auth,moduleEnabled:true},candidateService)).receipt.operationId,eighth.operationId);
    const eighthReject=decideCommand(eighth.operationId,'reject'),newInput={query:{siteId:site,requestId:eighth.operationId,operationId:null},command:eighthReject,authUserId:owner,allowWrite:true};
    const newResult=await decisionService.executeRevisionDecision(newInput,candidateService);assert.equal(newResult.decision.action,'reject');assert.equal(newResult.replayed,false);assert.equal(newResult.current.revision,5);
    const replayed=await decisionService.executeRevisionDecision({...newInput,allowWrite:false},candidateService);assert.equal(replayed.replayed,true);assert.equal(replayed.effectiveChanged,false);
    assert.equal((await cycleService.executeRevisionCycle({query:detail(eighth.operationId),command:null,authUserId:auth,moduleEnabled:true},candidateService)).item.status,'rejected');
    assert.deepEqual(counts(),[6,4]);assert.equal(fingerprint(),factsBefore);
    pass('candidate executors validate real SQL, fresh rejection and paused exact replay; current owner identity and historical employee receipt stay enforced without application grants');
    const ninth=next(2);
    await cycleService.executeRevisionCycle({query:detail(ninth.operationId),command:ninth,authUserId:auth,moduleEnabled:true},candidateService);
    const ninthInput={query:{siteId:site,requestId:ninth.operationId,operationId:null},command:null,authUserId:owner,allowWrite:true};
    const preflight=await decisionService.executeRevisionDecision(ninthInput,candidateService);assert.equal(preflight.canApprove,true);
    const ninthApproval={action:'approve',operationId:id(nonce++),requestId:ninth.operationId,expectedRevision:preflight.review.submittedRevision,
      expectedEvidence:preflight.evidenceToken,expectedBaseOperationId:preflight.current.operationId,reason:'Synthetic executor approval'};
    const applied=await decisionService.executeRevisionDecision({...ninthInput,command:ninthApproval},candidateService);
    assert.equal(applied.current.revision,6);assert.equal(applied.effectiveChanged,true);assert.equal(applied.replayed,false);
    const own=await cycleService.executeRevisionCycle({query:detail(ninth.operationId),command:null,authUserId:auth,moduleEnabled:true},candidateService);
    assert.equal(own.item.status,'approved');assert.equal(own.item.decisionEffect.revision,6);assert.equal(report().rows[0].correction.revision,6);
    assert.equal(report().totals.selected.workedUs,2*3600000000);assert.equal(report().totals.original.workedUs,8*3600000000);assert.deepEqual(counts(),[7,5]);
    pass('candidate employee/owner executors submit, preflight and approve into version 6, with exact source visible in employee detail and latest report');
    exec(`update public.merchants set user_id='${otherAuth}' where id='${site}';`);
    try{
      await assert.rejects(decisionService.executeRevisionDecision(ownerInput,candidateService),/attendance_access_denied/);
      const transferred=await decisionService.executeRevisionDecision({...ownerInput,authUserId:otherAuth},candidateService);
      assert.equal(transferred.decision.operationId,firstApproval.operationId);assert.equal(transferred.receipt,null);assert.equal(transferred.current.revision,6);
      await assert.rejects(decisionService.executeRevisionDecision({...ownerInput,query:{...ownerInput.query,operationId:null},command:firstApproval,authUserId:otherAuth},candidateService),/attendance_operation_conflict/);
    }finally{exec(`update public.merchants set user_id='${owner}' where id='${site}';`);}
    assert.equal(fingerprint(),factsBefore);assert.deepEqual(counts(),[7,5]);
    pass('after actual synthetic owner transfer, old owner loses recovery access and new owner can inspect history but cannot replay the former owner operation');
    // Report application RPCs retain their existing service_role grants. This
    // adapter NEVER calls private revision writers with that role.
    const reportRpc={rpc:async(name,args)=>{
      try{
        assert(['faolla_attendance_period_report_v2','faolla_attendance_scoped_period_report_v2','faolla_attendance_period_export_v2'].includes(name));
        const expression=`public.${name}('${args.p_site_id}','${args.p_auth_user_id}',${name.endsWith('export_v2')?`'${args.p_operation_id}',`:''}${json(args.p_query)})`;
        return {data:JSON.parse(exec(`set role service_role;select ${expression};`)),error:null};
      }catch(e){return {data:null,error:{message:String(e).match(/attendance_(?:access_denied|export_denied|self_identity_changed|scope_changed|report_version_required)/)?.[0]??'synthetic RPC failure'}};}
    }};
    const manager=id(21),managerAuth=id(22),managerRole=id(23),grant=id(24);
    exec(`begin;
      update public.merchant_enterprise_roles set permissions=permissions||array['attendance.self.export'] where id='${role}';
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${managerRole}','${site}','Manager',array['enterprise.view','attendance.records.view','attendance.reports.export']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${manager}','${site}','${managerAuth}','pipeline-manager@example.test','Synthetic manager','${managerRole}','active');
      insert into public.merchant_attendance_scopes(merchant_id,employee_id,revision) values('${site}','${manager}',1);
      insert into public.merchant_attendance_scope_grants(merchant_id,employee_id,id,valid_from,valid_until) values('${site}','${manager}','${grant}','2000-01-01Z',clock_timestamp()+interval '1 hour');
      insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${manager}','${grant}','${worker}');
      insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id) values('${site}','${manager}','${grant}','${loc}');commit;`);
    const ownerQuery={siteId:site,workerId:worker,fromDate:day(5),throughDate:day(1)},version=reports.ATTENDANCE_REPORT_SOURCE_VERSION;
    const ownerReport=await reportService.executeAttendanceTimesheet({query:ownerQuery,authUserId:owner},reportRpc);
    const ownerHttp=reportBrowser.parseAttendanceTimesheetResponse(await Response.json({ok:true,moduleEnabled:false,...ownerReport}).json(),ownerQuery,version);
    assert.equal(ownerHttp.rows[0].correction.revision,6);assert.equal(ownerHttp.rows[0].correction.operationId,ninthApproval.operationId);
    assert.equal(ownerHttp.rows[0].correction.lineage.rootOperationId,oldOperation);assert.equal(ownerHttp.rows[0].correction.lineage.previousOperationId,sixthApproval.operationId);
    assert.equal(ownerHttp.totals.original.workedUs,8*3600000000);assert.equal(ownerHttp.totals.selected.workedUs,2*3600000000);
    assert.equal(ownerHttp.moduleEnabled,false);assert.throws(()=>reportBrowser.parseAttendanceTimesheetResponse({ok:true,moduleEnabled:false,...ownerReport},ownerQuery));
    await assert.rejects(reportService.executeAttendanceTimesheet({query:ownerQuery,authUserId:auth},reportRpc),/attendance_access_denied/);
    pass('actual owner application service_role RPC and computed browser response preserve version 6 root/current/predecessor and 8h raw versus 2h approved, even while collection is paused');
    const scopedQuery=access=>({siteId:site,access,fromDate:ownerQuery.fromDate,throughDate:ownerQuery.throughDate,...(access==='self'?{expectedWorkerId:worker}:{workerId:worker,locationId:loc})});
    for(const access of ['self','manager']){
      const q=scopedQuery(access),viewer=access==='self'?employee:manager;
      const result=await scopedService.executeAttendanceScopedTimesheet({query:q,authUserId:access==='self'?auth:managerAuth},reportRpc);
      const parsed=scopedBrowser.parseScopedTimesheetResponse(await Response.json({ok:true,moduleEnabled:false,...result}).json(),q,viewer,version);
      assert.deepEqual(parsed.totals,ownerHttp.totals);assert.deepEqual(parsed.rows[0].correction,ownerHttp.rows[0].correction);assert.equal('employeeId' in parsed,false);
      assert.equal(parsed.coverage,'authorized-complete-sessions-v1');assert.throws(()=>scopedBrowser.parseScopedTimesheetResponse({ok:true,moduleEnabled:false,...result},q,other,version));
      if(access==='manager')assert(parsed.accessValidUntil>parsed.asOf);else assert.equal(parsed.accessValidUntil,null);
    }
    pass('self and manager application services and browser validators agree with owner latest source, with private identity omitted and finite manager expiry preserved');
    const exported=[];
    for(const access of ['owner','self','manager']){
      const command={siteId:site,operationId:id(nonce++),query:{access,workerId:access==='self'?null:worker,locationId:access==='manager'?loc:null,expectedWorkerId:access==='self'?worker:null,
        fromDate:ownerQuery.fromDate,throughDate:ownerQuery.throughDate,expectedTimeZone:'Europe/Madrid',expectedScopeRevision:access==='manager'?1:null}},authUserId=access==='owner'?owner:access==='self'?auth:managerAuth;
      const result=await exportService.executeTimesheetExport({command,authUserId},reportRpc);exported.push({command,authUserId});
      for(const value of [version,ninthApproval.operationId,oldOperation,sixthApproval.operationId,'lineage.previousOperationId',String(2*3600000000)])assert(result.csv.includes(value));
      assert(!result.csv.includes('[object Object]'));assert(!result.csv.includes('actorEmployeeId'));assert.equal(result.receipt.downloadConfirmed,false);
      const replay=await exportService.executeTimesheetExport({command,authUserId},reportRpc);assert.equal(replay.csv,null);assert.equal(replay.filename,null);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,result.receipt);
    }
    assert.equal(exec('select count(*) from public.merchant_attendance_report_exports;'),'3');
    pass('actual CSV exporter reads latest v2 via service_role, exports matching immutable source references and exact microseconds, and replays only the three receipts without files');
    exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.records.view'] where id='${managerRole}';`);
    await assert.rejects(exportService.executeTimesheetExport(exported[2],reportRpc),/attendance_export_denied/);
    exec(`update public.merchant_enterprise_roles set permissions=permissions||array['attendance.reports.export'] where id='${managerRole}';update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()-interval '1 second' where id='${grant}';`);
    await assert.rejects(scopedService.executeAttendanceScopedTimesheet({query:scopedQuery('manager'),authUserId:managerAuth},reportRpc),/attendance_access_denied/);
    await assert.rejects(exportService.executeTimesheetExport(exported[2],reportRpc),/attendance_access_denied/);
    exec(`update public.merchant_attendance_workers set employee_id='${other}' where id='${worker}';`);
    try{
      const fresh=await scopedService.executeAttendanceScopedTimesheet({query:scopedQuery('self'),authUserId:otherAuth},reportRpc);assert.equal(fresh.rows.length,0);assert.equal(fresh.totals.selected.workedUs,0);
      await assert.rejects(scopedService.executeAttendanceScopedTimesheet({query:scopedQuery('self'),authUserId:auth},reportRpc));
    }finally{exec(`update public.merchant_attendance_workers set employee_id='${employee}' where id='${worker}';`);}
    assert.deepEqual(counts(),[7,5]);assert.equal(fingerprint(),factsBefore);
    pass('report/export services recheck revoked export permission, expired pair grants and employee rebinding; original source ledgers remain byte-for-byte unchanged');
    const firstInput=(request,command=null,operation=null,allowWrite=true,who=owner)=>({query:{siteId:site,requestId:request,operationId:operation},command,authUserId:who,allowWrite});
    const firstSql=(request,command=null,operation=null,allowWrite=true,who=owner)=>`public.faolla_attendance_correction_decide_v2('${site}','${who}','${request}',${command?json(command):'null'},${operation?`'${operation}'`:'null'},${allowWrite})`;
    const firstService=input=>currentCorrection.executeCurrentCorrectionDecision(input,candidateService);
    const historic=await firstService(firstInput(oldRequest,null,oldOperation,false));
    assert.equal(historic.decisionEffect.revision,1);assert.equal(historic.decisionEffect.workedUs,9*3600000000);
    assert.equal(historic.current.revision,6);assert.equal(historic.current.workedUs,2*3600000000);assert.equal(historic.replayed,true);assert.equal(historic.effectiveChanged,false);
    for(const roleName of ['anon','authenticated','service_role']){
      assert.throws(()=>exec(`set role ${roleName};select ${firstSql(oldRequest)};`),/permission denied/);
      assert.throws(()=>exec(`set role ${roleName};select public.faolla_attendance_decision_checks_v2('${site}','{}'::jsonb);`),/permission denied/);
    }
    pass('new private first-decision protocol exposes immutable 9h initial approval separately from current version 6 at 2h; old receipt recovers while paused, without application grants');
    const initialRoot=exec(`select to_jsonb(t)::text from public.merchant_attendance_correction_effects t where merchant_id='${site}' and request_id='${oldRequest}';`);
    const initialEvents=exec(`select jsonb_agg(to_jsonb(t) order by sequence)::text from public.merchant_attendance_events t where merchant_id='${site}' and id in ('${id(101)}','${id(102)}');`);
    exec(`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
      ('${id(103)}','${site}','${worker}','${loc}','${id(203)}',3,'clock_in','web','${at(1,'16:00')}','Europe/Madrid','${employee}'),
      ('${id(104)}','${site}','${worker}','${loc}','${id(204)}',4,'clock_out','web','${at(1,'18:00')}','Europe/Madrid','${employee}');`);
    const submitOther=(start,end,revision)=>{const request=id(nonce++);exec(`set role service_role;select public.faolla_attendance_correction_self_v3('${site}','${auth}',${json({mode:'detail',expectedWorkerId:worker,requestId:request,operationId:null})},${json({action:'submit',operationId:request,expectedRevision:revision,expectedPolicyRevision:1,reason:'Synthetic other shift',startEventId:id(103),expectedLastEventId:id(104),proposal:{startAt:at(2,start),endAt:at(2,end),breaks:[]}})},true);`);return request;};
    const firstCommand=(r,action='approve')=>({action,operationId:id(nonce++),requestId:r.review.item.requestId,expectedRevision:r.review.item.revision,expectedEvidence:r.evidenceToken,reason:'Synthetic current-source first decision'});
    const overlapping=submitOther('09:00','11:00',0),overlap=await firstService(firstInput(overlapping));
    assert.equal(overlap.current,null);assert.equal(overlap.canApprove,false);assert.equal(overlap.canReject,true);assert(overlap.blockers.includes('effective_overlap'));
    const legacyCheck=JSON.parse(exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${overlapping}',null,null,true);`));
    assert.equal(legacyCheck.canApprove,true);assert.throws(()=>exec(`set role service_role;select public.faolla_attendance_correction_decide_v1('${site}','${owner}','${overlapping}',${json({...firstCommand(overlap),expectedEvidence:legacyCheck.evidenceToken})},null,true);`),/attendance_report_version_required/);
    assert.throws(()=>exec(`select ${firstSql(overlapping,firstCommand(overlap))};`),/attendance_correction_decision_blocked/);
    const rejected=await firstService(firstInput(overlapping,firstCommand(overlap,'reject')));assert.equal(rejected.current,null);assert.equal(rejected.decisionEffect,null);assert.equal(rejected.replayed,false);
    pass('latest-source conflict blocks a new first approval that the historical-only check would permit; legacy write still fails closed and explicit rejection changes no hours');
    const touching=submitOther('10:00','12:00',1),touch=await firstService(firstInput(touching));
    assert.equal(touch.canApprove,true);assert.equal(touch.current,null);const touchingCommand=firstCommand(touch);
    for(const operationId of [oldRequest,ninth.operationId,ninthApproval.operationId,touching])assert.throws(()=>exec(`select ${firstSql(touching,{...touchingCommand,operationId})};`),/attendance_operation_conflict/);
    assert.throws(()=>exec(`select ${firstSql(touching,touchingCommand,null,false)};`),/attendance_platform_paused/);
    const racing=next(3);sendCycle(racing);const racingApproval=decideCommand(racing.operationId);
    await race(`begin;select ${decisionSql(racing.operationId,racingApproval)};`,`select ${firstSql(touching,touchingCommand)};`,o=>assert.match(String(o.error),/attendance_correction_evidence_changed/));
    assert.equal(self().current.revision,7);assert.equal(exec(`select count(*) from public.merchant_attendance_correction_decisions where merchant_id='${site}' and request_id='${touching}';`),'0');
    const changed=await firstService(firstInput(touching));assert.equal(changed.canApprove,false);assert(changed.blockers.includes('effective_overlap'));
    await firstService(firstInput(touching,firstCommand(changed,'reject')));
    pass('half-open boundary and superseded-version exclusion permit initial preflight; concurrent revision wins the exact settings lock and stale first approval creates no decision');
    const permitted=submitOther('11:00','13:00',2),readyFirst=await firstService(firstInput(permitted));assert.equal(readyFirst.canApprove,true);
    const permittedCommand=firstCommand(readyFirst),reverseRequest=next(5);sendCycle(reverseRequest);const reverseApproval=decideCommand(reverseRequest.operationId);let newFirst;
    await race(async holder=>{
      await holder.step('begin;');
      return currentCorrection.executeCurrentCorrectionDecision(firstInput(permitted,permittedCommand),{rpc:async(name,args)=>{
        assert.equal(name,'faolla_attendance_correction_decide_v2');assert.equal(args.p_auth_user_id,owner);assert.equal(args.p_site_id,site);
        assert.equal(args.p_request_id,permitted);assert.deepEqual(args.p_command,permittedCommand);assert.equal(args.p_allow_write,true);assert.equal(args.p_operation_id,null);
        return {data:JSON.parse(await holder.step(sql(`select ${firstSql(permitted,permittedCommand)};`))),error:null};
      }});
    },`select ${decisionSql(reverseRequest.operationId,reverseApproval)};`,(o,held)=>{assert.match(String(o.error),/attendance_correction_evidence_changed/);newFirst=held;});
    assert.equal(self().current.revision,7);assert(inspect(reverseRequest.operationId).blockers.includes('effective_overlap'));
    const reversePending=self(detail(reverseRequest.operationId));sendCycle({action:'withdraw',operationId:id(nonce++),requestId:reverseRequest.operationId,expectedRevision:reversePending.revision,reason:'Withdraw after real conflict'},false);
    assert.equal(newFirst.decisionEffect.revision,1);assert.equal(newFirst.current.revision,1);assert.equal(newFirst.current.workedUs,2*3600000000);assert.equal(newFirst.effectiveChanged,true);assert.equal(newFirst.replayed,false);
    const firstReplay=await firstService(firstInput(permitted,permittedCommand,null,false));assert.equal(firstReplay.replayed,true);assert.equal(firstReplay.effectiveChanged,false);
    const rejectedHistory=await firstService(firstInput(overlapping));assert.equal(rejectedHistory.decisionEffect,null);assert.equal(rejectedHistory.current.lineage.rootRequestId,permitted);assert.equal(rejectedHistory.current.revision,1);
    const latestRoot=await firstService(firstInput(oldRequest));assert.equal(latestRoot.decisionEffect.workedUs,9*3600000000);assert.equal(latestRoot.current.revision,7);assert.equal(latestRoot.current.workedUs,3*3600000000);
    assert.equal(report().rows.length,2);assert.equal(report().totals.selected.workedUs,5*3600000000);assert.equal(report().totals.original.workedUs,10*3600000000);
    pass('first-approval-wins inverse race also rejects stale overlapping revision; actual executor approves another shift after seven versions, rejection history shows its different root and reports total 10h raw and 5h selected');
    exec(`update public.merchants set user_id='${otherAuth}' where id='${site}';`);
    try{
      await assert.rejects(firstService(firstInput(permitted,null,permittedCommand.operationId,false)),/attendance_access_denied/);
      const transferred=await firstService(firstInput(permitted,null,permittedCommand.operationId,false,otherAuth));assert.equal(transferred.receipt,null);assert.equal(transferred.decision.operationId,permittedCommand.operationId);assert.equal(transferred.current.revision,1);
      await assert.rejects(firstService(firstInput(permitted,permittedCommand,null,false,otherAuth)),/attendance_operation_conflict/);
    }finally{exec(`update public.merchants set user_id='${owner}' where id='${site}';`);}
    assert.equal(exec(`select to_jsonb(t)::text from public.merchant_attendance_correction_effects t where merchant_id='${site}' and request_id='${oldRequest}';`),initialRoot);
    assert.equal(exec(`select jsonb_agg(to_jsonb(t) order by sequence)::text from public.merchant_attendance_events t where merchant_id='${site}' and id in ('${id(101)}','${id(102)}');`),initialEvents);
    pass('current-owner access/recovery remains authoritative after transfer; original root approval and punches remain byte-for-byte unchanged');
    // Actual handler/client over owned SQL, with synthetic authentication only.
    // This neither grants service_role execution nor claims a real-login test.
    const storedCommand=JSON.parse(exec(`select command::text from public.merchant_attendance_correction_decisions where merchant_id='${site}' and operation_id='${oldOperation}';`));
    const beforeHttp=fingerprint(),pendingKey=currentBrowser.correctionDecisionKey(site,owner),pendingValue=JSON.stringify({siteId:site,ownerId:owner,command:storedCommand});
    const pendingStore=new Map([[pendingKey,pendingValue]]),httpCalls=[];let httpActor=owner;
    const storage={getItem:key=>pendingStore.get(key)??null,setItem:(key,value)=>pendingStore.set(key,value),removeItem:key=>pendingStore.delete(key)};
    const httpDeps={enabled:()=>true,allow:()=>true,
      authenticate:async()=>({user:{id:httpActor},accessToken:'synthetic',authenticationMethods:['password']}),
      entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}),
      execute:input=>currentCorrection.executeCurrentCorrectionDecision(input,candidateService)};
    const apiFetch=async(input,init={})=>{
      const url=new URL(input,'https://www.faolla.com');assert.equal(url.origin,'https://www.faolla.com');assert.equal(url.pathname,'/api/merchant-enterprise/attendance/correction-decisions');
      const method=init.method??'GET';httpCalls.push({method,requestId:url.searchParams.get('requestId'),operationId:url.searchParams.get('operationId')});
      const response=await currentHttp.handleCorrectionDecision(new Request(url,{...init,headers:{...init.headers,...(method==='POST'?{origin:url.origin}:{})}}),httpDeps);
      assert.equal(response.headers.get('cache-control'),'private, no-store');return response;
    };
    const browserClient=new currentBrowser.AttendanceCorrectionDecisionClient({siteId:site,ownerId:owner,apiFetch,storage:()=>storage});
    try{
      await browserClient.initialize(permitted);const state=browserClient.getSnapshot();
      assert.deepEqual(httpCalls,[{method:'GET',requestId:oldRequest,operationId:oldOperation}]);
      assert.equal(state.phase,'ready');assert.equal(state.requestId,oldRequest);assert.equal(state.pending,null);assert.equal(pendingStore.size,0);
      assert.equal(state.result.moduleEnabled,false);assert.equal(state.result.replayed,true);assert.equal(state.result.effectiveChanged,false);
      assert.equal(state.result.decisionEffect.workedUs,9*3600000000);assert.equal(state.result.current.revision,7);assert.equal(state.result.current.workedUs,3*3600000000);
      const response=await apiFetch('/api/merchant-enterprise/attendance/correction-decisions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({siteId:site,...storedCommand})});
      assert.equal(response.status,200);
      const replay=currentResponse.parseCurrentCorrectionResponse(await response.json(),{siteId:site,requestId:oldRequest,operationId:oldOperation});
      assert.equal(replay.replayed,true);assert.equal(replay.effectiveChanged,false);assert.equal(replay.current.revision,7);assert.equal(replay.receipt.operationId,oldOperation);
      await browserClient.initialize(overlapping);const rejectedState=browserClient.getSnapshot();
      assert.equal(rejectedState.phase,'ready');assert.equal(rejectedState.result.decision.action,'reject');assert.equal(rejectedState.result.decisionEffect,null);
      assert.equal(rejectedState.result.current.lineage.rootRequestId,permitted);assert.equal(rejectedState.result.current.workedUs,2*3600000000);
      assert.equal(fingerprint(),beforeHttp);
    }finally{browserClient.pause();}
    pass('actual SQL to executor to HTTP to browser state recovers the exact legacy slot by GET while paused: immutable 9h versus revision 7 at 3h; explicit replay and another-root rejection history change no facts');
    pendingStore.set(pendingKey,pendingValue);httpActor=auth;httpCalls.length=0;
    const deniedClient=new currentBrowser.AttendanceCorrectionDecisionClient({siteId:site,ownerId:owner,apiFetch,storage:()=>storage});
    try{
      await deniedClient.initialize(permitted);const denied=deniedClient.getSnapshot();
      assert.equal(denied.phase,'unconfirmed');assert.equal(denied.result,null);assert.deepEqual(denied.pending.command,storedCommand);
      assert.equal(pendingStore.get(pendingKey),pendingValue);assert.match(denied.message,/不是此企业的有效负责人/);
      assert.deepEqual(httpCalls,[{method:'GET',requestId:oldRequest,operationId:oldOperation}]);assert.equal(fingerprint(),beforeHttp);
    }finally{deniedClient.pause();pendingStore.clear();}
    pass('SQL authority denial reaches the real HTTP/browser recovery boundary: no private result or automatic POST, original uncertain command retained unchanged');
    const cycleStore=new Map(),cycleCalls=[];let cycleEnabled=true,loseCycleReply=false;
    const cycleStorage={getItem:k=>cycleStore.get(k)??null,setItem:(k,v)=>cycleStore.set(k,v),removeItem:k=>cycleStore.delete(k)};
    const cycleDeps={enabled:()=>true,allow:()=>true,authenticate:async()=>({user:{id:auth},accessToken:'synthetic',authenticationMethods:['password']}),
      entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:cycleEnabled}}),
      execute:input=>cycleService.executeRevisionCycle(input,candidateService)};
    const cycleFetch=async(input,init={})=>{
      const url=new URL(input,'https://www.faolla.com'),method=init.method??'GET';assert.equal(url.origin,'https://www.faolla.com');
      assert(['/api/merchant-enterprise/attendance/corrections/context','/api/merchant-enterprise/attendance/revision-requests'].includes(url.pathname));cycleCalls.push({method,path:url.pathname});
      const request=new Request(url,{...init,headers:{...init.headers,...(method==='POST'?{origin:url.origin}:{})}});
      const response=url.pathname.endsWith('/context')?await contextHttp.handleCorrectionContext(request,{...cycleDeps,execute:input=>contextService.executeAttendanceSelfContext(input,candidateService)}):await cycleHttp.handleAttendanceRevision(request,cycleDeps);
      assert.equal(response.headers.get('cache-control'),'private, no-store');
      if(loseCycleReply&&method==='POST'&&response.status===200)throw Error('synthetic lost reply after real commit');return response;
    };
    const employeeBrowser=new cycleBrowser.AttendanceRevisionCycleClient({siteId:site,employeeId:employee,apiFetch:cycleFetch,storage:()=>cycleStorage,randomId:()=>id(nonce++)});
    try{
      await employeeBrowser.initialize({workerId:worker,baseRequestId:oldRequest});let state=employeeBrowser.getSnapshot();assert.equal(state.phase,'ready',state.message);assert.equal(state.result.current.revision,7);
      loseCycleReply=true;await employeeBrowser.submit(proposal(2),'Synthetic browser cycle');state=employeeBrowser.getSnapshot();assert.equal(state.phase,'unconfirmed');assert.equal(cycleStore.size,1);
      const sent=state.pending.command;assert.equal(sent.expectedEffectiveOperationId,racingApproval.operationId);assert.equal(sent.expectedBaseOperationId,oldOperation);
      const pendingRequest=sent.operationId,applied=await decisionService.executeRevisionDecision({query:{siteId:site,requestId:pendingRequest,operationId:null},command:decideCommand(pendingRequest),authUserId:owner,allowWrite:true},candidateService);
      assert.equal(applied.current.revision,8);cycleEnabled=false;loseCycleReply=false;employeeBrowser.pause();await employeeBrowser.initialize(null);state=employeeBrowser.getSnapshot();
      assert.equal(state.phase,'ready');assert.equal(state.result.item.status,'approved');assert.equal(state.result.item.basedOn.revision,7);assert.equal(state.result.current.revision,8);
      assert.equal(state.result.current.workedUs,2*3600000000);assert.equal(state.result.moduleEnabled,false);assert.equal(state.pending,null);assert.equal(cycleCalls.filter(c=>c.method==='POST').length,1);
      assert.equal(report().totals.original.workedUs,10*3600000000);assert.equal(report().totals.selected.workedUs,4*3600000000);assert.equal(fingerprint(),beforeHttp);
      pass('actual self context and cycle HTTP/browser submit from version 7, lose committed reply, then recover after private owner approval to version 8 while paused; only one POST and original records unchanged');
      cycleEnabled=true;await employeeBrowser.prepare();await employeeBrowser.submit(proposal(1),'Synthetic next request');assert.equal(employeeBrowser.getSnapshot().result.item.status,'submitted');
      cycleEnabled=false;await employeeBrowser.initialize();assert.equal(employeeBrowser.getSnapshot().result.canWithdraw,true);loseCycleReply=true;await employeeBrowser.withdraw('Synthetic paused withdrawal');
      assert.equal(employeeBrowser.getSnapshot().phase,'unconfirmed');const originalPending=cycleStore.get(employeeBrowser.storageKey);loseCycleReply=false;
      exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${role}';`);
      try{await employeeBrowser.initialize();assert.equal(employeeBrowser.getSnapshot().phase,'blocked');assert.equal(employeeBrowser.getSnapshot().result,null);assert.equal(cycleStore.get(employeeBrowser.storageKey),originalPending);}
      finally{exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.request'] where id='${role}';`);}
      await employeeBrowser.initialize();state=employeeBrowser.getSnapshot();assert.equal(state.phase,'ready');assert.equal(state.result.item.status,'withdrawn');assert.equal(state.result.current.revision,8);
      assert.equal(state.pending,null);assert.equal(cycleStore.size,0);assert.equal(cycleCalls.filter(c=>c.method==='POST').length,3);assert.equal(fingerprint(),beforeHttp);
      pass('real HTTP/browser allows explicit withdrawal while collection paused, hides revoked self access without losing intent, then restores exact receipt after permission returns with no additional POST');
    }finally{employeeBrowser.pause();cycleStore.clear();}
    const approvalRequest=next(1);sendCycle(approvalRequest);
    const approvalStore=new Map(),approvalCalls=[];let approvalEnabled=true,loseApprovalReply=true,approvalActor=owner;
    const approvalStorage={getItem:k=>approvalStore.get(k)??null,setItem:(k,v)=>approvalStore.set(k,v),removeItem:k=>approvalStore.delete(k)};
    const approvalDeps={enabled:()=>true,allow:()=>true,authenticate:async()=>({user:{id:approvalActor},accessToken:'synthetic',authenticationMethods:['password']}),
      entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:approvalEnabled}}),
      execute:input=>decisionService.executeRevisionDecision(input,candidateService)};
    const approvalFetch=async(input,init={})=>{
      const url=new URL(input,'https://www.faolla.com'),method=init.method??'GET';assert.equal(url.origin,'https://www.faolla.com');assert.equal(url.pathname,'/api/merchant-enterprise/attendance/revision-decisions');
      approvalCalls.push({method,path:url.pathname});const r=await approvalHttp.handleRevisionDecision(new Request(url,{...init,headers:{...init.headers,...(method==='POST'?{origin:url.origin}:{})}}),approvalDeps);
      assert.equal(r.headers.get('cache-control'),'private, no-store');if(loseApprovalReply&&method==='POST'&&r.status===200)throw Error('synthetic lost owner reply after real commit');return r;
    };
    const approving=new approvalBrowser.AttendanceRevisionApprovalClient({siteId:site,ownerId:owner,apiFetch:approvalFetch,storage:()=>approvalStorage,randomId:()=>id(nonce++)});
    try{
      await approving.initialize(approvalRequest.operationId);let s=approving.getSnapshot();assert.equal(s.phase,'ready',s.message);assert.equal(s.result.current.revision,8);assert.equal(s.result.canApprove,true);
      await approving.submit({action:'approve',reason:'Synthetic HTTP owner approval'});s=approving.getSnapshot();assert.equal(s.phase,'unconfirmed');assert.equal(approvalStore.size,1);
      const sent=s.pending.command,saved=approvalStore.get(approving.storageKey);assert.equal(self().current.revision,9);assert.equal(self().current.operationId,sent.operationId);
      assert.equal(self().current.workedUs,3600000000);assert.equal(report().totals.original.workedUs,10*3600000000);assert.equal(report().totals.selected.workedUs,3*3600000000);
      pass('actual owner client stores captured predecessor, submits through HTTP/private executor/SQL, loses committed reply and produces version 9 at 1h; only one POST and raw total remains 10h');
      const later=next(2);sendCycle(later);const laterDecision=decideCommand(later.operationId);decide(laterDecision);approvalEnabled=false;loseApprovalReply=false;
      approving.pause();await approving.initialize(oldRequest);s=approving.getSnapshot();assert.equal(s.phase,'ready',s.message);assert.equal(s.requestId,approvalRequest.operationId);
      assert.equal(s.result.decision.operationId,sent.operationId);assert.equal(s.result.review.base.revision,8);assert.equal(s.result.current.revision,10);assert.equal(s.result.current.operationId,laterDecision.operationId);
      assert.equal(s.result.replayed,true);assert.equal(s.result.effectiveChanged,false);assert.equal(s.result.moduleEnabled,false);assert.equal(s.pending,null);assert.equal(approvalStore.size,0);
      assert.equal(approvalCalls.filter(c=>c.method==='POST').length,1);assert.equal(report().totals.selected.workedUs,4*3600000000);assert.equal(fingerprint(),beforeHttp);
      const reviewReply=await approvalReviewHttp.handleAttendanceRevisionReview(new Request(`https://www.faolla.com/api/merchant-enterprise/attendance/revision-reviews?siteId=${site}&requestId=${approvalRequest.operationId}`),{
        ...approvalDeps,execute:input=>decisionService.executeRevisionApprovalReview(input,candidateService)});
      assert.equal(reviewReply.status,200);const reviewBody=await reviewReply.json();assert.equal(reviewBody.requestState,'approved');assert.equal(reviewBody.sourceVersion,'revision-review-v2');assert.equal(reviewBody.moduleEnabled,false);
      pass('paused GET recovery retains original version 9 decision against current version 10, clears exact receipt with no POST; read-only review HTTP also consumes current terminal protocol');
      approvalStore.set(approving.storageKey,saved);exec(`update public.merchants set user_id='${otherAuth}' where id='${site}';`);
      try{
        await approving.initialize();s=approving.getSnapshot();assert.equal(s.result,null);assert.equal(s.phase,'unconfirmed');assert.equal(approvalStore.get(approving.storageKey),saved);
        approvalActor=otherAuth;const transferred=await approvalFetch(`/api/merchant-enterprise/attendance/revision-decisions?siteId=${site}&requestId=${approvalRequest.operationId}&operationId=${sent.operationId}`);
        assert.equal(transferred.status,200);const transferredBody=await transferred.json();assert.equal(transferredBody.receipt,null);assert.equal(transferredBody.decision.operationId,sent.operationId);
        const adoption=await approvalFetch('/api/merchant-enterprise/attendance/revision-decisions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({siteId:site,...sent})});
        assert.equal(adoption.status,409);assert.equal((await adoption.json()).error,'attendance_operation_conflict');assert.equal(fingerprint(),beforeHttp);
      }finally{approvalActor=owner;exec(`update public.merchants set user_id='${owner}' where id='${site}';`);}
      await approving.initialize();assert.equal(approving.getSnapshot().pending,null);assert.equal(approvalStore.size,0);
      pass('owner transfer at actual HTTP recovery hides old-owner facts, does not transfer receipt ownership and refuses new-owner adoption of the original operation; returned owner recovers without duplication');
    }finally{approving.pause();approvalStore.clear();}
    const ownerHistory={siteId:site,access:'owner',scope:'submission-period',fromAt:at(1,'00:00'),toAt:at(-1,'00:00'),status:'all',asOf:null,cursorAt:null,cursorId:null};
    const selfHistory={siteId:site,access:'self',scope:'root-history',expectedWorkerId:worker,rootRequestId:oldRequest,status:'all',asOf:null,cursorAt:null,cursorId:null};
    const historySql=(q,who=owner)=>{const {siteId,...query}=q;return `public.faolla_attendance_revision_history_v1('${siteId}','${who}',${json(query)})`;};
    const historyRead=(q,who=owner)=>historyProtocol.parseRevisionHistoryResult(JSON.parse(exec(`select ${historySql(q,who)};`)),q);
    for(const roleName of ['anon','authenticated','service_role'])assert.throws(()=>exec(`set role ${roleName};select ${historySql(ownerHistory)};`),/permission denied/);
    const historyBaseline=fingerprint(),hOwner=historyRead(ownerHistory),hSelf=historyRead(selfHistory,auth);
    assert(hOwner.items.some(i=>i.status==='approved'));assert(hOwner.items.some(i=>i.status==='rejected'));assert(hOwner.items.some(i=>i.status==='withdrawn'));
    assert.equal(hSelf.employeeId,employee);assert.equal(hSelf.workerId,worker);assert(hSelf.items.every(i=>i.rootRequestId===oldRequest&&i.employeeId===employee));
    assert.throws(()=>historyRead(ownerHistory,auth),/attendance_access_denied/);assert.throws(()=>historyRead(selfHistory,otherAuth),/attendance_access_denied/);
    assert.throws(()=>historyRead({...selfHistory,expectedWorkerId:id(999)},auth),/attendance_worker_changed/);
    assert.throws(()=>historyRead({...selfHistory,rootRequestId:id(999)},auth),/attendance_revision_base_not_found/);
    assert.equal(historyRead({...selfHistory,rootRequestId:permitted},auth).items.length,0);
    for(const q of [{...ownerHistory,siteId:'99990008'},{...ownerHistory,asOf:at(-1,'00:00')},{...ownerHistory,toAt:at(-40,'00:00')},{...ownerHistory,cursorAt:hOwner.items[0].submittedAt,cursorId:hOwner.items[0].requestId}])assert.throws(()=>historyRead(q));
    pass('private read-only history parses actual four-state ledgers; current owner and bound employee roots authorize independently, roles remain revoked and invalid cross-scope/cursor/date requests fail');
    const snapshotPending=next(1);sendCycle(snapshotPending);const pendingPage=historyRead({...ownerHistory,status:'submitted'}),cutoff=pendingPage.asOf;
    assert(pendingPage.items.some(i=>i.requestId===snapshotPending.operationId));const pendingHead=self(detail(snapshotPending.operationId));
    sendCycle({action:'withdraw',operationId:id(nonce++),requestId:snapshotPending.operationId,expectedRevision:pendingHead.revision,reason:'Synthetic snapshot withdrawal'},false);
    assert(historyRead({...ownerHistory,status:'submitted',asOf:cutoff}).items.some(i=>i.requestId===snapshotPending.operationId));
    assert(!historyRead({...ownerHistory,status:'submitted'}).items.some(i=>i.requestId===snapshotPending.operationId));
    assert(historyRead({...ownerHistory,status:'withdrawn'}).items.some(i=>i.requestId===snapshotPending.operationId));
    // 55 real private submit/withdraw transactions in one owned SQL session,
    // no data fabrication, new cluster, persistent fixture files or production.
    exec(`do $queue$ declare p jsonb;c jsonb;op uuid;result jsonb;begin
      for n in 1..55 loop
        p:=public.faolla_attendance_revision_self_v2('${site}','${auth}',${json({mode:'prepare',expectedWorkerId:worker,baseRequestId:oldRequest,requestId:null,operationId:null})},null,true);
        op:=('00000000-0000-4000-8000-'||lpad((800000+n*2)::text,12,'0'))::uuid;
        c:=jsonb_build_object('action','submit','operationId',op,'expectedRevision',p->'revision','expectedBaseOperationId','${oldOperation}','expectedEffectiveOperationId',p->'current'->'operationId','expectedPolicyRevision',1,'reason','Synthetic history page','proposal',${json(proposal(1))});
        result:=public.faolla_attendance_revision_self_v2('${site}','${auth}',jsonb_build_object('mode','detail','expectedWorkerId','${worker}','baseRequestId','${oldRequest}','requestId',op,'operationId',null),c,true);
        c:=jsonb_build_object('action','withdraw','operationId',('00000000-0000-4000-8000-'||lpad((800001+n*2)::text,12,'0'))::uuid,'requestId',op,'expectedRevision',result->'revision','reason','Synthetic history withdrawal');
        perform public.faolla_attendance_revision_self_v2('${site}','${auth}',jsonb_build_object('mode','detail','expectedWorkerId','${worker}','baseRequestId','${oldRequest}','requestId',op,'operationId',null),c,false);
      end loop;
    end;$queue$;`);
    const pages=(q,who=owner)=>{let r=historyRead(q,who),out=[...r.items],seen=new Set();while(r.nextCursor){assert(!seen.has(r.nextCursor.requestId));seen.add(r.nextCursor.requestId);assert(seen.size<10);
      q={...q,asOf:r.asOf,cursorAt:r.nextCursor.recordedAt,cursorId:r.nextCursor.requestId};r=historyRead(q,who);out.push(...r.items);}return out;};
    const all=pages(ownerHistory),ownAll=pages(selfHistory,auth),count=Number(exec(`select count(*) from public.merchant_attendance_revision_requests where merchant_id='${site}' and action='submit';`));
    assert.equal(all.length,count);assert.equal(new Set(all.map(i=>i.requestId)).size,count);assert.equal(ownAll.length,all.length);
    const sparse=historyRead({...ownerHistory,status:'approved'});assert.equal(sparse.scanned,50);assert.equal(sparse.items.length,0);assert(sparse.nextCursor);
    assert(pages({...ownerHistory,status:'approved'}).length>0);assert.equal(fingerprint(),historyBaseline);assert.equal(report().totals.selected.workedUs,4*3600000000);
    pass('actual 55 repeated submit/withdraw cycles paginate without omission/duplication; empty filtered pages advance, snapshot pending survives later withdrawal and raw/current hours stay unchanged');
    let historyActor=owner;const historyCalls=[];
    const historyDeps={enabled:()=>true,accessEnabled:()=>true,allow:()=>true,authenticate:async()=>({user:{id:historyActor},accessToken:'synthetic',authenticationMethods:['password']}),
      entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}),execute:input=>historyService.executeRevisionHistory(input,candidateService)};
    const historyFetch=async(input,init={})=>{assert.equal(init.method,'GET');historyCalls.push(input);return historyHttp.handleRevisionHistory(new Request(new URL(input,'https://www.faolla.com'),init),historyDeps);};
    const ownerList=new historyBrowser.AttendanceRevisionHistoryClient({siteId:site,actorId:owner,access:'owner',apiFetch:historyFetch});
    try{
      await ownerList.initialize({...ownerHistory,status:'approved'});let s=ownerList.getSnapshot();assert.equal(s.phase,'ready',s.message);assert.equal(s.result.moduleEnabled,false);assert(s.result.nextCursor);assert.equal(s.result.items.length,0);
      const stamp=s.result.asOf;await ownerList.next();s=ownerList.getSnapshot();assert.equal(s.phase,'ready',s.message);assert.equal(s.result.asOf,stamp);assert(s.result.items.some(i=>i.status==='approved'));
      historyActor=auth;await ownerList.refresh();assert.equal(ownerList.getSnapshot().result,null);assert.equal(ownerList.getSnapshot().phase,'blocked');
    }finally{ownerList.pause();}
    const selfList=new historyBrowser.AttendanceRevisionHistoryClient({siteId:site,actorId:employee,access:'self',apiFetch:historyFetch});
    try{
      await selfList.initialize(selfHistory);assert.equal(selfList.getSnapshot().phase,'ready',selfList.getSnapshot().message);assert.equal(selfList.getSnapshot().result.employeeId,employee);
      exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${role}';`);
      try{await selfList.next();assert.equal(selfList.getSnapshot().result,null);assert.equal(selfList.getSnapshot().phase,'blocked');}
      finally{exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.request'] where id='${role}';`);}
    }finally{selfList.pause();}
    assert.equal(fingerprint(),historyBaseline);
    pass('real executor/GET handler/client paginate both scopes while paused; role/owner authorization is rechecked every page and loss hides data without any writes');
    await checkAttendanceApplicationAccess({root,exec,pass,site,owner,auth,otherAuth,employee,worker,role,oldRequest,oldOperation,proposal,id,fingerprint,ownerHistory,selfHistory});
    async function race(hold,waiting,check){
      const holder=connect(),reader=connect();let pending;
      try{
        const pid=Number(await holder.step('select pg_backend_pid();'));const held=typeof hold==='function'?await hold(holder):await holder.step(sql(hold));
        pending=reader.step(sql(waiting)).then(output=>({output}),error=>({error}));let blocked=false;const deadline=Date.now()+1800;
        while(Date.now()<deadline){blocked=query(`select count(*) from pg_stat_activity where application_name='${reader.name}' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';if(blocked)break;await new Promise(r=>setTimeout(r,15));}
        assert(blocked);await holder.step('commit;');await check(await pending,held);
      }finally{await Promise.all([holder.close(),reader.close()]);if(pending)await pending;}
    }
  });
  pass('owned synthetic namespace removed and original baseline restored');
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
