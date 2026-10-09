// Opt-in, same-document identity acceptance. Reuses the existing in-memory
// enterprise harness and ownership-checked local PG; no production connection.
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {checkAttendanceLeaveShellBrowser} from './merchant-attendance-leave-shell-browser-check.mjs';
import {checkAttendanceLeaveAccountSwitch} from './merchant-attendance-leave-account-switch-checks.mjs';

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>
    checkAttendanceLeaveShellBrowser(native,scope,{accountSwitchCheck:checkAttendanceLeaveAccountSwitch})))
    .catch(()=>{console.error('leave_account_switch_browser_failed');process.exitCode=1;});
}
