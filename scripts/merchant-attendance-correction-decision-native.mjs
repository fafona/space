import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import decision from "../src/lib/merchantAttendanceCorrectionDecision.ts";
import correction from "../src/lib/merchantAttendanceCorrection.ts";
import review from "../src/lib/merchantAttendanceCorrectionReview.ts";
import {runAttendanceLabelsReuse} from "./merchant-attendance-choice-labels-reuse-native.mjs";
async function check({root,querySteps,pass}){
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const site="99990009",owner=id(98001),auth=id(98002),emp=id(98003),role=id(98004),worker=id(98005),loc=id(98006),other=id(98007);
  const day=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10),stamp=(n,h)=>`${day(n)}T${h}:00:00.000000Z`;
  const json=v=>v===null?"null":`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
  const read=n=>readFileSync(path.join(root,"scripts/supabase-migrations",n),"utf8").replace(/^begin;$/m,"").replace(/^commit;$/m,"");
  const proposal={startAt:stamp(4,"08"),endAt:stamp(4,"17"),breaks:[{startAt:stamp(4,"12"),endAt:`${day(4)}T12:30:00.000000Z`,paid:false},{startAt:stamp(4,"14"),endAt:`${day(4)}T14:30:00.000000Z`,paid:true}]};
  const submit=(req,start,last,p,rev=0)=>({action:"submit",operationId:req,expectedRevision:rev,expectedPolicyRevision:1,reason:"Synthetic application",startEventId:start,expectedLastEventId:last,proposal:p});
  const req1=id(98201),req2=id(98202),req3=id(98203),req4=id(98204),op1=id(98301),op2=id(98302),op3=id(98303);
  const command1=submit(req1,id(98101),id(98102),proposal);
  const proposal2={startAt:`${day(4)}T16:30:00.000000Z`,endAt:stamp(3,"16"),breaks:[]};
  const command2=submit(req2,id(98103),id(98104),proposal2);
  const command4=submit(req4,id(98103),id(98104),{startAt:stamp(3,"08"),endAt:stamp(3,"16"),breaks:[]},1);
  const detail=(req,op=null)=>({mode:"detail",expectedWorkerId:worker,requestId:req,operationId:op});
  const self=(q,c=null,version=3)=>`public.faolla_attendance_correction_self_v${version}('${site}','${auth}',${json(q)},${json(c)},true)`;
  const call=(req=req1,c="null",op=null,who=owner,allow=true)=>`public.faolla_attendance_correction_decide_v1('${site}','${who}','${req}',${c},${op?`'${op}'`:"null"},${allow})`;
  const controls=c=>`public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(c)},null,null,true)`;
  const make=(req,op,action="approve",revision=1)=>`${json({requestId:req,operationId:op,action,expectedRevision:revision,reason:"Synthetic decision"})}||jsonb_build_object('expectedEvidence',a->'evidenceToken')`;
  const reject=(expr,code)=>`begin perform ${expr};raise exception 'unexpected decision acceptance ${code}';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const out=(expr,req=req1,op=null,kind="decision",query=null)=>`insert into decision_contracts values('${kind}',${json(query??{siteId:site,requestId:req,operationId:op})},${expr});`;
  const lock={action:"lock_period",operationId:id(98401),expectedRevision:1,expectedSettingsVersion:1,reason:"Synthetic period lock",fromDate:day(4),throughDate:day(4)};
  const migrations=["202609300070_merchant_attendance_self_session.sql","202609300081_merchant_attendance_request_permission.sql","202609300082_merchant_attendance_correction_requests.sql",
    "202609300083_merchant_attendance_correction_owner_review.sql","202609300084_merchant_attendance_correction_controls.sql","202609300085_merchant_attendance_correction_rule_binding.sql","202609300086_merchant_attendance_correction_decisions.sql"];
  const output=await querySteps([`begin;set local statement_timeout='10s';set local lock_timeout='3s';${migrations.map(read).join("\n")}
    insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','Europe/Madrid',false,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${loc}','${site}','Synthetic decision location','Europe/Madrid',false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic decision role',array['enterprise.view','attendance.self.view','attendance.self.request']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${emp}','${site}','${auth}','decisions@example.test','Synthetic worker','${role}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values('${worker}','${site}','${emp}','DECISION','Synthetic worker','${loc}',false);
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
    ${[[1,'clock_in',stamp(4,'08')],[2,'clock_out',stamp(4,'16')],[3,'clock_in',stamp(3,'08')],[4,'clock_out',stamp(3,'16')],[5,'clock_in',stamp(2,'08')]].map(([n,action,t])=>`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id)
      values('${id(98100+n)}','${site}','${worker}','${loc}','${id(99100+n)}',${n},'${action}','web','${t}','Europe/Madrid','${emp}');`).join("\n")}
    create temp table decision_contracts(kind text,query jsonb,value jsonb);grant insert,select on decision_contracts to service_role;
    create temp table decision_tokens(name text primary key,command jsonb,value jsonb);grant select,insert,update on decision_tokens to service_role;
    create temp table decision_facts as select md5(jsonb_agg(to_jsonb(e) order by id)::text) value from public.merchant_attendance_events e;
    select ${controls({action:"set_policy",operationId:id(98400),expectedRevision:0,expectedSettingsVersion:1,reason:"Synthetic policy",submissionWindowDays:30})};
    select ${self(detail(req3),{action:'submit',operationId:req3,expectedRevision:0,reason:'Legacy open declaration',startEventId:id(98105),expectedLastEventId:id(98105),proposal:{startAt:stamp(2,'08'),endAt:stamp(2,'16'),breaks:[]}},1)};
    set local role service_role;do $checks$ declare a jsonb;c jsonb;begin
      perform ${self(detail(req1),command1)};perform ${self(detail(req2),command2)};
      a:=${call()};assert a->'canApprove'='true'::jsonb and a->'canReject'='true'::jsonb and a->'blockers'='[]'::jsonb;
      ${out(call())}
      insert into decision_tokens values('approve1',${make(req1,op1)},a);
      ${reject(call(req1,"null",null,auth),'attendance_access_denied')}
      ${reject(call(req1,"null",null,other),'attendance_access_denied')}
      ${reject(call(req1,make(req1,op1),null,owner,false),'attendance_platform_paused')}
      ${reject(call(req1,`${make(req1,op1)}||'{"actor":"injected"}'::jsonb`),'attendance_invalid_request')}
      a:=${call(req3)};assert a->'canApprove'='false'::jsonb and a->'canReject'='true'::jsonb and a->'blockers' ? 'open_session' and a->'blockers' ? 'rule_legacy_unbound';
      ${reject(call(req3,make(req3,op3)),'attendance_correction_decision_blocked')}
      ${out(call(req3),req3)}
    end $checks$;reset role;
    savepoint owner_self;update public.merchants set user_id='${auth}' where id='${site}';set local role service_role;
    do $checks$ declare a jsonb;begin a:=${call(req1,"null",null,auth)};assert a->'blockers' ? 'self_review' and a->'canReject'='false'::jsonb;
      ${reject(call(req1,make(req1,op1),null,auth),'attendance_correction_decision_blocked')}
    end $checks$;reset role;rollback to owner_self;
    savepoint rebind;update public.merchant_enterprise_employees set auth_user_id='${other}' where id='${emp}';set local role service_role;
    do $checks$ declare a jsonb;begin a:=${call()};assert a->'blockers' ? 'binding_changed' and a->'canReject'='false'::jsonb;${reject(call(req1,make(req1,op1)),'attendance_correction_decision_blocked')}end $checks$;
    reset role;rollback to rebind;
    savepoint gap;delete from public.merchant_attendance_employment_periods where merchant_id='${site}';set local role service_role;
    do $checks$ declare a jsonb;begin a:=${call()};assert a->'blockers' ? 'employment_gap';${reject(call(req1,make(req1,op1)),'attendance_correction_decision_blocked')}end $checks$;reset role;rollback to gap;`,
    `savepoint locking;set local role service_role;do $checks$ declare a jsonb;c jsonb;begin
      perform ${controls(lock)};select command into c from decision_tokens where name='approve1';${reject(call(req1,'c'),'attendance_correction_evidence_changed')}
      a:=${call()};assert a->'blockers' ? 'rule_period_locked';${reject(call(req1,make(req1,op1)),'attendance_correction_decision_blocked')}
      perform ${controls({action:'unlock_period',operationId:id(98402),expectedRevision:2,expectedSettingsVersion:1,reason:'Synthetic reopen',periodId:lock.operationId})};
      ${reject(call(req1,'c'),'attendance_correction_evidence_changed')}
    end $checks$;reset role;rollback to locking;
    savepoint withdrawn;set local role service_role;do $checks$ declare a jsonb;begin
      perform ${self(detail(req1),{action:'withdraw',operationId:id(98501),requestId:req1,expectedRevision:1,reason:'Synthetic withdraw'})};
      a:=${call()};assert a->'canReject'='false'::jsonb and a->'blockers' ? 'withdrawn';
      ${reject(call(req1,make(req1,op1,'approve',2)),'attendance_correction_decision_blocked')}
    end $checks$;reset role;rollback to withdrawn;
    savepoint tail_change;insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id)
      values('${id(98106)}','${site}','${worker}','${loc}','${id(99106)}',6,'clock_out','web','${stamp(2,'16')}','Europe/Madrid','${emp}');
    set local role service_role;do $checks$ declare c jsonb;a jsonb;begin
      select command into c from decision_tokens where name='approve1';${reject(call(req1,'c'),'attendance_correction_evidence_changed')}
      a:=${call(req3)};assert a->'blockers' ? 'basis_changed';${reject(call(req3,make(req3,op3)),'attendance_correction_decision_blocked')}
    end $checks$;reset role;rollback to tail_change;
    set local role service_role;do $checks$ declare a jsonb;c jsonb;begin
      select command into c from decision_tokens where name='approve1';a:=${call(req1,'c')};
      assert a->'decision'->>'action'='approve' and a->'canApprove'='false'::jsonb and a->'effective'->>'workedUs'='28800000000' and a->'effective'->>'paidBreakUs'='1800000000';
      ${out(call(req1,'c'),req1,op1)}${out(call(req1,'null',op1,owner,false),req1,op1)}
      ${reject(call(req1,"c||'{\"reason\":\"changed\"}'::jsonb"),'attendance_operation_conflict')}
      ${reject(call(req1,`c||${json({operationId:id(98502),action:'reject'})}`),'attendance_correction_decided')}
      ${reject(self(detail(req1),{action:'withdraw',operationId:id(98503),requestId:req1,expectedRevision:1,reason:'Cannot withdraw approved'}),'attendance_correction_decided')}
      ${out(self(detail(req1,command1.operationId)),req1,null,'self',{siteId:site,...detail(req1,command1.operationId)})}
      ${out(`public.faolla_attendance_correction_owner_review_v3('${site}','${owner}',${json({mode:'detail',requestId:req1})})`,req1,null,'review',{siteId:site,mode:'detail',requestId:req1})}
      a:=${call(req2)};assert a->'blockers' ? 'effective_overlap' and not(a->'blockers' ? 'overlap_previous');${reject(call(req2,make(req2,op2)),'attendance_correction_decision_blocked')}
      ${out(call(req2),req2)}
      a:=${call(req2)};c:=${make(req2,op2,'reject')};${out(call(req2,'c'),req2,op2)}
      ${reject(self(detail(req2),{action:'withdraw',operationId:id(98504),requestId:req2,expectedRevision:1,reason:'Cannot withdraw rejected'}),'attendance_correction_decided')}
      a:=${self({mode:'prepare',expectedWorkerId:worker,startEventId:id(98103)})};assert a->'pendingRequestId'='null'::jsonb and a->'revision'='1'::jsonb;
      perform ${self(detail(req4),command4)};
      ${out(self(detail(req2)),req2,null,'self',{siteId:site,...detail(req2)})}
      a:=${call(req3)};${out(call(req3,make(req3,op3,'reject')),req3,op3)}
    end $checks$;reset role;
    savepoint effect_failure;
    create function public.synthetic_effect_failure() returns trigger language plpgsql as $fn$ begin raise exception 'synthetic_effect_failure';end $fn$;
    create trigger synthetic_effect_failure before insert on public.merchant_attendance_correction_effects for each row execute function public.synthetic_effect_failure();
    set local role service_role;do $checks$ declare a jsonb;begin a:=${call(req4)};assert a->'canApprove'='true'::jsonb;
      ${reject(call(req4,make(req4,id(98505),'approve',2)),'synthetic_effect_failure')}
    end $checks$;reset role;do $checks$ begin assert not exists(select 1 from public.merchant_attendance_correction_decisions where merchant_id='${site}' and request_id='${req4}'),'effect failure rolls back decision';end $checks$;
    rollback to effect_failure;`,
    `savepoint transferred;update public.merchants set user_id='${other}' where id='${site}';set local role service_role;
    do $checks$ declare a jsonb;c jsonb;begin ${reject(call(),'attendance_access_denied')}
      a:=${call(req1,'null',op1,other)};assert a->'decision'->>'action'='approve' and a->'receipt'='null'::jsonb;
      select command into c from decision_tokens where name='approve1';${reject(call(req1,'c',null,other),'attendance_operation_conflict')}
    end $checks$;reset role;rollback to transferred;
    set local role service_role;do $checks$ begin
      begin perform 1 from public.merchant_attendance_correction_effects;raise exception 'direct effect';exception when insufficient_privilege then null;end;
      begin perform ${self(detail(req1),null,2)};raise exception 'legacy bypass';exception when insufficient_privilege then null;end;
      begin perform public.faolla_attendance_decision_checks_v1('${site}','{}');raise exception 'helper';exception when insufficient_privilege then null;end;
    end $checks$;reset role;
    ${['anon','authenticated'].map(w=>`set local role ${w};do $checks$ begin perform ${call()};raise exception 'public decision';exception when insufficient_privilege then null;end $checks$;reset role;`).join('\n')}
    do $checks$ begin
      assert (select count(*) from public.merchant_attendance_correction_decisions)=3;assert (select count(*) from public.merchant_attendance_correction_effects)=1;
      assert (select value from decision_facts)=(select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.merchant_attendance_events e),'raw punches unchanged';
      begin update public.merchant_attendance_correction_decisions set reason='rewrite';raise exception 'decision mutable';exception when insufficient_privilege then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;
      begin truncate public.merchant_attendance_correction_effects;raise exception 'effect mutable';exception when insufficient_privilege then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;
    end $checks$;
    select 'contracts:'||jsonb_agg(jsonb_build_object('kind',kind,'query',query,'value',value))::text from decision_contracts;rollback;`]);
  const line=output.split('\n').find(s=>s.startsWith('contracts:'));assert.ok(line);
  for(const {kind,query,value} of JSON.parse(line.slice(10))){
    if(kind==='decision')decision.parseCorrectionDecisionResult(value,query);
    else if(kind==='self')correction.parseCorrectionResult(value,query,true,true);
    else review.parseCorrectionReviewResult(value,query,true,true);
    assert.doesNotMatch(JSON.stringify(value),new RegExp(`${owner}|${auth}|review_snapshot|actor_auth_user_id`));
  }
  ["owner-only authorization, self-review and changed binding denied", "approval rechecks raw snapshot, open shift, neighboring records and employment coverage",
    "current lock blocks approval; lock/unlock still invalidates old evidence token", "new raw tail invalidates an old review even outside that shift",
    "withdrawal wins before decision; decided applications cannot withdraw", "approval atomically appends decision and exact microsecond effective declaration",
    "replay/GET recovery survive pause; changed body and competing decision are conflicts", "effective overlap is detected even when original neighboring punches allow it",
    "rejection has no effect and permits a separately versioned new submission", "legacy unbound/open request may be rejected, never approved",
    "simulated effect write failure rolls back the decision too", "owner transfer cannot inherit an operation receipt",
    "direct tables/internal helpers/legacy write bypass denied; both ledgers immutable", "real SQL responses parse, original punches unchanged, full rollback verified"].forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
