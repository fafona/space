// A separate owned-only entry: the imported engine has fully evaluated before
// it calls the writer's dynamic closure verifier. No unsettled self-import TLA.
import {runOwnedActiveReconciliationCase} from './release-toolchain-active-generation-reconciliation.mjs';
import {loadOwnedActiveReconciliationCase,ownedActiveReconciliationScope,sealOwnedLab} from './release-toolchain-active-generation-owned-lab.mjs';
import {stageFailureDiagnostic} from './release-toolchain-diagnostics.mjs';
import path from 'node:path';import {fileURLToPath} from 'node:url';
let capability;
try{
 if(process.argv.length!==3)throw Error('owned_active_reconciliation_no_production_entry');
 capability=loadOwnedActiveReconciliationCase(process.argv[2]);await runOwnedActiveReconciliationCase(capability);
}catch(error){
 // An exit diagnostic is NOT a completion/closure receipt. Its root ownership
 // and source are still checked even if the operation's lock result is unknown.
 if(capability)try{const s=ownedActiveReconciliationScope(capability);sealOwnedLab(s.directory+'/controller-exit-failed.json',{kind:'owned-active-controller-exit-unconfirmed',diagnostic:stageFailureDiagnostic(error,{stage:'rehearsal',toolRevision:path.basename(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),knownFiles:['release-toolchain-active-generation-reconciliation-case.mjs','release-toolchain-active-generation-reconciliation.mjs','online-release-retention-writer.mjs']}),publicationAuthority:false});}catch{}
 console.error('owned_active_reconciliation_unconfirmed');process.exitCode=1;
}
