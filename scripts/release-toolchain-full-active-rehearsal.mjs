// Owned fixture entry only, never a publication entry or formal process actor.
// Its library is fully evaluated before the active-profile rehearsal starts.
import {runFullActiveToolchainRehearsal} from './release-toolchain-full-rehearsal.mjs';
import {rehearseFullActiveToolchainInterruption} from './release-toolchain-full-interrupt.mjs';
import {scheduleOwnedExitDiagnostics} from './release-toolchain-owned-exit-diagnostics.mjs';
if(!(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--interrupt'))throw Error('active_native_rehearsal_no_resource_arguments');
try{if(process.argv.length===2){const result=await runFullActiveToolchainRehearsal();scheduleOwnedExitDiagnostics(result.root);}else console.log(JSON.stringify(await rehearseFullActiveToolchainInterruption()));}catch{console.error('active_native_rehearsal_unconfirmed_evidence_retained');process.exitCode=1;}
