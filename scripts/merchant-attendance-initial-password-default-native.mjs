// Default exported POST + installed SDK against a closed local protocol adapter.
// Verifies the approved RPC-only repair while the original table ACL stays
// closed. No injected route dependencies, real Auth service or production.
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareAttendanceInitialPasswordFixture,applyInitialPasswordReplayFixture} from './merchant-attendance-initial-password-fixture.mjs';
import {createInitialPasswordAuthModel} from './merchant-attendance-initial-password-native.mjs';
import {createInitialPasswordAdminBridge} from './merchant-attendance-initial-password-admin-bridge.mjs';
import {createInitialPasswordDefaultTransport} from './merchant-attendance-initial-password-default-transport.mjs';
import {installInitialPasswordLookupFixture} from './merchant-attendance-initial-password-lookup-fixture.mjs';
const require=createRequire(import.meta.url);
const {POST}=require('../src/app/api/merchant-enterprise/invitations/initial-password/route-handler.ts');
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const origin='https://www.faolla.com',endpoint='/api/merchant-enterprise/invitations/initial-password';
const lookupName='faolla_lookup_merchant_enterprise_staff_identity_v1';
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');

// Historical phase121 oracle, retained as a negative-proof regression helper.
export function assertInitialPasswordDefaultAclDefect({status,body,reads,rpcCalls,adminCalls,before,after,authBefore,authAfter}){
  assert.equal(status,503);
  assert.deepEqual(body,{ok:false,error:'employee_initial_password_store_unavailable'});
  assert.deepEqual(reads,[{kind:'invitation',status:200,error:null},{kind:'role',status:200,error:null},
    {kind:'identity',status:403,error:'42501'}]);
  assert.deepEqual(rpcCalls,[]);assert.deepEqual(adminCalls,[]);
  assert.deepEqual(after,before);assert.deepEqual(authAfter,authBefore);
  assert.equal(before.setups.length,0);assert.equal(authBefore.initialized,false);
  assert.equal(authBefore.updates,0);assert.equal(authBefore.reads,0);
  assert(before.employees.length>0&&before.employees.every(row=>row.status==='invited'&&row.accepted_at===null));
  return {defaultSetupSuccess:false,identityReadAclDefectReproduced:true};
}

export function assertInitialPasswordDefaultCompleted({before,after,invite,command,auth}){
  assert.equal(before.setups.length,0);assert.equal(after.setups.length,1);assert.deepEqual(after.audits,before.audits);
  const previous=before.employees.find(row=>row.id===invite.employeeId),employee=after.employees.find(row=>row.id===invite.employeeId);
  assert(previous&&employee);assert.equal(previous.initial_password_policy,'required');
  assert.equal(employee.initial_password_policy,'completed');assert.equal(employee.version,previous.version+1);
  assert(Number.isFinite(Date.parse(employee.updated_at)));
  assert.deepEqual({...employee,initial_password_policy:previous.initial_password_policy,version:previous.version,updated_at:previous.updated_at},previous);
  assert.equal(employee.status,'invited');assert.equal(employee.accepted_at,null);
  assert.deepEqual(after.employees.filter(row=>row.id!==invite.employeeId),before.employees.filter(row=>row.id!==invite.employeeId));
  const setup=after.setups[0];
  for(const [key,value] of Object.entries({employee_id:invite.employeeId,merchant_id:command.siteId,auth_user_id:invite.actor.id,
    invitation_version:invite.version,invitation_token_hash:hash(invite.token),operation_id:command.operationId,
    password_fingerprint:hash('faolla:merchant-employee-initial-password:v1\0'+invite.token+'\0'+command.newPassword),state:'completed',claim_expires_at:null}))
    assert.equal(setup[key],value);
  assert(Number.isFinite(Date.parse(setup.claimed_at))&&Number.isFinite(Date.parse(setup.completed_at)));
  assert.equal(auth.updates,1);assert.equal(auth.initialized,true);assert.equal(auth.retained,'unchanged');
}

export async function checkInitialPasswordDefaultNative(native,{lostReply=false}={}){
  await withAttendanceConcurrencySandbox(native,async scope=>{
    let phase='prepare';
    try{
      const prepared=await prepareAttendanceInitialPasswordFixture(native,scope);
      applyInitialPasswordReplayFixture(native,scope,prepared);
      const lookup=installInitialPasswordLookupFixture(native,scope,prepared);
      const invite=prepared.invitations[1];assert.equal(invite.policy,'required');
      const model=createInitialPasswordAuthModel(invite.actor),transport=createInitialPasswordDefaultTransport(prepared);
      const initial=prepared.facts(),protectedBefore=prepared.protectedFingerprint(),authBefore=model.proof();
      const lookupProtectedBefore=lookup.lookupProtectedFingerprint();
      const catalog=()=>JSON.parse(prepared.exec(`begin read only;reset role;
        select jsonb_build_object(
          'employeeSelect',has_table_privilege('service_role','public.merchant_enterprise_employees','SELECT'),
          'roleSelect',has_table_privilege('service_role','public.merchant_enterprise_roles','SELECT'),
          'identitySelect',has_table_privilege('service_role','public.merchant_enterprise_staff_identities','SELECT'),
          'identityAcl',(select relacl::text from pg_class where oid='public.merchant_enterprise_staff_identities'::regclass),
          'identityRls',(select relrowsecurity from pg_class where oid='public.merchant_enterprise_staff_identities'::regclass));commit;`));
      const originalCatalog=catalog();assert.equal(originalCatalog.employeeSelect,true);assert.equal(originalCatalog.roleSelect,true);
      assert.equal(originalCatalog.identitySelect,false);assert.equal(originalCatalog.identityRls,true);
      native.pass('default repair retains denied registry SELECT and installs only source-derived read-only lookup in the owned namespace');
      const safe=()=>{
        assert.equal(prepared.protectedFingerprint(),protectedBefore);assert.deepEqual(catalog(),originalCatalog);
        assert.equal(lookup.lookupProtectedFingerprint(),lookupProtectedBefore);
        assert.deepEqual(prepared.initialPasswordReadCalls,[]);assert.deepEqual(prepared.initialPasswordErrors,[]);
        assert.deepEqual(prepared.errors,[]);assert.deepEqual(transport.errors,[]);assert.deepEqual(lookup.lookupErrors,[]);
        assert(!transport.calls.some(row=>row.kind==='identity'),'default_route_must_not_select_registry');
      };
      const unchanged=()=>{
        assert.deepEqual(prepared.facts(),initial);assert.deepEqual(model.proof(),authBefore);
        assert.deepEqual(prepared.initialPasswordRpcCalls,[]);assert.deepEqual(prepared.rpcCalls,[]);
        safe();
      };
      const command={siteId:prepared.site,invitationToken:invite.token,invitationVersion:invite.version,
        newPassword:'Synthetic-new-employee-only!2026',operationId:randomUUID()};
      const rpc=(name,args)=>name===lookupName?lookup.lookupRpc(name,args):prepared.initialPasswordRpc(name,args);
      await withAttendanceApplicationAuth([invite.actor],rpc,async protocol=>{
        const protocolFetch=globalThis.fetch,bridge=createInitialPasswordAdminBridge(protocolFetch,invite.actor,model);
        globalThis.fetch=bridge.fetch;
        try{
          const token=protocol.issue(invite.actor,['invite']);
          const call=async(body=command,session=token,requestOrigin=origin)=>{
            const readStart=transport.calls.length,protocolStart=protocol.calls.length,setupStart=prepared.initialPasswordRpcCalls.length,adminStart=bridge.calls.length;
            const response=await POST(new Request(origin+endpoint,{method:'POST',
              headers:{origin:requestOrigin,'content-type':'application/json',...(session?{'x-merchant-access-token':session}:{})},body:JSON.stringify(body)}));
            assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
            return {status:response.status,body:await response.json(),reads:transport.calls.slice(readStart),
              protocolCalls:protocol.calls.slice(protocolStart),setupCalls:prepared.initialPasswordRpcCalls.slice(setupStart),adminCalls:bridge.calls.slice(adminStart)};
          };
          phase='origin-and-session';
          const crossOrigin=await call(command,token,'https://untrusted.example.test');
          assert.equal(crossOrigin.status,403);assert.equal(crossOrigin.body.error,'forbidden_origin');
          assert.deepEqual(crossOrigin.reads,[]);assert.deepEqual(crossOrigin.protocolCalls,[]);
          const unauthenticated=await call(command,null);assert.equal(unauthenticated.status,401);
          assert.deepEqual(unauthenticated.reads,[]);unchanged();
          native.pass('actual default POST rejects foreign origin and absent session before database reads or any setup/Auth mutation');
          phase='wrong-invitation';
          const wrong=await call({...command,invitationToken:randomBytes(32).toString('base64url')});
          assert.equal(wrong.status,410);assert.equal(wrong.body.error,'employee_invitation_invalid_or_expired');
          assert.deepEqual(wrong.reads,[{kind:'invitation',status:200,error:null}]);unchanged();
          native.pass('installed SDK executes the default invitation GET as service_role; a mismatched invitation returns 410 without reaching registry or Auth admin');
          phase='missing-registry';
          await lookup.withMissingRegistry(invite.actor,async()=>{
            const missing=await call();assert.equal(missing.status,410);assert.equal(missing.body.error,'employee_invitation_invalid_or_expired');
            assert.deepEqual(missing.setupCalls,[]);assert.deepEqual(missing.adminCalls,[]);
            assert.equal(lookup.lookupCalls.at(-1).source,'auth_recovery');
            assert.deepEqual(prepared.facts(),initial);assert.deepEqual(model.proof(),authBefore);
          });unchanged();
          native.pass('original lookup Auth-recovery branch is rejected before claim/password update; the complete synthetic registry row is restored unchanged');
          phase='default-first-setup';if(lostReply)model.loseNextUpdateReply();
          const first=await call();
          const normalReads=[{kind:'invitation',status:200,error:null},{kind:'role',status:200,error:null},
            {kind:'invitation',status:200,error:null},{kind:'role',status:200,error:null}];
          assert.deepEqual(first.reads,normalReads);assert.equal(lookup.lookupCalls.at(-1).source,'registry');
          assert.deepEqual(first.adminCalls,[{method:'GET',status:200},{method:'PUT',status:lostReply?503:200}]);
          if(lostReply){
            assert.equal(first.status,503);assert.equal(first.body.error,'employee_initial_password_setup_failed');
            assert.deepEqual(first.setupCalls.map(row=>row.name),['faolla_claim_merchant_employee_initial_password_setup_v1']);
            const pending=prepared.facts();assert.deepEqual(pending.employees,initial.employees);assert.deepEqual(pending.audits,initial.audits);
            assert.equal(pending.setups.length,1);assert.equal(pending.setups[0].state,'claimed');assert.equal(model.proof().updates,1);
            phase='recover-auth-commit';const recovered=await call();assert.equal(recovered.status,200);assert.deepEqual(recovered.body,{ok:true});
            assert.deepEqual(recovered.adminCalls,[{method:'GET',status:200}]);
            assert.deepEqual(recovered.setupCalls.map(row=>row.name),['faolla_claim_merchant_employee_initial_password_setup_v1','faolla_complete_merchant_employee_initial_password_setup_v1']);
          }else{
            assert.equal(first.status,200);assert.deepEqual(first.body,{ok:true});
            assert.deepEqual(first.setupCalls.map(row=>row.name),['faolla_claim_merchant_employee_initial_password_setup_v1','faolla_complete_merchant_employee_initial_password_setup_v1']);
          }
          const completed=prepared.facts();assertInitialPasswordDefaultCompleted({before:initial,after:completed,invite,command,auth:model.proof()});safe();
          assert(model.passwordMatches(command.newPassword));assert(!model.passwordMatches(command.newPassword+'x'));
          native.pass(lostReply?'default SDK path recovers a committed-but-lost Auth PUT using the same claim; exactly one password update and one completed setup':
            'actual default POST completes through original lookup/claim/complete SQL and installed Auth Admin SDK, with exactly one modeled password update');
          phase='completed-replay';const replay=await call();assert.equal(replay.status,200);assert.deepEqual(replay.body,{ok:true});
          assert.deepEqual(replay.adminCalls,[{method:'GET',status:200}]);
          assert.deepEqual(replay.setupCalls.map(row=>row.name),['faolla_claim_merchant_employee_initial_password_setup_v1']);
          assert.deepEqual(prepared.facts(),completed);assert.equal(model.proof().updates,1);safe();
          phase='changed-password-replay';const conflict=await call({...command,newPassword:command.newPassword+'x'});
          assert.equal(conflict.status,409);assert.equal(conflict.body.error,'employee_password_state_unknown');
          assert.deepEqual(conflict.setupCalls,[{name:'faolla_claim_merchant_employee_initial_password_setup_v1',error:'employee_initial_password_not_required'}]);
          assert.deepEqual(conflict.adminCalls,[]);assert.deepEqual(prepared.facts(),completed);
          assert(model.passwordMatches(command.newPassword));
          assert.equal(model.proof().updates,1);assert.deepEqual(bridge.errors,[]);safe();
          native.pass('completed default request replay returns 200 without another PUT; changed password under the same operation is rejected without mutating facts');
          console.log(JSON.stringify({initialPasswordDefaultRepair:true,lostReply,defaultSetupSuccess:true,defaultExportedPost:true,installedSdk:true,
            serviceRoleSql:true,routeDependencyInjection:false,defaultRestQueries:true,
            syntheticAuthProtocol:true,realPostgrestService:false,realAuthService:false,realBrowser:false,realEmail:false,
            passwordUpdates:1,completedSetups:1,identitySelectGranted:false,productionAccess:false,externalRequests:0}));
        }finally{globalThis.fetch=protocolFetch;}
      },undefined,transport.read);
      safe();
    }catch(error){
      // Never print a request, raw assertion, SQL statement or private Auth data.
      const sourceLine=Number(String(error?.stack??'').match(/initial-password-default-native\.mjs:(\d+):/)?.[1]??0);
      console.error(JSON.stringify({initialPasswordDefaultDiagnosticFailed:true,phase,sourceLine}));
      throw Error('initial_password_default_local_diagnosis_failed');
    }
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),async native=>{
    await checkInitialPasswordDefaultNative(native);await checkInitialPasswordDefaultNative(native,{lostReply:true});
  }).catch(()=>{
    console.error('initial_password_default_native_diagnosis_failed');process.exitCode=1;
  });
}
