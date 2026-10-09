//208 optional actual-UI and deterministic competing-writer acceptance. All
//database lifecycle and schema ownership remain in the existing207 driver.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPlanPosthocReviewNative} from './merchant-attendance-plan-posthoc-review-native.mjs';

export async function runPlanPosthocAcceptanceNative(args,{browserCheck=null,concurrencyCheck=null,fullLeaveBrowserCheck=null}={}){
  for(const check of [browserCheck,concurrencyCheck,fullLeaveBrowserCheck])assert(check===null||typeof check==='function');
  assert(browserCheck||concurrencyCheck||fullLeaveBrowserCheck,'posthoc_acceptance_check_required');
  return runPlanPosthocReviewNative(args,async ctx=>{
    const browser=browserCheck?await browserCheck(ctx):null;
    const concurrency=concurrencyCheck?await concurrencyCheck(ctx):null;
    return {phase:208,browser,concurrency,production:false,deployed:false,newCluster:false};
  },{onFullLeavePrepared:fullLeaveBrowserCheck});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),withBrowser=args.includes('--with-browser'),withConcurrency=args.includes('--with-concurrency'),withFullLeave=args.includes('--with-full-leave-browser');
  const checks=async()=>({
    browserCheck:withBrowser?(await import('./fixtures/attendance-plan-posthoc-browser-acceptance.mjs')).verifyPlanPosthocBrowserAcceptance:null,
    concurrencyCheck:withConcurrency?(await import('./fixtures/attendance-plan-posthoc-concurrency-native.mjs')).verifyPlanPosthocConcurrencyNative:null,
    fullLeaveBrowserCheck:withFullLeave?(await import('./fixtures/attendance-plan-posthoc-full-leave-browser.mjs')).verifyPosthocFullLeaveBrowser:null,
  });
  checks().then(value=>runPlanPosthocAcceptanceNative(args.filter(v=>!['--with-browser','--with-concurrency','--with-full-leave-browser'].includes(v)),value))
    .then(value=>console.log(JSON.stringify(value)))
    .catch(error=>{console.error(JSON.stringify({error:'posthoc_acceptance_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
}
