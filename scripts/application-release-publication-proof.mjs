// Retiring an obsolete standby appends a certificate, not a new publication.
// Bind the original application proof and permit ONLY validated maintenance
// suffixes preserving both the current website and its rollback anchor.
import {assertOnlineRetentionHistory,retentionHash} from './online-release-retention-policy.mjs';
const need=(value,reason)=>{if(!value)throw Error('application_publication_proof_'+reason);};
export function applicationPublicationProof(history,target){
 assertOnlineRetentionHistory(history);
 const index=history.entries.findIndex(entry=>entry.kind==='converge'&&entry.active.target===target&&entry.applicationRelease?.target===target);
 need(index>=0,'missing');const introduced=history.entries[index];
 for(const entry of history.entries.slice(index+1))need(['retire','booking-worker'].includes(entry.kind)&&
  entry.active.target===target&&entry.rollback.target===introduced.rollback.target,'successor');
 return{introduced,manifestSha256:introduced.applicationRelease.manifestSha256,
  completionCertificates:history.entries.slice(index).map(retentionHash)};
}
