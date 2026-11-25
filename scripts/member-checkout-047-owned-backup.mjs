// Explicit owned-CI file-loss rehearsal only. NOT a production backup/restore
// tool: original root and operation inode identities MUST still exist unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {assertCheckout047InterruptionCi} from './member-checkout-047-interruption-support.mjs';
import {openCheckoutEvidenceStorage,validateCheckoutEvidenceBinding} from './member-checkout-evidence-storage.mjs';
const tickets=new WeakSet(),maximum=8*1024*1024;
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=value=>createHash('sha256').update(value).digest('hex');
const identity=stat=>Object.fromEntries(['dev','ino','uid','gid'].map(k=>[k,String(stat[k])]).concat([['mode',(stat.mode&0o7777n).toString(8)]]));
const privateDirectory=stat=>assert.ok(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===BigInt(process.getuid())&&(stat.mode&0o7777n)===0o700n,'owned_backup_directory_invalid');
const privateFile=stat=>assert.ok(stat.isFile()&&stat.nlink===1n&&stat.uid===BigInt(process.getuid())&&(stat.mode&0o7777n)===0o600n&&stat.size>0n&&stat.size<=BigInt(maximum),'owned_backup_file_invalid');
function backupDirectory(root){
 assertCheckout047InterruptionCi();assert.equal(path.dirname(root),fs.realpathSync(tmpdir()));assert.match(path.basename(root),/^faolla-checkout-backup-test-[A-Za-z0-9]+$/);
 const initial=fs.lstatSync(root,{bigint:true});privateDirectory(initial);assert.equal(fs.realpathSync(root),root);
 const fd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),identity(initial));return fd;}catch(error){fs.closeSync(fd);throw error;}
}
function write(fd,name,wire){
 assert.ok(Buffer.byteLength(wire)>0&&Buffer.byteLength(wire)<=maximum);const file=fs.openSync('/proc/self/fd/'+fd+'/'+name,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(file,wire,'utf8');fs.fsyncSync(file);privateFile(fs.fstatSync(file,{bigint:true}));}finally{fs.closeSync(file);}fs.fsyncSync(fd);
}
function read(fd,name){
 const file='/proc/self/fd/'+fd+'/'+name,before=fs.lstatSync(file,{bigint:true});privateFile(before);
 const handle=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const first=fs.fstatSync(handle,{bigint:true});assert.deepEqual(first,before);
  const bytes=Buffer.alloc(Number(first.size)+1);let count=0,n;while(count<bytes.length&&(n=fs.readSync(handle,bytes,count,bytes.length-count,null))>0)count+=n;
  assert.equal(count,Number(first.size));const after=fs.fstatSync(handle,{bigint:true});
  for(const key of ['dev','ino','mode','uid','gid','nlink','size','mtimeNs','ctimeNs']){assert.equal(after[key],first[key]);assert.equal(fs.lstatSync(file,{bigint:true})[key],first[key]);}
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,count));
 }finally{fs.closeSync(handle);}
}
export function createOwned047FileBackup(store,locatorWire,root){
 assertCheckout047InterruptionCi();const {locator,artifacts}=store.read(locatorWire),stages=['initial','prepared','confirmed'].slice(0,locator.artifacts.length-1);
 const image={version:1,scope:'owned-ci-original-directory-file-loss-only',locatorWire,locators:stages.map(stage=>store.locate(locator.binding.operationId,stage)),artifacts};
 const wire=canonical(image);assert.ok(Buffer.byteLength(wire)<=maximum);const fd=backupDirectory(root),file=randomUUID()+'.json';
 try{write(fd,file,wire);assert.equal(read(fd,file),wire);}finally{fs.closeSync(fd);}
 const ticket=Object.freeze({root,file,sha256:sha(wire),bytes:Buffer.byteLength(wire),productionAuthorized:false});tickets.add(ticket);return ticket;
}
export function restoreOwned047FileBackup(ticket,roots){
 assertCheckout047InterruptionCi();assert.ok(tickets.has(ticket),'owned_backup_receipt_unverified');const backup=backupDirectory(ticket.root);let wire;
 try{wire=read(backup,ticket.file);}finally{fs.closeSync(backup);}
 assert.equal(Buffer.byteLength(wire),ticket.bytes);assert.equal(sha(wire),ticket.sha256,'owned_backup_bytes_changed');
 const image=JSON.parse(wire);assert.equal(canonical(image),wire);assert.equal(image.version,1);assert.equal(image.scope,'owned-ci-original-directory-file-loss-only');
 const locator=JSON.parse(image.locatorWire);validateCheckoutEvidenceBinding(canonical(locator.binding));assert.deepEqual(roots,locator.roots,'owned_backup_rebinding_refused');
 const operationId=locator.binding.operationId,handles=[];
 // Open the unchanged primitive first to validate all root ancestors. It still
 // has no repair API; this separate test helper writes ONLY absent owned files.
 const original=openCheckoutEvidenceStorage(roots);original.close();
 try{
  for(const [key,expected] of [['dataRoot',locator.rootIdentity.data],['locatorRoot',locator.rootIdentity.locators]]){
   const handle=fs.openSync(roots[key],fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);handles.push(handle);privateDirectory(fs.fstatSync(handle,{bigint:true}));assert.deepEqual(identity(fs.fstatSync(handle,{bigint:true})),expected);
  }
  const operation=fs.openSync('/proc/self/fd/'+handles[0]+'/'+operationId,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);handles.push(operation);privateDirectory(fs.fstatSync(operation,{bigint:true}));assert.deepEqual(identity(fs.fstatSync(operation,{bigint:true})),locator.operationIdentity,'owned_backup_operation_rebinding_refused');
  const stages=['initial','prepared','confirmed'].slice(0,locator.artifacts.length-1),files=[];
  assert.equal(image.locators.length,stages.length);assert.deepEqual(Object.keys(image.artifacts).sort(),locator.artifacts.map(v=>v.kind).sort());
  for(const item of locator.artifacts){assert.ok(['source','baseline','prepared','confirmation'].includes(item.kind));assert.equal(sha(image.artifacts[item.kind]),item.sha256);assert.equal(Buffer.byteLength(image.artifacts[item.kind]),item.bytes);files.push([operation,item.kind+'.json',image.artifacts[item.kind]]);}
  for(const [i,body] of image.locators.entries()){assert.equal(JSON.parse(body).stage,stages[i]);assert.equal(JSON.parse(body).binding.operationId,operationId);files.push([handles[1],operationId+'.'+stages[i]+'.json',body]);}
  for(const [fd,name] of files){let absent=false;try{fs.lstatSync('/proc/self/fd/'+fd+'/'+name);}catch(error){if(error.code==='ENOENT')absent=true;else throw error;}assert.equal(absent,true,'owned_backup_conflict_retained');}
  for(const [fd,name,body] of files){write(fd,name,body);assert.equal(read(fd,name),body);}
  const reopened=openCheckoutEvidenceStorage(roots);try{assert.equal(reopened.locate(operationId,locator.stage),image.locatorWire);assert.deepEqual(reopened.read(image.locatorWire).artifacts,image.artifacts);}finally{reopened.close();}
  return Object.freeze({restoredFiles:files.length,backupSha256:ticket.sha256,originalDirectoryIdentitiesPreserved:true,productionAuthorized:false,hostLossRecoveryProved:false});
 }finally{for(const fd of handles.reverse())fs.closeSync(fd);}
}
