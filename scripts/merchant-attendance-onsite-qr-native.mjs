// Real SQL + signature + HTTP handlers in an OWNED local synthetic namespace.
// No production connection, persistent QR, screenshots, exports or new cluster.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
const require=createRequire(import.meta.url);
const {executeOnsiteIssue,executeOnsiteClock,signOnsiteToken,verifyOnsiteToken}=require('../src/lib/merchantAttendanceOnsiteQr.server.ts');
const {terminalHash}=require('../src/lib/merchantAttendanceTerminal.server.ts');
const {TERMINAL_COOKIE}=require('../src/lib/merchantAttendanceTerminal.ts');
const {handleOnsiteCode}=require('../src/app/api/merchant-enterprise/attendance/onsite-code/route-handler.ts');
const {handleOnsiteClock}=require('../src/app/api/merchant-enterprise/attendance/onsite-clock/route-handler.ts');
const lit=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'",json=v=>v===null?'null':lit(JSON.stringify(v))+'::jsonb';
export async function checkOnsiteQr(native,browserCheck=null){
  await withAttendanceConcurrencySandbox(native,async({sql})=>{
    const {root,pass,connect}=native,exec=s=>native.query(sql(s)),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    for(const name of ['202610010104_merchant_attendance_terminals.sql','202610010108_merchant_attendance_onsite_qr.sql'])exec(readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8'));
    const site='99990001',owner=id(99),terminalId=id(70),location=id(301),secret=randomBytes(32).toString('base64url'),pairSecret=randomBytes(32).toString('base64url');
    exec(`insert into public.merchants(id,user_id) values('${site}','${owner}');
      insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','Europe/Madrid',true,true);
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${location}','${site}','合成现场码前台','Europe/Madrid',true);
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(30)}','${site}','Self',array['enterprise.view','attendance.self.view','attendance.self.clock']);`);
    for(const n of [1,2])exec(`insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values('${id(100+n)}','${site}','${id(n)}','onsite${n}@example.test','合成人员 ${n}','${id(30)}','active');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active)
      values('${id(200+n)}','${site}','${id(100+n)}','QR-${n}','合成人员 ${n}','${location}',true);
      insert into public.merchant_attendance_employment_periods(id,merchant_id,worker_id,starts_on) values('${id(400+n)}','${site}','${id(200+n)}','2020-01-01');`);
    const admin=command=>exec(`set role service_role;select public.faolla_attendance_terminal_admin_v1('${site}','${owner}','{"terminalId":null,"cursor":null}',${json(command)},true);`);
    admin({action:'create',terminalId,locationId:location,label:'合成现场终端',pairHash:terminalHash(pairSecret)});
    exec(`set role service_role;select public.faolla_attendance_terminal_device_v1('${site}','${terminalId}','${terminalHash(pairSecret)}','${terminalHash(secret)}',true);`);
    // Synthetic lifecycle aging preserves the exact pairing/device TTL checks.
    // It permits expiry-during-lock tests without sleeping 45 seconds or changing events.
    exec(`update public.merchant_attendance_terminals set created_at=created_at-interval '120 seconds',pair_expires_at=pair_expires_at-interval '120 seconds',
      paired_at=paired_at-interval '120 seconds',device_expires_at=device_expires_at-interval '120 seconds' where merchant_id='${site}' and id='${terminalId}';`);
    const argsSql=(name,a)=>{
      if(name==='faolla_attendance_onsite_issue_v1')return `public.${name}(${lit(a.p_site)},${lit(a.p_terminal)},${lit(a.p_secret_hash)})`;
      assert.equal(name,'faolla_attendance_onsite_clock_v1');
      return `public.${name}(${lit(a.p_site)},${lit(a.p_auth)},${json(a.p_claims)},${json(a.p_command)},${lit(a.p_operation)},${a.p_allow_new===true})`;
    };
    const service={rpc:async(name,a)=>{try{return {data:JSON.parse(exec(`set role service_role;select ${argsSql(name,a)};`)),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const issue=()=>executeOnsiteIssue({siteId:site,terminalId,secret},service);
    const command=(n,action,sequence,operationId=randomUUID())=>({expectedWorkerId:id(200+n),expectedEmployeeId:id(100+n),locationId:location,operationId,action,expectedSequence:sequence});
    const input=(n,c=null,token=null,operationId=null,allowNew=true)=>({siteId:site,authUserId:id(n),command:c,token,operationId,allowNew});
    const clock=(n,c=null,token=null,operationId=null,allowNew=true)=>executeOnsiteClock(input(n,c,token,operationId,allowNew),service);
    const fingerprint=()=>exec('select coalesce(md5(jsonb_agg(to_jsonb(e) order by worker_id,sequence)::text),\'empty\') from public.merchant_attendance_events e;');
    const nowMs=()=>Number(exec("select floor(extract(epoch from clock_timestamp())*1000)::bigint;"));
    const keyPrior=process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET=randomBytes(32).toString('hex');
    try{
      await assert.rejects(executeOnsiteIssue({siteId:site,terminalId,secret:pairSecret},service),/attendance_terminal_denied/);
      const code=await issue(),claims=verifyOnsiteToken(code.token);
      assert.equal(claims.expiresAtMs-claims.issuedAtMs,45000);assert.equal(claims.terminalId,terminalId);
      assert.equal(exec('select count(*) from public.merchant_attendance_onsite_receipts;'),'0');
      const c1=command(1,'clock_in',0),c2=command(2,'clock_in',0);
      const first=await clock(1,c1,code.token),second=await clock(2,c2,code.token);
      assert.notEqual(first.receipt.id,second.receipt.id);assert.equal(first.state.sequence,1);assert.equal(second.state.sequence,1);
      assert.equal((await clock(1,c1,code.token)).replayed,true);
      await assert.rejects(clock(1,command(1,'clock_out',1),code.token),/attendance_qr_used/);
      assert.equal(exec('select count(*) from public.merchant_attendance_events;'),'2');
      pass('actual paired-device issuance signs a shared 45-second code; two authenticated employees each write once, exact replay is stable and same-employee code reuse denies');

      const duplicateCode=await issue(),duplicateCommand=command(2,'clock_out',1),duplicateClaims=verifyOnsiteToken(duplicateCode.token);
      const duplicateArgs={p_site:site,p_auth:id(2),p_claims:duplicateClaims,p_command:duplicateCommand,p_operation:null,p_allow_new:true};
      const firstConnection=connect(),secondConnection=connect();
      try{
        const initial=JSON.parse(await firstConnection.step(sql(`begin;set local role service_role;select ${argsSql('faolla_attendance_onsite_clock_v1',duplicateArgs)};`)));
        const waiting=secondConnection.step(sql(`set role service_role;select ${argsSql('faolla_attendance_onsite_clock_v1',duplicateArgs)};`));
        await new Promise(resolve=>setTimeout(resolve,100));
        assert.equal(exec("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%select %faolla_attendance_onsite_clock_v1%';"),'1');
        await firstConnection.step('commit;');const replay=JSON.parse(await waiting);
        assert.equal(initial.replayed,false);assert.equal(replay.replayed,true);assert.equal(replay.receipt.id,initial.receipt.id);
      }finally{await firstConnection.close();await secondConnection.close();}
      assert.equal((await clock(2)).state.sequence,2);
      pass('two actual concurrent copies of one QR operation produce one event and an identical original receipt, not two punches');

      const before=fingerprint(),fresh=await issue();
      await assert.rejects(clock(1,{...c1,action:'clock_out'},fresh.token),/attendance_operation_conflict/);
      await assert.rejects(clock(1,command(2,'clock_out',1),fresh.token),/attendance_worker_changed/);
      await assert.rejects(clock(1,command(1,'clock_out',1),fresh.token.slice(0,-2)+'AA'),/attendance_qr_invalid/);
      await assert.rejects(executeOnsiteClock({...input(1,command(1,'clock_out',1),fresh.token),siteId:'99990002'},service),/attendance_qr_invalid/);
      const freshClaims=verifyOnsiteToken(fresh.token),expired={...freshClaims,issuedAtMs:nowMs()-46000,expiresAtMs:nowMs()-1000};expired.expiresAtMs=expired.issuedAtMs+45000;
      await assert.rejects(clock(1,command(1,'clock_out',1),signOnsiteToken(expired)),/attendance_qr_expired/);
      assert.equal((await clock(1,c1,signOnsiteToken(expired))).receipt.id,first.receipt.id);
      const future={...freshClaims,issuedAtMs:nowMs()+10000};future.expiresAtMs=future.issuedAtMs+45000;
      await assert.rejects(clock(1,command(1,'clock_out',1),signOnsiteToken(future)),/attendance_qr_invalid/);
      assert.equal((await clock(2,null,null,c1.operationId)).receipt,null);
      assert.equal(fingerprint(),before);
      pass('signature tampering, cross-tenant/token scope, wrong worker, changed original command, future/expired tokens all write nothing; other employees cannot recover receipts');

      const rawArgs={p_site:site,p_auth:id(1),p_claims:freshClaims,p_command:command(1,'clock_out',1),p_operation:null,p_allow_new:true};
      for(const invalid of [null,{}, {...freshClaims,pairedAtMs:freshClaims.pairedAtMs-1}, {...freshClaims,locationId:id(399)},
        {...freshClaims,nonce:null}, {...freshClaims,expiresAtMs:freshClaims.expiresAtMs+1}, {...freshClaims,issuedAtMs:String(freshClaims.issuedAtMs)}])
        assert.throws(()=>exec(`set role service_role;select ${argsSql('faolla_attendance_onsite_clock_v1',{...rawArgs,p_claims:invalid})};`),/attendance_qr_invalid/);
      for(const role of ['anon','authenticated'])assert.throws(()=>exec(`set role ${role};select ${argsSql('faolla_attendance_onsite_clock_v1',rawArgs)};`),/permission denied/);
      assert.equal(fingerprint(),before);
      pass('SQL independently denies malformed/null claims, false pairing/location binding and non-45-second lifetime; browser roles cannot execute the writer');

      exec(`update public.merchant_attendance_locations set latitude=37,longitude=-5,radius_meters=100 where id='${location}';`);
      await assert.rejects(issue(),/attendance_location_verification_required/);
      await assert.rejects(clock(1,command(1,'clock_out',1),fresh.token),/attendance_location_verification_required/);
      exec(`update public.merchant_attendance_locations set latitude=null,longitude=null,radius_meters=null where id='${location}';
        update public.merchant_attendance_employment_periods set ends_on='2020-01-01' where worker_id='${id(201)}';`);
      await assert.rejects(clock(1,command(1,'clock_out',1),fresh.token),/attendance_not_employed/);
      exec(`update public.merchant_attendance_employment_periods set ends_on=null where worker_id='${id(201)}';update public.merchant_attendance_workers set default_location_id=null where id='${id(201)}';`);
      await assert.rejects(clock(1,command(1,'clock_out',1),fresh.token),/attendance_location_denied/);
      exec(`update public.merchant_attendance_workers set default_location_id='${location}' where id='${id(201)}';update public.merchant_enterprise_employees set status='disabled' where id='${id(101)}';`);
      await assert.rejects(clock(1,null,null,c1.operationId),/attendance_access_denied/);
      await assert.rejects(clock(1,command(1,'clock_out',1),fresh.token),/attendance_access_denied/);
      exec(`update public.merchant_enterprise_employees set status='active' where id='${id(101)}';`);
      assert.equal(fingerprint(),before);
      pass('QR never bypasses configured geofence, current employment/default location or disabled employee; recovery still requires current account permission');

      await assert.rejects(clock(1,command(1,'break_start',1),(await issue()).token,null,false),/attendance_platform_paused/);
      assert.equal((await clock(1,command(1,'break_start',1),(await issue()).token)).state.status,'break');
      await assert.rejects(clock(1,command(1,'clock_out',2),(await issue()).token),/attendance_break_must_end/);
      assert.equal((await clock(1,command(1,'break_end',2),(await issue()).token,null,false)).state.status,'working');
      assert.equal((await clock(1,command(1,'clock_out',3),(await issue()).token,null,false)).state.status,'off');
      await assert.rejects(clock(1,command(1,'clock_in',4),(await issue()).token,null,false),/attendance_platform_paused/);
      assert.equal((await clock(1,null,null,c1.operationId,false)).receipt.id,first.receipt.id);
      pass('four explicit actions preserve state and paused-admission finish behavior; original receipt is separate from the newer current state');

      const lock=connect(),waiter=connect();
      try{
        const claimsWait=verifyOnsiteToken((await issue()).token),issued=nowMs()-43000;
        Object.assign(claimsWait,{issuedAtMs:issued,expiresAtMs:issued+45000});
        await lock.step(sql(`begin;select id from public.merchant_enterprise_employees where id='${id(101)}' for update;`));
        const waiting=waiter.step(sql(`set role service_role;select ${argsSql('faolla_attendance_onsite_clock_v1',{p_site:site,p_auth:id(1),p_claims:claimsWait,p_command:command(1,'clock_in',4),p_operation:null,p_allow_new:true})};`));
        const denied=assert.rejects(waiting,/attendance_qr_expired/);
        await new Promise(resolve=>setTimeout(resolve,100));
        assert.equal(exec("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%select %faolla_attendance_onsite_clock_v1%';"),'1');
        await new Promise(resolve=>setTimeout(resolve,2150));await lock.step('commit;');await denied;
      }finally{await lock.close();await waiter.close();}
      assert.equal((await clock(1)).state.sequence,4);
      pass('real member-lock contention can outlive the signed code; final transaction rechecks database time and rejects without an event');

      const webCommand={...command(1,'clock_in',4)};delete webCommand.expectedEmployeeId;
      const raceCode=await issue(),writer=connect(),competitor=connect();
      try{
        await writer.step(sql(`begin;set local role service_role;select ${argsSql('faolla_attendance_onsite_clock_v1',{p_site:site,p_auth:id(1),p_claims:verifyOnsiteToken(raceCode.token),p_command:command(1,'clock_in',4),p_operation:null,p_allow_new:true})};`));
        const waiting=competitor.step(sql(`select public.faolla_attendance_self_v1('${site}','${id(1)}',${json(webCommand)},null);`));
        const denied=assert.rejects(waiting,/attendance_sequence_conflict/);await new Promise(resolve=>setTimeout(resolve,100));
        assert.equal(exec("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like 'select %faolla_attendance_self_v1%';"),'1');
        await writer.step('commit;');await denied;
      }finally{await writer.close();await competitor.close();}
      assert.equal((await clock(1)).state.sequence,5);
      pass('onsite and existing web writer serialize on the same employee worker; concurrent different operations cannot both claim the same sequence');

      const beforeFailure=fingerprint(),failureCode=await issue();
      exec(`create function public.attendance_test_onsite_fail() returns trigger language plpgsql set search_path=pg_catalog as $$begin raise exception 'synthetic_onsite_failure';end;$$;
        create trigger synthetic_onsite_failure before insert on public.merchant_attendance_onsite_receipts for each row execute function public.attendance_test_onsite_fail();`);
      try{await assert.rejects(clock(1,command(1,'clock_out',5),failureCode.token),/attendance_unavailable/);assert.equal(fingerprint(),beforeFailure);}
      finally{exec('drop trigger synthetic_onsite_failure on public.merchant_attendance_onsite_receipts;drop function public.attendance_test_onsite_fail();');}
      for(const role of ['anon','authenticated','service_role'])assert.throws(()=>exec(`set role ${role};select * from public.merchant_attendance_onsite_receipts;`),/permission denied/);
      for(const statement of ['update public.merchant_attendance_onsite_receipts set nonce=nonce','delete from public.merchant_attendance_onsite_receipts','truncate public.merchant_attendance_onsite_receipts'])assert.throws(()=>exec(statement+';'),/attendance_events_append_only/);
      for(const role of ['anon','authenticated'])assert.throws(()=>exec(`set role ${role};select public.faolla_attendance_onsite_issue_v1('${site}','${terminalId}','${terminalHash(secret)}');`),/permission denied/);
      pass('receipt-insert fault rolls back the event atomically; source evidence is private/append-only and RPCs cannot be called by browser roles');

      const entitlement=async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}});
      const codeDeps={enabled:()=>true,allow:()=>true,entitlement,execute:i=>executeOnsiteIssue(i,service)};
      const clockDeps={enabled:()=>true,allow:()=>true,entitlement,authenticate:async()=>({user:{id:id(1)},accessToken:'synthetic',authenticationMethods:['password']}),execute:i=>executeOnsiteClock(i,service)};
      const url='https://www.faolla.com/api/merchant-enterprise/attendance/',origin='https://www.faolla.com';
      const issuedResponse=await handleOnsiteCode(new Request(url+'onsite-code',{method:'POST',headers:{origin,'content-type':'application/json',cookie:`${TERMINAL_COOKIE}=${site}.${terminalId}.${secret}`},body:'{}'}),codeDeps);
      assert.equal(issuedResponse.status,200);const issuedBody=await issuedResponse.json(),httpCommand=command(1,'clock_out',5);
      const submitted=await handleOnsiteClock(new Request(url+'onsite-clock',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({siteId:site,token:issuedBody.token,command:httpCommand})}),clockDeps);
      assert.equal(submitted.status,200); // Discard its response: caller must recover by original operation.
      const recovered=await handleOnsiteClock(new Request(url+`onsite-clock?siteId=${site}&operationId=${httpCommand.operationId}`),clockDeps);
      const recoveredBody=await recovered.json();assert.equal(recovered.status,200);assert.equal(recoveredBody.receipt.operationId,httpCommand.operationId);assert.equal(recoveredBody.state.sequence,6);
      assert.equal(recovered.headers.get('cache-control'),'private, no-store');assert.equal(recovered.headers.get('referrer-policy'),'no-referrer');
      pass('actual issuer and authenticated clock HTTP handlers call the signed-token/default executor/SQL path; lost-response recovery needs no QR and creates no duplicate');

      const policyCode=await issue(),beforePolicy=fingerprint();
      exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${id(30)}';`);
      await assert.rejects(clock(1,command(1,'clock_in',6),policyCode.token),/attendance_access_denied/);
      await assert.rejects(clock(1,c1,code.token),/attendance_access_denied/);
      assert.equal((await clock(1,null,null,c1.operationId)).receipt.id,first.receipt.id);
      exec(`update public.merchant_enterprise_roles set status='archived' where id='${id(30)}';`);
      await assert.rejects(clock(1,null,null,c1.operationId),/attendance_access_denied/);
      exec(`update public.merchant_enterprise_roles set status='active',permissions=array['enterprise.view','attendance.self.view','attendance.self.clock'] where id='${id(30)}';`);
      assert.equal(fingerprint(),beforePolicy);
      pass('removing self.clock denies both new writes and POST replays while self.view still recovers; archived role refuses even reads');

      exec(`update public.merchants set user_id='${id(98)}' where id='${site}';`);
      await assert.rejects(issue(),/attendance_terminal_denied/);
      await assert.rejects(clock(1,command(1,'clock_in',6),policyCode.token),/attendance_qr_invalid/);
      assert.equal((await clock(1,null,null,c1.operationId)).receipt.id,first.receipt.id);
      exec(`update public.merchants set user_id='${owner}' where id='${site}';`);
      assert.equal(fingerprint(),beforePolicy);
      pass('terminal issuer must still own the tenant: ownership transfer invalidates issuance/new use without hiding existing authorized receipts');

      exec(`update public.merchant_attendance_workers set active=false where id='${id(201)}';`);
      assert.equal((await clock(1,null,null,c1.operationId)).receipt.id,first.receipt.id);
      await assert.rejects(clock(1,command(1,'clock_in',6),policyCode.token),/attendance_access_denied/);
      exec(`update public.merchant_attendance_workers set active=true where id='${id(201)}';update public.merchant_attendance_settings set enabled=false where merchant_id='${site}';`);
      assert.equal((await clock(1,null,null,c1.operationId)).receipt.id,first.receipt.id);
      await assert.rejects(issue(),/attendance_disabled/);
      await assert.rejects(clock(1,command(1,'clock_in',6),policyCode.token),/attendance_disabled/);
      exec(`update public.merchant_attendance_settings set enabled=true where merchant_id='${site}';
        insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
          values('${id(103)}','${site}','${id(3)}','rebound@example.test','合成重新绑定','${id(30)}','active');
        update public.merchant_attendance_workers set employee_id='${id(103)}' where id='${id(201)}';`);
      await assert.rejects(clock(1,null,null,c1.operationId),/attendance_access_denied/);
      await assert.rejects(clock(3),/attendance_access_denied/);
      await assert.rejects(clock(3,null,null,c1.operationId),/attendance_access_denied/);
      exec(`update public.merchant_attendance_workers set employee_id='${id(101)}' where id='${id(201)}';`);
      assert.equal(fingerprint(),beforePolicy);
      pass('inactive worker or disabled settings can retain authorized recovery but not new writes; employee rebinding cannot reveal previous member state or receipts');

      if(browserCheck)await browserCheck({root,exec,id,site,owner,terminalId,location,secret,service,issue,clock,command,admin,pass});
      const revokeCode=await issue(),beforeRevoke=fingerprint();admin({action:'revoke',terminalId});
      await assert.rejects(issue(),/attendance_terminal_denied/);
      await assert.rejects(clock(1,command(1,'clock_in',6),revokeCode.token),/attendance_qr_invalid/);
      assert.equal((await clock(1,null,null,c1.operationId,false)).receipt.id,first.receipt.id);
      assert.equal((await clock(1,c1,code.token,null,false)).receipt.id,first.receipt.id);
      assert.equal(fingerprint(),beforeRevoke);
      pass('revoked device cannot issue or authorize new punches; currently authorized employee can still recover/replay the exact committed operation');
      assert.equal(exec('select count(*) from public.merchant_attendance_events;'),exec('select count(*) from public.merchant_attendance_onsite_receipts;'));
      process.stdout.write(JSON.stringify({onsiteQrNative:true,productionAccess:false,realAuth:false,uiComplete:false,newCluster:false})+'\n');
    }finally{if(keyPrior===undefined)delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;else process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET=keyPrior;}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runAttendanceLabelsReuse(process.argv.slice(2),checkOnsiteQr);
