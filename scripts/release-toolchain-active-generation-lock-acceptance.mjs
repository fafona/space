// No CLI resource arguments or production profile switch.
import {acceptActiveIncidentPreparationLocksInCi} from './online-release-retention-writer.mjs';
if(process.argv.length!==2)throw Error('active_lock_ci_no_arguments');
try{console.log(JSON.stringify(await acceptActiveIncidentPreparationLocksInCi()));}
catch{console.error('active_incident_preparation_lock_acceptance_unconfirmed');process.exitCode=1;}
