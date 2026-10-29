import {runActualActiveBookingSupervisor} from './release-toolchain-active-generation-supervisor.mjs';
import {canonicalJson,publicFailure} from './release-toolchain-contracts.mjs';
try{await runActualActiveBookingSupervisor();}catch(error){console.error(canonicalJson({...publicFailure(error,{stage:'candidate'}),supervisorCompleted:false,mailEnabled:false}));process.exitCode=1;}
