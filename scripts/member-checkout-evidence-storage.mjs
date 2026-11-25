// Immutable Linux storage primitive, NOT installation/production authority.
// Opens TWO externally provisioned private sibling directories. No mkdir of a
// root, database connector, configuration discovery, deletion or repair API.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
const limits={source:2097152,baseline:4194304,prepared:65536,confirmation:65536};
const stages=['initial','prepared','confirmed'],kinds=['source','baseline','prepared','confirmation'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const fail=code=>{throw Error('checkout_evidence_'+code);},need=(value,code)=>{if(!value)fail(code);};
const exact=(value,keys)=>need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|'),'shape_invalid');
const hash=value=>need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'hash_invalid');
function json(wire,limit){
 need(typeof wire==='string'&&Buffer.byteLength(wire)>0&&Buffer.byteLength(wire)<=limit,'wire_invalid');
 const value=JSON.parse(wire);need(canonical(value)===wire,'wire_not_canonical');return value;
}
function binding(wire){
 const value=json(wire,16384);exact(value,['version','kind','operationId','sourceBundleSha256','targetSha256','beforeSha256','priorRegistrySha256']);
 need(value.version===1&&value.kind==='checkout-installation-storage-binding-v1','binding_invalid');
 need(typeof value.operationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.operationId),'operation_invalid');
 for(const key of ['sourceBundleSha256','targetSha256','beforeSha256','priorRegistrySha256'])hash(value[key]);return value;
}
export function validateCheckoutEvidenceBinding(wire){try{return freeze(binding(wire));}catch{fail('binding_invalid');}}
function values(value,keys){
 need(value&&typeof value==='object'&&!isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype,'options_invalid');
 need(Reflect.ownKeys(value).every(key=>typeof key==='string'),'options_invalid');
 const descriptors=Object.getOwnPropertyDescriptors(value);exact(descriptors,keys);
 for(const descriptor of Object.values(descriptors))need(descriptor.enumerable&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string','options_invalid');
 return Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
}
const identity=stat=>Object.fromEntries(['dev','ino','uid','gid'].map(key=>[key,String(stat[key])]).concat([['mode',(stat.mode&0o7777n).toString(8)]]));
const same=(a,b)=>canonical(a)===canonical(b);
const fileIdentity=stat=>({...identity(stat),size:String(stat.size),mtime:String(stat.mtimeNs),ctime:String(stat.ctimeNs),links:String(stat.nlink)});
const statAt=file=>fs.lstatSync(file,{bigint:true});
const privateDirectory=stat=>need(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===BigInt(process.getuid())&&(stat.mode&0o7777n)===0o700n,'directory_private_required');
function ancestors(root){const parts=root.split('/').filter(Boolean),result=['/'];for(const part of parts)result.push(path.posix.join(result.at(-1),part));return result;}
function checkedRoot(root){
 need(typeof root==='string'&&root.length<4096&&path.posix.isAbsolute(root)&&path.posix.normalize(root)===root&&!root.includes('\0')&&root.split('/').filter(Boolean).length>=2,'root_invalid');
 const result=ancestors(root).map(file=>{const stat=statAt(file);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&fs.realpathSync(file)===file,'ancestor_invalid');
  need(stat.uid===0n||stat.uid===BigInt(process.getuid()),'ancestor_owner_invalid');
  need((stat.mode&0o022n)===0n||stat.uid===0n&&(stat.mode&0o1000n)!==0n,'ancestor_writable');return {file,identity:identity(stat)};
 });privateDirectory(statAt(path.dirname(root)));privateDirectory(statAt(root));return result;
}
function safe(run){try{return run();}catch(error){
 if(typeof error?.message==='string'&&/^checkout_evidence_[a-z_]+$/.test(error.message))throw error;
 if(error?.code==='EEXIST')fail('conflict');fail('unavailable');
}}

export function openCheckoutEvidenceStorage(input){return safe(()=>{
 need(process.platform==='linux'&&typeof process.getuid==='function','platform_unsupported');
 const roots=values(input,['dataRoot','locatorRoot']);need(roots.dataRoot!==roots.locatorRoot&&path.dirname(roots.dataRoot)===path.dirname(roots.locatorRoot),'roots_not_private_siblings');
 const chains=[checkedRoot(roots.dataRoot),checkedRoot(roots.locatorRoot)],fds=[];
 try{
  for(const root of Object.values(roots))fds.push(fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW));
  const pinned={data:identity(fs.fstatSync(fds[0],{bigint:true})),locators:identity(fs.fstatSync(fds[1],{bigint:true}))};let closed=false;
  const anchored=(fd,name)=>'/proc/self/fd/'+fd+'/'+name;
  const check=()=>{
   need(!closed,'closed');for(const chain of chains)for(const item of chain)need(same(identity(statAt(item.file)),item.identity),'root_changed');
   need(same(identity(fs.fstatSync(fds[0],{bigint:true})),pinned.data)&&same(identity(fs.fstatSync(fds[1],{bigint:true})),pinned.locators),'root_changed');
  };
  const privateFile=(stat,max)=>need(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===BigInt(process.getuid())&&(stat.mode&0o7777n)===0o600n&&stat.nlink===1n&&stat.size>0n&&stat.size<=BigInt(max),'file_private_required');
  const read=(fd,name,max)=>{
   const file=anchored(fd,name),before=statAt(file);privateFile(before,max);
   const handle=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   try{
    need(same(fileIdentity(fs.fstatSync(handle,{bigint:true})),fileIdentity(before)),'file_changed');
    const bytes=Buffer.alloc(Number(before.size)+1);let count=0,n;
    while(count<bytes.length&&(n=fs.readSync(handle,bytes,count,bytes.length-count,null))>0)count+=n;
    need(count===Number(before.size)&&same(fileIdentity(fs.fstatSync(handle,{bigint:true})),fileIdentity(before))&&same(fileIdentity(statAt(file)),fileIdentity(before)),'file_changed');
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,count));
   }finally{fs.closeSync(handle);}
  };
  const write=(fd,name,wire,max)=>{
   json(wire,max);check();const handle=fs.openSync(anchored(fd,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   try{fs.writeFileSync(handle,wire,'utf8');fs.fsyncSync(handle);privateFile(fs.fstatSync(handle,{bigint:true}),max);}finally{fs.closeSync(handle);}
   fs.fsyncSync(fd);need(read(fd,name,max)===wire,'readback_failed');check();
  };
  const opFd=(operationId,expected)=>{
   check();const handle=fs.openSync(anchored(fds[0],operationId),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
   try{const stat=fs.fstatSync(handle,{bigint:true});privateDirectory(stat);if(expected)need(same(identity(stat),expected),'operation_changed');return handle;}catch(error){fs.closeSync(handle);throw error;}
  };
  const locatorName=(op,stage)=>op+'.'+stage+'.json';
  const parseLocator=wire=>{
   const value=json(wire,32768);exact(value,['version','kind','stage','binding','roots','rootIdentity','operationIdentity','artifacts','parentSha256','productionAuthorized']);
   need(value.version===1&&value.kind==='checkout-installation-storage-locator-v1'&&stages.includes(value.stage)&&value.productionAuthorized===false,'locator_invalid');
   binding(canonical(value.binding));need(same(value.roots,roots)&&same(value.rootIdentity,pinned),'locator_root_changed');
   exact(value.operationIdentity,['dev','ino','uid','gid','mode']);need(Object.values(value.operationIdentity).every(v=>typeof v==='string'&&/^[0-9]+$/.test(v)),'locator_identity_invalid');
   need(Array.isArray(value.artifacts)&&value.artifacts.length===stages.indexOf(value.stage)+2,'locator_artifacts_invalid');
   for(const [i,item] of value.artifacts.entries()){exact(item,['kind','sha256','bytes']);need(item.kind===kinds[i]&&Number.isSafeInteger(item.bytes)&&item.bytes>0&&item.bytes<=limits[item.kind],'locator_artifacts_invalid');hash(item.sha256);}
   if(value.stage==='initial')need(value.parentSha256===null,'locator_parent_invalid');else hash(value.parentSha256);return value;
  };
  const resolve=wire=>{
   check();const value=parseLocator(wire),op=value.binding.operationId;let previous=null;
   for(let i=0;i<=stages.indexOf(value.stage);i++){
    const storedWire=read(fds[1],locatorName(op,stages[i]),32768),stored=parseLocator(storedWire);
    need(stored.stage===stages[i]&&same(stored.binding,value.binding)&&same(stored.operationIdentity,value.operationIdentity),'locator_chain_changed');
    if(previous)need(stored.parentSha256===sha(previous.wire)&&same(stored.artifacts.slice(0,-1),previous.value.artifacts),'locator_chain_changed');
    previous={wire:storedWire,value:stored};
   }
   need(previous.wire===wire,'locator_not_independently_stored');const handle=opFd(op,value.operationIdentity),artifacts={};
   try{for(const item of value.artifacts){const body=read(handle,item.kind+'.json',limits[item.kind]);json(body,limits[item.kind]);need(sha(body)===item.sha256&&Buffer.byteLength(body)===item.bytes,'artifact_changed');artifacts[item.kind]=body;}}
   finally{fs.closeSync(handle);}check();return {locator:value,artifacts};
  };
  const begin=input=>safe(()=>{
   check();const {bindingWire,sourceWire,baselineWire}=values(input,['bindingWire','sourceWire','baselineWire']),bound=binding(bindingWire);json(sourceWire,limits.source);json(baselineWire,limits.baseline);
   fs.mkdirSync(anchored(fds[0],bound.operationId),{mode:0o700});fs.fsyncSync(fds[0]);const handle=opFd(bound.operationId);
   let operationIdentity;try{
    operationIdentity=identity(fs.fstatSync(handle,{bigint:true}));write(handle,'source.json',sourceWire,limits.source);write(handle,'baseline.json',baselineWire,limits.baseline);
   }finally{fs.closeSync(handle);}
   const locator={version:1,kind:'checkout-installation-storage-locator-v1',stage:'initial',binding:bound,roots,rootIdentity:pinned,operationIdentity,
    artifacts:[['source',sourceWire],['baseline',baselineWire]].map(([kind,body])=>({kind,sha256:sha(body),bytes:Buffer.byteLength(body)})),parentSha256:null,productionAuthorized:false};
   const wire=canonical(locator);write(fds[1],locatorName(bound.operationId,'initial'),wire,32768);resolve(wire);return wire;
  });
  const append=(locatorWire,kind,body)=>safe(()=>{
   const previous=resolve(locatorWire),next=previous.locator.stage==='initial'?'prepared':previous.locator.stage==='prepared'?'confirmation':null;
   need(kind===next&&next!==null,'stage_invalid');json(body,limits[kind]);const handle=opFd(previous.locator.binding.operationId,previous.locator.operationIdentity);
   try{write(handle,kind+'.json',body,limits[kind]);}finally{fs.closeSync(handle);}
   const value={...previous.locator,stage:kind==='prepared'?'prepared':'confirmed',artifacts:[...previous.locator.artifacts,{kind,sha256:sha(body),bytes:Buffer.byteLength(body)}],parentSha256:sha(locatorWire)};
   const wire=canonical(value);write(fds[1],locatorName(value.binding.operationId,value.stage),wire,32768);resolve(wire);return wire;
  });
  const locate=(operationId,stage)=>safe(()=>{
   check();need(typeof operationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(operationId)&&stages.includes(stage),'locator_request_invalid');
   const wire=read(fds[1],locatorName(operationId,stage),32768);resolve(wire);return wire;
  });
  check();for(const fd of fds)fs.fsyncSync(fd);
  return Object.freeze({begin,append,locate,read:wire=>safe(()=>freeze(resolve(wire))),close:()=>safe(()=>{if(!closed){closed=true;for(const fd of fds)fs.closeSync(fd);}})});
 }catch(error){for(const fd of fds)try{fs.closeSync(fd);}catch{}throw error;}
});}
