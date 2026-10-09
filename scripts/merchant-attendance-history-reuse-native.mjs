import {runAttendanceLabelsReuse} from "./merchant-attendance-choice-labels-reuse-native.mjs";
import {checkAttendanceHistoryNative} from "./merchant-attendance-history-native-checks.mjs";
await runAttendanceLabelsReuse(process.argv.slice(2),checkAttendanceHistoryNative).catch(error=>{console.error(error);process.exitCode=1;});
