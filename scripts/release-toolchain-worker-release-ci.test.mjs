import test from 'node:test';import assert from 'node:assert/strict';
import {assertWorkerEntryAcceptance} from './release-toolchain-worker-release-ci.mjs';
const revision='a'.repeat(40),sourceHashes=Object.fromEntries(['release-toolchain-worker-entry.mjs','booking-atomic-worker.mjs','release-toolchain-worker-release-contract.mjs'].map(v=>[v,'b'.repeat(64)]));
function report(){return{kind:'real-pm2-esm-booking-worker-entry-acceptance',toolRevision:revision,realPm2Version:'6.0.14',entryMode:'pm2',openedGateCompletedCycles:2,actualPm2Wrapper:true,argvUnchanged:true,closedGatePaused:true,closedAgainNoDispatch:true,syntheticTickOnly:true,applicationOrDatabaseLoaded:false,formalHostTouched:false,publicationAuthority:false,sourceHashes};}
test('real wrapper, guarded actual loop and stopped private fixture evidence are required',()=>assertWorkerEntryAcceptance(report(),{revision,sourceHashes}));
test('CJS placeholder, foreign source, lost-gate dispatch, or mere online cannot satisfy native acceptance',()=>{
 for(const [key,value]of Object.entries({kind:'cjs-placeholder',toolRevision:'c'.repeat(40),realPm2Version:'6.0.15',entryMode:'direct',openedGateCompletedCycles:0,actualPm2Wrapper:false,argvUnchanged:false,closedGatePaused:false,closedAgainNoDispatch:false,syntheticTickOnly:false,applicationOrDatabaseLoaded:true,formalHostTouched:true,publicationAuthority:true,sourceHashes:{}}))assert.throws(()=>assertWorkerEntryAcceptance({...report(),[key]:value},{revision,sourceHashes}));
});
