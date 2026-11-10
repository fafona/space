// Restart-safe orchestration. Storage and host operations are supplied only by
// the fixed entry point; this model has no process, network or filesystem API.
export async function executeHostRebootRecovery(operations){
 const intent=await operations.admit();
 // A sealed restart attempt is never sent again, even if the ACK was lost.
 if(!await operations.hasRestartAttempt()){
  await operations.recordRestartAttempt(intent);
  await operations.restartVerifierOnce(intent);
 }
 const settled=await operations.verifySettledVerifier(intent);
 // Saving manager configuration is safe to finish only after comparing the
 // complete current cohort and any already-saved receipt/dump under our lock.
 const persistence=await operations.ensurePersistence(intent,settled);
 const certificate=await operations.ensureCertificate(intent,settled,persistence);
 const proof=await operations.auditNaturalCyclesAndPublicRoute(intent,certificate);
 await operations.complete(intent,certificate,proof);
 return proof;
}
