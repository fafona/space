// A read-only lifetime witness, NOT maintenance or process-control authority.
// Keep the real proc dentry alive; never normalize/replace a captured fact or
// exempt a field from the original fresh-observation/peer/continuity guards.
import * as fs from 'node:fs';
import {isDeepStrictEqual,types} from 'node:util';
import {ownedReleasePath} from './release-toolchain-source.mjs';

const KEYS=['pid','parentPid','startTicks','processIdentity','uid','cwd','cwdIdentity','executable','executableIdentity','commandLine','commandLineDigest'];
const META=['dev','ino','size','mtimeNs','ctimeNs','nlink','uid','mode'];
const need=v=>{if(!v)throw Error('release_proc_directory_witness_unconfirmed');};
const same=(a,b)=>need(isDeepStrictEqual(a,b));
const identity=s=>META.map(k=>String(s[k])).join(':');
function directoryIdentity(value){
 need(typeof value==='string'&&/^\d{1,25}(?::\d{1,25}){7}$/.test(value));
 const fields=value.split(':').map(BigInt);need(fields[1]>0n&&fields[5]>0n&&fields[6]===0n&&(fields[7]&0o170000n)===0o040000n&&(fields[7]&0o022n)===0n);return value;
}
function processFact(value,pid,home,heldIdentity){
 need(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype);
 const d=Object.getOwnPropertyDescriptors(value);need(Reflect.ownKeys(d).length===KEYS.length&&KEYS.every(k=>d[k]?.enumerable&&Object.hasOwn(d[k],'value')));
 const copy=Object.fromEntries(KEYS.map(k=>[k,d[k].value]));
 need(copy.pid===pid&&copy.uid===0&&Number.isSafeInteger(copy.parentPid)&&copy.parentPid>=0&&typeof copy.startTicks==='string'&&/^[1-9]\d{0,24}$/.test(copy.startTicks)&&copy.processIdentity===heldIdentity&&copy.executable==='/usr/bin/node');
 same(copy.commandLine,['PM2 v6.0.14: God Daemon ('+home+')']);need(typeof copy.commandLineDigest==='string'&&/^[a-f0-9]{64}$/.test(copy.commandLineDigest));return structuredClone(copy);
}

// Explicit I/O composition seam for deterministic tests. No host authority,
// path lookup, process launch, RPC, save or retry is provided by this function.
// Production entry points below NEVER accept an I/O or PID/path override.
export async function executePinnedProcessDirectory(io,work){
 need(io&&typeof work==='function');const before=io.pidFile();
 need(before&&typeof before.text==='string'&&/^[1-9]\d{0,9}\n?$/.test(before.text));
 const pid=Number(before.text.trim());need(Number.isSafeInteger(pid)&&pid<=2147483647);
 const boot=io.boot();need(typeof boot==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(boot));
 let fd=null,originalError=null,active=false;
 try{
  // Open BEFORE the first process sample. Otherwise even that first sample
  // can lose its unreferenced proc dentry during a later source/archive read.
  fd=io.openDirectory(pid);need(Number.isSafeInteger(fd)&&fd>=0);
  const heldIdentity=directoryIdentity(io.fdIdentity(fd));same(directoryIdentity(io.pathIdentity(pid)),heldIdentity);
  const frozen=processFact(io.process(pid),pid,io.home,heldIdentity);active=true;
  const verify=()=>{need(active);same(io.pidFile(),before);same(io.boot(),boot);same(directoryIdentity(io.fdIdentity(fd)),heldIdentity);same(directoryIdentity(io.pathIdentity(pid)),heldIdentity);same(processFact(io.process(pid),pid,io.home,heldIdentity),frozen);};
  verify();const result=await work(verify);verify();return result;
 }catch(error){originalError=error;throw error;}
 finally{active=false;if(fd!==null)try{io.closeDirectory(fd);}catch(error){if(!originalError)throw error;}}
}
function runtime(){need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&process.version==='v20.20.1'&&process.argv[1]&&process.argv[1]!=='-');}
async function actualIo(home){
 // Keep importing this resource module side-effect-free even for stdin. The
 // legacy fact module must only load after a real, guarded runtime invocation.
 const{captureProcessFact}=await import('./check-production-runtime-supervision.mjs');
 ownedReleasePath(home,{directory:true});const file=home+'/pm2.pid';
 return{home,
  pidFile:()=>{ownedReleasePath(file);const before=fs.lstatSync(file,{bigint:true});need(before.size>0n&&before.size<=32n);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{same(identity(fs.fstatSync(fd,{bigint:true})),identity(before));const text=fs.readFileSync(fd,'utf8');same(identity(fs.fstatSync(fd,{bigint:true})),identity(before));ownedReleasePath(file);same(identity(fs.lstatSync(file,{bigint:true})),identity(before));return{text,identity:identity(before)};}finally{fs.closeSync(fd);}},
  boot:()=>fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),
  openDirectory:pid=>fs.openSync('/proc/'+pid,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW),
  fdIdentity:fd=>identity(fs.fstatSync(fd,{bigint:true})),
  pathIdentity:pid=>identity(fs.lstatSync('/proc/'+pid,{bigint:true})),
  process:captureProcessFact,closeDirectory:fd=>fs.closeSync(fd)};
}
export async function withPinnedFormalPm2Process(work){need(arguments.length===1);runtime();return executePinnedProcessDirectory(await actualIo('/root/.pm2'),work);}
// Real native proof only, not a selectable formal-host override.
export async function withOwnedCiPm2ProcessWitness(root,work){
 need(arguments.length===2);runtime();need(process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&process.env.FAOLLA_RELEASE_PRODUCTION_EQ==='1'&&typeof root==='string'&&/^\/var\/lib\/faolla-eq-[A-Za-z0-9]+$/.test(root)&&!['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'].some(file=>fs.existsSync(file)));
 ownedReleasePath(root,{directory:true,privateMode:true});return executePinnedProcessDirectory(await actualIo(root+'/pm2'),work);
}
