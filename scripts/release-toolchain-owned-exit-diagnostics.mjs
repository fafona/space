// Observation only for the owned active rehearsal CLI. No close/unref/signal,
// process.exit, acceptance authority, environment values or arbitrary paths.
import * as fs from 'node:fs';
const rootPattern=/^\/var\/lib\/faolla-booking-full-rehearsal-[A-Za-z0-9]+$/;
const name=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)?value:'redacted';
export function safeOwnedExitResources(runtime=process){
 const handles=typeof runtime._getActiveHandles==='function'?runtime._getActiveHandles():[];
 const requests=typeof runtime._getActiveRequests==='function'?runtime._getActiveRequests():[];
 return {resources:runtime.getActiveResourcesInfo().slice(0,256).map(name),handles:handles.slice(0,256).map(handle=>{
  const value={type:name(handle?.constructor?.name),stdio:handle===runtime.stdin?'stdin':handle===runtime.stdout?'stdout':handle===runtime.stderr?'stderr':null};
  if(Number.isSafeInteger(handle?.pid)&&handle.pid>0){value.pid=handle.pid;value.exitCode=Number.isInteger(handle.exitCode)?handle.exitCode:null;value.signalCode=/^SIG[A-Z0-9]+$/.test(handle.signalCode??'')?handle.signalCode:null;}
  if(typeof handle?.hasRef==='function')value.referenced=handle.hasRef()===true;
  else if(typeof handle?._handle?.hasRef==='function')value.referenced=handle._handle.hasRef()===true;
  return value;
 }),requests:requests.slice(0,256).map(request=>name(request?.constructor?.name))};
}
export function scheduleOwnedExitDiagnostics(root,{runtime=process,schedule=setTimeout,write,now=()=>new Date().toISOString()}={}){
 if(!rootPattern.test(root))throw Error('owned_exit_diagnostic_path');
 const emit=phase=>{const value={kind:'owned-active-rehearsal-exit-resource-observation',phase,pid:runtime.pid,observedAt:now(),...safeOwnedExitResources(runtime),observationOnly:true,publicationAuthority:false};
  if(write)return write(phase,value);
  if(runtime.platform!=='linux'||runtime.getuid?.()!==0)throw Error('owned_exit_diagnostic_runtime');
  const directory=fs.lstatSync(root),receipt=fs.lstatSync(root+'/acceptance.json');
  if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==0||(directory.mode&0o777)!==0o700||fs.realpathSync(root)!==root||!receipt.isFile()||receipt.isSymbolicLink()||receipt.uid!==0||receipt.nlink!==1)throw Error('owned_exit_diagnostic_owner');
  const fd=fs.openSync(root+'/exit-diagnostic-'+phase+'.json',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 };
 emit('returned');
 for(const [phase,delay]of [['after-2s',2000],['after-10s',10000]])schedule(()=>{try{emit(phase);}catch{runtime.exitCode=1;}},delay).unref();
}
