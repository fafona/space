// 194 composes callbacks in the same existing owned PG15 sandbox. Import inert.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runApplicationDelegationNative} from './merchant-attendance-application-delegation-native.mjs';
import {prepareAttendanceEmployeeManagement} from './merchant-attendance-employee-management-fixture.mjs';
import {verifyAccountSuspensionNative} from './fixtures/attendance-account-suspension-native.mjs';

export async function runAccountStatusRecoveryNative(args){
  const {runAccountSuspensionBrowserAcceptance}=await import('./fixtures/attendance-account-suspension-browser.mjs');
  const {runDelegationRecoveryBrowserAcceptance}=await import('./fixtures/attendance-delegation-recovery-browser.mjs');
  const {runAccountStatusRecoveryBrowserAcceptance}=await import('./fixtures/attendance-account-status-recovery-browser.mjs');
  const {verifyAccountStatusRecoveryBoundaries}=await import('./fixtures/attendance-account-status-recovery-native.mjs');
  const {withAccountStatusRecoveryRestrictedRole}=await import('./fixtures/attendance-account-status-recovery-role.mjs');
  return runApplicationDelegationNative(args,null,async context=>{
    // The old191 fixture has no enterprise touch trigger. Test it in its own
    // original preparation, before installing the real enterprise chain.
    const prior191=await runDelegationRecoveryBrowserAcceptance(context);
    const enterprise=await prepareAttendanceEmployeeManagement(context.native,context.scope);
    return verifyAccountSuspensionNative({...context,enterprise},async ctx=>{
      const prior193=await runAccountSuspensionBrowserAcceptance(ctx);
      const {pending,...browser}=await runAccountStatusRecoveryBrowserAcceptance({...ctx,
        withRestrictedRole:callback=>withAccountStatusRecoveryRestrictedRole(ctx,callback)});
      const boundaries=await verifyAccountStatusRecoveryBoundaries(ctx,pending);
      // Never include persisted command bodies or credentials in the report.
      return {prior193,prior191,browser,boundaries};
    });
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAccountStatusRecoveryNative(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(JSON.stringify({error:'account_status_recovery_native_failed',detail:String(error).slice(0,24000)}));process.exitCode=1;});
}
