// Private diagnostics contain only bounded, known source locations and a hash
// of exception text. No arbitrary message, stack, credential or getter output.
import {TOOLCHAIN_STAGES,sha256,publicFailure,requireToolchain as need} from './release-toolchain-contracts.mjs';
export function stageFailureDiagnostic(error,{stage,toolRevision,knownFiles}){
 need(TOOLCHAIN_STAGES.includes(stage)&&/^[a-f0-9]{40}$/.test(toolRevision??'')&&Array.isArray(knownFiles),'invalid_contract');
 const allowed=new Set(knownFiles.filter(f=>/^[A-Za-z0-9_-]+\.mjs$/.test(f))),prefix='file:///var/lib/faolla-online-code/'+toolRevision+'/scripts/';
 const ownString=name=>{try{const d=Object.getOwnPropertyDescriptor(error,name);return d&&Object.hasOwn(d,'value')&&typeof d.value==='string'?d.value:'';}catch{return '';}};
 const frames=[];for(const line of ownString('stack').slice(0,32768).split('\n').slice(1,20)){
  const at=line.indexOf(prefix);if(at<0)continue;const m=/^([A-Za-z0-9_-]+\.mjs):(\d{1,7}):(\d{1,7})(?:\)|\s|$)/.exec(line.slice(at+prefix.length));
  if(m&&allowed.has(m[1])&&Number(m[2])>0&&Number(m[3])>0)frames.push({file:'scripts/'+m[1],line:Number(m[2]),column:Number(m[3])});if(frames.length===8)break;
 }
 return {kind:'release-toolchain-stage-failure-diagnostic',toolRevision,stage,code:publicFailure(error,{stage}).code,exceptionMessageSha256:sha256(ownString('message')),frames,detailsRedacted:true};
}
