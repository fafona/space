import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {checkAttendanceTerminals,terminalJson as json,terminalLiteral as quoted} from './merchant-attendance-terminals-native.mjs';
const literal=v=>v===null?'null':quoted(v);
const require=createRequire(import.meta.url);
const {executePinAdmin,executePinVerification}=require('../src/lib/merchantAttendancePin.server.ts');
const {terminalHash}=require('../src/lib/merchantAttendanceTerminal.server.ts');
export async function checkAttendancePin(native,browserCheck=null){
  await checkAttendanceTerminals(native,async env=>{
    const {exec,root,site,owner,id,location,pass,adminSql,deviceSql,connect,sql}=env;
    exec(readFileSync(path.join(root,'scripts/supabase-migrations/202610010106_merchant_attendance_pin_credentials.sql'),'utf8'));
    exec(`update public.merchant_attendance_settings set enabled=true where merchant_id='${site}';
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(30)}','${site}','Self',array['enterprise.view','attendance.self.view','attendance.self.clock']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${id(101)}','${site}','${id(1)}','pin@example.test','PIN 合成员工','${id(30)}','active');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values('${id(201)}','${site}','${id(101)}','PIN-01','PIN 合成员工','${location}',true);`);
    const terminalId=id(70),pairSecret=randomBytes(32).toString('base64url'),deviceSecret=randomBytes(32).toString('base64url');
    exec(adminSql({action:'create',terminalId,locationId:location,label:'PIN synthetic terminal',pairHash:terminalHash(pairSecret)}));
    exec(deviceSql(terminalId,{secret:terminalHash(pairSecret),device:terminalHash(deviceSecret),allow:true}));
    const argsToSql=(name,a)=>{
      if(name==='faolla_attendance_pin_admin_v1')return `public.${name}(${literal(a.p_site)},${literal(a.p_auth)},${literal(a.p_no)},${literal(a.p_operation)},${json(a.p_command)},${a.p_allow_set===true})`;
      assert(['faolla_attendance_pin_begin_v1','faolla_attendance_pin_finish_v1'].includes(name));
      return `public.${name}(${literal(a.p_site)},${literal(a.p_terminal)},${literal(a.p_secret_hash)},${literal(a.p_no)},${literal(a.p_lease)},${name.endsWith('finish_v1')?(a.p_verified===true)+',':''}${a.p_allow===true})`;
    };
    const calls=[],service={rpc:async(name,a)=>{
      calls.push({name});try{return {data:JSON.parse(exec(`set role service_role;select ${argsToSql(name,a)};`)),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}
    }};
    const query={siteId:site,workerNo:'PIN-01',operationId:null,authUserId:owner,command:null,allowSet:true};
    const pin='68142957',nextPin='01738264';
    const set=(n,expectedRevision,value=pin)=>({action:'set',operationId:id(n),expectedRevision,workerId:id(201),employeeId:id(101),pin:value,salt:randomBytes(16).toString('hex')});
    const verifyInput={siteId:site,terminalId,secret:deviceSecret,workerNo:'PIN-01',pin,allowVerify:true};
    const resetAttempts=()=>exec(`update public.merchant_attendance_pin_credentials set attempts=0,window_at=clock_timestamp() where merchant_id='${site}';
      update public.merchant_attendance_pin_attempts set attempts=0,window_at=clock_timestamp(),lease_id=null,lease_expires=null,worker_id=null,employee_id=null,credential_revision=null where merchant_id='${site}';`);
    const call=(name,a)=>JSON.parse(exec(`set role service_role;select ${argsToSql(name,a)};`));
    const reservation=()=>({p_site:site,p_terminal:terminalId,p_secret_hash:terminalHash(deviceSecret),p_no:'PIN-01',p_lease:randomUUID(),p_allow:true});
    const priorPepper=process.env.FAOLLA_ATTENDANCE_PIN_PEPPER;process.env.FAOLLA_ATTENDANCE_PIN_PEPPER=randomBytes(32).toString('base64url');
    try{
      for(const role of ['anon','authenticated','service_role'])for(const table of ['credentials','audit','attempts'])assert.throws(()=>exec(`set role ${role};select * from public.merchant_attendance_pin_${table};`),/permission denied/);
      assert.throws(()=>exec(`set role authenticated;select ${argsToSql('faolla_attendance_pin_admin_v1',{p_site:site,p_auth:owner,p_no:'PIN-01',p_operation:null,p_command:null,p_allow_set:true})};`),/permission denied/);
      await assert.rejects(executePinAdmin({...query,authUserId:id(1)},service),/attendance_access_denied/);
      assert.equal((await executePinAdmin(query,service)).revision,0);
      const initial=set(4000,0),created=await executePinAdmin({...query,command:initial},service);assert.equal(created.revision,1);assert.equal(created.enabled,true);
      assert.doesNotMatch(JSON.stringify(created),/salt|verifier|68142957|created_by|command_hash/);
      const stored=JSON.parse(exec(`select jsonb_build_object('salt',salt,'verifier',verifier) from public.merchant_attendance_pin_credentials where merchant_id='${site}';`));
      assert.match(stored.verifier,/^[0-9a-f]{64}$/);assert.notEqual(stored.verifier,pin);assert.equal(stored.salt,initial.salt);
      assert.equal((await executePinAdmin({...query,command:initial},service)).receipt.revision,1);
      await assert.rejects(executePinAdmin({...query,command:{...initial,pin:nextPin}},service),/attendance_operation_conflict/);
      await assert.rejects(executePinAdmin({...query,command:set(4001,0)},service),/attendance_pin_changed/);
      for(const action of ['update public.merchant_attendance_pin_audit set revision=revision+100','delete from public.merchant_attendance_pin_audit','truncate public.merchant_attendance_pin_audit'])assert.throws(()=>exec(action+';'),/attendance_events_append_only/);
      pass('owner-only separate PIN creation/replay binds exact command; stale edits and changed same-operation secrets rejected; no secrets in public metadata or raw table access');
      assert.equal((await executePinVerification(verifyInput,service)).verified,true);
      await assert.rejects(executePinVerification({...verifyInput,pin:nextPin},service),/attendance_pin_denied/);
      await assert.rejects(executePinVerification({...verifyInput,workerNo:'UNKNOWN'},service),/attendance_pin_denied/);
      assert.equal(exec(`select attempts from public.merchant_attendance_pin_credentials where merchant_id='${site}';`),'2');
      assert.equal(exec(`select attempts from public.merchant_attendance_pin_attempts where merchant_id='${site}' and terminal_id='${terminalId}';`),'3');
      pass('real peppered scrypt verifies correct PIN; wrong/unknown responses share generic denial and successful/failed attempts remain committed');
      const leased=reservation();call('faolla_attendance_pin_begin_v1',leased);
      const rotated=set(4002,1,nextPin);await executePinAdmin({...query,command:rotated},service);
      assert.deepEqual(call('faolla_attendance_pin_finish_v1',{...leased,p_verified:true}),{verified:false});
      await assert.rejects(executePinVerification(verifyInput,service),/attendance_pin_denied/);
      assert.equal((await executePinVerification({...verifyInput,pin:nextPin},service)).verified,true);
      const revoke={action:'revoke',operationId:id(4003),expectedRevision:2,workerId:id(201),employeeId:id(101)};
      const revoked=await executePinAdmin({...query,command:revoke,allowSet:false},service);assert.equal(revoked.enabled,false);assert.equal(revoked.revision,3);
      const recovered=await executePinAdmin({...query,command:initial},service);assert.equal(recovered.enabled,false);assert.equal(recovered.revision,3);assert.equal(recovered.receipt.revision,1);
      assert.equal(exec(`select salt is null and verifier is null from public.merchant_attendance_pin_credentials where merchant_id='${site}';`),'t');
      await assert.rejects(executePinVerification({...verifyInput,pin:nextPin},service),/attendance_pin_denied/);
      await executePinAdmin({...query,command:set(4004,3)},service);resetAttempts();
      pass('reset invalidates old PIN and in-flight verification; paused owner revoke removes verifier, prior receipts do not re-enable credentials');
      for(let n=0;n<10;n++){const a=reservation();assert.equal(call('faolla_attendance_pin_begin_v1',a).workerId,id(201));assert.deepEqual(call('faolla_attendance_pin_finish_v1',{...a,p_verified:false}),{verified:false});}
      assert.deepEqual(call('faolla_attendance_pin_begin_v1',reservation()),{denied:true});
      assert.equal(exec(`select attempts from public.merchant_attendance_pin_credentials where merchant_id='${site}';`),'10');
      resetAttempts();const a=reservation();call('faolla_attendance_pin_begin_v1',a);assert.deepEqual(call('faolla_attendance_pin_begin_v1',reservation()),{limited:true});
      assert.deepEqual(call('faolla_attendance_pin_finish_v1',{...a,p_verified:true}).verified,true);assert.deepEqual(call('faolla_attendance_pin_finish_v1',{...a,p_verified:true}),{verified:false});
      resetAttempts();exec(`update public.merchant_attendance_pin_attempts set attempts=60 where merchant_id='${site}';`);assert.deepEqual(call('faolla_attendance_pin_begin_v1',reservation()),{limited:true});resetAttempts();
      const expired=reservation();call('faolla_attendance_pin_begin_v1',expired);
      exec(`update public.merchant_attendance_pin_attempts set lease_expires=clock_timestamp()-interval '1 second' where merchant_id='${site}';`);
      assert.deepEqual(call('faolla_attendance_pin_finish_v1',{...expired,p_verified:true}),{verified:false});
      const replacement=reservation();assert.equal(call('faolla_attendance_pin_begin_v1',replacement).workerId,id(201));
      assert.deepEqual(call('faolla_attendance_pin_finish_v1',{...expired,p_verified:true}),{verified:false});assert.equal(call('faolla_attendance_pin_finish_v1',{...replacement,p_verified:true}).verified,true);
      resetAttempts();
      const c1=connect(),c2=connect();
      try{
        const first=reservation();await c1.step(sql(`begin;set local role service_role;select ${argsToSql('faolla_attendance_pin_begin_v1',first)};`));
        let done=false;const waiting=c2.step(sql(`select ${argsToSql('faolla_attendance_pin_begin_v1',reservation())};`)).then(r=>{done=true;return r;});
        await new Promise(resolve=>setTimeout(resolve,80));assert.equal(done,false);await c1.step('commit;');assert.deepEqual(JSON.parse(await waiting),{limited:true});
        call('faolla_attendance_pin_finish_v1',{...first,p_verified:false});
      }finally{await c1.close();await c2.close();}resetAttempts();
      pass('durable per-worker/device limits, single-use 30s leases and real concurrent device lock serialize verification without growing attempt rows');
      const pending=reservation();call('faolla_attendance_pin_begin_v1',pending);
      exec(`update public.merchant_enterprise_employees set status='disabled' where id='${id(101)}';`);
      assert.deepEqual(call('faolla_attendance_pin_finish_v1',{...pending,p_verified:true}),{verified:false});
      await assert.rejects(executePinVerification(verifyInput,service),/attendance_pin_denied/);
      exec(`update public.merchant_enterprise_employees set status='active' where id='${id(101)}';update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${id(30)}';`);
      await assert.rejects(executePinVerification(verifyInput,service),/attendance_pin_denied/);
      exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.clock'] where id='${id(30)}';`);
      exec(`update public.merchant_attendance_workers set active=false where id='${id(201)}';`);
      await assert.rejects(executePinVerification(verifyInput,service),/attendance_pin_denied/);
      exec(`update public.merchant_attendance_workers set active=true,employee_id=null where id='${id(201)}';`);
      await assert.rejects(executePinVerification(verifyInput,service),/attendance_pin_denied/);
      const unbound=await executePinAdmin(query,service);assert.equal(unbound.ready,false);assert.equal(unbound.bindingCurrent,false);
      exec(`update public.merchant_attendance_workers set employee_id='${id(101)}' where id='${id(201)}';`);
      await assert.rejects(executePinVerification({...verifyInput,allowVerify:false},service),/attendance_platform_paused/);
      await assert.rejects(executePinVerification({...verifyInput,secret:pairSecret},service),/attendance_terminal_denied/);
      resetAttempts();pass('disabled member, lost clock permission, pause and pairing-code substitution cannot verify; identity is rechecked after the KDF');
      if(browserCheck)await browserCheck({...env,service,query,verifyInput,pin,nextPin,set,resetAttempts,terminalId,deviceSecret,argsToSql});
      const last=reservation();call('faolla_attendance_pin_begin_v1',last);exec(adminSql({action:'revoke',terminalId}));
      assert.throws(()=>call('faolla_attendance_pin_finish_v1',{...last,p_verified:true}),/attendance_terminal_denied/);
      assert.equal(exec('select count(*) from public.merchant_attendance_events;'),'0');
      assert.equal(exec(`select count(*) from public.merchant_attendance_pin_attempts where merchant_id='${site}';`),'1');
      pass('device revoke blocks in-flight completion; all PIN flows create zero punches and only one bounded device-attempt row');
    }finally{if(priorPepper===undefined)delete process.env.FAOLLA_ATTENDANCE_PIN_PEPPER;else process.env.FAOLLA_ATTENDANCE_PIN_PEPPER=priorPepper;}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runAttendanceLabelsReuse(process.argv.slice(2),checkAttendancePin);
