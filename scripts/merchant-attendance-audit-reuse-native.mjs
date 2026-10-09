import {runAttendanceLabelsReuse} from "./merchant-attendance-choice-labels-reuse-native.mjs";
import {checkAttendanceAuditNative} from "./merchant-attendance-audit-native-checks.mjs";
await runAttendanceLabelsReuse(process.argv.slice(2),checkAttendanceAuditNative)
  .catch(error=>{console.error(error);process.exitCode=1;});
