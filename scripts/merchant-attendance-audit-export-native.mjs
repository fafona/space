// Only the existing explicitly named synthetic cluster; schema/data roll back.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import contract from "../src/lib/merchantAttendanceAuditExport.ts";
import {runAttendanceLabelsReuse} from "./merchant-attendance-choice-labels-reuse-native.mjs";
async function check({root,querySteps,pass}){
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const site="99990007",foreign="99990008",owner=id(80001),other=id(80002),employee=id(80003),grant=id(80004),worker=id(80005),place=id(80006);
  const json=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
  const read=name=>readFileSync(path.join(root,"scripts/supabase-migrations",name),"utf8").replace(/^begin;$/m,"").replace(/^commit;$/m,"");
  const q={source:"config",fromAt:"2026-09-01T00:00:00.000000Z",toAt:"2026-09-02T00:00:00.000000Z"};
  const call=(input=q,who=owner,tenant=site)=>`public.faolla_attendance_audit_export_v1('${tenant}','${who}',${json(input)})`;
  const reject=(expression,code="attendance_invalid_request")=>`begin perform ${expression};raise exception 'unexpected export acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const settings={timeZone:"UTC",enabled:false,webClockEnabled:false,webBreakPaid:false};
  const grantValue={id:grant,workerIds:[worker],locationIds:[place],validFrom:q.fromAt,validUntil:null};
  const otherGrant={...grantValue,id:id(80009)};
  const oldWorker={id:worker,employee_id:employee,worker_no:"OLD",display_name:'历史,"员工"',default_location_id:place,active:false,private_extra:"never expose"};
  const newWorker={id:worker,employeeId:employee,workerNo:"NEW",displayName:"=not-a-formula",locationId:place,active:true,startsOn:"2026-09-01"};
  const addConfigs=(count,base=81000,time="2026-09-01T12:00:00.000001Z")=>`insert into public.merchant_attendance_config_operations
    (merchant_id,operation_id,actor_auth_user_id,version,command,before_value,after_value,recorded_at)
    select '${site}',('00000000-0000-4000-8000-'||lpad((${base}+n)::text,12,'0'))::uuid,'${owner}',${base}+n,
      ${json({kind:"settings",values:settings})},null,${json(settings)},'${time}' from generate_series(1,${count})n;`;
  const output=await querySteps([`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${["202609300069_merchant_attendance_audit_read.sql","202609300080_merchant_attendance_audit_export.sql"].map(read).join("\n")}
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${other}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled) values('${site}','UTC',false),('${foreign}','UTC',false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
      values('${id(80007)}','${site}','Synthetic export role',array['enterprise.view','attendance.records.view','audit.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values('${employee}','${site}','${id(80008)}','audit-export@example.test','Synthetic export employee','${id(80007)}','active');
    insert into public.merchant_attendance_scopes(merchant_id,employee_id,revision) values('${site}','${employee}',2);
    ${addConfigs(248)}
    insert into public.merchant_attendance_config_operations(merchant_id,operation_id,actor_auth_user_id,version,command,before_value,after_value,recorded_at) values
      ('${site}','${id(81501)}','${owner}',81501,${json({kind:"location",values:{id:place}})},${json({id:place,name:"Old",active:false,time_zone:"UTC",latitude:37,longitude:-5,private_extra:"never expose"})},${json({id:place,name:"New",active:true,timeZone:"UTC"})},'2026-09-01T13:00:00Z'),
      ('${site}','${id(81502)}','${owner}',81502,${json({kind:"worker",values:newWorker})},${json(oldWorker)},${json(newWorker)},'2026-09-01T13:01:00Z'),
      ('${foreign}','${id(81503)}','${other}',1,${json({kind:"settings",values:settings})},null,${json(settings)},'2026-09-01T12:00:00Z');
    insert into public.merchant_attendance_scope_operations(merchant_id,employee_id,operation_id,actor_auth_user_id,revision,command,before_value,after_value,recorded_at) values
      ('${site}','${employee}','${id(82001)}','${owner}',1,${json({action:"put",grantId:grant})},${json({grants:[otherGrant]})},${json({grants:[otherGrant,grantValue]})},'2026-09-01T14:00:00Z'),
      ('${site}','${employee}','${id(82002)}','${owner}',2,${json({action:"remove",grantId:grant})},${json({grants:[otherGrant,grantValue]})},${json({grants:[otherGrant]})},'2026-09-01T14:01:00Z');
    create temporary table export_contracts(value jsonb);grant insert,select on export_contracts to service_role;
    create temporary table export_fingerprint as select md5((select jsonb_agg(to_jsonb(t) order by merchant_id,operation_id)::text from public.merchant_attendance_config_operations t)) config,
      md5((select jsonb_agg(to_jsonb(t) order by merchant_id,operation_id)::text from public.merchant_attendance_scope_operations t)) scope;
    set local role service_role;do $checks$ declare a jsonb;b jsonb;begin
      a:=${call()};assert a->>'count'='250','full bounded export';
      assert a->'rows'->0->'item'->>'operationId'='${id(81502)}','ordered worker first';
      assert a->'rows'->0->'before'->'startsOn'='null'::jsonb,'old missing date preserved';
      assert a->'rows'->2->'item'->>'operationId'='${id(81248)}','UUID tie ordering';
      assert a->'rows'->2->'item'->>'recordedAt'='2026-09-01T12:00:00.000001Z','microseconds';
      assert position('latitude' in a::text)=0 and position('longitude' in a::text)=0 and position('private_extra' in a::text)=0 and position('${owner}' in a::text)=0,'private fields removed';
      insert into export_contracts values(a);
      a:=${call({...q,source:"scope"})};assert a->>'count'='2','scope count';
      assert a->'rows'->0->'before'=${json(grantValue)} and a->'rows'->0->'after'='null'::jsonb,'removal';
      assert position('${id(80009)}' in a::text)=0,'other grant excluded';insert into export_contracts values(a);
      a:=${call({...q,fromAt:"2026-09-01T12:00:00.000001Z",toAt:"2026-09-01T12:00:00.000002Z"})};assert a->>'count'='248','half-open microseconds';
      a:=${call({...q,fromAt:"2026-09-01T12:00:00.000002Z",toAt:"2026-09-01T12:00:00.000003Z"})};assert a->>'count'='0','empty bounded snapshot';insert into export_contracts values(a);
      ${[other,id(80008)].map(who=>reject(call(q,who),"attendance_access_denied")).join("\n")}
      ${reject(call(q,owner,foreign),"attendance_access_denied")}
      ${[{...q,source:"all"},{...q,ownerId:owner},{...q,limit:1000},{...q,asOf:q.toAt},{...q,toAt:q.fromAt},{...q,toAt:"2026-10-02T00:00:00.000001Z"},{...q,fromAt:"2026-02-30T00:00:00.000000Z"},null,[]].map(input=>reject(call(input))).join("\n")}
    end $checks$;reset role;`,
    `savepoint too_many;${addConfigs(1,83000)}set local role service_role;do $checks$ begin ${reject(call(),"attendance_export_too_large")} end $checks$;reset role;rollback to savepoint too_many;
    savepoint revoke;update public.merchants set user_id='${other}' where id='${site}';
    set local role service_role;do $checks$ declare a jsonb;begin ${reject(call(),"attendance_access_denied")}
      a:=${call(q,other)};assert a->'rows'->0->'item'->'byCurrentOwner'='false'::jsonb,'new owner historical attribution';end $checks$;reset role;rollback to savepoint revoke;
    ${["anon","authenticated"].map(role=>`set local role ${role};do $checks$ begin perform ${call()};raise exception 'public export';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    set local role service_role;do $checks$ begin perform public.faolla_attendance_audit_value_v1('settings',${json(settings)},false,null);raise exception 'direct helper';exception when insufficient_privilege then null;end $checks$;reset role;
    savepoint too_large;
    insert into public.merchant_attendance_scope_operations(merchant_id,employee_id,operation_id,actor_auth_user_id,revision,command,before_value,after_value,recorded_at)
      select '${site}','${employee}',('00000000-0000-4000-8000-'||lpad((84000+n)::text,12,'0'))::uuid,'${owner}',10+n,
        ${json({action:"put",grantId:grant})},
        ${json({grants:[{...grantValue,workerIds:Array.from({length:200},(_,n)=>id(90000+n)),locationIds:Array.from({length:50},(_,n)=>id(91000+n))}]})},
        ${json({grants:[{...grantValue,workerIds:Array.from({length:200},(_,n)=>id(90000+n)),locationIds:Array.from({length:50},(_,n)=>id(91000+n))}]})},
        '2026-09-01T15:00:00Z' from generate_series(1,90)n;
    set local role service_role;do $checks$ begin ${reject(call({...q,source:"scope"}),"attendance_export_too_large")} end $checks$;reset role;rollback to savepoint too_large;
    do $checks$ begin
      assert (select config from export_fingerprint)=(select md5(jsonb_agg(to_jsonb(t) order by merchant_id,operation_id)::text) from public.merchant_attendance_config_operations t),'config immutable';
      assert (select scope from export_fingerprint)=(select md5(jsonb_agg(to_jsonb(t) order by merchant_id,operation_id)::text) from public.merchant_attendance_scope_operations t),'scope immutable';
    end $checks$;
    select jsonb_agg(value) from export_contracts;rollback;`]);
  for(const value of JSON.parse(output)){
    const parsed=contract.parseAttendanceAuditExportResult(value,{siteId:value.siteId,source:value.source,fromAt:value.fromAt,toAt:value.toAt});
    const file=contract.buildAttendanceAuditCsv(parsed);assert.equal(file.count,value.count);assert.ok(file.csv.startsWith("\ufeff"));
  }
  ["250 receipts and historical values exported in one bounded SQL snapshot", "microsecond ordering, half-open range and zero-row metadata preserved",
    "private coordinates, raw auth and unrelated grants excluded", "employee and cross-tenant denied; ownership rechecked after change",
    "strict schema/date guards; 251st receipt rejects rather than truncates", "oversized scope snapshots reject without partial export",
    "service-only execution and helper ACL preserved", "real SQL JSON parses and creates CSV; all synthetic schema/data rolled back"].forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
