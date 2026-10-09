// Existing owned local DB only. Real writers -> read-only provenance -> existing reports.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {checkPinWorkflow,workflowJson as json} from './merchant-attendance-pin-workflow-native.mjs';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
const require=createRequire(import.meta.url);
const {executeEventChannels}=require('../src/lib/merchantAttendanceEventChannels.server.ts');
const {executeOnsiteIssue,executeOnsiteClock}=require('../src/lib/merchantAttendanceOnsiteQr.server.ts');
const {executeAttendanceSelf}=require('../src/lib/merchantAttendanceSelf.server.ts');
const {executePinClock}=require('../src/lib/merchantAttendancePinClock.server.ts');
const {executeAttendanceCorrection}=require('../src/lib/merchantAttendanceCorrection.server.ts');
const lit=v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'";
export async function checkEventChannels(native,browserCheck=null,prepare=null){
  await checkPinWorkflow(native,async env=>{
    const {root,exec,id,site,owner,terminalId,secret,location,people,pass}=env,p=people[2];
    for(const name of ['202610010108_merchant_attendance_onsite_qr.sql','202610020109_merchant_attendance_event_channels.sql'])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    const service={rpc:async(name,a)=>{
      let args;
      if(name==='faolla_attendance_event_channels_v1')args=[lit(a.p_site_id),lit(a.p_auth_user_id),json(a.p_query)];
      else if(name==='faolla_attendance_onsite_issue_v1')args=[lit(a.p_site),lit(a.p_terminal),lit(a.p_secret_hash)];
      else if(name==='faolla_attendance_onsite_clock_v1')args=[lit(a.p_site),lit(a.p_auth),json(a.p_claims),json(a.p_command),lit(a.p_operation),String(a.p_allow_new===true)];
      else return env.service.rpc(name,a);
      try{return {data:JSON.parse(exec(`set role service_role;select public.${name}(${args.join(',')});`)),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}
    }};
    const previous=process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET=randomBytes(32).toString('hex');
    const added=[];
    try{
      for(const [index,action] of ['clock_in','break_start','break_end','clock_out'].entries()){
        const command={expectedWorkerId:p.worker,locationId:location,action,expectedSequence:4+index,operationId:randomUUID()};let result;
        if(index===0||index===3){const code=await executeOnsiteIssue({siteId:site,terminalId,secret},service);result=await executeOnsiteClock({siteId:site,authUserId:p.auth,token:code.token,command:{...command,expectedEmployeeId:p.employee},operationId:null,allowNew:true},service);}
        else if(index===1)result=await executeAttendanceSelf({siteId:site,authUserId:p.auth,command,operationId:null},service);
        else result=await executePinClock({...env.input,workerNo:p.no,pin:p.pin,command:{...command,expectedEmployeeId:p.employee}},service);
        added.push(result.receipt.id);
      }
    }finally{if(previous===undefined)delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;else process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET=previous;}
    // Optional additional synthetic tenant is enrolled BEFORE immutable baselines.
    // Existing callers are unchanged; browser callback remains read-only.
    const preparedFixture=prepare?await prepare({...env,service,p,added}):{};
    const events=JSON.parse(exec(`select jsonb_agg(id order by sequence) from public.merchant_attendance_events where worker_id='${p.worker}';`));
    const query={siteId:site,access:'self',workerId:p.worker,locationId:null,eventIds:events};
    const read=(q=query,auth=p.auth)=>executeEventChannels({query:q,authUserId:auth},service);
    const rawBefore=env.raw(),pinBefore=env.receipts(),onsiteBefore=exec('select md5(jsonb_agg(to_jsonb(r) order by event_id)::text) from public.merchant_attendance_onsite_receipts r;');
    const beforeReport=await env.report(p),result=await read();
    assert.deepEqual(result.items.map(i=>i.channel),['kiosk','web','kiosk','web','onsite_qr','web','kiosk','onsite_qr']);
    assert.deepEqual(result.items.map(i=>i.eventId),events);assert(result.items.filter(i=>i.channel==='onsite_qr').every(i=>i.terminalId===terminalId));
    assert.deepEqual((await read({...query,eventIds:[...events].reverse()})).items.map(i=>i.eventId),[...events].reverse());
    pass('actual signed QR, web and PIN writes classify in exact requested order after QR signing key removal; original web/kiosk fields stay untouched');
    const prepared=await executeAttendanceCorrection({query:{siteId:site,mode:'prepare',expectedWorkerId:p.worker,startEventId:added[0]},command:null,authUserId:p.auth,moduleEnabled:true},service);
    assert.deepEqual(prepared.basis.events.map(e=>e.id),added);
    assert.deepEqual((await read({...query,eventIds:prepared.basis.events.map(e=>e.id)})).items.map(i=>i.channel),['onsite_qr','web','kiosk','onsite_qr']);
    const reportIds=beforeReport.base.rows.flatMap(row=>row.eventIds);
    assert.equal((await read({...query,access:'owner',eventIds:reportIds},owner)).items.length,8);
    pass('real correction basis and unified-report original IDs resolve to the same mixed-source receipts without changing pending/approved minutes');
    for(const q of [{...query,eventIds:[events[0],id(9999)]},{...query,workerId:people[0].worker},{...query,siteId:'99990002'}])await assert.rejects(read(q),/attendance_access_denied/);
    await assert.rejects(read(query,people[1].auth),/attendance_access_denied/);
    exec(`update public.merchants set owner_user_id='${people[1].auth}' where id='${site}';`);
    await assert.rejects(read({...query,access:'owner'},people[1].auth),/attendance_access_denied/);
    for(const role of ['anon','authenticated'])assert.throws(()=>exec(`set role ${role};select public.faolla_attendance_event_channels_v1('${site}','${p.auth}',${json({...query,siteId:undefined})});`),/permission denied/);
    pass('unknown IDs, mixed batches, foreign tenant/worker/member and legacy owner aliases deny atomically; browser database roles cannot invoke reader');
    const replacement=people[0];
    exec(`begin;update public.merchant_attendance_workers set employee_id=null where id in ('${p.worker}','${replacement.worker}');update public.merchant_attendance_workers set employee_id='${replacement.employee}' where id='${p.worker}';update public.merchant_attendance_workers set employee_id='${p.employee}' where id='${replacement.worker}';commit;`);
    try{await assert.rejects(read(),/attendance_access_denied/);await assert.rejects(read(query,replacement.auth),/attendance_access_denied/);assert.equal((await read({...query,access:'owner'},owner)).items.length,8);}
    finally{exec(`begin;update public.merchant_attendance_workers set employee_id=null where id in ('${p.worker}','${replacement.worker}');update public.merchant_attendance_workers set employee_id='${p.employee}' where id='${p.worker}';update public.merchant_attendance_workers set employee_id='${replacement.employee}' where id='${replacement.worker}';commit;`);}
    pass('after real worker rebinding both the old account and new account cannot read old actor-bound origins; current owner alone retains review access');
    exec(`update public.merchants set user_id='${people[1].auth}' where id='${site}';`);
    try{await assert.rejects(read({...query,access:'owner'},owner),/attendance_access_denied/);assert.equal((await read({...query,access:'owner'},people[1].auth)).items.length,8);}
    finally{exec(`update public.merchants set user_id='${owner}' where id='${site}';`);}
    pass('canonical ownership transfer immediately denies old owner and admits only the new owner, independent of legacy aliases');
    // Only synthetic configuration is temporarily changed; append-only facts never are.
    exec(`update public.merchant_attendance_settings set enabled=false,web_clock_enabled=false where merchant_id='${site}';update public.merchant_attendance_workers set active=false where id='${p.worker}';update public.merchant_attendance_locations set active=false where id='${location}';update public.merchant_attendance_terminals set revoked_at=clock_timestamp(),revoked_by='${owner}' where id='${terminalId}';`);
    try{assert.deepEqual((await read()).items,result.items);assert.equal((await read({...query,access:'owner'},owner)).items.length,8);}
    finally{exec(`update public.merchant_attendance_settings set enabled=true,web_clock_enabled=true where merchant_id='${site}';update public.merchant_attendance_workers set active=true where id='${p.worker}';update public.merchant_attendance_locations set active=true where id='${location}';update public.merchant_attendance_terminals set revoked_at=null,revoked_by=null where id='${terminalId}';`);}
    exec(`update public.merchant_enterprise_employees set status='disabled' where id='${p.employee}';`);
    try{await assert.rejects(read(),/attendance_access_denied/);assert.equal((await read({...query,access:'owner'},owner)).items.length,8);}
    finally{exec(`update public.merchant_enterprise_employees set status='active' where id='${p.employee}';`);}
    pass('historical QR origin survives paused collection, inactive worker/location and revoked terminal; current disabled member still loses read access');
    const manager=people[1],grant=id(710),grant2=id(711),otherLocation=id(302);
    exec(`insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(31)}','${site}','Synthetic reviewer',array['enterprise.view','attendance.records.view']);update public.merchant_enterprise_employees set role_id='${id(31)}' where id='${manager.employee}';
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${otherLocation}','${site}','Other synthetic site','Europe/Madrid');
      insert into public.merchant_attendance_scopes(merchant_id,employee_id,revision) values('${site}','${manager.employee}',1);
      insert into public.merchant_attendance_scope_grants(merchant_id,employee_id,id,valid_from) values('${site}','${manager.employee}','${grant}','2020-01-01Z'),('${site}','${manager.employee}','${grant2}','2020-01-01Z');
      insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${manager.employee}','${grant}','${p.worker}'),('${site}','${manager.employee}','${grant2}','${people[0].worker}');
      insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id) values('${site}','${manager.employee}','${grant}','${otherLocation}'),('${site}','${manager.employee}','${grant2}','${location}');`);
    const mq={...query,access:'manager',locationId:location};await assert.rejects(read(mq,manager.auth),/attendance_access_denied/);
    exec(`insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id) values('${site}','${manager.employee}','${grant}','${location}');update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()+interval '20 seconds' where id='${grant}';`);
    assert((await read(mq,manager.auth)).accessValidUntil);
    exec(`insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id) values('${site}','${manager.employee}','${grant2}','${p.worker}');`);
    assert.equal((await read(mq,manager.auth)).accessValidUntil,null);
    exec(`update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()-interval '1 second' where employee_id='${manager.employee}';`);
    await assert.rejects(read(mq,manager.auth),/attendance_access_denied/);
    pass('manager cannot combine worker/location from separate grants; same-grant finite access, unbounded overlap and expiry are enforced by real SQL');
    if(browserCheck)await browserCheck({...env,...preparedFixture,service,p,events,added});
    assert.equal(env.raw(),rawBefore);assert.equal(env.receipts(),pinBefore);assert.equal(exec('select md5(jsonb_agg(to_jsonb(r) order by event_id)::text) from public.merchant_attendance_onsite_receipts r;'),onsiteBefore);
    const afterReport=await env.report(p);assert.deepEqual(afterReport.totals,beforeReport.totals);assert.deepEqual(afterReport.base.rows,beforeReport.base.rows);
    pass('all annotation and UI reads preserve raw event/PIN/QR fingerprints and unified-report rows/totals exactly');
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runAttendanceLabelsReuse(process.argv.slice(2),checkEventChannels);
