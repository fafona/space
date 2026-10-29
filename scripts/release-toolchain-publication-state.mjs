// Pure operational classification. Facts must be collected independently by a
// host observer. This report is NEVER an admission token, resume command or an
// instruction to clear an operation directory, replay SQL, or signal a process.
import{isDeepStrictEqual}from'node:util';
const requireFact=(v,c)=>{if(!v)throw Error('publication_state_'+c);};
const fields=(v,n)=>requireFact(v&&typeof v==='object'&&!Array.isArray(v)&&isDeepStrictEqual(Object.keys(v).sort(),[...n].sort()),'shape');
const bool=v=>typeof v==='boolean';
const FORBIDDEN=Object.freeze(['clear-operation-state','replay-activation','restore-legacy-booking-json','restart-already-paused-legacy','enable-mail','reuse-expired-window']);
export function classifyBookingPublicationState(facts){
 fields(facts,['protocol','expectedGeneration','databaseGeneration','databaseActive','route','metadata','legacyPaused','legacyOriginalIntact','controllerAlive','watchdogAlive','workerEnabled','workerGeneration','publicationCertificateVerified','publicationJournalComplete','recoveryReceiptVerified','operationDirectoryPresent']);
 requireFact(facts.protocol===2&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(facts.expectedGeneration)&&facts.databaseGeneration===facts.expectedGeneration,'database_identity');
 for(const k of ['databaseActive','legacyPaused','legacyOriginalIntact','controllerAlive','watchdogAlive','workerEnabled','publicationCertificateVerified','publicationJournalComplete','recoveryReceiptVerified','operationDirectoryPresent'])requireFact(bool(facts[k]),'boolean');
 requireFact(['baseline','rollback','primary','mixed'].includes(facts.route)&&['baseline','rollback','primary','unknown'].includes(facts.metadata),'location');
 requireFact(facts.workerEnabled?facts.workerGeneration===facts.expectedGeneration:facts.workerGeneration===null,'worker_generation');
 const result=(state,required,complete=false)=>({kind:'booking-publication-operational-state',state,complete,publicationAuthority:false,mutatingContinuationAuthorized:false,required,forbidden:[...FORBIDDEN],mailMustRemainDisabled:true});
 if(facts.controllerAlive||facts.watchdogAlive)return result('owned-operation-running',['observe-owned-controller-and-watchdog','do-not-start-another-operation']);
 if(facts.route==='mixed')return result('routing-conflict',['independent-route-ownership-diagnosis','explicit-recovery-review']);
 if(!facts.databaseActive){
  if(facts.route!=='baseline'||facts.metadata!=='baseline'||!facts.legacyOriginalIntact||facts.legacyPaused||facts.workerEnabled||facts.publicationCertificateVerified)return result('inactive-state-conflict',['independent-state-diagnosis']);
  if(facts.operationDirectoryPresent)return result('inactive-operation-unsealed',['audit-failed-operation','preserve-before-any-reviewed-closure']);
  return result('inactive-baseline-ready-for-fresh-validation',['full-source-and-ci-review','real-adapter-acceptance','fresh-backup-and-compatible-rollback','new-explicit-admission']);
 }
 if(facts.route==='baseline')return result('active-database-on-incompatible-baseline',['review-owned-compatible-route-recovery','never-deactivate-or-restore-business-data']);
 if(!facts.legacyPaused)return result('active-database-legacy-owner-not-paused',['verify-current-writer-ownership','explicit-single-attempt-pause-recovery-review']);
 if(facts.workerEnabled&&!(facts.route==='primary'&&facts.metadata==='primary'&&facts.publicationCertificateVerified&&facts.publicationJournalComplete))return result('worker-gate-conflict',['verify-certificate-generation-and-actual-writer','explicit-worker-reconciliation-review']);
 if(facts.route==='primary'){
  if(facts.metadata==='primary'&&facts.publicationCertificateVerified&&facts.publicationJournalComplete&&facts.workerEnabled&&!facts.operationDirectoryPresent)return result('published',['public-and-authorization-smoke','backup-and-process-delta-audit'],true);
  return result('primary-route-unsealed',['new-window-independent-postcondition-proof','audit-metadata-journal-and-certificate','enable-worker-only-after-valid-certificate']);
 }
 if(facts.route==='rollback'){
  if(facts.metadata==='rollback'&&facts.recoveryReceiptVerified&&!facts.workerEnabled&&!facts.operationDirectoryPresent)return result('compatible-rollback-sealed',['separate-active-generation-publication-plan']);
  return result('compatible-rollback-unsealed',['independent-current-state-and-failure-diagnosis','fresh-compatible-rollback-readiness-not-timestamp-rewrite','review-active-generation-metadata-closure','new-audited-continuation-without-restarting-legacy-or-replaying-sql']);
 }
 return result('unclassified-conflict',['independent-state-diagnosis']);
}
