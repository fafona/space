// The reboot entry owns this one complete tail. Ordinary readers remain strict.
// All old evidence bytes/inodes are retained; a crash may finish only our exact
// pre-sealed files/head, never hide or adopt an unrelated incomplete history.
import * as fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {readOnlineRetentionHistory,ONLINE_RETENTION_FILES,buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {assertOnlineRetentionHistory,retentionCanonicalText,retentionHash,onlineRetentionHeadRecord} from './online-release-retention-policy.mjs';
const need=(v,c)=>{if(!v)throw Error('host_reboot_journal_'+c);},same=(a,b)=>need(isDeepStrictEqual(a,b),'changed');
const id=s=>[s.dev,s.ino,s.uid,s.mode];
const fileId=s=>[...id(s),s.nlink,s.size,s.mtimeMs,s.ctimeMs];
export function createHostRebootTailJournal({history,receipt,directory,root='/var/lib/faolla-online-retention',io=fs,readHistory=readOnlineRetentionHistory}){
 assertOnlineRetentionHistory(history);const certificate=receipt.certificate;
 need(certificate.kind==='host-reboot'&&receipt.files instanceof Map&&receipt.files.size===5,'scope');
 const parse=file=>JSON.parse(receipt.files.get(file));
 const derived=buildOnlineRetentionReceipt(parse('before.json'),parse('after.json'),parse('recovery-pm2.json'),history,{preparedAt:parse('prepared.json').preparedAt,completedAt:certificate.completedAt});
 same(derived.certificate,certificate);for(const file of ONLINE_RETENTION_FILES)same(derived.files.get(file),receipt.files.get(file));
 const next={...structuredClone(history),entries:[...structuredClone(history.entries),certificate],headSha256:retentionHash(certificate)};
 assertOnlineRetentionHistory(next);
 const name=String(certificate.sequence).padStart(6,'0'),tail=root+'/'+name,stage=directory+'/retention-tail',head=root+'.head.json',pending=head+'.host-reboot-pending';
 need(certificate.previousSha256===history.headSha256&&certificate.sequence===history.entries.length+1&&path.posix.isAbsolute(directory)&&path.posix.normalize(directory)===directory,'binding');
 const exists=p=>{try{io.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 const owned=(p,file,privateMode=true)=>{const s=io.lstatSync(p);need(s.uid===0&&!s.isSymbolicLink()&&(file?s.isFile()&&s.nlink===1:s.isDirectory())&&!(s.mode&0o022)&&(!privateMode||(s.mode&0o777)===(file?0o600:0o700))&&io.realpathSync(p)===p,'owned');return s;};
 for(let p=directory;;p=path.posix.dirname(p)){owned(p,false,p===directory);if(p==='/')break;}
 owned(root,false);const rootId=id(io.lstatSync(root));
 const read=p=>{const s=owned(p,true),fd=io.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{same(fileId(io.fstatSync(fd)),fileId(s));const b=io.readFileSync(fd,'utf8');same(fileId(io.fstatSync(fd)),fileId(s));same(fileId(io.lstatSync(p)),fileId(s));need(Buffer.byteLength(b)===s.size,'read');return b;}finally{io.closeSync(fd);}};
 const sync=p=>{const fd=io.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}};
 const write=(p,text)=>{const fd=io.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{io.writeFileSync(fd,text);io.fsyncSync(fd);}finally{io.closeSync(fd);}sync(path.posix.dirname(p));same(read(p),text);};
 const verifyFiles=location=>{owned(location,false);same(io.readdirSync(location).sort(),[...ONLINE_RETENTION_FILES].sort());for(const file of ONLINE_RETENTION_FILES)same(read(location+'/'+file),receipt.files.get(file));};
 const prefix=()=>{
  same(id(io.lstatSync(root)),rootId);
  if(!exists(tail)){same(readHistory(root,io),history);return history;}
  verifyFiles(tail);same(io.readdirSync(root).sort(),Array.from({length:certificate.sequence},(_,i)=>String(i+1).padStart(6,'0')));
  const headText=read(head);
  if(headText===retentionCanonicalText(onlineRetentionHeadRecord(next))){same(readHistory(root,io),next);return next;}
  same(headText,retentionCanonicalText(onlineRetentionHeadRecord(history)));
  const view=Object.create(io);view.readdirSync=(p,...args)=>p===root?io.readdirSync(p,...args).filter(n=>n!==name):io.readdirSync(p,...args);
  same(readHistory(root,view),history);return history;
 };
 return{prefix,commit(){
  const observed=prefix();if(observed.headSha256===next.headSha256)return observed;
  if(!exists(tail)){
   if(!exists(stage)){io.mkdirSync(stage,{mode:0o700});sync(directory);}owned(stage,false);
   need(io.readdirSync(stage).every(n=>ONLINE_RETENTION_FILES.includes(n)),'foreign_stage');
   for(const file of ONLINE_RETENTION_FILES){const p=stage+'/'+file,text=receipt.files.get(file);need(typeof text==='string','files');if(exists(p))same(read(p),text);else write(p,text);}
   verifyFiles(stage);
   // Existing exact files may come from a crash before their fsync returned.
   for(const file of ONLINE_RETENTION_FILES){const fd=io.openSync(stage+'/'+file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
   sync(stage);prefix();need(!exists(tail),'tail_appeared');io.renameSync(stage,tail);sync(directory);sync(root);
  }
  prefix();const text=retentionCanonicalText(onlineRetentionHeadRecord(next));
  if(exists(pending))same(read(pending),text);else write(pending,text);
  prefix();io.renameSync(pending,head);sync(path.posix.dirname(root));same(readHistory(root,io),next);return next;
 }};
}
