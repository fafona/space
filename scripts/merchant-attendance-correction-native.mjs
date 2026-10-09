// Exact existing stopped synthetic PG15 only. Every migration and fixture rolls back.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import contract from "../src/lib/merchantAttendanceCorrection.ts";
import {runAttendanceLabelsReuse} from "./merchant-attendance-choice-labels-reuse-native.mjs";
async function check({root,querySteps,pass}){
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const site="99990007",owner=id(82001),auth=id(82002),employee=id(82003),role=id(82004),worker=id(82005),place=id(82006);
  const json=v=>v===null?"null":`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
  const read=name=>readFileSync(path.join(root,"scripts/supabase-migrations",name),"utf8").replace(/^begin;$/m,"").replace(/^commit;$/m,"");
  const start=id(82101),end=id(82104),request=id(82201);
  const proposal={startAt:"2026-09-28T08:00:00.000000Z",endAt:"2026-09-28T17:00:00.000000Z",breaks:[{startAt:"2026-09-28T12:00:00.000000Z",endAt:"2026-09-28T12:30:00.000000Z",paid:false}]};
  const submit={action:"submit",operationId:request,expectedRevision:0,reason:"Synthetic missing end time",startEventId:start,expectedLastEventId:end,proposal};
  const withdrawal={action:"withdraw",operationId:id(82202),requestId:request,expectedRevision:1,reason:"Synthetic withdraw"};
  const prepare={mode:"prepare",expectedWorkerId:worker,startEventId:start};
  const detail=(req=request,op=null)=>({mode:"detail",expectedWorkerId:worker,requestId:req,operationId:op});
  const list={mode:"list",expectedWorkerId:worker,cursorAt:null,cursorId:null};
  const call=(q=prepare,c=null,who=auth,enabled=true,tenant=site)=>`public.faolla_attendance_correction_self_v1('${tenant}','${who}',${json(q)},${json(c)},${enabled})`;
  let rejectSequence=0;
  const reject=(expression,code="attendance_invalid_request")=>`begin perform ${expression};raise exception 'unexpected correction acceptance ${++rejectSequence} expected ${code}';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const punch=(n,action,time,actor=employee,source="web")=>`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,time_zone,actor_employee_id)
    values('${id(82100+n)}','${site}','${worker}','${place}','${id(83100+n)}',${n},'${action}','${source}',${action==="break_start"?"false":"null"},'${time}','Europe/Madrid','${actor}');`;
  const output=await querySteps([`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${["202609300070_merchant_attendance_self_session.sql","202609300081_merchant_attendance_request_permission.sql","202609300082_merchant_attendance_correction_requests.sql"].map(read).join("\n")}
    insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','Europe/Madrid',false,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${place}','${site}','Synthetic correction place','Europe/Madrid',false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic correction role',array['enterprise.view','attendance.self.view','attendance.self.request']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${employee}','${site}','${auth}','correction@example.test','Synthetic correction employee','${role}','active');
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${id(82009)}','${site}','${id(82010)}','correction-other@example.test','Synthetic other employee','${role}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values('${worker}','${site}','${employee}','CORRECTION','Synthetic correction worker','${place}',false);
    ${punch(1,"clock_in","2026-09-28T08:00:00Z")}${punch(2,"break_start","2026-09-28T12:00:00Z")}${punch(3,"break_end","2026-09-28T12:30:00Z")}${punch(4,"clock_out","2026-09-28T16:00:00Z")}
    ${punch(5,"clock_in","2026-09-29T09:00:00Z")}
    create temp table correction_contracts(query jsonb,value jsonb);grant insert,select on correction_contracts to service_role;
    create temp table correction_event_fingerprint as select md5(jsonb_agg(to_jsonb(e) order by id)::text) value from public.merchant_attendance_events e;
    set local role service_role;do $checks$ declare a jsonb;b jsonb;begin
      a:=${call()};assert a->>'revision'='0' and a->'canRequest'='true'::jsonb,'separate request permission without clock';
      insert into correction_contracts values(${json({siteId:site,...prepare})},a);
      a:=${call(detail(),submit)};assert a->'item'->>'status'='submitted' and a->'receipt'->>'revision'='1','submit pending';
      assert a->'proposal'->>'endAt'='2026-09-28T17:00:00.000000Z' and a->'basis'->'events'->-1->>'occurredAt'='2026-09-28T16:00:00.000000Z','separate assertion from fact';
      assert position('${auth}' in a::text)=0,'no raw auth identity';
      insert into correction_contracts values(${json({siteId:site,...detail(request,request)})},a);
      a:=${call(detail(),submit,auth,false)};assert a->'receipt'->>'revision'='1','same operation replay survives platform pause';
      ${reject(call(detail(),{...submit,reason:"changed"}),"attendance_operation_conflict")}
      ${reject(call(detail(id(82210)),{...submit,operationId:id(82210)}),"attendance_version_conflict")}
      ${reject(call(detail(id(82210)),{...submit,operationId:id(82210),expectedRevision:1}),"attendance_correction_pending")}
      a:=${call()};assert a->>'pendingRequestId'='${request}','prepare reports existing pending';
      ${reject(call(prepare,null,owner),"attendance_access_denied")}
      ${reject(call({...prepare,expectedWorkerId:id(82999)}),"attendance_worker_changed")}
      ${reject(call(prepare,null,auth,true,"99990008"),"attendance_access_denied")}
      a:=${call(detail(),withdrawal,auth,false)};assert a->'item'->>'status'='withdrawn' and a->'receipt'->>'revision'='2','explicit withdrawal while paused';
      insert into correction_contracts values(${json({siteId:site,...detail(request,withdrawal.operationId)})},a);
      a:=${call(detail(request,request))};assert a->'receipt'->>'revision'='1' and a->'item'->>'revision'='2','original receipt survives later command';
      insert into correction_contracts values(${json({siteId:site,...detail(request,request)})},a);
      ${reject(call(detail(),{...withdrawal,operationId:id(82211),expectedRevision:2}),"attendance_correction_closed")}
      ${reject(call(detail(id(82212)),{...submit,operationId:id(82212),expectedRevision:2},auth,false),"attendance_platform_paused")}
      ${reject(call(detail(id(82212)),{...submit,operationId:id(82212),expectedRevision:2,expectedLastEventId:id(82999)}),"attendance_correction_basis_changed")}
    end $checks$;reset role;`,
    `savepoint no_request;
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';
    set local role service_role;do $checks$ declare a jsonb;begin
      a:=${call(detail(request,request))};assert a->'canRequest'='false'::jsonb and a->'receipt'->>'revision'='1','view-only receipt recovery';
      perform ${call(detail(),submit)};
      ${reject(call(detail(id(82212)),{...submit,operationId:id(82212),expectedRevision:2}),"attendance_access_denied")}
    end $checks$;reset role;rollback to savepoint no_request;
    savepoint rebind;update public.merchant_enterprise_employees set auth_user_id='${id(82900)}' where id='${employee}';
    set local role service_role;do $checks$ declare a jsonb;begin
      ${reject(call(),"attendance_access_denied")}
      ${reject(call(detail(),null,id(82900)),"attendance_correction_not_found")}
      ${reject(call(prepare,null,id(82900)),"attendance_access_denied")}
      a:=${call(list,null,id(82900))};assert jsonb_array_length(a->'items')=0,'new auth does not inherit old requests';
    end $checks$;reset role;rollback to savepoint rebind;
    savepoint disabled;update public.merchant_enterprise_employees set status='disabled' where id='${employee}';
    set local role service_role;do $checks$ begin ${reject(call(detail()),"attendance_access_denied")}end $checks$;reset role;rollback to savepoint disabled;
    savepoint no_view;update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${role}';
    set local role service_role;do $checks$ begin ${reject(call(list),"attendance_access_denied")}end $checks$;reset role;rollback to savepoint no_view;
    set local role service_role;do $checks$ begin
      ${[{...proposal,endAt:proposal.startAt},{...proposal,endAt:"2099-01-01T00:00:00.000000Z"},{...proposal,breaks:[...proposal.breaks,...proposal.breaks]},
        {...proposal,breaks:[{...proposal.breaks[0],paid:"yes"}]},{...proposal,latitude:37}].map(p=>reject(call(detail(id(82212)),{...submit,operationId:id(82212),expectedRevision:2,proposal:p}))).join("\n")}
      ${reject(call({...prepare,ownerId:owner}))}
      ${reject(call(detail(id(82212)),{...submit,action:"approve",operationId:id(82212),expectedRevision:2}))}
    end $checks$;reset role;
    savepoint changed_basis;${punch(6,"clock_out","2026-09-29T17:00:00Z")}
    set local role service_role;do $checks$ begin
      ${reject(call(detail(id(82213)),{...submit,operationId:id(82213),startEventId:id(82105),expectedLastEventId:id(82105),expectedRevision:0}),"attendance_correction_basis_changed")}
    end $checks$;reset role;
    ${punch(7,"clock_in","2026-09-29T18:00:00Z",employee,"kiosk")}${punch(8,"clock_out","2026-09-29T19:00:00Z",employee,"kiosk")}
    set local role service_role;do $checks$ begin ${reject(call({...prepare,startEventId:id(82107)}),"attendance_correction_unsupported_basis")}end $checks$;reset role;
    ${punch(9,"clock_in","2026-09-29T20:00:00Z",id(82009))}${punch(10,"clock_out","2026-09-29T21:00:00Z",id(82009))}
    set local role service_role;do $checks$ begin ${reject(call({...prepare,startEventId:id(82109)}),"attendance_correction_unsupported_basis")}end $checks$;reset role;
    rollback to savepoint changed_basis;`,
    `savepoint future_basis;${punch(6,"clock_out","2099-09-29T17:00:00Z")}
    set local role service_role;do $checks$ begin ${reject(call({...prepare,startEventId:id(82105)}),"attendance_session_invalid_records")}end $checks$;reset role;
    rollback to savepoint future_basis;`,
    `set local role service_role;do $checks$ declare a jsonb;c jsonb;q jsonb;rev bigint:=2;count_rows integer:=0;pages integer:=0;begin
      for n in 1..26 loop
        c:=${json(submit)}||jsonb_build_object('operationId',('00000000-0000-4000-8000-'||lpad((82400+n*2)::text,12,'0')),'expectedRevision',rev);
        q:=${json(detail())}||jsonb_build_object('requestId',c->>'operationId');
        a:=public.faolla_attendance_correction_self_v1('${site}','${auth}',q,c,true);rev:=rev+1;
        c:=jsonb_build_object('action','withdraw','operationId',('00000000-0000-4000-8000-'||lpad((82401+n*2)::text,12,'0')),
          'requestId',q->>'requestId','expectedRevision',rev,'reason','Synthetic page withdrawal');
        perform public.faolla_attendance_correction_self_v1('${site}','${auth}',q,c,true);rev:=rev+1;
      end loop;
      q:=${json(list)};loop
        a:=public.faolla_attendance_correction_self_v1('${site}','${auth}',q,null,false);pages:=pages+1;
        assert jsonb_array_length(a->'items')=case when pages=1 then 25 else 2 end,'bounded pages';
        count_rows:=count_rows+jsonb_array_length(a->'items');
        assert position('proposal' in a::text)=0 and position('reason' in a::text)=0,'summary only';
        insert into correction_contracts values(q||jsonb_build_object('siteId','${site}'),a);
        exit when a->'nextCursor'='null'::jsonb;assert pages<2,'no cursor loop';
        q:=q||jsonb_build_object('cursorAt',a->'nextCursor'->>'recordedAt','cursorId',a->'nextCursor'->>'requestId');
      end loop;assert count_rows=27,'no missing original submissions';
      a:=${call(detail(),withdrawal)};assert a->'receipt'->>'revision'='2','old withdrawal replay after newer requests';
    end $checks$;reset role;
    ${["anon","authenticated"].map(r=>`set local role ${r};do $checks$ begin perform ${call()};raise exception 'public RPC';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    set local role service_role;do $checks$ begin
      begin perform 1 from public.merchant_attendance_correction_entries;raise exception 'direct read';exception when insufficient_privilege then null;end;
      begin perform public.faolla_attendance_correction_proposal_v1(${json(proposal)},clock_timestamp());raise exception 'direct helper';exception when insufficient_privilege then null;end;
    end $checks$;reset role;
    do $checks$ begin
      begin update public.merchant_attendance_correction_entries set reason='rewritten' where merchant_id='${site}';raise exception 'rewrite allowed';exception when insufficient_privilege then null;end;
      begin delete from public.merchant_attendance_correction_entries where merchant_id='${site}';raise exception 'delete allowed';exception when insufficient_privilege then null;end;
      assert (select value from correction_event_fingerprint)=(select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.merchant_attendance_events e),'raw facts unchanged';
      assert not public.faolla_valid_merchant_enterprise_permissions_v1(array['attendance.self.request']),'request dependencies';
      assert public.faolla_valid_merchant_enterprise_permissions_v1(array['enterprise.view','attendance.self.view','attendance.self.request']),'independent permission';
    end $checks$;
    select jsonb_agg(jsonb_build_object('query',query,'value',value)) from correction_contracts;rollback;`]);
  for(const {query,value} of JSON.parse(output)){
    const parsed=contract.parseCorrectionResult(value,query);
    if(parsed.mode==="detail")assert.equal(contract.previewCorrection(parsed.basis,parsed.proposal).kind,"unapproved_declaration");
  }
  ["independent request permission; inactive worker can read/request history without clock rights",
    "submit/withdraw are append-only declarations, never changes to raw clock facts",
    "exact operation replay, version conflicts and one pending request per original segment",
    "GET recovers original receipt after withdrawal and later requests",
    "platform pause rejects new submission but preserves authorized withdrawal/recovery",
    "role revocation, employee disablement, owner/cross-tenant and worker-pin attacks rejected",
    "auth rebind cannot inherit another authenticated person's applications",
    "malformed/future/overlapping proposal breaks rejected; no approve action exists",
    "changed/future original segment, kiosk and different employee evidence fail closed",
    "27 summaries paginate 25/2 without exporting reasons or full snapshots",
    "service-only RPC, table isolation, helper ACL and immutable ledger enforced",
    "real SQL JSON parses/preview remains unapproved; schema/data roll back"].forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
