//196 inert runner. Reuse the explicitly named stopped synthetic PG15 cluster.
//193 completes its164 reapply BEFORE166; no cluster/database copy or old hook.
//Usage: node --import tsx scripts/merchant-attendance-employment-lifecycle-native.mjs --run-local --directory <existing-stopped-directory> [--with-browser]
//The inherited fixtures import TypeScript services with extensionless imports;
//the tsx loader is required before module evaluation, including no-browser runs.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runApplicationDelegationNative} from './merchant-attendance-application-delegation-native.mjs';
import {prepareAttendanceEmployeeManagement} from './merchant-attendance-employee-management-fixture.mjs';
import {verifyAccountSuspensionNative} from './fixtures/attendance-account-suspension-native.mjs';
import {verifyEmploymentLifecycleNative} from './fixtures/attendance-employment-lifecycle-native.mjs';

export async function runEmploymentLifecycleNative(args,browserCheck=null){
  return runApplicationDelegationNative(args,null,async context=>{
    const enterprise=await prepareAttendanceEmployeeManagement(context.native,context.scope);
    const prepared={...context,enterprise};
    // Its final164 reinstall must not overwrite166's narrowly adapted readers.
    const prior193=await verifyAccountSuspensionNative(prepared);
    const employment=await verifyEmploymentLifecycleNative(prepared,browserCheck);
    return {prior193,employment};
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),withBrowser=args.includes('--with-browser');
  const browserCheck=withBrowser?(await import('./fixtures/attendance-employment-lifecycle-browser.mjs')).runEmploymentLifecycleBrowserAcceptance:null;
  runEmploymentLifecycleNative(args.filter(x=>x!=='--with-browser'),browserCheck)
    .then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(JSON.stringify({error:'employment_lifecycle_native_failed',detail:String(error).slice(0,24000)}));process.exitCode=1;});
}
