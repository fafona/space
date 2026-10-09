// Local onboarding -> owner attendance enrollment -> first web punch contract.
// Actual handlers/resolvers/executors/service-role SQL; modeled Auth and explicit
// synthetic platform entitlement. No browser, real email/phone or production.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareAttendanceOnboardingFixture} from './merchant-attendance-onboarding-fixture.mjs';
import {createInitialPasswordAuthModel} from './merchant-attendance-initial-password-native.mjs';
import {createInitialPasswordAuthBridge} from './merchant-attendance-initial-password-auth-bridge.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createMerchantEnterpriseInitialPasswordHandler}=require('../src/app/api/merchant-enterprise/invitations/initial-password/route-handler.ts');
const {resolveValidatedMerchantEnterpriseAuthUser,requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {POST:accept}=require('../src/app/api/merchant-enterprise/employees/accept/route-handler.ts');
const {PATCH:updateRole}=require('../src/app/api/merchant-enterprise/roles/route-handler.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {handleAttendanceSelf}=require('../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
const origin='https://www.faolla.com',authOrigin='https://attendance-auth.invalid',site='99990001';
const password='Synthetic-new-staff-only!2026',ownerPassword='Synthetic-attendance-only!';
const api='/api/merchant-enterprise/',roleId='00000000-0000-4000-8000-000000000030';
const locationId='00000000-0000-4000-8000-000000000301',workerId='00000000-0000-4000-8000-000000000201';
const viewOnly=['enterprise.view','attendance.self.view'],clockPermissions=[...viewOnly,'attendance.self.clock'];

export function assertOnboardingEnrollment({before,after,employeeId,worker,receipt,operationId,ownerId}){
  assert.equal(before.workers.length,0);assert.equal(before.periods.length,0);
  assert.equal(after.workers.length,1);assert.equal(after.periods.length,1);assert.equal(after.events.length,0);
  const row=after.workers[0],period=after.periods[0];
  assert.equal(row.id,worker.id);assert.equal(row.employee_id,employeeId);assert.equal(row.merchant_id,site);
  assert.equal(row.worker_no,worker.workerNo);assert.equal(row.default_location_id,worker.locationId);assert.equal(row.active,true);
  assert.equal(row.display_name,worker.displayName);
  assert.equal(period.worker_id,worker.id);assert.equal(period.merchant_id,site);assert.equal(period.starts_on,worker.startsOn);assert.equal(period.ends_on,null);
  assert.equal(receipt.kind,'worker');assert.equal(receipt.targetId,worker.id);
  assert.equal(after.configOperations.length,before.configOperations.length+1);
  assert.equal(before.settings.length,1);assert.equal(after.settings.length,1);assert.equal(after.settings[0].version,before.settings[0].version+1);
  assert.deepEqual({...after.settings[0],version:before.settings[0].version,updated_at:before.settings[0].updated_at},before.settings[0]);
  const added=after.configOperations.filter(row=>!before.configOperations.some(old=>old.operation_id===row.operation_id));assert.equal(added.length,1);
  const operation=added[0];assert.equal(operation.operation_id,operationId);assert.equal(operation.actor_auth_user_id,ownerId);assert.equal(operation.merchant_id,site);
  assert.equal(operation.version,after.settings[0].version);assert.equal(receipt.operationId,operationId);assert.equal(receipt.version,operation.version);
  assert.deepEqual(operation.command,{operationId,expectedVersion:before.settings[0].version,kind:'worker',values:worker});
  assert.equal(operation.before_value,null);assert.deepEqual(operation.after_value,worker);
  assert.deepEqual({...after,workers:before.workers,periods:before.periods,configOperations:before.configOperations,settings:before.settings},before);
  assert.equal(after.enterprise.employees.find(row=>row.id===employeeId).status,'active');
  for(const row of before.configOperations)assert.deepEqual(after.configOperations.find(next=>next.operation_id===row.operation_id),row);
}

export function assertOnboardingFirstPunch({before,after,body,employeeId,operationId}){
  assert.equal(before.events.length,0);assert.equal(after.events.length,1);
  assert.deepEqual({...after,events:before.events},before,'onboarding_punch_changed_configuration_or_membership');
  const event=after.events[0];assert.equal(event.merchant_id,site);assert.equal(event.worker_id,workerId);
  assert.equal(event.actor_employee_id,employeeId);assert.equal(event.location_id,locationId);assert.equal(event.operation_id,operationId);
  assert.equal(event.action,'clock_in');assert.equal(event.source,'web');assert.equal(event.sequence,1);assert.equal(event.time_zone,'Europe/Madrid');
  assert.equal(body.ok,true);assert.equal(body.workerId,workerId);assert.equal(body.locationId,locationId);assert.equal(body.replayed,false);
  assert.equal(body.state.status,'working');assert.equal(body.state.sequence,1);assert.equal(body.receipt.id,event.id);
  assert.equal(body.receipt.operationId,operationId);assert.equal(body.receipt.action,'clock_in');assert.deepEqual(body.state.lastEvent,body.receipt);
  assert.equal(body.receipt.siteId,event.merchant_id);assert.equal(body.receipt.workerId,event.worker_id);assert.equal(body.receipt.locationId,event.location_id);
  assert.equal(body.receipt.sequence,event.sequence);assert.equal(body.receipt.timeZone,event.time_zone);assert.equal(body.receipt.breakPaid,event.break_paid);
  assert(Number.isFinite(Date.parse(event.occurred_at)));assert.equal(Date.parse(body.receipt.occurredAt),Date.parse(event.occurred_at));
}

export async function checkAttendanceOnboarding(native){
  await withAttendanceConcurrencySandbox(native,async scope=>{
    const prepared=await prepareAttendanceOnboardingFixture(native,scope),invite=prepared.invitations[1],owner=prepared.owner;
    const initial=prepared.onboardingFacts(),protectedBefore=prepared.onboardingProtectedFingerprint(),model=createInitialPasswordAuthModel(invite.actor);
    const safe=()=>assert.equal(prepared.onboardingProtectedFingerprint(),protectedBefore,'onboarding_unrelated_facts_changed');
    const requests=[];let phase='auth-start',moduleEnabled=true;
    const savedMode=process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE='off';
    try{
      await withAttendanceApplicationAuth(prepared.onboardingActors,prepared.onboardingRpc,async protocol=>{
        const ownerToken=await protocol.login(owner),protocolFetch=globalThis.fetch;
        const bridge=createInitialPasswordAuthBridge(protocolFetch,invite.actor,model);
        // The exact owner token still goes through original JWT validation. The
        // employee bridge is not widened to accept another user's metadata.
        globalThis.fetch=async(input,init)=>{
          const request=new Request(input,init),url=new URL(request.url);
          if(url.origin===authOrigin&&url.pathname==='/auth/v1/user'&&request.method==='GET'
            &&request.headers.get('authorization')==='Bearer '+ownerToken)return protocolFetch(request);
          return bridge.fetch(request);
        };
        const sdk=createClient(authOrigin,'attendance-synthetic-anon',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
        try{
          const entitlement=value=>requireMerchantEnterpriseEntitlement(value,async()=>[{id:site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}}]);
          const handlers={admin:request=>handleAttendanceAdmin(request,{entitlement}),self:request=>handleAttendanceSelf(request,{entitlement}),role:updateRole,accept};
          const paths={admin:'attendance/admin',self:'attendance/self',role:'roles',accept:'employees/accept',setup:'invitations/initial-password'};
          const call=async(kind,token,{body,query={},method=body?'POST':'GET'}={})=>{
            const request=new Request(origin+api+paths[kind]+(body?'':'?'+new URLSearchParams({siteId:site,...query})),{
              method,headers:{origin,'content-type':'application/json','x-merchant-access-token':token},body:body?JSON.stringify(body):undefined});
            const response=await handlers[kind](request),result=await response.json();
            requests.push({kind,method,status:response.status,error:result.error??null});
            if(kind!=='role'&&kind!=='accept')assert.match(response.headers.get('cache-control'),/no-store/);
            return {status:response.status,body:result};
          };
          const success=async(...args)=>{const result=await call(...args);assert.equal(result.status,200);assert.equal(result.body.ok,true);safe();return result.body;};
          const reject=async(kind,token,options,status,error)=>{
            const before=prepared.onboardingFacts(),result=await call(kind,token,options);
            assert.equal(result.status,status);assert.equal(result.body.error,error);assert.deepEqual(prepared.onboardingFacts(),before);safe();return result;
          };
          const adminBody=async(kind,values)=>({siteId:site,operationId:randomUUID(),expectedVersion:(await success('admin',ownerToken)).version,kind,values});
          const settings={timeZone:'Europe/Madrid',enabled:true,webClockEnabled:false,webBreakPaid:false};
          const location={id:locationId,name:'合成新员工地点',timeZone:'Europe/Madrid',active:true};
          const worker={id:workerId,employeeId:invite.employeeId,workerNo:'ONBOARD-119',displayName:'合成新入职员工',locationId,active:true,startsOn:'2000-01-01'};
          const punch={siteId:site,expectedWorkerId:workerId,operationId:randomUUID(),locationId,action:'clock_in',expectedSequence:0};
          const invitationToken=protocol.issue(invite.actor,['invite']);
          phase='empty-read-and-invite-session';
          const empty=await success('admin',ownerToken),choices=await success('admin',ownerToken,{query:{view:'employees'}});
          assert.equal(empty.version,0);assert.equal(empty.settings,null);assert.deepEqual(choices.items,[]);assert.deepEqual(prepared.onboardingFacts(),initial);
          const preLogin=await sdk.auth.signInWithPassword({email:invite.actor.email,password});assert.equal(preLogin.error?.status,400);
          await reject('self',invitationToken,{body:punch},403,'employee_password_authentication_required');
          native.pass('new invited employee has no active membership, attendance configuration or worker; owner reads are write-free, modeled new-password login fails before setup and invite-only session cannot punch');

          phase='explicit-owner-preparation';
          const settingsCommand=await adminBody('settings',settings);await success('admin',ownerToken,{body:settingsCommand});
          const locationCommand=await adminBody('location',location);await success('admin',ownerToken,{body:locationCommand});
          await reject('admin',ownerToken,{body:await adminBody('worker',worker)},409,'attendance_employee_invalid');
          const beforeSetup=prepared.onboardingFacts();assert.equal(beforeSetup.configOperations.length,2);assert.equal(beforeSetup.workers.length,0);assert.equal(beforeSetup.events.length,0);
          native.pass('actual owner admin handler/SQL explicitly initializes enabled attendance with web punching off and creates a location; enrolling a still-invited member is rejected without activation or audit');

          phase='password-setup-before-membership';
          const setupCall=kind=>input=>prepared.initialPasswordRpc(`faolla_${kind}_merchant_employee_initial_password_setup_v1`,{p_input:{
            merchant_id:input.siteId,auth_user_id:input.authUserId,invitation_version:input.invitationVersion,token_hash:input.tokenHash,operation_id:input.operationId,password_fingerprint:input.passwordFingerprint}});
          handlers.setup=createMerchantEnterpriseInitialPasswordHandler({resolveAuthUser:resolveValidatedMerchantEnterpriseAuthUser,
            loadInvitation:prepared.loadInvitation,loadRole:prepared.loadRole,loadStaffIdentity:prepared.loadStaffIdentity,
            getAuthUserById:model.getAuthUserById,updateAuthUserById:model.updateAuthUserById,
            claimInitialPasswordSetup:setupCall('claim'),completeInitialPasswordSetup:setupCall('complete'),releaseInitialPasswordSetup:setupCall('release'),now:()=>new Date()});
          await success('setup',invitationToken,{body:{siteId:site,invitationVersion:invite.version,invitationToken:invite.token,newPassword:password,operationId:randomUUID()}});
          assert.equal(model.proof().updates,1);assert.equal(model.proof().initialized,true);
          const setupFacts=prepared.onboardingFacts();assert.equal(setupFacts.enterprise.setups.length,1);assert.equal(setupFacts.enterprise.setups[0].state,'completed');
          assert.equal(setupFacts.enterprise.employees.find(row=>row.id===invite.employeeId).status,'invited');assert.deepEqual(setupFacts.enterprise.audits,beforeSetup.enterprise.audits);
          const signedIn=await sdk.auth.signInWithPassword({email:invite.actor.email,password});assert.equal(signedIn.error,null);
          const employeeToken=signedIn.data.session?.access_token;assert(employeeToken);assert.equal(signedIn.data.user.id,invite.actor.id);
          await reject('self',employeeToken,{body:punch},403,'attendance_access_denied');
          native.pass('actual setup completes once and installed SDK logs in with that modeled new password; a password session alone still cannot punch before real invitation acceptance');

          phase='accepted-without-attendance-permission';
          const accepted=await success('accept',employeeToken,{body:{siteId:site,invitationVersion:invite.version,invitationToken:invite.token}});
          assert.equal(accepted.employee.id,invite.employeeId);assert.equal(accepted.alreadyActive,false);
          const acceptedFacts=prepared.onboardingFacts();assert.equal(acceptedFacts.enterprise.audits.length,setupFacts.enterprise.audits.length+1);
          const acceptanceAudit=acceptedFacts.enterprise.audits.filter(row=>!setupFacts.enterprise.audits.some(old=>old.id===row.id));
          assert.equal(acceptanceAudit.length,1);assert.equal(acceptanceAudit[0].event_type,'invitation.accepted');assert.equal(acceptanceAudit[0].entity_id,invite.employeeId);
          for(const row of setupFacts.enterprise.audits)assert.deepEqual(acceptedFacts.enterprise.audits.find(next=>next.id===row.id),row);
          assert.deepEqual(acceptedFacts.enterprise.setups,setupFacts.enterprise.setups);assert.equal(acceptedFacts.workers.length,0);
          const activeChoices=await success('admin',ownerToken,{query:{view:'employees'}});assert.deepEqual(activeChoices.items.map(row=>row.id),[invite.employeeId]);
          await reject('self',employeeToken,{},403,'attendance_access_denied');
          await reject('admin',employeeToken,{},403,'attendance_access_denied');
          native.pass('real acceptance creates one active member/audit and makes that member selectable for enrollment, but does not automatically grant attendance permission or owner configuration access');

          const patchRole=async permissions=>{
            const before=prepared.onboardingFacts(),role=before.roles.find(row=>row.id===roleId);
            await success('role',ownerToken,{method:'PATCH',body:{siteId:site,roleId,version:role.version,permissions}});
            const after=prepared.onboardingFacts(),updated=after.roles.find(row=>row.id===roleId);
            assert.deepEqual([...updated.permissions].sort(),[...permissions].sort());assert.equal(updated.version,role.version+1);
            assert.equal(after.enterprise.audits.length,before.enterprise.audits.length+1);
            const additions=after.enterprise.audits.filter(row=>!before.enterprise.audits.some(old=>old.id===row.id));
            assert.equal(additions[0].event_type,'role.updated');assert.equal(additions[0].entity_id,roleId);assert.equal(additions[0].actor_type,'owner');
            assert.deepEqual({...after,roles:before.roles,enterprise:{...after.enterprise,audits:before.enterprise.audits}},before);
            for(const row of before.roles.filter(row=>row.id!==roleId))assert.deepEqual(after.roles.find(next=>next.id===row.id),row);
            for(const row of before.enterprise.audits)assert.deepEqual(after.enterprise.audits.find(next=>next.id===row.id),row);
          };
          phase='view-permission-without-worker';await patchRole(viewOnly);
          await reject('self',employeeToken,{},403,'attendance_access_denied');
          native.pass('actual role PATCH grants self-view with a real role audit; the active member still cannot read attendance before the owner creates its worker/employment binding');

          phase='worker-enrollment';
          const workerCommand=await adminBody('worker',worker),beforeEnrollment=prepared.onboardingFacts();
          const enrolled=await success('admin',ownerToken,{body:workerCommand});
          const afterEnrollment=prepared.onboardingFacts();assertOnboardingEnrollment({before:beforeEnrollment,after:afterEnrollment,employeeId:invite.employeeId,worker,receipt:enrolled.receipt,operationId:workerCommand.operationId,ownerId:owner.id});
          assert.deepEqual((await success('admin',ownerToken,{body:workerCommand})).receipt,enrolled.receipt);assert.deepEqual(prepared.onboardingFacts(),afterEnrollment);
          assert.deepEqual((await success('admin',ownerToken,{query:{operationId:workerCommand.operationId}})).receipt,enrolled.receipt);assert.deepEqual(prepared.onboardingFacts(),afterEnrollment);
          await reject('admin',ownerToken,{body:{...workerCommand,values:{...worker,displayName:'Changed synthetic intent'}}},409,'attendance_operation_conflict');
          assert.deepEqual((await success('admin',ownerToken,{query:{view:'employees'}})).items,[]);
          native.pass('owner enrollment through actual admin handler/SQL creates exactly one worker and employment period; original command/receipt recovery is idempotent and changed intent with the same operation is rejected');

          phase='view-only-read-without-clock';
          const idle=await success('self',employeeToken);assert.equal(idle.workerId,workerId);assert.equal(idle.state.status,'off');assert.equal(idle.state.sequence,0);assert.equal(idle.receipt,null);
          await reject('self',employeeToken,{body:punch},403,'attendance_access_denied');
          native.pass('the enrolled view-only employee can read its own off/sequence-zero state but cannot create a punch');

          phase='clock-permission-web-and-platform-gates';await patchRole(clockPermissions);
          await reject('self',employeeToken,{body:punch},403,'attendance_web_disabled');
          const enableWeb=await adminBody('settings',{...settings,webClockEnabled:true});await success('admin',ownerToken,{body:enableWeb});
          moduleEnabled=false;await reject('self',employeeToken,{body:punch},403,'attendance_platform_paused');moduleEnabled=true;
          await reject('self',employeeToken,{body:{...punch,expectedWorkerId:'00000000-0000-4000-8000-000000000202'}},409,'attendance_worker_changed');
          native.pass('self-clock permission alone does not bypass web-clock disable or synthetic platform pause; a supplied foreign worker ID cannot redirect the authenticated member');

          phase='first-clock-and-recovery';const beforePunch=prepared.onboardingFacts(),first=await success('self',employeeToken,{body:punch});
          const afterPunch=prepared.onboardingFacts();assertOnboardingFirstPunch({before:beforePunch,after:afterPunch,body:first,employeeId:invite.employeeId,operationId:punch.operationId});
          // API-level response-loss model only: no browser network abort or
          // client pending-storage behavior is claimed by this native check.
          const recovered=await success('self',employeeToken,{query:{operationId:punch.operationId}});assert.deepEqual(recovered.receipt,first.receipt);assert.equal(recovered.replayed,false);
          const replayed=await success('self',employeeToken,{body:punch});assert.deepEqual(replayed.receipt,first.receipt);assert.equal(replayed.replayed,true);
          await reject('self',employeeToken,{body:{...punch,action:'clock_out'}},409,'attendance_operation_conflict');
          assert.deepEqual(prepared.onboardingFacts(),afterPunch);
          native.pass('the new member first punches through real auth/handler/executor/service-role SQL exactly once; original receipt GET and explicit same-body POST recover it, while changed action under the same operation is rejected');

          phase='final-proof';
          const final=prepared.onboardingFacts();assert.equal(final.events.length,1);assert.equal(final.workers.length,1);assert.equal(final.periods.length,1);assert.equal(final.configOperations.length,4);
          assert.equal(final.enterprise.audits.length,initial.enterprise.audits.length+3);
          const newAudits=final.enterprise.audits.filter(row=>!initial.enterprise.audits.some(old=>old.id===row.id));
          assert.equal(newAudits.length,3);assert.equal(newAudits.filter(row=>row.event_type==='role.updated').length,2);
          assert.equal(newAudits.filter(row=>row.event_type==='invitation.accepted').length,1);
          for(const row of initial.enterprise.audits)assert.deepEqual(final.enterprise.audits.find(next=>next.id===row.id),row);
          assert.deepEqual(final.enterprise.employees,acceptedFacts.enterprise.employees);assert.deepEqual(final.enterprise.setups,acceptedFacts.enterprise.setups);
          for(const row of initial.enterprise.employees.filter(row=>row.id!==invite.employeeId))assert.deepEqual(final.enterprise.employees.find(next=>next.id===row.id),row);
          for(const row of initial.roles.filter(row=>row.id!==roleId))assert.deepEqual(final.roles.find(next=>next.id===row.id),row);
          assert.equal(model.proof().updates,1);assert.equal(bridge.proof().passwordAccepted,1);safe();
          assert.deepEqual(prepared.onboardingErrors,[]);assert.deepEqual(prepared.initialPasswordErrors,[]);assert.deepEqual(prepared.errors,[]);
          console.log(JSON.stringify({attendanceOnboarding:true,realPasswordSetupHandler:true,realAcceptance:true,realOwnerRolePatch:true,realOwnerAdmin:true,realFirstSelfPunch:true,
            passwordMutationCalls:1,workerRows:1,employmentPeriods:1,punchEvents:1,configReceipts:4,acceptanceAudits:1,roleAudits:2,
            sharedModeledAuth:true,syntheticPlatformEntitlement:true,injectedSetupReads:true,defaultAttendanceExecutors:true,
            realBrowser:false,realAuthService:false,realEmail:false,realPhone:false,productionAccess:false,externalRequests:0}));
        }finally{sdk.auth.stopAutoRefresh();globalThis.fetch=protocolFetch;}
      },undefined,prepared.onboardingRead,(actor,value)=>actor.id===owner.id?value===ownerPassword:actor.id===invite.actor.id&&model.proof().initialized&&model.passwordMatches(value));
    }catch(error){
      const sourceLine=String(error?.stack??'').match(/merchant-attendance-onboarding-native\.mjs:(\d+):\d+/)?.[1]??null;
      console.error(JSON.stringify({attendanceOnboardingFailed:true,phase,sourceLine,requests}));throw Error('attendance_onboarding_local_check_failed');
    }finally{if(savedMode===undefined)delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE=savedMode;}
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),checkAttendanceOnboarding).catch(()=>{console.error('attendance_onboarding_native_failed');process.exitCode=1;});
}
