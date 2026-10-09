// Opt-in diagnosis of the unchanged setup handler factory with real setup SQL.
// Auth identity/password mutation and DI read transport are explicitly synthetic.
// Does not test a browser, default setup dependencies, real email or Auth service.
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareAttendanceInitialPasswordFixture,applyInitialPasswordReplayFixture} from './merchant-attendance-initial-password-fixture.mjs';
import {checkInitialPasswordReplayRejections} from './merchant-attendance-initial-password-replay-rejections.mjs';
const require=createRequire(import.meta.url);
const {createMerchantEnterpriseInitialPasswordHandler}=require('../src/app/api/merchant-enterprise/invitations/initial-password/route-handler.ts');
const {POST:acceptInvitation}=require('../src/app/api/merchant-enterprise/employees/accept/route-handler.ts');
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const setupNames={claim:'faolla_claim_merchant_employee_initial_password_setup_v1',complete:'faolla_complete_merchant_employee_initial_password_setup_v1',release:'faolla_release_merchant_employee_initial_password_setup_v1'};
const origin='https://www.faolla.com',password='Synthetic-attendance-only!';
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');

/** In-memory model only. No password, JWT, fingerprint or Auth metadata is logged. */
export function createInitialPasswordAuthModel(actor){
  assert.match(actor.id,/^00000000-0000-4000-8000-\d{12}$/);
  assert.match(actor.email,/^[^@]+@example\.test$/);
  let user={id:actor.id,email:actor.email,app_metadata:{principal_type:'merchant_staff',
    merchant_staff_email_hash:hash(actor.email),merchant_staff_password_initialized:false,fixture_retained:'unchanged'}};
  let updates=0,reads=0,loseReply=false,storedPassword=null;
  const sessionToken=randomBytes(32).toString('base64url');
  return {
    sessionToken,
    resolveAuthUser:async request=>{assert.equal(request.headers.get('x-merchant-access-token'),sessionToken);return structuredClone(user);},
    getAuthUserById:async id=>{assert.equal(id,actor.id);reads++;return {user:structuredClone(user),error:null};},
    updateAuthUserById:async(id,attributes)=>{
      assert.equal(id,actor.id);assert.deepEqual(Object.keys(attributes).sort(),['app_metadata','password']);
      assert.equal(typeof attributes.password,'string');assert(attributes.password.length>=8&&attributes.password.length<=128);
      assert.deepEqual(attributes.app_metadata,{...user.app_metadata,merchant_staff_password_initialized:true});
      updates++;storedPassword=attributes.password;user={...user,app_metadata:structuredClone(attributes.app_metadata)};
      if(loseReply){loseReply=false;return {user:null,error:{status:503,message:'synthetic_auth_reply_lost_after_commit'}};}
      return {user:structuredClone(user),error:null};
    },
    loseNextUpdateReply:()=>{loseReply=true;},
    passwordMatches:value=>storedPassword!==null&&storedPassword===value,
    proof:()=>({updates,reads,initialized:user.app_metadata.merchant_staff_password_initialized,
      retained:user.app_metadata.fixture_retained}),
    user:()=>structuredClone(user),
  };
}

export function assertCompletedSetupRetryDefect({status,body,rpcErrors,before,after,authBefore,authAfter}){
  assert.equal(status,409);assert.deepEqual(body,{ok:false,error:'employee_password_state_unknown'});
  assert.deepEqual(rpcErrors,['employee_initial_password_not_required']);
  assert.deepEqual(after,before);assert.deepEqual(authAfter,authBefore);
  assert.equal(before.setups.length,1);assert.equal(before.setups[0].state,'completed');
  const employee=before.employees.find(row=>row.id===before.setups[0].employee_id);
  assert(employee&&employee.status==='invited'&&employee.accepted_at===null&&employee.initial_password_policy==='completed');
  assert.equal(authBefore.initialized,true);assert.equal(authBefore.updates,1);
  return {completedSetupRetryPassed:false,completedSetupRetryDefectReproduced:true};
}

export function assertCompletedSetupRetryRecovered({status,body,rpcErrors,rpcNames,before,after,authBefore,authAfter}){
  assert.equal(status,200);assert.deepEqual(body,{ok:true});assert.deepEqual(rpcErrors,[]);
  assert.deepEqual(rpcNames,[setupNames.claim]);
  assert.deepEqual(after,before);assert.equal(before.setups.length,1);assert.equal(before.setups[0].state,'completed');
  const employee=before.employees.find(row=>row.id===before.setups[0].employee_id);
  assert(employee&&employee.status==='invited'&&employee.accepted_at===null&&employee.initial_password_policy==='completed');
  assert.deepEqual(authAfter,{...authBefore,reads:authBefore.reads+1});
  assert.equal(authBefore.updates,1);assert.equal(authBefore.initialized,true);
  return {completedSetupRetryPassed:true,completedSetupRetryDefectReproduced:false};
}

function checkExpiryAfterStatementStart(prepared,invite,input){
  const before=prepared.facts(),protectedBefore=prepared.protectedFingerprint();
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  // A bounded real-time expiry inside one DO statement witnesses stale
  // statement_timestamp, not an actual blocked-lock concurrency test.
  const result=prepared.exec(`begin;reset role;
    update public.merchant_enterprise_employees set invitation_expires_at=clock_timestamp()+interval '300 milliseconds' where id=${quote(invite.employeeId)};
    set local role service_role;
    do $expiry$ begin
      if not exists(select 1 from public.merchant_enterprise_employees where id=${quote(invite.employeeId)} and invitation_expires_at>statement_timestamp())
        then raise exception 'initial_password_expiry_test_late_start';end if;
      perform pg_sleep(0.35);
      begin
        perform public.faolla_claim_merchant_employee_initial_password_setup_v1(${quote(JSON.stringify(input))}::jsonb);
        raise exception 'initial_password_expiry_unexpected_success';
      exception when others then
        if sqlerrm<>'employee_invitation_expired' then raise exception 'initial_password_expiry_wrong_rejection';end if;
      end;
    end;$expiry$;
    reset role;select 'initial_password_statement_expiry_rejected';rollback;`);
  assert.equal(result,'initial_password_statement_expiry_rejected');
  assert.deepEqual(prepared.facts(),before);assert.equal(prepared.protectedFingerprint(),protectedBefore);
}

export async function checkInitialPasswordNative(native,{patched=false,directSuccess=false}={}){
  await withAttendanceConcurrencySandbox(native,async scope=>{
    const prepared=await prepareAttendanceInitialPasswordFixture(native,scope),invite=prepared.invitations[1];
    assert.equal(invite.policy,'required');
    if(patched){applyInitialPasswordReplayFixture(native,scope,prepared);native.pass('candidate114 installs and reapplies in the owned fixture without changing existing employee/setup/audit facts, function owner or ACL');}
    const initial=prepared.facts(),protectedBefore=prepared.protectedFingerprint(),auth=createInitialPasswordAuthModel(invite.actor);
    const original={siteId:prepared.site,invitationToken:invite.token,invitationVersion:invite.version,newPassword:password,operationId:randomUUID()};
    const setupCall=kind=>input=>prepared.initialPasswordRpc(setupNames[kind],{p_input:{merchant_id:input.siteId,auth_user_id:input.authUserId,
      invitation_version:input.invitationVersion,token_hash:input.tokenHash,operation_id:input.operationId,password_fingerprint:input.passwordFingerprint}});
    let authReadFailure=null;
    const handle=createMerchantEnterpriseInitialPasswordHandler({resolveAuthUser:auth.resolveAuthUser,
      loadInvitation:prepared.loadInvitation,loadRole:prepared.loadRole,loadStaffIdentity:prepared.loadStaffIdentity,
      getAuthUserById:async id=>{const result=await auth.getAuthUserById(id);
        if(authReadFailure==='unavailable')return {user:null,error:{status:503,message:'synthetic_auth_read_unavailable'}};
        if(authReadFailure==='uncommitted')result.user.app_metadata.merchant_staff_password_initialized=false;
        return result;},updateAuthUserById:auth.updateAuthUserById,
      claimInitialPasswordSetup:setupCall('claim'),completeInitialPasswordSetup:setupCall('complete'),releaseInitialPasswordSetup:setupCall('release'),now:()=>new Date()});
    const call=async(body=original)=>{
      const start=prepared.initialPasswordRpcCalls.length;
      const response=await handle(new Request(origin+'/api/merchant-enterprise/invitations/initial-password',{
        method:'POST',headers:{origin,'content-type':'application/json','x-merchant-access-token':auth.sessionToken},body:JSON.stringify(body)}));
      assert.match(response.headers.get('cache-control'),/no-store/);
      assert.equal(response.headers.get('referrer-policy'),'no-referrer');
      const calls=prepared.initialPasswordRpcCalls.slice(start);
      return {status:response.status,body:await response.json(),rpcNames:calls.map(row=>row.name),rpcErrors:calls.map(row=>row.error).filter(Boolean)};
    };
    const safe=()=>assert.equal(prepared.protectedFingerprint(),protectedBefore,'initial_password_protected_facts_changed');
    const previousFetch=globalThis.fetch,savedOrigin=process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN,savedMode=process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;
    let phase='preconditions',externalRequests=0;
    globalThis.fetch=async()=>{externalRequests++;throw Error('initial_password_external_request_forbidden');};
    process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN=origin;process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE='off';
    try{
      const bad=await call({...original,invitationToken:randomBytes(32).toString('base64url')});
      assert.equal(bad.status,410);assert.equal(bad.body.error,'employee_invitation_invalid_or_expired');
      assert.deepEqual(prepared.facts(),initial);assert.deepEqual(auth.proof(),{updates:0,reads:0,initialized:false,retained:'unchanged'});
      const early=await prepared.rpc('faolla_accept_merchant_employee_invitation_v1',{p_input:{merchant_id:prepared.site,auth_user_id:invite.actor.id,
        invitation_version:invite.version,token_hash:hash(invite.token)}});
      assert.equal(early.error?.message,'employee_initial_password_setup_incomplete');assert.deepEqual(prepared.facts(),initial);safe();
      native.pass('wrong setup bearer is rejected before Auth mutation; original service-role accept refuses the still-required password policy without activating a member');

      let claimed;
      if(!directSuccess){
      phase='auth-write-reply-lost';auth.loseNextUpdateReply();const lost=await call();
      assert.equal(lost.status,503);assert.equal(lost.body.error,'employee_initial_password_setup_failed');
      claimed=prepared.facts();assert.equal(claimed.setups.length,1);assert.equal(claimed.setups[0].state,'claimed');
      assert.equal(claimed.setups[0].employee_id,invite.employeeId);assert.equal(claimed.setups[0].operation_id,original.operationId);
      assert.deepEqual(claimed.employees,initial.employees);assert.deepEqual(claimed.audits,initial.audits);
      assert(auth.passwordMatches(password));assert.equal(auth.proof().updates,1);safe();
      native.pass('a modeled Auth write followed by503 leaves the real SQL claim pending and the member invited;503 is not treated as proof that the password was never saved');

      phase='changed-password-retry';const beforeChangedAuth=auth.proof(),changed=await call({...original,newPassword:'A-different-synthetic-password!'});
      assert.equal(changed.status,409);assert.equal(changed.body.error,'employee_initial_password_setup_in_progress');
      assert.deepEqual(prepared.facts(),claimed);assert.deepEqual(auth.proof(),beforeChangedAuth);safe();
      native.pass('changing the password while the original claim is live is rejected by real SQL with no extra Auth write, mutation or activation');
      }

      phase='same-request-recovery';const recovered=await call();assert.equal(recovered.status,200);assert.deepEqual(recovered.body,{ok:true});
      const completed=prepared.facts();assert.equal(completed.setups.length,1);assert.equal(completed.setups[0].state,'completed');
      assert.equal(completed.setups[0].operation_id,original.operationId);
      if(claimed)assert.equal(completed.setups[0].password_fingerprint,claimed.setups[0].password_fingerprint);
      assert(completed.setups[0].completed_at);assert.equal(completed.setups[0].claim_expires_at,null);
      const completedEmployee=completed.employees.find(row=>row.id===invite.employeeId);
      assert.equal(completedEmployee.initial_password_policy,'completed');assert.equal(completedEmployee.status,'invited');assert.equal(completedEmployee.accepted_at,null);
      for(const row of initial.employees.filter(row=>row.id!==invite.employeeId))assert.deepEqual(completed.employees.find(next=>next.id===row.id),row);
      assert.deepEqual(completed.audits,initial.audits);
      assert.equal(auth.proof().updates,1);assert(auth.passwordMatches(password));safe();
      native.pass(directSuccess?'normal first setup completes real claim and SQL in one handler call with one modeled Auth password update':
        'the original request resumes its real claim, observes the modeled saved Auth password and completes real SQL without a second password update');

      // Deliberately do not acknowledge the previous200 to a client. This is a
      // new identical handler request after commit, NOT a browser network test.
      phase='completed-request-replay';const authBefore=auth.proof(),retry=await call();
      const resultProof=patched
        ?assertCompletedSetupRetryRecovered({...retry,before:completed,after:prepared.facts(),authBefore,authAfter:auth.proof()})
        :assertCompletedSetupRetryDefect({...retry,before:completed,after:prepared.facts(),authBefore,authAfter:auth.proof()});
      const rejectedAuthBaseline=auth.proof();
      for(const body of [{...original,newPassword:'A-different-synthetic-password!'},{...original,operationId:randomUUID()}]){
        const denied=await call(body);assert.equal(denied.status,409);assert.equal(denied.body.error,'employee_password_state_unknown');
        assert.deepEqual(prepared.facts(),completed);assert.deepEqual(auth.proof(),rejectedAuthBaseline);
      }
      safe();native.pass(patched?'candidate114 confirms the exact completed request with200 and one Auth read; changed operation/password still409, and no SQL fact or password is rewritten':
        'DIAGNOSTIC: after completion the identical setup request returns409 password_state_unknown from the real claim policy gate, not200; no password or database fact is rewritten');

      if(patched&&!directSuccess){
        phase='completed-auth-read-gates';
        for(const failure of ['uncommitted','unavailable']){
          const proofBefore=auth.proof();authReadFailure=failure;let denied;
          try{denied=await call();}finally{authReadFailure=null;}
          assert.equal(denied.status,503);assert.equal(auth.proof().updates,1);assert.equal(auth.proof().reads,proofBefore.reads+1);
          assert.deepEqual(denied.rpcNames,[setupNames.claim]);
          assert.deepEqual(prepared.facts(),completed);safe();
        }
        const afterAuthFailure=auth.proof(),confirmed=await call();
        assertCompletedSetupRetryRecovered({...confirmed,before:completed,after:prepared.facts(),authBefore:afterAuthFailure,authAfter:auth.proof()});
        native.pass('a completed SQL receipt still requires current Auth initialized=true; missing confirmation or an unavailable Auth read returns503 without rewriting password/setup, and a later healthy read recovers');
        const row=completed.setups[0],input={merchant_id:prepared.site,auth_user_id:invite.actor.id,invitation_version:invite.version,
          token_hash:row.invitation_token_hash,operation_id:original.operationId,password_fingerprint:row.password_fingerprint};
        phase='completed-rejection-matrix';await checkInitialPasswordReplayRejections(native,scope,prepared,invite,input);
        phase='expiry-after-statement-start';checkExpiryAfterStatementStart(prepared,invite,input);safe();
        native.pass('invitation expiry after statement start is rejected against wall-clock time; the bounded synthetic expiry mutation is rolled back with all original facts intact');
      }

      phase='existing-password-fallback';
      await withAttendanceApplicationAuth(prepared.actors,prepared.rpc,async protocol=>{
        assert(auth.passwordMatches(password));assert.equal(auth.proof().initialized,true);
        // The protocol fixture independently validates this synthetic password.
        // Its validated user reply carries the setup model's current metadata;
        // this is still modeled Auth, not the default setup Auth admin transport.
        const protocolFetch=globalThis.fetch;
        globalThis.fetch=async(input,init)=>{
          const request=new Request(input,init),response=await protocolFetch(request),url=new URL(request.url);
          if(url.pathname==='/auth/v1/user'&&request.method==='GET'&&response.ok){
            const user=await response.json();assert.equal(user.id,invite.actor.id);
            return Response.json({...user,app_metadata:auth.user().app_metadata});
          }
          return response;
        };
        try{
          const token=await protocol.login(invite.actor);
          const response=await acceptInvitation(new Request(origin+'/api/merchant-enterprise/employees/accept',{
            method:'POST',headers:{origin,'content-type':'application/json','x-merchant-access-token':token},
            body:JSON.stringify({siteId:prepared.site,invitationVersion:invite.version,invitationToken:invite.token})}));
          const payload=await response.json();assert.equal(response.status,200);assert.equal(payload.ok,true);
          assert.equal(payload.alreadyActive,false);assert.equal(payload.employee.id,invite.employeeId);
          assert(protocol.calls.some(row=>row.path==='/auth/v1/token'&&row.method==='POST'));
        }finally{globalThis.fetch=protocolFetch;}
      },undefined,prepared.read);
      const final=prepared.facts();assert.equal(final.employees.find(row=>row.id===invite.employeeId).status,'active');
      for(const row of initial.employees.filter(row=>row.id!==invite.employeeId))assert.deepEqual(final.employees.find(next=>next.id===row.id),row);
      assert.deepEqual(final.setups,completed.setups);assert.equal(final.audits.length,completed.audits.length+1);
      for(const row of completed.audits)assert.deepEqual(final.audits.find(next=>next.id===row.id),row);
      const added=final.audits.filter(row=>!completed.audits.some(previous=>previous.id===row.id));
      assert.equal(added[0].event_type,'invitation.accepted');assert.equal(added[0].entity_id,invite.employeeId);
      assert.equal(auth.proof().updates,1);safe();assert.equal(externalRequests,0);assert.deepEqual(prepared.errors,[]);assert.deepEqual(prepared.initialPasswordErrors,[]);
      native.pass('a separate installed-SDK synthetic password login followed by the actual accept handler and original SQL activates the completed member once without changing its setup receipt');
      console.log(JSON.stringify({initialPasswordNative:true,patched,directSuccess,...resultProof,authUnknownOutcomeRecoveryPassed:!directSuccess,existingPasswordFallbackPassed:true,
        passwordMutationCalls:auth.proof().updates,addedAcceptanceAudits:1,realHandlerFactory:true,realSql:true,
        injectedReadDependencies:true,defaultSetupDependencies:false,syntheticAuthMutation:true,realAuthService:false,realBrowser:false,realEmail:false,
        productionAccess:false,externalRequests}));
    }catch{
      console.error(JSON.stringify({initialPasswordNativeFailed:true,phase}));throw Error('initial_password_local_diagnosis_failed');
    }finally{
      globalThis.fetch=previousFetch;
      if(savedOrigin===undefined)delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;else process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN=savedOrigin;
      if(savedMode===undefined)delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE=savedMode;
    }
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),patched=args.includes('--patched');
  await runAttendanceLabelsReuse(args.filter(value=>value!=='--patched'),async native=>{
    await checkInitialPasswordNative(native,{patched});
    if(patched)await checkInitialPasswordNative(native,{patched:true,directSuccess:true});
  }).catch(()=>{
    console.error('initial_password_native_diagnosis_failed');process.exitCode=1;
  });
}
