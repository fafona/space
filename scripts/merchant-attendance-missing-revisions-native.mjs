import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {checkAttendanceMissing} from './merchant-attendance-missing-native.mjs';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
const require=createRequire(import.meta.url);
const {parseUnifiedSource}=require('../src/lib/merchantAttendanceUnifiedTimesheet.ts');
const {parseUnifiedExportSource,buildUnifiedExportCsv}=require('../src/lib/merchantAttendanceUnifiedExport.ts');
const {parseCurrentCorrectionDecision}=require('../src/lib/merchantAttendanceCurrentCorrectionDecision.ts');
const {parseRevisionApprovalResult}=require('../src/lib/merchantAttendanceRevisionApproval.ts');
const json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
export async function checkMissingRevisions(native,browserCheck=null){
  await checkAttendanceMissing(native,async env=>{
    const {exec,sql,run,q,own,owner,employee,worker,location,day,id,proposal,cmd,pass,connect}=env,site=q.siteId;
    const call=(query,c=null,actor=employee,allow=true)=>`public.faolla_attendance_missing_v1(${json(query)},'${actor}',${c?json(c):'null'},${allow})`;
    const deny=(query,c,code,actor=employee,prep='')=>exec(`begin;${prep}set local role service_role;do $deny$ begin begin perform ${call(query,c,actor)};raise exception 'unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;end $deny$;rollback;`);
    const detail=(rid,access='self')=>run({...q,access,requestId:rid},null,access==='self'?employee:owner).detail;
    const revise=(n,parent=id(401),parentOp=id(410),p={...proposal(-1),endAt:day(-1)+'T16:00:00.000000Z'})=>({...cmd,action:'revise',operationId:id(n),supersedesRequestId:parent,expectedApprovalOperationId:parentOp,proposal:p,reason:'合成修订，更正结束时间'});
    const decide=(rid,n,action='approve')=>{
      const d=detail(rid,action==='withdraw'?'self':'owner'),query={...q,access:action==='withdraw'?'self':'owner',requestId:rid};
      const c={action,operationId:id(n),requestId:rid,expectedRevision:1,reason:'合成修订决定',...(action==='withdraw'?{}:{evidenceToken:d.evidenceToken})};
      return run(query,c,action==='withdraw'?employee:owner);
    };
    const ownerQ={siteId:site,access:'owner',workerId:worker,fromDate:day(-30),throughDate:q.throughDate};
    const report=()=>parseUnifiedSource(JSON.parse(exec(`set role service_role;select public.faolla_attendance_unified_report_v1('${site}','${owner}',${json({access:'owner',workerId:worker,fromDate:ownerQ.fromDate,throughDate:ownerQ.throughDate})});`)),ownerQ);
    const firstRows=exec(`select jsonb_build_object('r',(select to_jsonb(r) from public.merchant_attendance_missing_requests r where request_id='${id(401)}'),'d',(select to_jsonb(d) from public.merchant_attendance_missing_entries d where operation_id='${id(410)}'));`);
    const baseHours=report().totals.selected.workedUs;
    assert.equal(detail(id(401)).lineage.canRevise,true);
    deny(q,revise(5000,id(401),id(411)),'attendance_missing_revision_stale');
    deny(q,{...revise(5000),expectedWorkerId:id(202)},'attendance_access_denied',id(2));
    deny({...own},revise(5000),'attendance_invalid_request',owner);
    deny(q,revise(5000,id(401),id(410),proposal(-1)),'attendance_missing_revision_unchanged');
    const first=run(q,revise(5000));assert.equal(first.detail.lineage.supersedesRequestId,id(401));
    assert.equal(first.detail.lineage.currentRequestId,id(401));assert.equal(report().totals.selected.workedUs,baseHours);
    assert.equal(detail(id(401)).lineage.canRevise,false);
    deny(q,revise(5001),'attendance_missing_revision_pending');
    assert.equal(run(q,revise(5000),employee,false).receipt.operationId,id(5000));
    assert.equal(run({...q,operationId:id(5000)}).detail.requestId,id(5000));
    pass('revision is separate immutable request bound to exact approved parent; pending revision leaves old hours active, duplicates replay once, foreign/self-owner identity and unchanged proposal rejected');
    decide(id(5000),5002,'reject');assert.equal(report().totals.selected.workedUs,baseHours);
    run(q,revise(5003));decide(id(5003),5004,'withdraw');assert.equal(report().totals.selected.workedUs,baseHours);
    run(q,revise(5005));decide(id(5005),5006);
    let current=report();assert.equal(current.totals.selected.workedUs,baseHours-3600000000);
    assert(current.missing.some(m=>m.requestId===id(5005)));assert(!current.missing.some(m=>[id(401),id(5000),id(5003)].includes(m.requestId)));
    assert.equal(detail(id(401)).lineage.currentRequestId,id(5005));assert.equal(detail(id(401)).lineage.canRevise,false);
    assert.equal(detail(id(5005)).lineage.canRevise,true);
    deny(q,revise(5007),'attendance_missing_revision_stale');
    run(q,revise(5007,id(5005),id(5006),{...proposal(-1),endAt:day(-1)+'T15:00:00.000000Z'}));decide(id(5007),5008);
    current=report();assert.equal(current.totals.selected.workedUs,baseHours-2*3600000000);
    assert.equal(detail(id(5007)).lineage.rootRequestId,id(401));assert.equal(detail(id(5007)).lineage.supersedesRequestId,id(5005));
    assert.equal(exec(`select jsonb_build_object('r',(select to_jsonb(r) from public.merchant_attendance_missing_requests r where request_id='${id(401)}'),'d',(select to_jsonb(d) from public.merchant_attendance_missing_entries d where operation_id='${id(410)}'));`),firstRows);
    assert.equal(run({...q,operationId:id(5005)}).receipt.command.action,'revise');
    pass('rejected/withdrawn revision keeps original; two successive approvals replace selected source exactly once; original facts and approval remain byte-identical and old operation recovery still works');
    const c={siteId:site,operationId:id(5010),query:{access:'owner',workerId:worker,locationId:null,expectedWorkerId:null,fromDate:ownerQ.fromDate,throughDate:ownerQ.throughDate,expectedTimeZone:'UTC',expectedScopeRevision:null}};
    const exported=JSON.parse(exec(`set role service_role;select public.faolla_attendance_unified_export_v1('${site}','${owner}','${c.operationId}',${json(c.query)});`));
    const parsed=parseUnifiedExportSource(exported,c),csv=buildUnifiedExportCsv(parsed.report,parsed.receipt);
    assert.equal(parsed.report.totals.selected.workedUs,current.totals.selected.workedUs);
    assert(csv.includes(id(5007)));assert(!csv.includes(id(401)));assert(!csv.includes(id(5005)));
    assert.equal(parsed.receipt.missingCount,current.missing.length);
    pass('actual unified export RPC and CSV select the same latest approved declaration, excluding superseded/rejected/withdrawn versions');
    const selfQ={siteId:site,access:'self',expectedWorkerId:worker,fromDate:ownerQ.fromDate,throughDate:ownerQ.throughDate};
    const scoped=(query,who,prep='')=>{
      const wire={access:query.access,workerId:query.workerId??null,locationId:query.locationId??null,expectedWorkerId:query.expectedWorkerId??null,fromDate:query.fromDate,throughDate:query.throughDate};
      return parseUnifiedSource(JSON.parse(exec(`begin;${prep}set local role service_role;select public.faolla_attendance_unified_report_v1('${site}','${who}',${json(wire)});rollback;`)),query);
    };
    assert.equal(scoped(selfQ,employee).totals.selected.workedUs,current.totals.selected.workedUs);
    assert.equal(scoped({...selfQ,expectedWorkerId:id(202)},id(2)).missing.length,0);
    const managerPrep=`update public.merchant_enterprise_roles set permissions=array_append(permissions,'attendance.records.view') where id='${id(30)}';
      insert into public.merchant_attendance_scopes(merchant_id,employee_id,revision) values('${site}','${id(102)}',1);
      insert into public.merchant_attendance_scope_grants(merchant_id,employee_id,id,valid_from) values('${site}','${id(102)}','${id(59999)}','2000-01-01Z');
      insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${id(102)}','${id(59999)}','${worker}');
      insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id) values('${site}','${id(102)}','${id(59999)}','${location}');`;
    const managerQ={siteId:site,access:'manager',workerId:worker,locationId:location,fromDate:ownerQ.fromDate,throughDate:ownerQ.throughDate};
    const manager=scoped(managerQ,id(2),managerPrep);assert.equal(manager.totals.selected.workedUs,current.totals.selected.workedUs);
    assert(manager.missing.every(m=>m.employeeId===null));assert(manager.missing.some(m=>m.requestId===id(5007)));
    pass('owner, self and explicitly granted manager select identical latest approved sources while another employee self report remains empty; synthetic grant changes roll back');
    const locked=`select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json({action:'lock_period',operationId:id(5100),expectedRevision:1,expectedSettingsVersion:1,reason:'原时段锁定',fromDate:day(-1),throughDate:day(-1)})},null,null,true);`;
    deny(q,revise(5101,id(5007),id(5008),proposal(-2)),'attendance_missing_conflict',employee,locked);
    deny(q,revise(5101,id(5007),id(5008),proposal(-3)),'attendance_missing_conflict');
    const policy=`select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json({action:'set_policy',operationId:id(5102),expectedRevision:1,expectedSettingsVersion:1,reason:'合成短窗口',submissionWindowDays:1})},null,null,true);`;
    deny(q,{...revise(5103,id(430),id(431),proposal(-2)),expectedPolicyRevision:2},'attendance_correction_window_expired',employee,policy);
    deny(q,revise(5104,id(5007),id(5008),proposal(-2)),'attendance_access_denied',employee,`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.self.request') where id='${id(30)}';`);
    pass('revision cannot move away from a locked original period, overlap another active declaration, renew deadline by moving dates, or bypass revoked request permission');
    // A new pair of transactions competes for the same current parent even with
    // disjoint proposals. Exactly one pending replacement is allowed.
    const ca=revise(5200,id(5007),id(5008),proposal(-2)),cb=revise(5201,id(5007),id(5008),proposal(-4));
    const a=connect(),b=connect();
    try{
      await a.step(sql(`begin;set local role service_role;select ${call(q,ca)};`));
      const waiting=b.step(sql(`begin;set local role service_role;do $race$ begin begin perform ${call(q,cb)};raise exception 'unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'attendance_missing_revision_pending' then raise;end if;end;end $race$;commit;`));
      await a.step('commit;');await waiting;
    }finally{await a.close();await b.close();}
    assert.equal(detail(id(5200)).status,'submitted');decide(id(5200),5202,'withdraw');
    pass('two concurrent revision submissions serialize under the existing settings lock; a disjoint competing proposal cannot fork the approval chain');
    // A genuine existing correction application overlaps a currently approved
    // missing span. Raw events are outside it, so the new missing guard is causal.
    const raw=`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
      ('${id(5300)}','${site}','${worker}','${location}','${id(5300)}',1,'clock_in','web','${day(-1)}T00:00:00Z','UTC','${id(101)}'),
      ('${id(5301)}','${site}','${worker}','${location}','${id(5301)}',2,'clock_out','web','${day(-1)}T01:00:00Z','UTC','${id(101)}');`;
    const correction={action:'submit',operationId:id(5302),expectedRevision:0,expectedPolicyRevision:1,reason:'真实补正重叠检查',startEventId:id(5300),expectedLastEventId:id(5301),proposal:proposal(-1)};
    const submitCorrection=`select public.faolla_attendance_correction_self_v3('${site}','${employee}',${json({mode:'detail',expectedWorkerId:worker,requestId:id(5302),operationId:null})},${json(correction)},true);`;
    const blocked=JSON.parse(exec(`begin;${raw}set local role service_role;${submitCorrection.replace('select public.', 'do $submit$ begin perform public.').replace(/;$/,';end $submit$;')}select public.faolla_attendance_correction_decide_v2('${site}','${owner}','${id(5302)}',null,null,true);rollback;`));
    assert(blocked.blockers.includes('missing_overlap'));assert.equal(blocked.canApprove,false);assert.equal(blocked.canReject,true);
    assert.equal(parseCurrentCorrectionDecision(blocked,{siteId:site,requestId:id(5302),operationId:null}).canApprove,false);
    exec(`begin;${raw}set local role service_role;${submitCorrection}
      do $approve$ declare r jsonb;begin r:=public.faolla_attendance_correction_decide_v2('${site}','${owner}','${id(5302)}',null,null,true);
      begin perform public.faolla_attendance_correction_decide_v2('${site}','${owner}','${id(5302)}',${json({action:'approve',operationId:id(5303),requestId:id(5302),expectedRevision:1,reason:'冲突应拒绝'})}||jsonb_build_object('expectedEvidence',r->'evidenceToken'),null,true);
      raise exception 'unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'attendance_correction_decision_blocked' then raise;end if;end;end $approve$;rollback;`);
    pass('existing first-correction review exposes missing-overlap blocker to real parser and real approving RPC rejects it without writing an effect');
    const safeProposal={startAt:day(-1)+'T01:00:00.000000Z',endAt:day(-1)+'T02:00:00.000000Z',breaks:[]};
    const safeFirst=`perform public.faolla_attendance_correction_self_v3('${site}','${employee}',${json({mode:'detail',expectedWorkerId:worker,requestId:id(5302),operationId:null})},${json({...correction,proposal:safeProposal})},true);
      r:=public.faolla_attendance_correction_decide_v2('${site}','${owner}','${id(5302)}',null,null,true);
      perform public.faolla_attendance_correction_decide_v2('${site}','${owner}','${id(5302)}',${json({action:'approve',operationId:id(5303),requestId:id(5302),expectedRevision:1,reason:'不重叠补正'})}||jsonb_build_object('expectedEvidence',r->'evidenceToken'),null,true);
      perform public.faolla_attendance_revision_self_v2('${site}','${employee}',${json({mode:'detail',expectedWorkerId:worker,baseRequestId:id(5302),requestId:id(5304),operationId:null})},
        ${json({action:'submit',operationId:id(5304),expectedRevision:0,expectedBaseOperationId:id(5303),expectedEffectiveOperationId:id(5303),expectedPolicyRevision:1,reason:'连续修订冲突检查',proposal:proposal(-1)})},true);`;
    const subsequent=JSON.parse(exec(`begin;${raw}set local role service_role;do $prepare$ declare r jsonb;begin ${safeFirst} end $prepare$;
      select public.faolla_attendance_revision_decide_v2('${site}','${owner}','${id(5304)}',null,null,true);rollback;`));
    assert(subsequent.blockers.includes('missing_overlap'));assert.equal(subsequent.canApprove,false);
    assert.equal(parseRevisionApprovalResult(subsequent,{siteId:site,requestId:id(5304),operationId:null}).canApprove,false);
    exec(`begin;${raw}set local role service_role;do $approve$ declare r jsonb;begin ${safeFirst}
      r:=public.faolla_attendance_revision_decide_v2('${site}','${owner}','${id(5304)}',null,null,true);
      begin perform public.faolla_attendance_revision_decide_v2('${site}','${owner}','${id(5304)}',
        ${json({action:'approve',operationId:id(5305),requestId:id(5304),expectedRevision:1,expectedBaseOperationId:id(5303),reason:'连续冲突应拒绝'})}||jsonb_build_object('expectedEvidence',r->'evidenceToken'),null,true);
      raise exception 'unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'attendance_correction_decision_blocked' then raise;end if;end;end $approve$;rollback;`);
    pass('a real nonoverlapping correction still approves; its subsequent revision overlapping missing time is blocked by review, application parser and actual decision RPC');
    run(q,revise(5400,id(5007),id(5008),proposal(-2)));decide(id(5400),5401);
    const dayReport=n=>{
      const query={...ownerQ,fromDate:day(n),throughDate:day(n)};
      return parseUnifiedSource(JSON.parse(exec(`set role service_role;select public.faolla_attendance_unified_report_v1('${site}','${owner}',${json({access:'owner',workerId:worker,fromDate:query.fromDate,throughDate:query.throughDate})});`)),query);
    };
    assert.equal(dayReport(-1).missing.length,0);assert.equal(dayReport(-1).totals.selected.workedUs,0);
    assert.equal(dayReport(-2).missing[0].requestId,id(5400));assert.equal(dayReport(-2).totals.selected.workedUs,7*3600000000);
    pass('moving an approved declaration to another date removes superseded hours from old date and counts only replacement on its new date');
    if(browserCheck)await browserCheck(env);
  },{revisions:true});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceLabelsReuse(process.argv.slice(2),checkMissingRevisions).catch(e=>{console.error(e);process.exitCode=1;});
