import test from 'node:test';
import assert from 'node:assert/strict';
import * as nativeFs from 'node:fs';
import {readCheckoutProcNetworkTable as read} from './member-checkout-proc-table-reader.mjs';
function stat(){return {dev:1n,ino:9001n,nlink:1n,uid:0n,gid:0n,mode:0o100444n,size:0n,mtimeNs:10n,ctimeNs:11n,isFile(){return (this.mode&0o170000n)===0o100000n;},isSymbolicLink(){return (this.mode&0o170000n)===0o120000n;}};}
function fixture({pathChange,fdChange,typeChange,wire='header\n',failRead=false}={}){
 let paths=0,fds=0,types=0,position=0,opened=false,closed=0;const stages=[],calls=[];
 const fs={constants:nativeFs.constants,
  lstatSync(file){calls.push(['lstat',file]);const s=stat();paths++;if(paths===2)pathChange?.(s);return s;},
  openSync(file,flags){calls.push(['open',file,flags]);assert.equal(flags&nativeFs.constants.O_WRONLY,0);opened=true;return 4;},
  fstatSync(fd){assert.equal(fd,4);const s=stat();fds++;if(fds===2)fdChange?.(s);return s;},
  statfsSync(path){assert.equal(path,'/proc/self/fd/4');types++;return {type:typeChange?.(types)??0x9fa0n};},
  readSync(fd,b,o,len){assert.equal(fd,4);if(failRead)throw Error('read_failed');const s=Buffer.isBuffer(wire)?wire:Buffer.from(wire),n=Math.min(len,s.length-position);s.copy(b,o,position,position+n);position+=n;return n;},
  closeSync(fd){assert.equal(fd,4);closed++;}
 };
 return {fs,stages,calls,read:file=>read(fs,file??'/proc/net/tcp',s=>stages.push(s)),state:()=>({paths,fds,types,opened,closed})};
}
test('exact IPv4 and IPv6 tables validate procfs and descriptor identities',()=>{for(const path of ['/proc/net/tcp','/proc/net/tcp6']){const f=fixture(),r=f.read(path);assert.equal(r.wire,'header\n');assert.equal(r.proof.procfsVerified,true);assert.equal(r.proof.descriptorMetadataStable,true);assert.equal(r.proof.pathIdentityStable,true);assert.equal(r.proof.ordinaryFilePolicyChanged,false);assert.equal(r.proof.productionAuthorized,false);assert.deepEqual(f.state(),{paths:2,fds:2,types:2,opened:true,closed:1});}});
test('production-observed path mtime/ctime changes no longer impersonate table identity changes',()=>{const f=fixture({pathChange:s=>{s.mtimeNs+=100n;s.ctimeNs+=100n;}}),r=f.read();assert.deepEqual(r.proof.pathTimestampDifferencesAfter,['mtimeNs','ctimeNs']);assert.deepEqual(r.proof.pathTimestampDifferencesBefore,[]);});
test('timestamp-only path lookup before open also requires verified procfs and same stable identity',()=>{const f=fixture(),lstat=f.fs.lstatSync;f.fs.lstatSync=file=>{const s=lstat(file);s.mtimeNs+=1n;s.ctimeNs+=1n;return s;};const r=f.read();assert.deepEqual(r.proof.pathTimestampDifferencesBefore,['mtimeNs','ctimeNs']);assert.deepEqual(r.proof.pathTimestampDifferencesAfter,['mtimeNs','ctimeNs']);});
test('ordinary, other proc, traversal and aliased paths refuse before any FS operation',()=>{for(const file of ['/tmp/tcp','/proc/1/stat','/proc/net/udp','/proc/net/../net/tcp','/proc/net/tcp/','/proc/self/net/tcp','/proc/1/net/tcp']){const f=fixture();assert.throws(()=>f.read(file),/proc_table_path_refused/);assert.equal(f.calls.length,0);}});
test('non-proc filesystem cannot use timestamp semantics',()=>{const f=fixture({typeChange:()=>0xef53n});assert.throws(()=>f.read(),/proc_table_filesystem_refused/);assert.equal(f.state().closed,1);assert.equal(f.state().fds,0);});
test('filesystem change after read refuses',()=>{const f=fixture({typeChange:n=>n===2?0x1021994n:0x9fa0n});assert.throws(()=>f.read(),/proc_table_filesystem_refused/);assert.equal(f.state().closed,1);});
for(const key of ['dev','ino','nlink','uid','gid','mode','size'])test('path '+key+' change still refuses and closes descriptor',()=>{const f=fixture({pathChange:s=>s[key]+=1n});assert.throws(()=>f.read());assert.equal(f.state().closed,1);});
for(const key of ['dev','ino','nlink','uid','gid','mode','size','mtimeNs','ctimeNs'])test('same descriptor '+key+' change still refuses and closes',()=>{const f=fixture({fdChange:s=>s[key]+=1n});assert.throws(()=>f.read());assert.equal(f.state().closed,1);});
test('before-open table must be single-link root-owned zero-size regular readonly metadata',()=>{for(const mutate of [s=>s.nlink=2n,s=>s.uid=1001n,s=>s.gid=1001n,s=>s.mode=0o100644n,s=>s.mode=0o120444n,s=>s.size=1n]){const f=fixture(),lstat=f.fs.lstatSync;f.fs.lstatSync=file=>{const s=lstat(file);mutate(s);return s;};assert.throws(()=>f.read(),/proc_table_metadata_refused/);assert.equal(f.state().opened,false);}});
test('byte bound is exactly one MiB plus refusal sentinel',()=>{const f=fixture({wire:'x'.repeat(1048577)});assert.throws(()=>f.read(),/metadata_file_changed/);assert.equal(f.state().closed,1);const g=fixture({wire:'x'.repeat(1048576)});assert.equal(g.read().wire.length,1048576);});
test('read and strict UTF-8 errors do not leak descriptor',()=>{for(const options of [{failRead:true},{wire:Buffer.from([0xff,0xff])}]){const f=fixture(options);assert.throws(()=>f.read());assert.equal(f.state().closed,1);}});
test('64-bit inode remains exact rather than rounded',()=>{const f=fixture(),ls=f.fs.lstatSync,st=f.fs.fstatSync;f.fs.lstatSync=p=>({...ls(p),ino:18446744073709551610n});f.fs.fstatSync=p=>({...st(p),ino:18446744073709551610n});assert.equal(f.read().identity.ino,'18446744073709551610');});
test('module contains no process connector, environment, configuration or write operation',()=>{const s=nativeFs.readFileSync(new URL('./member-checkout-proc-table-reader.mjs',import.meta.url),'utf8');for(const denied of ['node:fs','node:child_process','node:http','process.env','fetch(','writeFile','mkdir','rmSync','chmod','chown'])assert.ok(!s.includes(denied),denied);});
test('filesystem verification uses an existing Node API and only its own numeric descriptor link',()=>{assert.equal(typeof nativeFs.statfsSync,'function');const s=nativeFs.readFileSync(new URL('./member-checkout-proc-table-reader.mjs',import.meta.url),'utf8');assert.ok(s.includes("fs.statfsSync('/proc/self/fd/'+fd,{bigint:true})"));assert.ok(!s.includes('fs.fstatfsSync('));});
