// Invocation-local byte witness, never a persistent or caller-supplied cache.
// The unchanged semantic reader runs before AND after the public probe. Every
// intermediate check re-reads all raw proof bytes and directory/ancestor facts.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readOnlineRetentionHistory,ONLINE_RETENTION_ROOT} from './online-release-retention.mjs';
import {ONLINE_ROLLING_ROOT} from './online-release-rolling.mjs';
import {ONLINE_RETIREMENT_ROOT} from './online-release-retirement.mjs';
const need=(v,c)=>{if(!v)throw Error('application_history_observation_'+c);};
const equal=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
const fields=['dev','ino','mode','uid','nlink','size','mtimeNs','ctimeNs'];
const identity=s=>fields.map(k=>String(s[k]));
const ancestor=s=>['dev','ino','mode','uid'].map(k=>String(s[k]));
const hash=b=>createHash('sha256').update(b).digest('hex');
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

// Filesystem composition seam for isolated tests only; no writes or authority.
export function snapshotRetentionProofFiles(io,roots){
 need(Array.isArray(roots)&&roots.length===3&&new Set(roots).size===3&&roots.every(p=>p.startsWith('/')&&path.posix.normalize(p)===p&&p!=='/'),'roots');
 const result=[],parents=new Set();let files=0,total=0;
 const stat=p=>{try{return io.lstatSync(p,{bigint:true});}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const safe=(s,p,directory,privateMode)=>{
  need(s&&!s.isSymbolicLink()&&s.uid===0n&&(directory?s.isDirectory():s.isFile())&&
   (privateMode?(s.mode&0o777n)===(directory?0o700n:0o600n):(s.mode&0o022n)===0n)&&
   (directory||s.nlink===1n)&&io.realpathSync(p)===p,'unsafe_path');
 };
 for(const root of roots)for(let p=path.posix.dirname(root);;p=path.posix.dirname(p)){
  if(!parents.has(p)){const s=stat(p);safe(s,p,true,false);result.push([p,'ancestor',ancestor(s)]);parents.add(p);}
  if(p==='/')break;
 }
 const visit=(p,depth=0)=>{
  need(depth<=4&&result.length<10000,'tree_limit');const s=stat(p);
  if(!s){result.push([p,'absent']);return;}
  if(s.isDirectory()){
   safe(s,p,true,true);const names=io.readdirSync(p).sort();
   need(names.length<10000&&names.every(n=>/^[a-zA-Z0-9.-]+$/.test(n)&&n!=='.'&&n!=='..'),'listing');
   result.push([p,'directory',identity(s),names]);for(const n of names)visit(p+'/'+n,depth+1);
   equal(identity(stat(p)),identity(s),'directory_changed');equal(io.readdirSync(p).sort(),names,'listing_changed');
  }else{
   safe(s,p,false,true);need(s.size>0n&&s.size<=32n*1024n**2n&&++files<=10000,'file_limit');
   total+=Number(s.size);need(total<=512*1024**2,'bytes_limit');
   const fd=io.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   try{
    equal(identity(io.fstatSync(fd,{bigint:true})),identity(s),'file_replaced');
    const bytes=io.readFileSync(fd);need(Buffer.isBuffer(bytes)&&BigInt(bytes.length)===s.size,'file_changed');
    equal(identity(io.fstatSync(fd,{bigint:true})),identity(s),'file_changed');equal(identity(stat(p)),identity(s),'file_replaced');
    result.push([p,'file',identity(s),hash(bytes)]);
   }finally{io.closeSync(fd);}
  }
 };
 for(const root of roots)visit(root);
 visit(roots[0]+'.head.json');
 return result;
}

export function createVerifiedHistoryObservation({snapshot,read}){
 need(typeof snapshot==='function'&&typeof read==='function','composition');
 const original=snapshot(),history=read();equal(snapshot(),original,'changed_during_validation');
 const expected=structuredClone(history);let active=true;
 const verify=()=>{need(active,'closed');equal(snapshot(),original,'raw_proofs_changed');};
 return Object.freeze({history:freeze(structuredClone(history)),verify,
  finish(){need(active,'closed');try{verify();equal(read(),expected,'history_changed');verify();}finally{active=false;}}});
}

export function captureApplicationHistoryObservation(){
 need(arguments.length===0&&process.platform==='linux'&&process.getuid?.()===0,'invocation');
 return createVerifiedHistoryObservation({snapshot:()=>snapshotRetentionProofFiles(fs,[ONLINE_RETENTION_ROOT,ONLINE_ROLLING_ROOT,ONLINE_RETIREMENT_ROOT]),read:readOnlineRetentionHistory});
}
