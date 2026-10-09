// Static composition guard; not evidence of a database/browser run.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const driver=readFileSync(new URL('./merchant-attendance-account-status-recovery-native.mjs',import.meta.url),'utf8');
const ports=readFileSync(new URL('./fixtures/attendance-account-suspension-native.mjs',import.meta.url),'utf8');
test('194 composes new recovery and both old browser paths inside one existing owned runner',()=>{
  for(const text of ['return runApplicationDelegationNative(args,null,async context=>','await runAccountSuspensionBrowserAcceptance(ctx)',
    'await runDelegationRecoveryBrowserAcceptance(context)','await runAccountStatusRecoveryBrowserAcceptance({...ctx,',
    'prepareAttendanceEmployeeManagement(context.native,context.scope)','withAccountStatusRecoveryRestrictedRole(ctx,callback)',
    'await verifyAccountStatusRecoveryBoundaries(ctx,pending)','if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))'])assert(driver.includes(text),text);
  assert.doesNotMatch(driver,/\binitdb\b|\bcreatedb\b|writeFile|npm run build|listen\(/);
});
test('original manager token is not silently replaced by an owner token in 194 handler ports',()=>{
  const segment=ports.slice(ports.indexOf('const statusRecoveryPorts='),ports.indexOf('const result=await browserCheck'));
  for(const text of ['managerAuth:d.auth,managerToken,handleEmployee:PATCH,handleOverview:GET',
    'handleAccountSuspension(request,{entitlement,allow:()=>true})','handleMerchantEnterpriseCurrentOperationsGet(request,',
    'handleMerchantEnterpriseNotificationsGet(request,',"loadNotifications:async()=>{throw Error('enterprise_schema_unavailable');}"])assert(segment.includes(text),text);
  assert(!segment.includes('authenticated(request)'));
});
test('pending command body is consumed for SQL boundary verification but not emitted in summary',()=>{
  assert(driver.includes('const {pending,...browser}=await runAccountStatusRecoveryBrowserAcceptance({...ctx,'));
  assert(driver.includes('return {prior193,prior191,browser,boundaries}'));
  assert(!driver.includes('return {pending'));
});
