// Observe an expected process without turning an executable-disappearance race
// into signal authority. PID reuse, permission failures and unknown errors are
// not absence. The caller must still own every target it can signal.
import * as fs from 'node:fs';import {isDeepStrictEqual} from 'node:util';import {captureProcessFact} from './check-production-runtime-supervision.mjs';
const goneCodes=new Set(['ENOENT','ESRCH']),exitMessages=new Set(['invalid_proc_stat','proc_file_size_invalid','proc_records_invalid','process_identity_drift']);
export function processBirth(pid){try{const raw=fs.readFileSync('/proc/'+pid+'/stat','utf8'),end=raw.lastIndexOf(')'),fields=raw.slice(end+2).trim().split(/\s+/);if(end<1||!/^\d+$/.test(fields[19]??''))throw Error('invalid_proc_stat');return{startTicks:fields[19],zombie:fields[0]==='Z'};}catch(error){if(goneCodes.has(error.code))return null;throw error;}}
export function expectedProcessStateSequence({expected,birth,capture}){
 const classify=value=>value===null?'absent':value.startTicks!==expected.startTicks?'reused':value.zombie?'absent':'owned';
 const initial=classify(birth());if(initial!=='owned')return initial;
 try{const current=capture(),fields=['pid','uid','startTicks','executable','cwd','commandLineDigest'];return fields.every(key=>isDeepStrictEqual(current[key],expected[key]))?'owned':'reused';}
 catch(error){if(goneCodes.has(error.code)||exitMessages.has(error.message)){const final=classify(birth());if(final!=='owned')return final;}throw error;}
}
export const expectedProcessState=expected=>expectedProcessStateSequence({expected,birth:()=>processBirth(expected.pid),capture:()=>captureProcessFact(expected.pid)});
