import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

// Rollback-only synthetic fixtures. No application credentials or online schema.
export function checkAttendanceAuditNative({root,query,pass}){
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const site="99990007",foreign="99990008",owner=id(21001),foreignOwner=id(21002),employee=id(21003),grant=id(21004),place=id(21005),worker=id(21006);
  const base={mode:"list",source:"config",fromAt:"2026-09-01T00:00:00.000000Z",toAt:"2026-09-02T00:00:00.000000Z",asOf:null,cursorAt:null,cursorId:null};
  const detail=(operationId,source="config")=>({mode:"detail",source,operationId});
  const call=(q=base,who=owner,tenant=site)=>`public.faolla_attendance_audit_v1('${tenant}','${who}','${JSON.stringify(q)}'::jsonb)`;
  const reject=(q,code="attendance_invalid_request",who=owner,tenant=site)=>`begin perform ${call(q,who,tenant)};
    raise exception 'unexpected audit acceptance'; exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise; end if; end;`;
  const settings={timeZone:"UTC",enabled:false,webClockEnabled:false,webBreakPaid:false};
  const oldSettings={time_zone:"Europe/Madrid",enabled:true,web_clock_enabled:true,web_break_paid:false,merchant_id:site};
  const oldLocation={id:place,name:"Old workplace",active:false,time_zone:"UTC",latitude:37.389,longitude:-5.984,private_extra:"never expose"};
  const newLocation={id:place,name:"New workplace",active:true,timeZone:"Europe/Madrid"};
  const oldWorker={id:worker,employee_id:employee,worker_no:"OLD",display_name:"Old worker",default_location_id:place,active:false,private_extra:"never expose"};
  const newWorker={id:worker,employeeId:employee,workerNo:"NEW",displayName:"New worker",locationId:place,active:true,startsOn:"2026-09-01"};
  const grantValue={id:grant,workerIds:[worker],locationIds:[place],validFrom:"2026-09-01T00:00:00.000Z",validUntil:null};
  const otherGrant={...grantValue,id:id(21009),workerIds:[id(21010)]};
  const scopeValue=grants=>({siteId:site,employeeId:employee,revision:2,grants});
  const json=v=>`'${JSON.stringify(v)}'::jsonb`;
  const receipt=(n,kind,before,after)=>`('${site}','${id(n)}','${owner}',${n},${json({kind,values:after})},${json(before)},${json(after)},'2026-09-01T13:00:00Z')`;
  const migration=readFileSync(path.join(root,"scripts/supabase-migrations/202609300069_merchant_attendance_audit_read.sql"),"utf8").replace(/^begin;$/m,"").replace(/^commit;$/m,"");
  const invalid=[{...base,authUserId:foreignOwner},{...base,limit:1000},{...base,source:["config"]},{...base,toAt:base.fromAt},
    {...base,toAt:"2026-10-02T00:00:00.000001Z"},{...base,fromAt:"2026-02-30T00:00:00.000000Z"},
    {...base,asOf:"2099-01-01T00:00:00.000000Z"},{...base,cursorAt:"2026-09-01T12:00:00.000000Z",cursorId:id(22025)},
    {...base,asOf:"2026-09-03T00:00:00.000000Z",cursorAt:base.toAt,cursorId:id(22025)},
    {...detail(id(22502)),fromAt:base.fromAt},{...detail(id(22502)),operationId:"*"}];
  const labels=["owner audit lists 54 config receipts in 25, 25 and 4 without duplicate or missing IDs",
    "microsecond and same-time UUID ordering survive page continuation",
    "date bounds are half-open and limited to 31 days with strict list/detail queries",
    "settings, location and worker snapshots use historical field whitelists",
    "old worker startsOn stays unrecorded rather than reconstructed",
    "grant put/remove detail exposes only the affected grant, not other scopes",
    "lists never return snapshots and details never return raw authentication identity or coordinates",
    "unknown, wrong-source and other-tenant operation IDs all return owner-visible not-found",
    "current owner authorization is rechecked for list, page and detail after owner change",
    "actor linkage is tenant-scoped and current-owner attribution is exact",
    "anon/authenticated cannot execute audit RPC and service role cannot call raw projection helper",
    "audit reading does not alter any config or scope receipt"];
  const output=query(`begin; set local lock_timeout='3s'; set local statement_timeout='10s';
    ${migration}
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${foreignOwner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled) values('${site}','UTC',false),('${foreign}','UTC',false);
    insert into public.merchant_enterprise_employees(id,merchant_id,email,display_name,status) values('${employee}','${site}','audit@example.test','Synthetic audit employee','invited');
    insert into public.merchant_attendance_scopes(merchant_id,employee_id,revision) values('${site}','${employee}',2);
    insert into public.merchant_attendance_config_operations(merchant_id,operation_id,actor_auth_user_id,version,command,before_value,after_value,recorded_at)
      select '${site}',('00000000-0000-4000-8000-'||lpad((22000+n)::text,12,'0'))::uuid,'${owner}',n,
        ${json({kind:"settings",values:settings})},${json(oldSettings)},${json(settings)},
        '2026-09-01T12:00:00Z'::timestamptz+(n/2)*interval '1 microsecond' from generate_series(1,51)n;
    insert into public.merchant_attendance_config_operations(merchant_id,operation_id,actor_auth_user_id,version,command,before_value,after_value,recorded_at) values
      ${receipt(22501,"location",oldLocation,newLocation)},${receipt(22502,"worker",oldWorker,newWorker)},${receipt(22503,"settings",null,settings)},
      ('${foreign}','${id(22504)}','${owner}',1,${json({kind:"settings",values:settings})},null,${json(settings)},'2026-09-01T12:00:00Z');
    insert into public.merchant_attendance_scope_operations(merchant_id,operation_id,employee_id,actor_auth_user_id,revision,command,before_value,after_value,recorded_at) values
      ('${site}','${id(23001)}','${employee}','${owner}',1,${json({action:"put",grantId:grant})},${json(scopeValue([otherGrant]))},${json(scopeValue([otherGrant,grantValue]))},'2026-09-01T14:00:00Z'),
      ('${site}','${id(23002)}','${employee}','${owner}',2,${json({action:"remove",grantId:grant})},${json(scopeValue([otherGrant,grantValue]))},${json(scopeValue([otherGrant]))},'2026-09-01T14:01:00Z');
    create temporary table audit_fingerprint as select md5((select jsonb_agg(to_jsonb(t) order by operation_id)::text from public.merchant_attendance_config_operations t)) config,
      md5((select jsonb_agg(to_jsonb(t) order by operation_id)::text from public.merchant_attendance_scope_operations t)) scope;
    set local role service_role;
    do $checks$ declare r jsonb; q jsonb:='${JSON.stringify(base)}'; all_rows jsonb:='[]'; pages integer:=0; begin
      loop
        r:=public.faolla_attendance_audit_v1('${site}','${owner}',q);pages:=pages+1;
        assert jsonb_array_length(r->'items')=case when pages<3 then 25 else 4 end,'page size';
        all_rows:=all_rows||(r->'items'); exit when r->'nextCursor'='null'::jsonb;
        assert pages<3,'bounded pages';q:=q||jsonb_build_object('asOf',r->>'asOf','cursorAt',r->'nextCursor'->>'recordedAt','cursorId',r->'nextCursor'->>'operationId');
      end loop;
      assert pages=3 and jsonb_array_length(all_rows)=54,'all receipts';
      assert (select count(distinct j->>'operationId') from jsonb_array_elements(all_rows)j)=54,'unique receipts';
      assert all_rows->3->>'operationId'='${id(22051)}' and all_rows->4->>'operationId'='${id(22050)}','equal-time UUID tie';
      assert all_rows->3->>'recordedAt'='2026-09-01T12:00:00.000025Z','microseconds';
      assert (select array_agg(k order by k) from jsonb_object_keys(all_rows->0)k)=array['actorRef','byCurrentOwner','employeeId','kind','operationId','recordedAt','targetId','version'],'metadata whitelist';
      assert all_rows->0->>'actorRef'=all_rows->53->>'actorRef' and (all_rows->0->>'byCurrentOwner')::boolean,'stable current actor';
      assert position('${owner}' in r::text)=0,'no raw authentication ID';
      r:=${call({...base,fromAt:"2026-09-01T12:00:00.000000Z",toAt:"2026-09-01T12:00:00.000001Z"})};
      assert jsonb_array_length(r->'items')=1 and r->'items'->0->>'operationId'='${id(22001)}','half-open dates';
      perform ${call({...base,toAt:"2026-10-02T00:00:00.000000Z"})};
      ${invalid.map(q=>reject(q)).join("\n")}
      r:=${call(detail(id(22001)))};
      assert r->'before'=${json({timeZone:"Europe/Madrid",enabled:true,webClockEnabled:true,webBreakPaid:false})} and r->'after'=${json(settings)},'settings historical mapping';
      r:=${call(detail(id(22501)))};
      assert r->'before'=${json({id:place,name:"Old workplace",active:false,timeZone:"UTC"})} and r->'after'=${json(newLocation)},'location whitelist';
      r:=${call(detail(id(22502)))};
      assert r->'before'=${json({id:worker,employeeId:employee,workerNo:"OLD",displayName:"Old worker",locationId:place,active:false,startsOn:null})}
        and r->'after'=${json(newWorker)},'worker historical values';
      r:=${call(detail(id(22503)))}; assert r->'before'='null'::jsonb,'initial create';
      r:=${call(detail(id(23001),"scope"))};assert r->'before'='null'::jsonb and r->'after'=${json(grantValue)},'put only target grant';
      r:=${call(detail(id(23002),"scope"))};assert r->'before'=${json(grantValue)} and r->'after'='null'::jsonb,'remove only target grant';
      assert r->'item'->>'employeeId'='${employee}' and position('${id(21009)}' in r::text)=0,'scope isolation';
      r:=${call({...base,source:"scope"})};assert jsonb_array_length(r->'items')=2 and r->'items'->0->>'kind'='grant_remove','scope summary';
      ${[detail(id(29999)),detail(id(22504)),detail(id(23001)),detail(id(22502),"scope")].map(q=>reject(q,"attendance_audit_not_found")).join("\n")}
      ${[base,detail(id(22502))].map(q=>reject(q,"attendance_access_denied",foreignOwner)).join("\n")}
      ${reject(base,"attendance_access_denied",owner,foreign)}
      r:=${call(base,foreignOwner,foreign)};assert r->'items'->0->>'actorRef'<>all_rows->0->>'actorRef'
        and r->'items'->0->>'byCurrentOwner'='false','tenant-scoped actor reference';
    end $checks$; reset role;
    update public.merchants set user_id='${foreignOwner}' where id='${site}';
    set local role service_role; do $checks$ begin
      ${[base,{...base,asOf:"2026-09-03T00:00:00.000000Z",cursorAt:"2026-09-01T12:00:00.000012Z",cursorId:id(22025)},detail(id(22502))].map(q=>reject(q,"attendance_access_denied")).join("\n")}
      perform ${call(base,foreignOwner)};
    end $checks$;reset role;
    ${["anon","authenticated"].map(role=>`set local role ${role};do $checks$ begin perform ${call(base,foreignOwner)};
      raise exception 'unexpected audit execution';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    set local role service_role;do $checks$ begin perform public.faolla_attendance_audit_value_v1('settings',${json(settings)},false,null);
      raise exception 'unexpected helper execution';exception when insufficient_privilege then null;end $checks$;reset role;
    do $checks$ begin
      assert (select config from audit_fingerprint)=(select md5(jsonb_agg(to_jsonb(t) order by operation_id)::text) from public.merchant_attendance_config_operations t),'config receipts unchanged';
      assert (select scope from audit_fingerprint)=(select md5(jsonb_agg(to_jsonb(t) order by operation_id)::text) from public.merchant_attendance_scope_operations t),'scope receipts unchanged';
    end $checks$;
    select '${JSON.stringify(labels)}'::jsonb;rollback;`);
  assert.deepEqual(JSON.parse(output),labels);labels.forEach(pass);
}
