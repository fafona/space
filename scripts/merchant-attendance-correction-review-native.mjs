// Reuse exact existing stopped synthetic PG; all added schema and sample data roll back.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import review from "../src/lib/merchantAttendanceCorrectionReview.ts";
import {runAttendanceLabelsReuse} from "./merchant-attendance-choice-labels-reuse-native.mjs";
async function check({root,querySteps,pass}){
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const site="99990008",owner=id(85001),auth=id(85002),emp=id(85003),role=id(85004),worker=id(85005),place=id(85006),start=id(85103),req=id(85201);
  const json=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
  const read=name=>readFileSync(path.join(root,"scripts/supabase-migrations",name),"utf8").replace(/^begin;$/m,"").replace(/^commit;$/m,"");
  const proposal={startAt:"2026-09-28T08:00:00.000000Z",endAt:"2026-09-28T17:00:00.000000Z",breaks:[]};
  const dq={mode:"detail",requestId:req},lq={mode:"list",fromAt:"2026-09-01T00:00:00.000000Z",toAt:"2026-10-02T00:00:00.000000Z",workerId:null,status:"all",asOf:null,cursorAt:null,cursorId:null};
  const call=(q=dq,who=owner,tenant=site)=>`public.faolla_attendance_correction_owner_review_v1('${tenant}','${who}',${json(q)})`;
  const self=(request,command)=>`public.faolla_attendance_correction_self_v1('${site}','${auth}',${json({mode:"detail",expectedWorkerId:worker,requestId:request,operationId:null})},${json(command)},true)`;
  const submit={action:"submit",operationId:req,expectedRevision:0,reason:"Synthetic correction review",startEventId:start,expectedLastEventId:id(85106),proposal};
  const reject=(expression,code)=>`begin perform ${expression};raise exception 'unexpected owner review acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const punch=(n,action,time,source="web",zone="Europe/Madrid")=>`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,time_zone,actor_employee_id)
    values('${id(85100+n)}','${site}','${worker}','${place}','${id(86100+n)}',${n},'${action}','${source}',${action==="break_start"?"false":"null"},'${time}','${zone}','${emp}');`;
  const save=(expression=call(),q=dq,kind="normal")=>`insert into review_contracts values('${kind}',${json({siteId:site,...q})},${expression});`;
  const output=await querySteps([`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${["202609300070_merchant_attendance_self_session.sql","202609300081_merchant_attendance_request_permission.sql","202609300082_merchant_attendance_correction_requests.sql","202609300083_merchant_attendance_correction_owner_review.sql"].map(read).join("\n")}
    insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','Europe/Madrid',false,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${place}','${site}','Synthetic review place','Europe/Madrid',false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic review role',array['enterprise.view','attendance.self.view','attendance.self.request']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${emp}','${site}','${auth}','review@example.test','Synthetic review employee','${role}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values('${worker}','${site}','${emp}','REVIEW','Synthetic review worker','${place}',false);
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2026-01-01');
    ${punch(1,"clock_in","2026-09-27T08:00:00Z")}${punch(2,"clock_out","2026-09-27T16:00:00Z","web","UTC")}
    ${punch(3,"clock_in","2026-09-28T08:00:00Z")}${punch(4,"break_start","2026-09-28T12:00:00Z")}${punch(5,"break_end","2026-09-28T12:30:00Z")}${punch(6,"clock_out","2026-09-28T16:00:00Z")}
    ${punch(7,"clock_in","2026-09-29T08:00:00Z","web","Asia/Shanghai")}${punch(8,"clock_out","2026-09-29T16:00:00Z")}
    create temp table review_contracts(kind text,query jsonb,value jsonb);grant insert,select on review_contracts to service_role;
    set local role service_role;do $checks$ declare a jsonb;begin
      perform ${self(req,submit)};
      a:=${call()};assert a->'approvalAvailable'='false'::jsonb and a->'application'->'canRequest'='false'::jsonb,'never approvable';
      assert a->'evidence'->'previous'->>'timeZone'='UTC' and a->'evidence'->'next'->>'timeZone'='Asia/Shanghai','cross zone adjacent shifts';
      assert a->'evidence'->'currentBasis'->'events'->0->>'id'='${start}','correct segment';
      assert position('${auth}' in a::text)=0 and position('latitude' in a::text)=0,'no auth or GPS';
      ${save()}
      ${save(call(lq),lq,"list")}
      ${reject(call(dq,auth),"attendance_access_denied")}
      ${reject(call(dq,id(85990)),"attendance_access_denied")}
      ${reject(call(dq,owner,"99990007"),"attendance_access_denied")}
      ${reject(call({mode:"detail",requestId:id(85999)}),"attendance_correction_not_found")}
      ${reject(call({...dq,action:"approve"}),"attendance_invalid_request")}
      ${reject(call({...lq,expectedOwnerId:owner}),"attendance_invalid_request")}
      ${reject(call({...lq,toAt:"2026-10-02T00:00:00.000001Z"}),"attendance_invalid_request")}
      ${reject(call({...lq,asOf:"2099-01-01T00:00:00.000000Z"}),"attendance_invalid_request")}
    end $checks$;reset role;
    create temp table review_fingerprint as select
      (select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.merchant_attendance_events e) facts,
      (select md5(jsonb_agg(to_jsonb(e) order by request_id,revision)::text) from public.merchant_attendance_correction_entries e) requests;
    savepoint departed;update public.merchant_enterprise_employees set status='disabled' where id='${emp}';
    set local role service_role;${save(call(),dq,"departed")}reset role;rollback to savepoint departed;
    savepoint rebound;update public.merchant_enterprise_employees set auth_user_id='${id(85980)}' where id='${emp}';
    set local role service_role;do $checks$ declare a jsonb;begin a:=${call()};assert a->'evidence'->'bindingCurrent'='false'::jsonb;end $checks$;
    reset role;rollback to savepoint rebound;
    savepoint transfer;update public.merchants set user_id='${id(85981)}' where id='${site}';set local role service_role;
    do $checks$ begin ${reject(call(),"attendance_access_denied")}perform ${call(dq,id(85981))};end $checks$;reset role;rollback to savepoint transfer;
    savepoint own;update public.merchants set user_id='${auth}' where id='${site}';set local role service_role;
    do $checks$ declare a jsonb;begin a:=${call(dq,auth)};assert a->'evidence'->'ownApplication'='true'::jsonb;end $checks$;reset role;rollback to savepoint own;
    `,
    `savepoint missing_employment;delete from public.merchant_attendance_employment_periods where merchant_id='${site}';
      set local role service_role;do $checks$ declare a jsonb;begin a:=${call()};assert a->'evidence'->'employmentPeriods'='[]'::jsonb;end $checks$;
      reset role;rollback to savepoint missing_employment;
      savepoint open_segment;${punch(9,"clock_in","2026-09-29T18:00:00Z")}
      set local role service_role;do $checks$ begin perform ${self(id(85202),{...submit,operationId:id(85202),startEventId:id(85109),expectedLastEventId:id(85109),proposal:{...proposal,startAt:"2026-09-29T18:00:00.000000Z",endAt:"2026-09-29T19:30:00.000000Z"}})};end $checks$;
      ${save(call({mode:"detail",requestId:id(85202)}),{mode:"detail",requestId:id(85202)},"open")}
      reset role;
      ${[
        ["unsupported",punch(10,"clock_out","2026-09-29T20:00:00Z","kiosk"),"attendance_correction_unsupported_basis"],
        ["future",punch(10,"clock_out","2099-01-01T00:00:00Z"),"attendance_session_invalid_records"],
        ["oversized",Array.from({length:202},(_,n)=>punch(n+10,n%2===0?"break_start":"break_end","2026-09-29T18:00:01Z")).join("\n"),"attendance_session_too_large"]
      ].map(([kind,facts,issue])=>`savepoint evidence_guard;${facts}set local role service_role;
        ${save(call({mode:"detail",requestId:id(85202)}),{mode:"detail",requestId:id(85202)},kind)}
        do $checks$ declare a jsonb;begin a:=${call({mode:"detail",requestId:id(85202)})};
          assert a->'evidence'->>'basisIssue'='${issue}';assert a->'evidence'->'currentBasis'='null'::jsonb;end $checks$;
        reset role;select 'scenario:'||jsonb_agg(jsonb_build_object('kind',kind,'query',query,'value',value))::text from review_contracts where kind='${kind}';
        rollback to savepoint evidence_guard;release savepoint evidence_guard;`).join("\n")}
      ${punch(10,"clock_out","2026-09-29T20:00:00Z")}
      set local role service_role;${save(call({mode:"detail",requestId:id(85202)}),{mode:"detail",requestId:id(85202)},"changed")}
      reset role;
      -- Return the scenario JSON for parsing before rollback removes its synthetic rows.
      select 'scenario:'||jsonb_agg(jsonb_build_object('kind',kind,'query',query,'value',value))::text from review_contracts where kind in ('open','changed');
      rollback to savepoint open_segment;
      do $checks$ begin
        assert (select facts from review_fingerprint)=(select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.merchant_attendance_events e),'raw facts unchanged';
        assert (select requests from review_fingerprint)=(select md5(jsonb_agg(to_jsonb(e) order by request_id,revision)::text) from public.merchant_attendance_correction_entries e),'requests unchanged';
      end $checks$;
      savepoint pages;
      set local role service_role;do $checks$ declare i integer;op uuid;c jsonb;a jsonb;q jsonb;count_rows integer:=0;pages integer:=0;begin
        perform ${self(req,{action:"withdraw",operationId:id(85203),requestId:req,expectedRevision:1,reason:"Synthetic withdrawn"})};
        for i in 1..51 loop
          op:=('00000000-0000-4000-8000-'||lpad((87000+i)::text,12,'0'))::uuid;
          c:=${json(submit)}||jsonb_build_object('operationId',op,'expectedRevision',2*i);
          perform public.faolla_attendance_correction_self_v1('${site}','${auth}',jsonb_build_object('mode','detail','expectedWorkerId','${worker}','requestId',op,'operationId',null),c,true);
          c:=jsonb_build_object('action','withdraw','operationId',('00000000-0000-4000-8000-'||lpad((88000+i)::text,12,'0'))::uuid,'requestId',op,'expectedRevision',2*i+1,'reason','Synthetic withdraw');
          perform public.faolla_attendance_correction_self_v1('${site}','${auth}',jsonb_build_object('mode','detail','expectedWorkerId','${worker}','requestId',op,'operationId',null),c,true);
        end loop;
        q:=${json(lq)};loop
          a:=public.faolla_attendance_correction_owner_review_v1('${site}','${owner}',q);pages:=pages+1;count_rows:=count_rows+jsonb_array_length(a->'items');
          assert jsonb_array_length(a->'items')=case when pages=1 then 50 else 2 end,'50/2 pagination';
          insert into review_contracts values('page',q||jsonb_build_object('siteId','${site}'),a);
          exit when a->'nextCursor'='null'::jsonb;assert pages<2;
          q:=q||jsonb_build_object('asOf',a->>'asOf','cursorAt',a->'nextCursor'->>'recordedAt','cursorId',a->'nextCursor'->>'requestId');
        end loop;assert count_rows=52;
        a:=${call({...lq,status:"submitted"})};assert a->'items'='[]'::jsonb and a->'scanned'='50'::jsonb and a->'nextCursor'<>'null'::jsonb,'empty filtered page still advances';
        insert into review_contracts values('empty-page',${json({siteId:site,...lq,status:"submitted"})},a);
      end $checks$;reset role;
      ${["anon","authenticated"].map(r=>`set local role ${r};do $checks$ begin perform ${call()};raise exception 'public owner review';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
      set local role service_role;do $checks$ begin
        begin perform public.faolla_attendance_correction_owner_basis_v1('${site}','${worker}','${emp}','${start}',clock_timestamp());raise exception 'public helper';exception when insufficient_privilege then null;end;
        begin perform 1 from public.merchant_attendance_correction_entries;raise exception 'direct read';exception when insufficient_privilege then null;end;
      end $checks$;reset role;
      select 'result:'||jsonb_agg(jsonb_build_object('kind',kind,'query',query,'value',value))::text from review_contracts;rollback;`]);
  let seenOpen=false,seenChanged=false;const evidenceGuards=new Set();
  for(const line of output.split(/\r?\n/).filter(l=>l.startsWith("scenario:")||l.startsWith("result:"))){
    for(const {kind,query,value} of JSON.parse(line.slice(line.indexOf(":")+1))){
      const parsed=review.parseCorrectionReviewResult(value,query);
      if(parsed.mode==="detail"){
        const report=review.inspectCorrectionReview(parsed);assert.equal(report.approvalAvailable,false);
        if(kind==="normal")assert.deepEqual(report.issues,[]);
        if(kind==="open"){assert.ok(report.issues.includes("open_session"));seenOpen=true;}
        if(kind==="changed"){assert.ok(report.issues.includes("basis_changed"));seenChanged=true;}
        if(["unsupported","future","oversized"].includes(kind)){assert.ok(report.issues.includes("basis_unavailable"));evidenceGuards.add(kind);}
      }
    }
  }
  assert.ok(seenOpen&&seenChanged);
  assert.equal(evidenceGuards.size,3);
  ["owner-only current ownership; employee and cross-tenant rejection",
    "no approve fields/action; read-only evidence does not rewrite requests or raw facts",
    "inactive/disabled worker history remains reviewable; no new self clock rights",
    "current binding and owner-self application conflicts are exposed without auth IDs",
    "bounded complete current segment and cross-zone raw neighbors",
    "missing employment evidence, open segment and later clock-out are distinguished",
    "mixed kiosk evidence is surfaced as unsupported, never silently accepted",
    "future raw evidence is surfaced as invalid without projecting partial facts",
    "203-event segment is capped and surfaced as oversized without a clear preflight",
    "52 applications paginate 50/2 with microsecond cursors",
    "filtered empty page retains an advancing cursor",
    "RPC service-only; private helpers and raw table reads unavailable",
    "real SQL JSON parses and preflight never grants approval; all data/schema rolls back"].forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
