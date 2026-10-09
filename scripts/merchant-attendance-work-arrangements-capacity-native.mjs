//188 Targeted local evidence only. Reuse the guarded187 native lifecycle;
// no browser, dependency copy, full build, production or environment creation.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runWorkArrangementsNative} from './merchant-attendance-work-arrangements-native.mjs';
import {verifyWorkArrangementCapacityNative} from './fixtures/attendance-work-arrangements-capacity-native.mjs';

export const runWorkArrangementCapacityNative=args=>runWorkArrangementsNative(args,null,verifyWorkArrangementCapacityNative);
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runWorkArrangementCapacityNative(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value))).catch(error=>{
    console.error(JSON.stringify({error:'work_arrangement_capacity_native_failed',detail:String(error).slice(0,5000)}));process.exitCode=1;
  });
}
