// Recovery ONLY of the expired 5871 publication. Not publication continuation.
import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
export const INTERRUPTED_RECOVERY=Object.freeze({
 priorTool:'44054c0180ba4a4e83b8b547f48ba229490f3495',inventorySha256:'a8d4181992f1b6666fad36e9ba41baaa1f73ae6b09158ec8a676b6078f53db1e',
 operationId:'5871a892-48f7-4c14-a4e8-40e8f2111953',operationInode:2624961,
 publication:'/var/lib/faolla-booking-active-publications/'+P.candidate+'/5871a892-48f7-4c14-a4e8-40e8f2111953',
 manifestSha256:'55e0459850d9450e374159274a53b59e51be18cd215317cbc3a3f4ad3c171a34',
 activeSha256:'fc134e66b145251cb5a047b04fa6e509b24529bdf903a346942bf09f9655eb0f',
 stateSha256:'6f39fb0a04aa7676325f97f01ce45a52f63c9785ec7c534f39a91e91b9b9a8ed',
 root:'/var/lib/faolla-booking-interrupted-recoveries/5871a892-48f7-4c14-a4e8-40e8f2111953',
 qualification:'/var/lib/faolla-booking-active-qualifications/b49808d6-1950-4cb4-b029-97086873d7a7/44054c0180ba4a4e83b8b547f48ba229490f3495/attempt_1793356234310_d70bf4ae-cb66-45dc-9be8-608068620479',
 qualificationSha256:'8d00f0b84096b4e83781caa7fe8b1916e5bd7f109f813d957c3dabe88d6bb251',
 parentPid:885628,supervisorPid:902091,workerPid:901209,workerRestarts:7,
 headFileSha256:'af4b0f84537aece6f56bbec796e6de2b3bec5ffa910d0d3fb2273e63a89bdc9c',
 headSha256:'77ea9068d2c634f146f0f53be465ba9cb13ad335417cbc8f2228fd6bc5cef6cb',
 pending:'/var/lib/faolla-online-retention/000022',pendingInode:2883638,
 pendingFiles:Object.freeze({'before.json':'daa425f5ba04cc59ec1b349fcad2b7866f32e2e17f2e2748d531901367c25804','prepared.json':'d7e248266ddd76bd38927937ef536b75aebe5339271e41be3eb857f80f8005da','recovery-pm2.json':'33023a908dfd3257c4e8438076d6bdf3d18303672f32155a7c909bdd8b12b445'})
});
export const interruptedRecoveryBinding=()=>({kind:'fixed-interrupted-publication-recovery-only',...INTERRUPTED_RECOVERY,publicationRetryAllowed:false,oldLeaseRenewed:false,businessDataWritten:false,mailEnabled:false,publicationAuthority:false});
export const interruptedRecoveryBindingSha256=()=>sha256(canonicalJson(interruptedRecoveryBinding()));
export function interruptedRecoveryMetadata({activeText,stateText,originalActiveText,recoveryId,at}){
 const H=INTERRUPTED_RECOVERY;
 need(sha256(activeText)===H.activeSha256&&sha256(stateText)===H.stateSha256,'owned_resource_changed');
 const old=JSON.parse(originalActiveText),state=JSON.parse(stateText);
 need(old.target===P.compatibleRollback&&old.port===3110&&old.directory==='/www/wwwroot/merchant-space.web-releases/'+P.compatibleRollback.slice(0,12)+'-online'&&old.name==='merchant-space-online-'+P.compatibleRollback.slice(0,12),'evidence_invalid');
 need(state.target===P.candidate&&state.status==='active'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(recoveryId??'')&&recoveryId!==H.operationId&&new Date(at).toISOString()===at,'invalid_contract');
 return{activeText:originalActiveText,stateText:JSON.stringify({...state,status:'booking-active-generation-cutover-failed',bookingRecoveryTarget:P.compatibleRollback,bookingRecoveryOperationId:H.operationId,bookingRecoveryAuditId:recoveryId,bookingRecoveryAt:at},null,2)};
}
export const INTERRUPTED_RECOVERY_STEPS=Object.freeze(['inspect','preserve','routeRollback','publicProof','metadata','verify','complete']);
// Shared by the fixed host and native/negative tests. Any uncertain step stops;
// there is no automatic replay, state cleanup, worker enable or publication.
export async function executeInterruptedRecovery(operations){
 let stage='startup';try{for(const name of INTERRUPTED_RECOVERY_STEPS){stage=name;await operations.assertHeld();await operations[name]();await operations.assertHeld();}}
 catch(error){try{await operations.failure(error,stage);}catch{}throw error;}
}
export function assertInterruptedRecoveryStable(before,after){
 const strip=v=>{const {at,publicProof,database,activeSha256,stateSha256,proxyHashes,...rest}=v;void at;void publicProof;void database;void activeSha256;void stateSha256;void proxyHashes;return rest;};
 need(isDeepStrictEqual(strip(before),strip(after)),'owned_resource_changed');return true;
}
