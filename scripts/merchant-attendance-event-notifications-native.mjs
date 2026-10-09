//200 imports are inert. Reuse the one explicitly selected owned local cluster.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runScheduleDelegationNative} from './merchant-attendance-schedule-delegation-native.mjs';
import {verifyEventNotificationsNative} from './fixtures/attendance-event-notifications-native.mjs';
export async function runEventNotificationsNative(args,browserCheck=null){
  let eventNotifications;
  const prior=await runScheduleDelegationNative(args,async context=>{
    eventNotifications=await verifyEventNotificationsNative(context,browserCheck);
    return {eventNotifications};
  });
  return {prior,eventNotifications,production:false,deployed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),withBrowser=args.includes('--with-browser');
  const browserCheck=withBrowser?(await import('./fixtures/attendance-event-notifications-browser.mjs')).runEventNotificationsBrowserAcceptance:null;
  runEventNotificationsNative(args.filter(a=>a!=='--with-browser'),browserCheck).then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(JSON.stringify({error:'event_notifications_native_failed',detail:String(error).slice(0,24000)}));process.exitCode=1;});
}
