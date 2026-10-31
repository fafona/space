import {createHash} from 'node:crypto';
import {bookingHandoffFixture} from './booking-handoff-retention-fixture.mjs';
import {buildOnlineRetentionReceipt} from '../online-release-retention.mjs';
import {retentionHash} from '../online-release-retention-policy.mjs';
export function applicationRetentionFixture(){
 const fixture=bookingHandoffFixture(),recovery={version:2,process:null};
 const original=buildOnlineRetentionReceipt(fixture.before,structuredClone(fixture.before),recovery,fixture.history,
  {preparedAt:'2026-10-26T10:01:00.000Z',completedAt:'2026-10-26T10:01:00.000Z'});
 const history={...fixture.history,entries:[...fixture.history.entries,original.certificate],headSha256:retentionHash(original.certificate)};
 const before=structuredClone(fixture.before),old=original.certificate.active,target='e'.repeat(40);
 const directory='/www/wwwroot/merchant-space.web-releases/'+target.slice(0,12)+'-online',name='merchant-space-online-'+target.slice(0,12);
 const process={...old.process,name,cwd:directory,executable:directory+'/node_modules/next/dist/bin/next',pmId:90,pid:7090,port:3110,args:['start','-H','127.0.0.1','-p','3110']};
 const active={target,name,directory,port:3110,process};
 Object.assign(before,{kind:'converge',sequence:history.entries.length+1,previousSha256:history.headSha256,active,rollback:structuredClone(old),
  processes:[...structuredClone(original.certificate.processes),process],
  activeFile:{target,name,directory,port:3110},ancestry:[{older:old.target,newer:target,verified:true}],
  applicationRelease:{kind:'reviewed-application-code-only-v1',baseline:old.target,target,manifestSha256:'d'.repeat(64)}});
 delete before.bookingHandoff;
 before.activeState={...before.activeFile,status:'active',activatedAt:'2026-10-26T10:02:00.000Z',baseline:old.target,
  oldName:old.name,oldDirectory:old.directory,oldPort:old.port,retentionHeadSha256:history.headSha256};
 const priorProof=structuredClone(fixture.before.releaseProofs.find(row=>row.target===old.target));
 const stateText=JSON.stringify(before.activeState);
 before.releaseProofs=[{...priorProof,target,sourceHead:target,state:before.activeState,stateText,
  stateSha256:createHash('sha256').update(stateText).digest('hex'),http:{status:200,ok:true,buildId:target}},priorProof];
 before.identityProofs.push({...before.identityProofs.find(row=>row.pid===old.process.pid),name,pid:process.pid,cwd:directory});
 before.listeners.push({address:'127.0.0.1',port:3110,pid:process.pid});
 return {fixture,recovery,original,history,before,old,target};
}
