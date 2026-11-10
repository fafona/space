import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs';
import {hostRebootFixture} from './test-support/release-toolchain-host-reboot-fixture.mjs';
import {buildOnlineRetentionReceipt,ONLINE_RETENTION_FILES} from './online-release-retention.mjs';
import {retentionHash,retentionCanonicalText,onlineRetentionHeadRecord} from './online-release-retention-policy.mjs';
import {createHostRebootTailJournal} from './release-toolchain-host-reboot-journal.mjs';
function model(){
 const files=new Map(),dirs=new Set(['/','/proof','/retention']),fds=new Map(),inodes=new Map();let number=1,fd=10;
 const missing=()=>Object.assign(Error('missing'),{code:'ENOENT'}),stat=p=>{if(!files.has(p)&&!dirs.has(p))throw missing();if(!inodes.has(p))inodes.set(p,number++);return{dev:1,ino:inodes.get(p),uid:0,mode:files.has(p)?0o100600:0o40700,nlink:1,size:files.get(p)?.length??0,mtimeMs:1,ctimeMs:1,isFile:()=>files.has(p),isDirectory:()=>dirs.has(p),isSymbolicLink:()=>false};};
 const io={lstatSync:stat,realpathSync:p=>{stat(p);return p;},readdirSync:p=>[...new Set([...files.keys(),...dirs].filter(n=>n!==p&&n.startsWith(p+'/')).map(n=>n.slice(p.length+1).split('/')[0]))],mkdirSync:p=>{if(dirs.has(p))throw Error('exists');dirs.add(p);},openSync:(p,flags)=>{if(flags&fs.constants.O_EXCL&&files.has(p))throw Error('exists');if(flags&fs.constants.O_CREAT)files.set(p,Buffer.alloc(0));else stat(p);fds.set(fd,p);return fd++;},fstatSync:f=>stat(fds.get(f)),readFileSync:(p,encoding)=>{const b=files.get(typeof p==='number'?fds.get(p):p);if(!b)throw missing();return encoding?b.toString():Buffer.from(b);},writeFileSync:(f,text)=>files.set(fds.get(f),Buffer.from(text)),fsyncSync:f=>assert.ok(fds.has(f)),closeSync:f=>fds.delete(f),renameSync:(a,b)=>{stat(a);if(files.has(a)){files.set(b,files.get(a));files.delete(a);}else{dirs.delete(a);dirs.add(b);for(const p of [...files.keys()])if(p.startsWith(a+'/')){files.set(b+p.slice(a.length),files.get(p));files.delete(p);}}inodes.set(b,inodes.get(a));inodes.delete(a);}};
 return{files,dirs,fds,io};
}
function fixture(){
 const f=hostRebootFixture(),receipt=buildOnlineRetentionReceipt(f.before,f.after,{version:2,process:null},f.history,{preparedAt:f.before.hostReboot.window.startedAt,completedAt:'2026-11-10T10:01:00.000Z'}),next={...structuredClone(f.history),entries:[...structuredClone(f.history.entries),receipt.certificate],headSha256:retentionHash(receipt.certificate)},m=model();
 for(let i=1;i<=f.history.entries.length;i++){const d='/retention/'+String(i).padStart(6,'0');m.dirs.add(d);m.files.set(d+'/old-evidence',Buffer.from('old '+i));}
 m.files.set('/retention.head.json',Buffer.from(retentionCanonicalText(onlineRetentionHeadRecord(f.history))));
 const readHistory=(_root,io)=>{const names=io.readdirSync('/retention').sort(),head=JSON.parse(io.readFileSync('/retention.head.json','utf8'));
  if(head.headSha256===f.history.headSha256){assert.equal(names.length,f.history.entries.length,'an uncommitted visible tail must not be accepted');return structuredClone(f.history);}
  assert.equal(head.headSha256,next.headSha256);assert.equal(names.length,next.entries.length);for(const file of ONLINE_RETENTION_FILES)assert.equal(io.readFileSync('/retention/'+String(next.entries.length).padStart(6,'0')+'/'+file,'utf8'),receipt.files.get(file));return structuredClone(next);
 };
 return{...m,...f,receipt,next,readHistory};
}
test('every staged write, fsync and rename interruption can finish only its exact owned tail and never rewrites old proofs',()=>{
 const baseline=fixture();const called=[];const log=Object.create(baseline.io);for(const method of ['mkdirSync','writeFileSync','fsyncSync','renameSync'])log[method]=(...args)=>{const r=baseline.io[method](...args);called.push(method);return r;};createHostRebootTailJournal({history:baseline.history,receipt:baseline.receipt,directory:'/proof',root:'/retention',io:log,readHistory:baseline.readHistory}).commit();
 for(let cut=0;cut<called.length;cut++){
  const f=fixture(),old=new Map([...f.files].map(([p,b])=>[p,Buffer.from(b)]));let step=0;
  const io=Object.create(f.io);for(const method of ['mkdirSync','writeFileSync','fsyncSync','renameSync'])io[method]=(...args)=>{const r=f.io[method](...args);if(step++===cut)throw Error('owned-interruption');return r;};
  assert.throws(()=>createHostRebootTailJournal({history:f.history,receipt:f.receipt,directory:'/proof',root:'/retention',io,readHistory:f.readHistory}).commit(),/owned-interruption/);
  const result=createHostRebootTailJournal({history:f.history,receipt:f.receipt,directory:'/proof',root:'/retention',io:f.io,readHistory:f.readHistory}).commit();assert.deepEqual(result,f.next);
  for(const [p,b]of old)if(!p.endsWith('.head.json'))assert.deepEqual(f.files.get(p),b);
  assert.equal(f.fds.size,0);
 }
});
test('changed receipts, unknown tail/stage files and foreign heads cannot be adopted or overwritten',()=>{
 for(const change of [f=>f.files.set('/retention.head.json',Buffer.from('{"headSha256":"foreign"}')),f=>{f.dirs.add('/proof/retention-tail');f.files.set('/proof/retention-tail/foreign',Buffer.from('retained'));},f=>{const d='/retention/'+String(f.next.entries.length).padStart(6,'0');f.dirs.add(d);f.files.set(d+'/foreign',Buffer.from('retained'));},f=>f.receipt.files.set('after.json',f.receipt.files.get('after.json')+' ')]){const f=fixture();change(f);const original=new Map([...f.files].map(([p,b])=>[p,Buffer.from(b)]));assert.throws(()=>createHostRebootTailJournal({history:f.history,receipt:f.receipt,directory:'/proof',root:'/retention',io:f.io,readHistory:f.readHistory}).commit());for(const [p,b]of original)assert.deepEqual(f.files.get(p),b);assert.equal(f.fds.size,0);}
});
