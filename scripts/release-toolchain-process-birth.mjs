// Observe an expected process without turning an executable-disappearance race
// into signal authority. PID reuse, permission failures and unknown errors are
// not absence. The caller must still own every target it can signal.
import * as fs from 'node:fs';import {isDeepStrictEqual} from 'node:util';import {captureReparentableProcessFact} from './release-toolchain-process-reparent-capture.mjs';
import {requireToolchain as need,exactKeys} from './release-toolchain-contracts.mjs';
const goneCodes=new Set(['ENOENT','ESRCH']),exitMessages=new Set(['invalid_proc_stat','proc_file_size_invalid','proc_records_invalid','process_identity_drift']);
export function processBirth(pid){try{const raw=fs.readFileSync('/proc/'+pid+'/stat','utf8'),end=raw.lastIndexOf(')'),fields=raw.slice(end+2).trim().split(/\s+/);if(end<1||!/^\d+$/.test(fields[19]??''))throw Error('invalid_proc_stat');return{startTicks:fields[19],zombie:fields[0]==='Z'};}catch(error){if(goneCodes.has(error.code))return null;throw error;}}
export function expectedProcessStateSequence({expected,birth,capture}){
 const classify=value=>value===null?'absent':value.startTicks!==expected.startTicks?'reused':value.zombie?'absent':'owned';
 const initial=classify(birth());if(initial!=='owned')return initial;
 try{const current=capture(),fields=['pid','uid','startTicks','executable','cwd','commandLineDigest'];return fields.every(key=>isDeepStrictEqual(current[key],expected[key]))?'owned':'reused';}
 catch(error){if(goneCodes.has(error.code)||exitMessages.has(error.message)){const final=classify(birth());if(final!=='owned')return final;}throw error;}
}
// Kernel exit can remove exe/cwd just before stat reports Z/absence. Re-observe
// read-only for at most 25 samples; never turn an incomplete identity into owned
// or absent, retry identity drift/permissions, or signal/restart a process here.
export function observeExpectedProcessStateSequence({expected,birth,capture,wait}){
 for(let sample=0;sample<25;sample++){
  try{return expectedProcessStateSequence({expected,birth,capture});}
  catch(error){if(!goneCodes.has(error.code)||sample===24)throw error;wait(10);}
 }
}
const exitRaceWaitBuffer=new Int32Array(new SharedArrayBuffer(4));
export const expectedProcessState=expected=>observeExpectedProcessStateSequence({expected,birth:()=>processBirth(expected.pid),capture:()=>captureReparentableProcessFact(expected.pid),wait:ms=>Atomics.wait(exitRaceWaitBuffer,0,0,ms)});
// SSH/shell loss may reparent the SAME controller to init. Compare every
// captured field other than PPID; this is not PID-only signal authority.
export function assertExpectedReparentableProcessIdentity(expected,actual){const keys=['pid','uid','startTicks','processIdentity','cwd','cwdIdentity','executable','executableIdentity','commandLine','commandLineDigest','parentPid'];exactKeys(expected,keys);exactKeys(actual,keys);need(Number.isSafeInteger(actual.parentPid)&&actual.parentPid>=0&&Number.isSafeInteger(expected.parentPid)&&expected.parentPid>=0,'owned_resource_changed');const strip=value=>{const result={...value};delete result.parentPid;return result;};need(isDeepStrictEqual(strip(expected),strip(actual)),'owned_resource_changed');return true;}
