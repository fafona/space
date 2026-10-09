import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {applicationWindowRpcExpression} from './attendance-application-window-native.mjs';
import {applicationWindowNativeArgs,applicationWindowNativeTables,applicationWindowReplacedFunctions} from '../merchant-attendance-application-window-native.mjs';
import {continuationCapacityMode} from '../merchant-attendance-period-continuation-native.mjs';
const source=readFileSync(new URL('./attendance-application-window-native.mjs',import.meta.url),'utf8');
test('capacity reuse is explicit extension-only; original CLI/full suite defaults remain full',()=>{
 assert.equal(continuationCapacityMode(null),'full');assert.equal(continuationCapacityMode(()=>{},{}),'full');
 assert.equal(continuationCapacityMode(()=>{},{capacity:'reuse_previous'}),'reuse_previous');
 for(const value of [null,{capacity:false},{capacity:'skip_everything'},{unrelated:true}])assert.throws(()=>continuationCapacityMode(()=>{},value));
 assert.throws(()=>continuationCapacityMode(null,{capacity:'reuse_previous'}));
});
test('243 native import is inert; explicit existing local directory and finite install scope',()=>{
 const directory=fileURLToPath(new URL('.',import.meta.url));
 for(const args of [[],['--run-local'],['--run-local','--directory','relative'],['--run-local','--directory',directory,'--extra']])assert.throws(()=>applicationWindowNativeArgs(args));
 assert.deepEqual(applicationWindowNativeArgs(['--run-local','--directory',directory]),['--run-local','--directory',directory]);
 assert.equal(applicationWindowNativeTables.length,2);assert.equal(applicationWindowReplacedFunctions.length,4);
});
test('243 real RPC adapter accepts only exact4 arguments and actual actor',()=>{
 const args={p_query:{siteId:'99990001',consumer:'application_window',mode:'current'},p_auth_user_id:'00000000-0000-4000-8000-000000000001',p_command:null,p_allow_activate:false};
 assert.match(applicationWindowRpcExpression('faolla_attendance_operational_consumer_activation_v1',args),/false\)$/);
 assert.throws(()=>applicationWindowRpcExpression('unknown',args));assert.throws(()=>applicationWindowRpcExpression('faolla_attendance_operational_consumer_activation_v1',{...args,owner:'spoof'}));
 assert.throws(()=>applicationWindowRpcExpression('faolla_attendance_operational_consumer_activation_v1',{...args,p_allow_activate:'true'}));
});
test('243 acceptance pins actual four families, old-number/withdraw and zero-write failed proof',()=>{
 for(const token of ["actualFamilies:['correction','correction_revision','missing','missing_revision']","proof_failure_injection","error.code==='attendance_application_window_invalid'",
  "assert.equal(lastRpc.sqlstate,'23514')","legacy_revision_withdraw_off","real_zero_day_expired","read_reject_or_replay_changed_facts","prior(value)",
  "current_user='postgres'","assert.equal(d.fingerprint(),baseline)","await connection.close()","notHistoricalRpc:true"] )assert(source.includes(token),token);
 assert(source.includes("mode:'detail',expectedWorkerId:h.workerId,baseRequestId,requestId:command.operationId"));
 // These two checks intentionally parse raw SQL, not the HTTP envelope with its moduleEnabled flag.
 assert(source.includes("legacyMissing(moq)),moq,false)"));
 assert(source.includes("{...moq,operationId:missingApprove.operationId},false)"));
 assert(!/create\s+database|drop\s+database|process\.env|fetch\(/i.test(source));
});
