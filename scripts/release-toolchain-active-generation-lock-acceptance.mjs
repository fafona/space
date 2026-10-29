// No CLI resource arguments or production profile switch.
import {acceptActiveIncidentPreparationLocksInCi,acceptPreControlAbortClosureInCi,acceptPreConnectAbortClosureInCi} from './online-release-retention-writer.mjs';
import {acceptActiveIncidentPreservationInCi} from './release-toolchain-active-generation-preservation.mjs';
import {acceptActiveIncidentMetadataInCi} from './release-toolchain-active-generation-metadata.mjs';
import{acceptActualPythonWorkerRuntimeInCi}from'./release-toolchain-python-runtime.mjs';
if(process.argv.length!==2)throw Error('active_lock_ci_no_arguments');
try{console.log(JSON.stringify(await acceptActiveIncidentPreparationLocksInCi()));console.log(JSON.stringify(await acceptActiveIncidentPreservationInCi()));console.log(JSON.stringify(await acceptActiveIncidentMetadataInCi()));console.log(JSON.stringify(await acceptPreControlAbortClosureInCi()));console.log(JSON.stringify(await acceptPreConnectAbortClosureInCi()));console.log(JSON.stringify(acceptActualPythonWorkerRuntimeInCi()));}
catch{console.error('active_incident_preparation_lock_acceptance_unconfirmed');process.exitCode=1;}
