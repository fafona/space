import {runAttendanceLabelsReuse} from "./merchant-attendance-choice-labels-reuse-native.mjs";
import {checkAttendanceSessionNative} from "./merchant-attendance-session-native-checks.mjs";
await runAttendanceLabelsReuse(process.argv.slice(2),checkAttendanceSessionNative)
  .catch(error=>{console.error(error);process.exitCode=1;});
