import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {checkUnifiedReport} from './merchant-attendance-unified-report-native.mjs';
const require=createRequire(import.meta.url);
const {parseUnifiedExportSource,buildUnifiedExportCsv}=require('../src/lib/merchantAttendanceUnifiedExport.ts');
const json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
export async function checkUnifiedExport(native,browserCheck=null){
  await checkUnifiedReport(native,async env=>{
    const {root,exec,sql,connect,id,site,owner,employee,manager,worker,location,ownerQ,selfQ,managerQ,pass,day}=env;
    exec(readFileSync(path.join(root,'scripts/supabase-migrations/202610010102_merchant_attendance_unified_export.sql'),'utf8'));
    const command=(q=ownerQ,n=90001)=>({siteId:site,operationId:id(n),query:{access:q.access,workerId:q.access==='self'?null:q.workerId,
      expectedWorkerId:q.access==='self'?q.expectedWorkerId:null,locationId:q.access==='manager'?q.locationId:null,
      fromDate:q.fromDate,throughDate:q.throughDate,expectedTimeZone:'UTC',expectedScopeRevision:q.access==='manager'?1:null}});
    const call=(c=command(),who=owner)=>`public.faolla_attendance_unified_export_v1('${c.siteId}','${who}','${c.operationId}',${json(c.query)})`;
    const read=(c=command(),who=owner)=>JSON.parse(exec(`set role service_role;select ${call(c,who)};`));
    const count=()=>Number(exec('select count(*) from public.merchant_attendance_unified_exports;'));
    const reject=(c,who,code,prep='')=>exec(`begin;${prep}set local role service_role;do $check$ begin begin perform ${call(c,who)};raise exception 'unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;end $check$;rollback;`);
    const oldExports=exec('select coalesce(md5(jsonb_agg(to_jsonb(t) order by operation_id)::text),\'empty\') from public.merchant_attendance_report_exports t;');
    const first=read(),parsed=parseUnifiedExportSource(first,command());assert.equal(parsed.report.totals.selected.workedUs,17*3600000000);
    assert.equal(first.receipt.sessionCount,2);assert.equal(first.receipt.missingCount,2);assert.equal(first.receipt.sourceCount,4);
    const csv=buildUnifiedExportCsv(parsed.report,parsed.receipt);assert(csv.includes('61200000000'));assert(csv.includes('50400000000'));assert(csv.includes('missing-approved'));assert.equal(count(),1);
    const hash=exec(`set role service_role;with r as(select ${call(command(ownerQ,90002))} v) select v->'receipt'->>'sourceSha256'=encode(sha256(convert_to((v->'report')::text,'UTF8')),'hex') from r;`);assert.equal(hash,'t');
    pass('combined export reads all four actual sources in one RPC, matches 17h report and stores a hash of actual unified source, not a fabricated CSV hash');
    reject(command(selfQ,90010),employee,'attendance_export_denied');reject(command(managerQ,90011),manager,'attendance_export_denied');assert.equal(count(),2);
    const permissionSnapshot=exec(`select jsonb_agg(jsonb_build_object('id',id,'permissions',permissions) order by id)::text from public.merchant_enterprise_roles;`);
    try{
      exec(`update public.merchant_enterprise_roles set permissions=array_append(permissions,case when id='${id(30)}' then 'attendance.self.export' else 'attendance.reports.export' end) where id in ('${id(30)}','${id(31)}');`);
      const self=read(command(selfQ,90012),employee),scope=read(command(managerQ,90013),manager);
      assert.equal(parseUnifiedExportSource(self,command(selfQ,90012)).report.totals.selected.workedUs,17*3600000000);
      assert.equal(parseUnifiedExportSource(scope,command(managerQ,90013)).report.totals.selected.workedUs,17*3600000000);
      const other=command({...selfQ,expectedWorkerId:id(202)},90014),empty=read(other,id(2));assert.equal(parseUnifiedExportSource(empty,other).report.totals.selected.workedUs,0);
      reject(command(ownerQ,90015),employee,'attendance_access_denied');reject({...command(ownerQ,90015),siteId:'99990002'},owner,'attendance_access_denied');
      reject(command({...managerQ,locationId:id(302)},90015),manager,'attendance_access_denied');
      pass('view permission alone cannot export; independent self/manager export permissions retain tenant, employee and exact granted location isolation');
      const before=count(),again=read();assert.equal(again.replayed,true);assert.equal(again.report,null);assert.deepEqual(again.receipt,first.receipt);assert.equal(count(),before);
      reject(command({...ownerQ,fromDate:day(-1)}),owner,'attendance_operation_conflict');
      reject(command(managerQ,90013),manager,'attendance_export_denied',`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.records.view'] where id='${id(31)}';`);
      reject(command(managerQ,90013),manager,'attendance_access_denied',`update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()-interval '1 second' where id='${id(91)}';`);
      reject({...command(managerQ,90016),query:{...command(managerQ).query,expectedScopeRevision:2}},manager,'attendance_version_conflict');
      reject({...command(ownerQ,90017),query:{...command().query,expectedTimeZone:'Europe/Madrid'}},owner,'attendance_report_zone_changed');
      assert.equal(count(),before);pass('replay returns the original metadata only; changed query, revoked export permission, expired scope, stale revision or changed zone cannot emit a file or another receipt');
      const a=connect(),b=connect(),race=command(ownerQ,90020);let left,right;
      try{
        left=JSON.parse(await a.step(sql(`begin;set local role service_role;select ${call(race)};`)));
        const waiting=b.step(sql(`begin;set local role service_role;select ${call(race)};commit;`));
        await a.step('commit;');right=JSON.parse(await waiting);
      }finally{await a.close();await b.close();}
      assert.equal(left.replayed,false);assert.equal(right.replayed,true);assert.equal(right.report,null);assert.deepEqual(left.receipt,right.receipt);
      assert.equal(exec(`select count(*) from public.merchant_attendance_unified_exports where operation_id='${race.operationId}';`),'1');
      pass('two actual database connections with the same operation produce one metadata row and only the first response may contain source data');
      // Expiry is temporal: a shared grant lock alone cannot keep it valid while
      // a duplicate operation waits for another transaction to finish.
      exec(`update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()+interval '2 seconds' where id='${id(91)}';`);
      const holder=connect(),waiter=connect(),expiring=command(managerQ,90022);
      try{
        await holder.step(sql(`begin;set local role service_role;select ${call(expiring,manager)};`));
        const blocked=waiter.step(sql(`begin;set local role service_role;do $expiry$ begin begin perform ${call(expiring,manager)};raise exception 'unexpected_expired_export';exception when sqlstate 'P0001' then if sqlerrm<>'attendance_access_denied' then raise;end if;end;end $expiry$;commit;`));
        await holder.step("select pg_sleep(2.1);commit;");await blocked;
      }finally{await holder.close();await waiter.close();exec(`update public.merchant_attendance_scope_grants set valid_until=null where id='${id(91)}';`);}
      assert.equal(exec(`select count(*) from public.merchant_attendance_unified_exports where operation_id='${expiring.operationId}';`),'1');
      pass('manager grant expiring while a duplicate export waits is rechecked after the wait; no stale replay/file escapes the database');
      const rawConflict=`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values('${id(90500)}','${site}','${worker}','${location}','${id(90500)}',5,'clock_in','web','${day(-1)}T16:00:00Z','UTC','${id(101)}');`;
      const beforeConflict=count();reject(command(ownerQ,90021),owner,'attendance_report_reconciliation_required',rawConflict);assert.equal(count(),beforeConflict);
      pass('a source conflict discovered at export time fails closed without recording a successful source read or altering punch/approval history');
      if(browserCheck)await browserCheck({...env,command,call,readExport:read});
    }finally{
      exec(`update public.merchant_enterprise_roles r set permissions=x.permissions from jsonb_to_recordset('${permissionSnapshot.replaceAll("'","''")}'::jsonb) as x(id uuid,permissions text[]) where r.id=x.id;`);
    }
    const acl=JSON.parse(exec(`select jsonb_build_object('serviceRead',has_table_privilege('service_role','public.merchant_attendance_unified_exports','SELECT'),'serviceWrite',has_table_privilege('service_role','public.merchant_attendance_unified_exports','INSERT'),'anon',has_function_privilege('anon','public.faolla_attendance_unified_export_v1(text,uuid,uuid,jsonb)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public.faolla_attendance_unified_export_v1(text,uuid,uuid,jsonb)','EXECUTE'),'service',has_function_privilege('service_role','public.faolla_attendance_unified_export_v1(text,uuid,uuid,jsonb)','EXECUTE'));`));
    assert.deepEqual(acl,{serviceRead:false,serviceWrite:false,anon:false,authenticated:false,service:true});
    for(const statement of ["update public.merchant_attendance_unified_exports set source_bytes=2","delete from public.merchant_attendance_unified_exports","truncate public.merchant_attendance_unified_exports"]){
      exec(`begin;do $immutable$ begin begin ${statement};raise exception 'unexpected_rewrite';exception when sqlstate '42501' then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;end $immutable$;rollback;`);
    }
    const stored=JSON.parse(exec('select to_jsonb(t) from public.merchant_attendance_unified_exports t limit 1;'));for(const key of ['csv','report','worker_name','proposal','reason','latitude'])assert.equal(key in stored,false);
    assert.equal(exec('select coalesce(md5(jsonb_agg(to_jsonb(t) order by operation_id)::text),\'empty\') from public.merchant_attendance_report_exports t;'),oldExports);
    pass('new receipts contain metadata only, are append-only and server-RPC-only; no legacy export entries, business facts or original role permissions changed');
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceLabelsReuse(process.argv.slice(2),checkUnifiedExport).catch(e=>{console.error(e);process.exitCode=1;});
