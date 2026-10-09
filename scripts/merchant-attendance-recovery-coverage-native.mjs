//226 one extension of the225 owned dump/restore lifecycle, not another cluster.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceRecoveryNative} from './merchant-attendance-recovery-native.mjs';
import {prepareAttendanceRecoveryCoverage} from './fixtures/attendance-recovery-coverage-native.mjs';
import {prepareAttendanceRecoverySecurity} from './fixtures/attendance-recovery-security-native.mjs';

export async function prepareAttendanceRecoveryFullCoverage(ctx){
 assert(ctx?.d?.syntheticOnly===true&&ctx?.h?.syntheticOnly===true,'recovery_extended_synthetic_context_required');
 assert.equal(typeof ctx.registerRecoveryCoverageEvents,'function','recovery_explicit_event_allowance_required');
 ctx.registerRecoveryCoverageEvents();
 const coverage=await prepareAttendanceRecoveryCoverage(ctx),security=await prepareAttendanceRecoverySecurity(ctx);
 return {summary:{coverage:coverage.summary,security:security.summary},verifyRestored:async exec=>{
  assert.equal(typeof exec,'function');
  return {coverage:await coverage.verifyRestored(exec),security:await security.verifyRestored(exec)};
 }};
}
export const runAttendanceRecoveryCoverageNative=args=>runAttendanceRecoveryNative(args,{phase:226,prepare:prepareAttendanceRecoveryFullCoverage});
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceRecoveryCoverageNative(process.argv.slice(2))
 .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
