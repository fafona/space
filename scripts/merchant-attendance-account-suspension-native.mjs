//193 reuses the owned stopped PG15 cluster; no new cluster/database/copy/build.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runApplicationDelegationNative} from './merchant-attendance-application-delegation-native.mjs';
import {prepareAttendanceEmployeeManagement} from './merchant-attendance-employee-management-fixture.mjs';
import {verifyAccountSuspensionNative} from './fixtures/attendance-account-suspension-native.mjs';

export async function runAccountSuspensionNative(args,browserCheck=null){
  return runApplicationDelegationNative(args,null,async context=>{
    // Real011→017→019 functions/triggers copied exactly by the existing fixture;
    // no fake employee-update success, owner spoofing, or public-schema changes.
    const enterprise=await prepareAttendanceEmployeeManagement(context.native,context.scope);
    return verifyAccountSuspensionNative({...context,enterprise},browserCheck);
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),withBrowser=args.includes('--with-browser');
  const browserCheck=withBrowser?(await import('./fixtures/attendance-account-suspension-browser.mjs')).runAccountSuspensionBrowserAcceptance:null;
  runAccountSuspensionNative(args.filter(x=>x!=='--with-browser'),browserCheck)
    .then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(JSON.stringify({error:'account_suspension_native_failed',detail:String(error).slice(0,22000)}));process.exitCode=1;});
}
