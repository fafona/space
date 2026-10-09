// Opt-in local acceptance of the real accept HTTP handler -> original SQL chain.
// Auth, entitlement and pre-existing invited users are explicitly synthetic.
// A discarded handler response models loss after commit, not browser/network QA.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareAttendanceEmployeeManagement} from './merchant-attendance-employee-management-fixture.mjs';
import {prepareAttendanceInvitationRetry} from './merchant-attendance-invitation-retry-fixture.mjs';
import {assertLifecycleSandbox,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createAttendanceEmployeeManagementReadTransport}=require('./fixtures/attendance-employee-management-read-transport.ts');
const {POST}=require('../src/app/api/merchant-enterprise/employees/accept/route-handler.ts');
const site='99990001',waive='faolla_waive_employee_initial_password_v1',accept='faolla_accept_merchant_employee_invitation_v1';
const actors=[1,2,3,4,5,6].map(n=>({id:id(n),email:`invite-retry-${n}@example.test`}));
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const keys=value=>Object.keys(value).sort();
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bounded=async(promise)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('invitation_retry_gate_timeout')),20000);})]);}finally{clearTimeout(timer);}};
const recoveryColumns='id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,invitation_version,invitation_expires_at,invitation_revoked_at,invitation_sent_at,invitation_delivery_status,version,created_at,updated_at';

export function validateInvitationRecoveryRead(request){
  const url=new URL(request.url),p=url.searchParams;
  assert.equal(request.method,'GET');assert.equal(url.origin,'https://attendance-auth.invalid');assert.equal(url.pathname,'/rest/v1/merchant_enterprise_employees');
  assert(!url.hash&&!url.username&&!url.password);
  assert.equal(request.headers.get('apikey'),'attendance-synthetic-service');assert.equal(request.headers.get('authorization'),'Bearer attendance-synthetic-service');
  for(const name of ['range','range-unit','prefer','content-profile'])assert.equal(request.headers.get(name),null);
  assert([null,'public'].includes(request.headers.get('accept-profile')));
  assert.equal([...p.keys()].length,new Set(p.keys()).size);
  assert.deepEqual([...p.keys()].sort(),['select','merchant_id','auth_user_id','status','invitation_version','accepted_at','invitation_revoked_at','invitation_token_hash','limit'].sort());
  assert.equal(p.get('select'),recoveryColumns);assert.equal(p.get('merchant_id'),'eq.'+site);assert.equal(p.get('status'),'eq.active');
  assert.equal(p.get('accepted_at'),'not.is.null');assert.equal(p.get('invitation_revoked_at'),'is.null');assert.equal(p.get('invitation_token_hash'),'is.null');assert.equal(p.get('limit'),'1');
  const actor=actors.find(item=>'eq.'+item.id===p.get('auth_user_id'));assert(actor,'invitation_retry_recovery_subject_forbidden');
  assert.match(p.get('invitation_version')??'',/^eq\.[1-9][0-9]*$/);const version=Number(p.get('invitation_version').slice(3));assert(Number.isSafeInteger(version));
  const acceptHeader=request.headers.get('accept')??'application/json';assert(['application/json','application/vnd.pgrst.object+json'].includes(acceptHeader));
  return {actorId:actor.id,version,object:acceptHeader==='application/vnd.pgrst.object+json'};
}

export function createInvitationRetryRecoveryRead(exec,{owned,ownedGuard,fallback}){
  const calls=[],errors=[];
  const read=request=>{
    if(new URL(request.url).pathname!=='/rest/v1/merchant_enterprise_employees')return fallback(request);
    try{
      const input=validateInvitationRecoveryRead(request);assert.deepEqual(assertLifecycleSandbox(exec),owned,'invitation_retry_recovery_namespace_changed');
      calls.push({...input});
      const result=JSON.parse(exec(`begin read only;reset role;${ownedGuard}set local role service_role;
        select jsonb_build_object('role',current_user,'data',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from
          (select ${recoveryColumns} from public.merchant_enterprise_employees where merchant_id='${site}' and auth_user_id=${quote(input.actorId)}
            and status='active' and invitation_version=${input.version} and accepted_at is not null
            and invitation_revoked_at is null and invitation_token_hash is null limit 1) t));commit;`));
      assert.equal(result.role,'service_role');assert(Array.isArray(result.data)&&result.data.length<=1);
      return Response.json(input.object?result.data[0]??null:result.data,{headers:{'cache-control':'no-store'}});
    }catch{errors.push('invitation_retry_recovery_read_failed');throw Error('invitation_retry_recovery_read_failed');}
  };
  return {read,calls,errors};
}

export function validateInvitationRetryRpcInput(name,args){
  assert([waive,accept].includes(name),'invitation_retry_rpc_forbidden');
  assert(args&&typeof args==='object'&&!Array.isArray(args));assert.deepEqual(keys(args),['p_input']);
  const input=args.p_input;assert(input&&typeof input==='object'&&!Array.isArray(input));
  const hasCredentials=Object.hasOwn(input,'invitation_version');
  assert.deepEqual(keys(input),['auth_user_id','merchant_id',...(hasCredentials?['invitation_version','token_hash']:[])].sort());
  assert.equal(input.merchant_id,site);assert(actors.some(actor=>actor.id===input.auth_user_id));
  if(name===waive)assert(hasCredentials);
  if(hasCredentials){assert(Number.isSafeInteger(input.invitation_version)&&input.invitation_version>0);assert.match(input.token_hash,/^[0-9a-f]{64}$/);}
  return input;
}

export function assertInvitationRetryDivergence({retryStatus,retryBody,retryRpcs,reentryStatus,reentryBody,reentryRpcs,employeeId}){
  assert.equal(retryStatus,410);assert.deepEqual(retryBody,{ok:false,error:'employee_invitation_superseded'});
  assert.deepEqual(retryRpcs,[waive]);assert.equal(reentryStatus,200);
  assert.equal(reentryBody.ok,true);assert.equal(reentryBody.alreadyActive,true);
  assert.equal(reentryBody.employee?.id,employeeId);assert.equal(reentryBody.employee?.status,'active');
  assert.deepEqual(reentryRpcs,[accept]);
  return {defectReproduced:true,retryRecoveryPassed:false,credentialRetryStatus:410,passwordAuthenticatedReentryStatus:200};
}

export function assertInvitationRetryRecovery({retryStatus,retryBody,retryRpcs,retryReads,reentryStatus,reentryBody,reentryRpcs,reentryReads,employeeId}){
  assert.equal(retryStatus,200);assert.equal(retryBody.ok,true);assert.equal(retryBody.alreadyActive,true);
  assert.equal(retryBody.employee?.id,employeeId);assert.equal(retryBody.employee?.status,'active');
  assert.deepEqual(retryRpcs,[waive]);assert.equal(retryReads,1);assert.equal(reentryStatus,200);
  assert.deepEqual(retryBody,reentryBody);assert.deepEqual(reentryRpcs,[accept]);assert.equal(reentryReads,0);
  return {defectReproduced:false,retryRecoveryPassed:true,credentialRetryStatus:200,passwordAuthenticatedReentryStatus:200};
}

export async function checkInvitationRetryNative(native){
  await withAttendanceConcurrencySandbox(native,async scope=>{
    const exec=source=>native.query(scope.sql(source));
    exec(`begin;insert into public.merchants(id,user_id) values('${site}','${id(99)}');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,system_key,permissions)
        values('${id(30)}','${site}','合成邀请角色','employee',array['enterprise.view']);commit;`);
    await prepareAttendanceEmployeeManagement(native,scope);
    await prepareAttendanceInvitationRetry(native,scope);
    const owned=assertLifecycleSandbox(exec);
    const ownedGuard=`do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
      and n.nspname=${quote(owned.schema)} and n.nspowner::regrole::text='postgres'
      and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)}) then raise exception 'invitation_retry_owned_schema_required'; end if; end; $owned$;`;
    const invitations=[1,2,4,5,6].map(n=>({n,employeeId:id(100+n),actor:actors[n-1],token:randomBytes(32).toString('base64url'),version:7}));
    // Initial synthetic invitation states, not fabricated successful acceptance.
    exec(`begin;reset role;${ownedGuard}${invitations.map(item=>`insert into public.merchant_enterprise_employees(
      id,merchant_id,auth_user_id,email,display_name,role_id,status,invitation_version,invitation_token_hash,
      invitation_expires_at,invitation_revoked_at,initial_password_policy,accepted_at) values(
      '${item.employeeId}','${site}','${item.actor.id}',${quote(item.actor.email)},'合成受邀员工${item.n}','${id(30)}','${item.n===6?'disabled':'invited'}',7,${item.n===6?'null':quote(hash(item.token))},
      clock_timestamp()+interval '${item.n===4?'-1 hour':'1 day'}',${item.n===5?'clock_timestamp()':'null'},'${item.n===2?'required':'waived'}',${item.n===6?'clock_timestamp()':'null'});`).join('\n')}commit;`);
    const rows=table=>JSON.parse(exec(`reset role;select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t;`));
    const employee=item=>JSON.parse(exec(`reset role;select to_jsonb(e) from public.merchant_enterprise_employees e where id='${item.employeeId}';`));
    const snapshot=()=>JSON.stringify([rows('merchant_enterprise_employees'),rows('merchant_employee_initial_password_setups'),rows('merchant_enterprise_audit_events')]);
    const protectedFacts=()=>exec(`reset role;select md5(jsonb_build_object(${[
      'merchants','merchant_enterprise_roles','merchant_enterprise_role_boards','merchant_task_boards','merchant_task_columns','merchant_tasks','merchant_task_assignees',
      'merchant_attendance_workers','merchant_attendance_events','merchant_attendance_settings','merchant_attendance_locations',
    ].map(table=>`${quote(table)},(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.${table} t)`).join(',')})::text);`);
    const baseline=protectedFacts(),initialEmployees=rows('merchant_enterprise_employees'),initialAudits=rows('merchant_enterprise_audit_events');
    const rpcCalls=[],requestScope=new AsyncLocalStorage();
    const rpc=async(name,args)=>{
      const input=validateInvitationRetryRpcInput(name,args);
      // Keep only names and controlled errors; never log credentials/hash/JWT.
      const record={name,error:null};rpcCalls.push(record);const context=requestScope.getStore();context?.rpcs.push(record);
      if(name===waive&&context?.holdWaiver&&!context.holdWaiver.used){
        context.holdWaiver.used=true;context.holdWaiver.ready.resolve();await context.holdWaiver.release.promise;
      }
      assert.deepEqual(assertLifecycleSandbox(exec),owned,'invitation_retry_namespace_changed');
      try{
        const result=JSON.parse(exec(`begin;reset role;${ownedGuard}set local role service_role;
          select jsonb_build_object('role',current_user,'data',public.${name}(${quote(JSON.stringify(input))}::jsonb));commit;`));
        assert.equal(result.role,'service_role');return {data:result.data,error:null};
      }catch(error){
        const code=String(error).match(/ERROR:\s+([a-z_]+)/)?.[1];
        if(!code||!/^employee_|^merchant_|^enterprise_/.test(code))throw Error('invitation_retry_unexpected_sql_failure');
        record.error=code;return {data:null,error:{message:code}};
      }
    };
    const reads=createAttendanceEmployeeManagementReadTransport(exec,{syntheticAuthUserIds:actors.map(actor=>actor.id)});
    const recovery=createInvitationRetryRecoveryRead(exec,{owned,ownedGuard,fallback:reads.read});
    const additionalRead=request=>{
      if(new URL(request.url).pathname==='/rest/v1/merchant_enterprise_employees'){
        const context=requestScope.getStore();if(context)context.reads++;
        if(context?.failRead){validateInvitationRecoveryRead(request);return Response.json({code:'synthetic_read_unavailable',message:'synthetic read unavailable'},{status:503});}
      }
      return recovery.read(request);
    };
    const savedMode=process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE='off';
    try{await withAttendanceApplicationAuth(actors,rpc,async auth=>{
      const tokens=new Map();for(const actor of actors)tokens.set(actor.id,await auth.login(actor));
      const request=async(actor,body,overrideToken=null,options={})=>requestScope.run({rpcs:[],reads:0,...options},async()=>{
        const context=requestScope.getStore();
        const result=await POST(new Request('https://www.faolla.com/api/merchant-enterprise/employees/accept',{
          method:'POST',headers:{'content-type':'application/json',origin:'https://www.faolla.com','sec-fetch-site':'same-origin',
            'x-merchant-access-token':overrideToken??tokens.get(actor.id)},body:JSON.stringify(body)}));
        return {status:result.status,body:await result.json(),rpcs:context.rpcs.map(row=>row.name),recoveryReads:context.reads};
      });
      const body=item=>({siteId:site,invitationVersion:item.version,invitationToken:item.token});
      const untouched=async(action,status,error,expectedRpcs)=>{
        const before=snapshot(),result=await action();assert.equal(result.status,status);assert.deepEqual(result.body,{ok:false,error});
        assert.deepEqual(result.rpcs,expectedRpcs);assert.equal(snapshot(),before);assert.equal(protectedFacts(),baseline);return result;
      };
      const a=invitations[0],b=invitations[1];
      await untouched(()=>request(a.actor,{...body(a),invitationToken:'X'.repeat(43)}),410,'employee_invitation_superseded',[waive]);
      await untouched(()=>request(a.actor,{...body(a),invitationVersion:6}),410,'employee_invitation_superseded',[waive]);
      for(const item of invitations.slice(2))await untouched(()=>request(item.actor,body(item)),410,'employee_invitation_superseded',[waive]);
      const disabled=invitations.find(item=>item.n===6);
      await untouched(()=>request(disabled.actor,{siteId:site}),403,'employee_account_disabled',[accept]);
      await untouched(()=>request(actors[2],{...body(a),auth_user_id:a.actor.id}),403,'merchant_employee_not_invited',[waive]);
      await untouched(()=>request(a.actor,{siteId:site,invitationVersion:7}),400,'invalid_employee_invitation_credentials',[]);
      await untouched(()=>request(a.actor,{...body(a),siteId:'99990002'}),403,'enterprise_management_disabled',[]);
      for(const methods of [['invite'],['recovery'],['password','recovery']])
        await untouched(()=>request(a.actor,body(a),auth.issue(a.actor,methods)),403,'employee_password_authentication_required',[]);
      await untouched(()=>request(a.actor,body(a),'invalid-synthetic-token'),401,'unauthorized',[]);
      native.pass('wrong token/version, expired/revoked invitations, foreign actor/body spoof, malformed credentials, wrong tenant and non-password/invalid auth all deny without changing invitation/setup/audit facts');

      // Original policy guard remains exercised, not bypassed to manufacture an active row.
      const beforeDirect=snapshot();const direct=await rpc(accept,{p_input:{merchant_id:site,auth_user_id:b.actor.id,invitation_version:b.version,token_hash:hash(b.token)}});
      assert.equal(direct.error?.message,'employee_initial_password_setup_incomplete');assert.equal(snapshot(),beforeDirect);
      native.pass('original service-role accept without HTTP password waiver still refuses required initial-password policy, with no mutation or audit');

      const proofs=[];
      for(const item of [a,b]){
        const previous=employee(item),auditsBefore=rows('merchant_enterprise_audit_events');
        let committed,concurrentRetry=null;
        if(item===b){
          const gate={ready:deferred(),release:deferred(),used:false};
          const held=request(item.actor,body(item),null,{holdWaiver:gate});void held.catch(()=>{});let failure;
          try{await bounded(gate.ready.promise);committed=await request(item.actor,body(item));}
          catch(error){failure=error;}finally{gate.release.resolve();}
          concurrentRetry=await bounded(held);if(failure)throw failure;
        }else committed=await request(item.actor,body(item));
        assert.equal(committed.status,200);assert.equal(committed.body.ok,true);assert.equal(committed.body.alreadyActive,false);
        assert.deepEqual(committed.rpcs,[waive,accept]);assert.equal(committed.body.employee.id,item.employeeId);
        const active=employee(item);assert.equal(active.status,'active');assert.equal(active.invitation_token_hash,null);
        assert(active.accepted_at);assert.equal(active.accepted_at,active.last_active_at);
        assert.equal(active.version,previous.version+(item.n===2?2:1));assert.equal(active.initial_password_policy,'waived');
        assert.equal(active.auth_user_id,previous.auth_user_id);assert.equal(active.role_id,previous.role_id);assert.equal(active.invitation_version,previous.invitation_version);
        const auditsAfter=rows('merchant_enterprise_audit_events');
        for(const row of auditsBefore)assert.deepEqual(auditsAfter.find(next=>next.id===row.id),row);
        const added=auditsAfter.filter(row=>!auditsBefore.some(old=>old.id===row.id));assert.equal(added.length,1);
        assert.equal(added[0].event_type,'invitation.accepted');assert.equal(added[0].entity_id,item.employeeId);
        assert.equal(added[0].actor_type,'employee');assert.equal(added[0].actor_id,item.employeeId);
        assert.equal(added[0].before_data.status,'invited');assert.equal(added[0].after_data.status,'active');
        const auditText=JSON.stringify(added);assert(!auditText.includes(item.token)&&!auditText.includes(hash(item.token))&&!auditText.includes(item.actor.id));
        // Deliberately do not acknowledge committed response to a UI/client. The
        // next call is a fresh real handler request with the exact original body.
        const afterCommit=snapshot(),retry=await request(item.actor,body(item));assert.equal(snapshot(),afterCommit);
        const reentry=await request(item.actor,{siteId:site});assert.equal(snapshot(),afterCommit);
        assert.deepEqual(reentry.body.employee,committed.body.employee);
        const proof=assertInvitationRetryRecovery({retryStatus:retry.status,retryBody:retry.body,retryRpcs:retry.rpcs,retryReads:retry.recoveryReads,
          reentryStatus:reentry.status,reentryBody:reentry.body,reentryRpcs:reentry.rpcs,reentryReads:reentry.recoveryReads,employeeId:item.employeeId});
        if(concurrentRetry)assertInvitationRetryRecovery({retryStatus:concurrentRetry.status,retryBody:concurrentRetry.body,retryRpcs:concurrentRetry.rpcs,retryReads:concurrentRetry.recoveryReads,
          reentryStatus:reentry.status,reentryBody:reentry.body,reentryRpcs:reentry.rpcs,reentryReads:reentry.recoveryReads,employeeId:item.employeeId});
        const repeated=await request(item.actor,body(item));assert.equal(snapshot(),afterCommit);
        assertInvitationRetryRecovery({retryStatus:repeated.status,retryBody:repeated.body,retryRpcs:repeated.rpcs,retryReads:repeated.recoveryReads,
          reentryStatus:reentry.status,reentryBody:reentry.body,reentryRpcs:reentry.rpcs,reentryReads:reentry.recoveryReads,employeeId:item.employeeId});
        const oldGeneration=await untouched(()=>request(item.actor,{...body(item),invitationVersion:item.version-1}),410,'employee_invitation_superseded',[waive]);
        assert.equal(oldGeneration.recoveryReads,1);assert.equal(snapshot(),afterCommit);
        const failedRead=await untouched(()=>request(item.actor,body(item),null,{failRead:true}),503,'merchant_employee_accept_failed',[waive]);
        assert(failedRead.recoveryReads>=1);assert.equal(snapshot(),afterCommit);
        proofs.push(proof);assert.equal(protectedFacts(),baseline);
        native.pass(`recovery verified (${item.n===2?'required policy with existing password':'waived policy'}): committed HTTP200 activates once; repeated original-credential retries use only waiver plus one real read and match credential-free200 alreadyActive; older generation still410 and all committed facts/audits stay unchanged`);
      }
      native.pass('named pre-SQL waiver gate lets the competing required-policy POST activate once; the held original POST then recovers200 by a real read, while read503, disabled membership and old generation never produce a new activation');
      for(const row of initialEmployees.filter(row=>![a.employeeId,b.employeeId].includes(row.id)))
        assert.deepEqual(rows('merchant_enterprise_employees').find(next=>next.id===row.id),row);
      const finalAudits=rows('merchant_enterprise_audit_events');assert.equal(finalAudits.length,initialAudits.length+2);
      for(const row of initialAudits)assert.deepEqual(finalAudits.find(next=>next.id===row.id),row);
      assert.deepEqual(rows('merchant_employee_initial_password_setups'),[]);assert.deepEqual(rows('merchant_attendance_events'),[]);
      assert.equal(protectedFacts(),baseline);assert.deepEqual(reads.errors,[]);assert.deepEqual(recovery.errors,[]);
      assert(reads.calls.some(call=>call.shape==='synthetic-platform-entitlement'));
      assert(!auth.calls.some(call=>call.path.includes('/admin/')||call.path.includes('/recover')||call.path.includes('/invite')));
      console.log(JSON.stringify({invitationRetryAcceptance:true,defectReproduced:false,retryRecoveryPassed:proofs.every(p=>p.retryRecoveryPassed),
        activatedSyntheticEmployees:2,addedAcceptanceAudits:2,concurrentRetryRecovered:true,readFailureDenied:true,attendanceEvents:0,protectedFactsUnchanged:true,
        realHandler:true,realSql:true,realAuthService:false,realEmail:false,realBrowser:false,simulatedResponseLoss:'discard-after-handler-commit',productionAccess:false}));
    },undefined,additionalRead);}finally{if(savedMode===undefined)delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE=savedMode;}
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),checkInvitationRetryNative).catch(()=>{
    // SQL command errors can contain synthetic credentials; fail closed without
    // dumping raw queries, exception.actual/expected, invitation or Auth values.
    console.error('invitation_retry_acceptance_failed');process.exitCode=1;
  });
}
