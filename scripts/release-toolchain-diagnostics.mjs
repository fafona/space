// Private diagnostics contain only bounded, known source locations and a hash
// of exception text. No arbitrary message, stack, credential or getter output.
import {TOOLCHAIN_STAGES,sha256,publicFailure,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {readReleasePm2FailureDiagnostic} from './release-toolchain-pm2-readonly-diagnostic.mjs';
// Read-only provenance in error evidence, never an alternate source authority.
const historicalSources=new Set(['9ab3cc54e2034ed495ea4107b25f0b640ba87814','dc80eacba6b3c6a78b271f88786372b026efd7dc','92f8595eba8d99bf251e5d84ba2d4f91ac5715b3','203e4314ee37384996dd42f2e1f585dc06612dcd','8607f9d21980f8330cba46eb13c7e8f5d99a8485','c2f92ef696998901e5f060a40f7beee2d94ac1d5']);
export function stageFailureDiagnostic(error,{stage,toolRevision,knownFiles}){
 need(TOOLCHAIN_STAGES.includes(stage)&&/^[a-f0-9]{40}$/.test(toolRevision??'')&&Array.isArray(knownFiles),'invalid_contract');
 const allowed=new Set(knownFiles.filter(f=>/^[A-Za-z0-9_-]+\.mjs$/.test(f))),prefix='file:///var/lib/faolla-online-code/'+toolRevision+'/scripts/';
 const ownString=name=>{try{const d=Object.getOwnPropertyDescriptor(error,name);return d&&Object.hasOwn(d,'value')&&typeof d.value==='string'?d.value:'';}catch{return '';}};
 const frames=[],historicalFrames=[];for(const line of ownString('stack').slice(0,32768).split('\n').slice(1,20)){
  const at=line.indexOf(prefix);
  if(at>=0){const m=/^([A-Za-z0-9_-]+\.mjs):(\d{1,7}):(\d{1,7})(?:\)|\s|$)/.exec(line.slice(at+prefix.length));
   if(m&&allowed.has(m[1])&&Number(m[2])>0&&Number(m[3])>0)frames.push({file:'scripts/'+m[1],line:Number(m[2]),column:Number(m[3])});
  }else{const m=/file:\/\/\/var\/lib\/faolla-online-code\/([a-f0-9]{40})\/scripts\/([A-Za-z0-9_-]+\.mjs):(\d{1,7}):(\d{1,7})(?:\)|\s|$)/.exec(line);
   if(m&&historicalSources.has(m[1])&&allowed.has(m[2])&&Number(m[3])>0&&Number(m[4])>0)historicalFrames.push({revision:m[1],file:'scripts/'+m[2],line:Number(m[3]),column:Number(m[4])});}
  if(frames.length+historicalFrames.length===8)break;
 }
 const pm2=readReleasePm2FailureDiagnostic(error);
 return {kind:'release-toolchain-stage-failure-diagnostic',toolRevision,stage,code:publicFailure(error,{stage}).code,exceptionMessageSha256:sha256(ownString('message')),frames,...(historicalFrames.length?{historicalFrames}:{}),...(pm2?{pm2}:{}),detailsRedacted:true};
}
