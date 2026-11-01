// Ordinary application publications do not expose a partial certificate tail.
// Assemble and fsync all five proof files under the owned release operation,
// then publish the complete directory by rename. A crash can leave only an
// unpublished private staging directory or a complete, reconcilable tail.
import * as fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {APPLICATION_RELEASE_LANE} from './application-release-policy.mjs';
import {applicationPublicationProof} from './application-release-publication-proof.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {buildOnlineRetentionReceipt,readOnlineRetentionHistory,ONLINE_RETENTION_ROOT} from './online-release-retention.mjs';
import {assertOnlineRetentionPlan,assertOnlineRetentionCompletion,retentionHash,retentionCanonicalText} from './online-release-retention-policy.mjs';
import {createOnlineRetentionProductionOperations,assertOnlineRetentionHeldLocks,inspectOnlineRetentionReconciliation,reconcileOnlineRetentionUnderHeldLocks} from './online-release-retention-writer.mjs';
import {bookingHostWriteOnce,bookingHostRead,bookingHostSync} from './booking-handoff-host-io.mjs';
const need=(value,reason)=>{if(!value)throw Error('application_release_retention_'+reason);};
const same=(a,b,reason)=>need(isDeepStrictEqual(a,b),reason);

export async function executeApplicationRetentionCommit(operations) {
  const history=operations.history(),before=await operations.observe();
  assertOnlineRetentionPlan(before,history);
  need(before.kind==='converge'&&before.victim===null&&before.applicationRelease?.kind===APPLICATION_RELEASE_LANE,'scope');
  await operations.wait(2000);
  const second=await operations.observe();assertOnlineRetentionCompletion(before,second,history);
  const preparedAt=operations.now(),after=await operations.finalCheck(before);
  assertOnlineRetentionCompletion(before,after,history);
  const receipt=buildOnlineRetentionReceipt(before,after,{version:2,process:null},history,{preparedAt,completedAt:operations.now()});
  await operations.stage(receipt,history);
  const last=await operations.finalCheck(before);assertOnlineRetentionCompletion(before,last,history);
  same(operations.history(),history,'history_changed');
  await operations.publish(receipt,history);
  // Only the external head is advanced here; no business effect, process
  // mutation, data migration or second route switch is retried on uncertainty.
  await operations.reconcile(receipt,history);
  const complete=operations.history();
  need(complete.headSha256===retentionHash(receipt.certificate),'completion');
  return receipt.certificate;
}

export async function commitApplicationRetention({toolRevision,target,operation,lock}) {
  assertOnlineRetentionHeldLocks(lock);
  need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(target??'')&&
    operation==='/var/lib/faolla-online-release/'+target,'invocation');
  ownedReleasePath(operation,{directory:true,privateMode:true});
  const pending=inspectOnlineRetentionReconciliation();
  if(pending.status==='complete-uncommitted-tail'){
    need(pending.before.toolRevision===toolRevision&&pending.before.active.target===target&&
      pending.before.applicationRelease?.kind===APPLICATION_RELEASE_LANE,'foreign_pending_tail');
    await reconcileOnlineRetentionUnderHeldLocks({toolRevision,lock});
    return readOnlineRetentionHistory().entries.at(-1);
  }
  if(pending.history.entries.at(-1)?.active.target===target){
    const prior=pending.history.entries.at(-1);
    const publication=applicationPublicationProof(pending.history,target);
    need(publication.introduced.toolRevision===toolRevision,'completion_identity');return prior;
  }
  const adapter=createOnlineRetentionProductionOperations({kind:'converge',activeTarget:target,victimTarget:null,toolRevision,lock});
  const staging=operation+'/application-retention-staging-'+randomUUID();let captured=null;
  const verifyStaged=receipt=>{
    ownedReleasePath(staging,{directory:true,privateMode:true});
    same(fs.readdirSync(staging).sort(),[...receipt.files.keys()].sort(),'staging_files');
    for(const [name,text]of receipt.files)same(bookingHostRead(staging+'/'+name),text,'staging_changed');
  };
  return executeApplicationRetentionCommit({
    ...adapter,
    finalCheck:async before=>{assertOnlineRetentionHeldLocks(lock);return adapter.finalCheck(before);},
    stage:async receipt=>{
      assertOnlineRetentionHeldLocks(lock);
      // Never erase or reuse a half-written staging directory. It remains an
      // inert private artifact; only a fresh evidence attempt gets a new UUID.
      need(!fs.existsSync(staging),'staging_exists');fs.mkdirSync(staging,{mode:0o700});bookingHostSync(operation);
      for(const [name,text]of receipt.files)bookingHostWriteOnce(staging+'/'+name,text);
      verifyStaged(receipt);captured=fs.lstatSync(staging);
    },
    publish:async(receipt,history)=>{
      assertOnlineRetentionHeldLocks(lock);same(readOnlineRetentionHistory(),history,'history_changed');verifyStaged(receipt);
      const current=fs.lstatSync(staging);same([current.dev,current.ino],[captured.dev,captured.ino],'staging_replaced');
      ownedReleasePath(ONLINE_RETENTION_ROOT,{directory:true,privateMode:true});
      const destination=ONLINE_RETENTION_ROOT+'/'+String(receipt.certificate.sequence).padStart(6,'0');
      need(!fs.existsSync(destination),'entry_exists');fs.renameSync(staging,destination);
      bookingHostSync(ONLINE_RETENTION_ROOT);bookingHostSync(operation);
    },
    reconcile:async receipt=>{
      assertOnlineRetentionHeldLocks(lock);
      const observed=inspectOnlineRetentionReconciliation();
      need(observed.status==='complete-uncommitted-tail','tail_state');
      same(retentionCanonicalText(observed.history.entries.at(-1)),retentionCanonicalText(receipt.certificate),'tail_changed');
      await reconcileOnlineRetentionUnderHeldLocks({toolRevision,lock});
    },
  });
}
