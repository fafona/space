//198 inert runner: reuse the explicitly selected stopped synthetic cluster.
//Usage: node --import tsx scripts/merchant-attendance-schedule-delegation-native.mjs --run-local --directory <existing-stopped-directory> [--with-browser]
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runApplicationDelegationNative} from './merchant-attendance-application-delegation-native.mjs';
import {prepareAttendanceEmployeeManagement} from './merchant-attendance-employee-management-fixture.mjs';
import {verifyAccountSuspensionNative} from './fixtures/attendance-account-suspension-native.mjs';
import {verifyEmploymentLifecycleNative} from './fixtures/attendance-employment-lifecycle-native.mjs';
import {verifyScheduleDelegationNative} from './fixtures/attendance-schedule-delegation-native.mjs';
export async function runScheduleDelegationNative(args,browserCheck=null){
  return runApplicationDelegationNative(args,null,async context=>{
    const enterprise=await prepareAttendanceEmployeeManagement(context.native,context.scope),prepared={...context,enterprise};
    const prior193=await verifyAccountSuspensionNative(prepared);
    const prior196=await verifyEmploymentLifecycleNative(prepared);
    const scheduleDelegation=await verifyScheduleDelegationNative(prepared,browserCheck);
    return {prior193,prior196,scheduleDelegation};
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),withBrowser=args.includes('--with-browser');
  const browserCheck=withBrowser?(await import('./fixtures/attendance-schedule-delegation-browser.mjs')).runScheduleDelegationBrowserAcceptance:null;
  runScheduleDelegationNative(args.filter(x=>x!=='--with-browser'),browserCheck).then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(JSON.stringify({error:'schedule_delegation_native_failed',detail:String(error).slice(0,24000)}));process.exitCode=1;});
}
