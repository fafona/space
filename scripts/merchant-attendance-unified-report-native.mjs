import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runAttendanceLabelsReuse } from './merchant-attendance-choice-labels-reuse-native.mjs';
import { withAttendanceConcurrencySandbox } from './merchant-attendance-concurrency-sandbox.mjs';
const require=createRequire(import.meta.url);
const {parseUnifiedSource}=require('../src/lib/merchantAttendanceUnifiedTimesheet.ts');
export const unifiedId=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
export async function checkUnifiedReport(native,browserCheck=null){
  const {root,query,pass}=native,id=unifiedId,site='99990001',owner=id(99),employee=id(1),manager=id(3),worker=id(201),location=id(301);
  await withAttendanceConcurrencySandbox(native,async({sql})=>{
    const exec=s=>query(sql(s)),folder=path.join(root,'scripts/supabase-migrations');
    const extras=readdirSync(folder).filter(n=>/^2026\d{8}_/.test(n)&&Number(n.slice(0,12))>=202609300087&&Number(n.slice(0,12))<=202610010101).sort();assert.equal(extras.length,15);
    for(const f of extras)exec(readFileSync(path.join(folder,f),'utf8'));
    const today=exec("select (clock_timestamp() at time zone 'UTC')::date;"),day=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),at=(n,t)=>`${day(n)}T${t}:00.000000Z`;
    exec(`begin;insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990002','${id(98)}');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
      ('${id(30)}','${site}','Self',array['enterprise.view','attendance.self.view','attendance.self.request']),('${id(31)}','${site}','Manager',array['enterprise.view','attendance.records.view']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${id(101)}','${site}','${employee}','unified-a@example.invalid','核对员工甲','${id(30)}','active'),('${id(102)}','${site}','${id(2)}','unified-b@example.invalid','核对员工乙','${id(30)}','active'),
      ('${id(103)}','${site}','${manager}','unified-manager@example.invalid','合成主管','${id(31)}','active');
      insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','UTC');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${location}','${site}','合成地点甲','UTC',true),('${id(302)}','${site}','合成地点乙','UTC',true);
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id) values
      ('${worker}','${site}','${id(101)}','A01','核对员工甲',true,'${location}'),('${id(202)}','${site}','${id(102)}','B01','核对员工乙',true,'${location}');
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01'),('${site}','${id(202)}','2000-01-01');
      insert into public.merchant_attendance_scopes(merchant_id,employee_id,revision) values('${site}','${id(103)}',1);
      insert into public.merchant_attendance_scope_grants(merchant_id,employee_id,id,valid_from) values('${site}','${id(103)}','${id(91)}','2000-01-01Z');
      insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${id(103)}','${id(91)}','${worker}');
      insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id) values('${site}','${id(103)}','${id(91)}','${location}');
      insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values
      ('${id(8101)}','${site}','${worker}','${location}','${id(8101)}',1,'clock_in','web','${at(-1,'01:00')}','UTC','${id(101)}'),
      ('${id(8102)}','${site}','${worker}','${location}','${id(8102)}',2,'clock_out','web','${at(-1,'02:00')}','UTC','${id(101)}'),
      ('${id(8103)}','${site}','${worker}','${location}','${id(8103)}',3,'clock_in','web','${at(-1,'04:00')}','UTC','${id(101)}'),
      ('${id(8104)}','${site}','${worker}','${location}','${id(8104)}',4,'clock_out','web','${at(-1,'05:00')}','UTC','${id(101)}');commit;`);
    const policy={action:'set_policy',operationId:id(390),expectedRevision:0,expectedSettingsVersion:1,reason:'合成规则',submissionWindowDays:30};
    exec(`set role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(policy)},null,null,true);`);
    const corrected=(startEvent,lastEvent,request,operation,proposal)=>`perform public.faolla_attendance_correction_self_v3('${site}','${employee}',${json({mode:'detail',expectedWorkerId:worker,requestId:request,operationId:null})},${json({action:'submit',operationId:request,expectedRevision:0,expectedPolicyRevision:1,reason:'合成核定',startEventId:startEvent,expectedLastEventId:lastEvent,proposal})},true);
      evidence:=public.faolla_attendance_correction_decide_v2('${site}','${owner}','${request}',null,null,true);if evidence->'canApprove'<>'true'::jsonb then raise exception 'fixture_not_approvable';end if;
      perform public.faolla_attendance_correction_decide_v2('${site}','${owner}','${request}',${json({action:'approve',operationId:operation,requestId:request,expectedRevision:1,reason:'合成批准'})}||jsonb_build_object('expectedEvidence',evidence->'evidenceToken'),null,true);`;
    exec(`set role service_role;do $correct$ declare evidence jsonb;begin ${corrected(id(8101),id(8102),id(8110),id(8111),{startAt:at(-1,'02:00'),endAt:at(-1,'04:00'),breaks:[]})} end $correct$;`);
    const missingQ={siteId:site,access:'self',fromDate:day(-6),throughDate:today,requestId:null,operationId:null,beforeAt:null,beforeId:null};
    const proposal={startAt:at(-1,'09:00'),endAt:at(-1,'17:00'),breaks:[{startAt:at(-1,'12:00'),endAt:at(-1,'13:00'),paid:true}]};
    const command={action:'submit',operationId:id(401),reason:'整段漏卡',expectedWorkerId:worker,expectedSettingsVersion:1,expectedPolicyRevision:1,locationId:location,timeZone:'UTC',proposal};
    const declareMissing=(n,p,status='approve')=>{
      const c={...command,operationId:id(n),proposal:p};
      exec(`set role service_role;select public.faolla_attendance_missing_v1(${json(missingQ)},'${employee}',${json(c)},true);`);
      if(status==='pending')return;
      const q={...missingQ,access:status==='withdraw'?'self':'owner',requestId:id(n)},who=status==='withdraw'?employee:owner;
      const evidence=JSON.parse(exec(`set role service_role;select public.faolla_attendance_missing_v1(${json(q)},'${who}',null,true);`));
      const d={action:status,requestId:id(n),operationId:id(n+1),expectedRevision:1,reason:'合成决定',...(status==='withdraw'?{}:{evidenceToken:evidence.detail.evidenceToken})};
      exec(`set role service_role;select public.faolla_attendance_missing_v1(${json(q)},'${who}',${json(d)},true);`);
    };
    declareMissing(401,proposal);
    declareMissing(403,{startAt:at(-3,'22:00'),endAt:at(-2,'06:00'),breaks:[{startAt:at(-2,'00:30'),endAt:at(-2,'01:30'),paid:false}]});
    for(const [n,start,end,status] of [[405,'18:00','19:00','pending'],[407,'19:00','20:00','withdraw'],[409,'20:00','21:00','reject']])declareMissing(n,{startAt:at(-1,start),endAt:at(-1,end),breaks:[]},status);
    const ownerQ={siteId:site,access:'owner',workerId:worker,fromDate:day(-6),throughDate:today},selfQ={siteId:site,access:'self',expectedWorkerId:worker,fromDate:day(-6),throughDate:today},managerQ={siteId:site,access:'manager',workerId:worker,locationId:location,fromDate:day(-6),throughDate:today};
    const wireQuery=q=>q.access==='owner'?{access:q.access,workerId:q.workerId,fromDate:q.fromDate,throughDate:q.throughDate}:{access:q.access,workerId:q.access==='manager'?q.workerId:null,locationId:q.access==='manager'?q.locationId:null,expectedWorkerId:q.access==='self'?q.expectedWorkerId:null,fromDate:q.fromDate,throughDate:q.throughDate};
    const call=(q=ownerQ,who=owner)=>`public.faolla_attendance_unified_report_v1('${q.siteId}','${who}',${json(wireQuery(q))})`;
    const read=(q=ownerQ,who=owner)=>parseUnifiedSource(JSON.parse(exec(`set role service_role;select ${call(q,who)};`)),q);
    const reject=(q,who,code,prep='')=>exec(`begin;${prep}set local role service_role;do $check$ begin begin perform ${call(q,who)};raise exception 'unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;end $check$;rollback;`);
    const fingerprint=()=>exec(`select jsonb_build_object(${['events','correction_entries','correction_effects','effect_versions','missing_requests','missing_entries','settings','workers','scope_grants'].map(t=>`'${t}',(select md5(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text) from public.merchant_attendance_${t} t)`).join(',')},'roles',(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.merchant_enterprise_roles t));`),baseline=fingerprint();
    const r=read();assert.equal(r.base.rows.length,2);assert.equal(r.missing.length,2);assert.equal(r.totals.original.workedUs,2*3600000000);assert.equal(r.totals.recordedSelected.workedUs,3*3600000000);
    assert.equal(r.totals.missingSelected.workedUs,14*3600000000);assert.equal(r.totals.selected.workedUs,17*3600000000);assert.equal(r.totals.missingSelected.paidBreakUs,3600000000);assert.equal(fingerprint(),baseline);
    const legacy=JSON.parse(exec(`set role service_role;select public.faolla_attendance_period_report_v2('${site}','${owner}',${json({workerId:worker,fromDate:ownerQ.fromDate,throughDate:today})});`));assert.equal(legacy.items.length,2);
    pass('unified report adds two approved declarations once, retains original/latest corrected totals and paid-break semantics; old report and source rows unchanged');
    assert.equal(read({...ownerQ,fromDate:day(-2),throughDate:day(-2)}).totals.selected.workedUs,5*3600000000);
    assert.equal(read({...ownerQ,fromDate:day(-1),throughDate:day(-1)}).totals.selected.workedUs,10*3600000000);
    assert.equal(r.missing.some(x=>[id(405),id(407),id(409)].includes(x.requestId)),false);pass('cross-midnight clipping counts only requested natural days; pending, withdrawn and rejected declarations excluded');
    assert.equal(read(selfQ,employee).totals.selected.workedUs,r.totals.selected.workedUs);assert.equal(read(managerQ,manager).totals.selected.workedUs,r.totals.selected.workedUs);
    assert.equal(read({...selfQ,expectedWorkerId:null},id(2)).missing.length,0);reject(ownerQ,employee,'attendance_access_denied');reject({...ownerQ,siteId:'99990002'},owner,'attendance_access_denied');
    reject({...managerQ,locationId:id(302)},manager,'attendance_access_denied');reject({...managerQ,workerId:id(202)},manager,'attendance_access_denied');
    pass('owner, self and authorized manager use same totals; foreign employee, owner impersonation and ungranted worker/location combinations cannot leak sources');
    reject(managerQ,manager,'attendance_access_denied',`update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()-interval '1 second' where id='${id(91)}';`);
    reject(managerQ,manager,'attendance_access_denied',`update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${id(31)}';`);
    const historical=JSON.parse(exec(`begin;update public.merchant_attendance_workers set active=false where id='${worker}';update public.merchant_attendance_locations set active=false where id='${location}';select ${call()};rollback;`));
    assert.equal(parseUnifiedSource(historical,ownerQ).missing.length,2);
    const reboundPrep=`update public.merchant_attendance_workers set employee_id=null where id in ('${worker}','${id(202)}');update public.merchant_attendance_workers set employee_id='${id(101)}' where id='${id(202)}';`;
    reject(selfQ,employee,'attendance_worker_changed',reboundPrep);
    const rebound=JSON.parse(exec(`begin;${reboundPrep}select ${call({...selfQ,expectedWorkerId:null},employee)};rollback;`));assert.equal(rebound.missing.length,0);
    pass('expired/revoked manager grants and employee rebinding are rechecked; historical approved declarations survive inactive worker/location without becoming another employee records');
    const laterCorrection=`do $later$ declare evidence jsonb;begin ${corrected(id(8103),id(8104),id(8120),id(8121),{startAt:at(-1,'10:00'),endAt:at(-1,'11:00'),breaks:[]})} end $later$;`;
    reject(ownerQ,owner,'attendance_report_reconciliation_required',laterCorrection);
    reject(managerQ,manager,'attendance_report_reconciliation_required',laterCorrection);
    const rawConflict=`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id) values('${id(8150)}','${site}','${worker}','${location}','${id(8150)}',5,'clock_in','web','${at(-1,'16:00')}','UTC','${id(101)}');`;
    reject(ownerQ,owner,'attendance_report_reconciliation_required',rawConflict);assert.equal(fingerprint(),baseline);
    pass('later real correction approval moving into an approved missing span and later overlapping raw event cause fail-closed report, never misleading combined totals');
    const lock={action:'lock_period',operationId:id(8200),expectedRevision:1,expectedSettingsVersion:1,reason:'合成锁定',fromDate:day(-6),throughDate:day(-1)};
    const locked=JSON.parse(exec(`begin;do $lock$ begin perform public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(lock)},null,null,true);end $lock$;select ${call()};rollback;`));
    assert.equal(parseUnifiedSource(locked,ownerQ).totals.selected.workedUs,r.totals.selected.workedUs);pass('locking an already approved period preserves read-only historical totals and does not invalidate approved hours');
    // The count bound applies to all sources together, not a separate 100+100.
    // Use real submit/approve operations, then roll the synthetic bulk back.
    const bulk=`do $bulk$ declare n integer;rid uuid;op uuid;start_at timestamptz;submitted jsonb;reviewed jsonb;current_report jsonb;begin
      for n in 0..96 loop
        rid:=('00000000-0000-4000-8000-'||lpad((9000+n)::text,12,'0'))::uuid;op:=('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid;
        start_at:='${at(-1,'05:01')}'::timestamptz+n*interval '2 minutes';
        submitted:=${json(command)}||jsonb_build_object('operationId',rid,'proposal',jsonb_build_object('startAt',to_char(start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char((start_at+interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'breaks','[]'::jsonb));
        perform public.faolla_attendance_missing_v1(${json(missingQ)},'${employee}',submitted,true);
        reviewed:=public.faolla_attendance_missing_v1(${json({...missingQ,access:'owner'})}||jsonb_build_object('requestId',rid),'${owner}',null,true);
        perform public.faolla_attendance_missing_v1(${json({...missingQ,access:'owner'})}||jsonb_build_object('requestId',rid),'${owner}',jsonb_build_object('action','approve','requestId',rid,'operationId',op,'expectedRevision',1,'reason','Synthetic count boundary','evidenceToken',reviewed->'detail'->'evidenceToken'),true);
        if n=95 then current_report:=${call()};if jsonb_array_length(current_report->'missing')+jsonb_array_length(current_report->'base'->'items')<>100 then raise exception 'unexpected_count_boundary';end if;end if;
      end loop;
    end $bulk$;`;
    reject(ownerQ,owner,'attendance_report_too_large',bulk);assert.equal(fingerprint(),baseline);
    pass('exactly 100 combined sources remain readable; 101 real approved/raw sources fail closed without a partial total and test rows roll back');
    const privileges=JSON.parse(exec(`select jsonb_build_object('anon',has_function_privilege('anon','public.faolla_attendance_unified_report_v1(text,uuid,jsonb)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public.faolla_attendance_unified_report_v1(text,uuid,jsonb)','EXECUTE'),'service',has_function_privilege('service_role','public.faolla_attendance_unified_report_v1(text,uuid,jsonb)','EXECUTE'));`));
    assert.deepEqual(privileges,{anon:false,authenticated:false,service:true});pass('unified database function is callable only through the server role, never directly by anonymous or browser-authenticated roles');
    if(browserCheck)await browserCheck({...native,exec,sql,id,site,owner,employee,manager,worker,location,today,day,ownerQ,selfQ,managerQ,read});
    assert.equal(fingerprint(),baseline);pass('all unified report browser/API/SQL reads leave punch, decision, settings and grant ledgers byte-for-byte unchanged');
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceLabelsReuse(process.argv.slice(2),checkUnifiedReport).catch(e=>{console.error(e);process.exitCode=1;});
