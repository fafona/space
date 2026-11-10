import {createHash} from 'node:crypto';
import {bookingHandoffFixture} from './booking-handoff-retention-fixture.mjs';
import {buildOnlineRetentionReceipt} from '../online-release-retention.mjs';
import {retentionHash,retentionCanonicalText} from '../online-release-retention-policy.mjs';
import {REBOOT_WORKER_NAME as NAME} from '../release-toolchain-host-reboot-contract.mjs';
const clone=structuredClone,H=x=>x.repeat(64),S=x=>x.repeat(40),id='10000000-0000-4000-8000-000000000001';
const digest=v=>createHash('sha256').update(v).digest('hex');
export function hostRebootFixture(f=bookingHandoffFixture()){
 const first=buildOnlineRetentionReceipt(f.before,clone(f.before),{version:2,process:null},f.history,{preparedAt:'2026-10-26T10:01:00.000Z',completedAt:'2026-10-26T10:01:00.000Z'});
 const history={...f.history,entries:[...f.history.entries,first.certificate],headSha256:retentionHash(first.certificate)},prior=history.entries.at(-1);
 const gate={schemaVersion:1,kind:'booking-atomic-worker-gate',candidate:prior.active.target,toolRevision:prior.toolRevision,certificateSha256:history.headSha256,generation:f.handoff.databaseAfter.generation,enabled:true};
 const resurrected=prior.processes.map((p,i)=>({...clone(p),pmId:50+i,pid:p.status==='online'?5000+i:0,restartCount:p.status==='online'?0:p.restartCount,environmentSha256:digest(p.name)}));
 const hostReboot={version:1,kind:'verified-host-boot-rebind',verifierAction:'upgrade',previousBootId:id,bootId:id.replace(/1$/,'2'),priorHistoryHead:history.headSha256,oldDumpSha256:H('a'),oldBootReceiptSha256:H('b'),sourceInventorySha256:H('c'),nativeEvidenceSha256:H('d'),gateSha256:digest(retentionCanonicalText(gate)),publicationCertificateSha256:history.headSha256,protectedHostSha256:H('e'),environmentProofs:prior.processes.map(p=>({name:p.name,beforeSha256:p.environmentSha256,afterSha256:digest(p.name),beforeStableSha256:H('1'),afterStableSha256:H('1'),beforeUniqueId:id,afterUniqueId:id.replace(/1$/,'3')})),resurrectedProcesses:resurrected,identities:resurrected.filter(p=>p.pid).map(p=>({name:p.name,pid:p.pid,uid:0,parentPid:900,cwd:p.cwd,executable:'/usr/bin/node',startTicks:String(p.pid),commandSha256:H('2'),environmentSha256:H('3')})),daemon:{pid:900,uid:0,bootId:id.replace(/1$/,'2'),startTicks:'100'},window:{id,startedAt:'2026-11-10T10:00:00.000Z',deadlineAt:'2026-11-10T10:10:00.000Z'},mailEnabled:false};
 const before={...Object.fromEntries(['version','policy','legacySha256','rollingHeadSha256','rollingHistorySha256','victim'].map(k=>[k,clone(prior[k])])),kind:'host-reboot',sequence:history.entries.length+1,previousSha256:history.headSha256,toolRevision:S('a'),active:{...prior.active,process:resurrected.find(p=>p.name===prior.active.name)},rollback:{...prior.rollback,process:resurrected.find(p=>p.name===prior.rollback.name)},hostReboot,processes:resurrected,workerIdentity:hostReboot.identities.find(p=>p.name===NAME),persistenceSha256:null};
 const after={...clone(before),processes:resurrected.map(p=>p.name===NAME?{...p,pid:9999,restartCount:1,executable:'/var/lib/faolla-online-code/'+before.toolRevision+'/scripts/booking-atomic-worker.mjs'}:clone(p)),workerIdentity:{...before.workerIdentity,pid:9999,startTicks:'9999'},persistenceSha256:H('4')};
 return{history,before,after,gate,prior,websiteState:clone(f.before.activeState)};
}
