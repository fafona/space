// Dependency-injected reader for exactly two kernel-owned proc network tables.
// No connector, environment access, authority or automatic retry. The caller
// still binds projected LISTEN rows to the same PID/start-time and socket FDs.
export function readCheckoutProcNetworkTable(fs,file,onStage=()=>{}){
 const paths=['/proc/net/tcp','/proc/net/tcp6'];
 if(!paths.includes(file))throw Error('proc_table_path_refused');
 const keys=['dev','ino','nlink','uid','gid','mode','bytes','mtimeNs','ctimeNs'];
 const timestamps=['mtimeNs','ctimeNs'];
 const identity=s=>({dev:String(s.dev),ino:String(s.ino),nlink:Number(s.nlink),uid:Number(s.uid),gid:Number(s.gid),mode:Number(s.mode),bytes:Number(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)});
 const differences=(a,b)=>keys.filter(k=>a[k]!==b[k]);
 const reject=(code,fields=[])=>{throw Object.assign(Error(code),{changedFields:fields});};
 function shape(s){
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.uid!==0n||s.gid!==0n||s.size!==0n||(s.mode&0o170000n)!==0o100000n||(s.mode&0o7777n)!==0o444n)reject('proc_table_metadata_refused');
  return identity(s);
 }
 // Node exposes statfsSync(path), not fstatfsSync(fd). Linux's own numeric
 // descriptor link resolves to this still-open object, not a fresh table open.
 function procfs(fd){if(!Number.isSafeInteger(fd)||fd<0)reject('proc_table_metadata_refused');const s=fs.statfsSync('/proc/self/fd/'+fd,{bigint:true});if(s.type!==0x9fa0n)reject('proc_table_filesystem_refused');}
 onStage('before_metadata');const pathBefore=shape(fs.lstatSync(file,{bigint:true}));
 onStage('open_readonly');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  onStage('procfs_before');procfs(fd);
  onStage('open_identity');const opened=shape(fs.fstatSync(fd,{bigint:true})),openingDiff=differences(pathBefore,opened);
  if(openingDiff.some(k=>!timestamps.includes(k)))reject('metadata_file_changed',openingDiff);
  onStage('read_bound');const max=1048576,bytes=Buffer.alloc(max+1);let n=0,k;
  while(n<bytes.length&&(k=fs.readSync(fd,bytes,n,bytes.length-n,null))>0)n+=k;
  if(n>max)reject('metadata_file_changed',['readBytes']);
  onStage('after_fd_identity');const afterFd=shape(fs.fstatSync(fd,{bigint:true})),fdDiff=differences(opened,afterFd);
  // Times remain strict for the SAME open file description; only path lookups
  // of these verified procfs tables have different timestamp semantics.
  if(fdDiff.length)reject('metadata_file_changed',fdDiff);
  onStage('procfs_after');procfs(fd);
  onStage('after_path_identity');const pathAfter=shape(fs.lstatSync(file,{bigint:true})),closingDiff=differences(opened,pathAfter);
  if(closingDiff.some(k=>!timestamps.includes(k)))reject('metadata_file_changed',closingDiff);
  onStage('utf8_decode');const wire=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,n));
  return {wire,identity:opened,proof:{path:file,procfsVerified:true,descriptorMetadataStable:true,pathIdentityStable:true,pathTimestampDifferencesBefore:openingDiff,pathTimestampDifferencesAfter:closingDiff,ordinaryFilePolicyChanged:false,productionAuthorized:false}};
 }finally{fs.closeSync(fd);}
}
