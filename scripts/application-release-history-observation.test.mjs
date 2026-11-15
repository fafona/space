import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifiedHistoryObservation,snapshotRetentionProofFiles} from './application-release-history-observation.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';
const roots=['/var/lib/history','/var/lib/rolling','/var/lib/legacy'];
function fixture(){
 const nodes=new Map(),fds=new Map();let serial=1;
 const add=(name,directory,bytes='proof')=>nodes.set(name,{directory,bytes:Buffer.from(bytes),ino:BigInt(serial++),mode:directory?0o40700n:0o100600n,uid:0n,nlink:1n,mtimeNs:1n,ctimeNs:1n});
 ['/', '/var','/var/lib',...roots,roots[0]+'/000001'].forEach(p=>add(p,true));
 [roots[0]+'/000001/certificate.json',roots[0]+'.head.json',roots[1]+'/before.json',roots[2]+'/after.json'].forEach(p=>add(p,false));
 const stat=p=>{const n=nodes.get(p);if(!n)throw Object.assign(Error('ENOENT'),{code:'ENOENT'});return{...n,dev:1n,size:BigInt(n.directory?0:n.bytes.length),isDirectory:()=>n.directory,isFile:()=>!n.directory,isSymbolicLink:()=>!!n.symlink};};
 const io={lstatSync:stat,realpathSync:p=>nodes.get(p)?.redirect??p,
  readdirSync:p=>[...nodes.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(k=>k.slice(p.length+1)),
  openSync:(p,flags)=>{assert.equal(flags&3,0);const fd=serial++;fds.set(fd,p);return fd;},
  fstatSync:fd=>stat(fds.get(fd)),readFileSync:fd=>Buffer.from(nodes.get(fds.get(fd)).bytes),closeSync:fd=>fds.delete(fd)};
 return{nodes,add,io,fds,snapshot:()=>snapshotRetentionProofFiles(io,roots)};
}
test('all raw generations and the head are witnessed without opening any write path',()=>{
 const f=fixture(),s=f.snapshot();assert.equal(s.filter(x=>x[1]==='file').length,4);assert.equal(f.fds.size,0);
 assert.deepEqual(f.snapshot(),s);
});
for(const change of [
 f=>f.nodes.get(roots[0]+'/000001/certificate.json').bytes=Buffer.from('other'),
 f=>f.nodes.get(roots[0]+'.head.json').ino++,
 f=>f.nodes.get(roots[1]+'/before.json').ctimeNs++,
 f=>f.nodes.get(roots[2]+'/after.json').bytes=Buffer.from('other'),
 f=>f.add(roots[0]+'/unexpected.json',false),
 f=>f.nodes.delete(roots[0]+'/000001/certificate.json'),
 f=>f.nodes.get('/var/lib').ino++,
])test('every byte, inode, timestamp, ancestor and listing change refuses the observation',()=>{
 const f=fixture(),o=createVerifiedHistoryObservation({snapshot:f.snapshot,read:()=>({entries:[1]})});change(f);
 assert.throws(o.verify,/raw_proofs_changed/);
});
for(const mutate of [n=>n.symlink=true,n=>n.uid=1n,n=>n.mode=0o100644n,n=>n.nlink=2n,n=>n.redirect='/elsewhere'])
 test('unsafe proof ownership, link or redirection is rejected rather than cached',()=>{
  const f=fixture();mutate(f.nodes.get(roots[0]+'.head.json'));assert.throws(f.snapshot,/unsafe_path/);assert.equal(f.fds.size,0);
 });
test('absent legacy roots and head cannot silently appear',()=>{
 const f=fixture();for(const p of [...f.nodes.keys()])if(p.startsWith(roots[2]))f.nodes.delete(p);
 const o=createVerifiedHistoryObservation({snapshot:f.snapshot,read:()=>({entries:[]})});f.add(roots[2],true);assert.throws(o.verify,/raw_proofs_changed/);
});
test('semantic validation runs before and after, but never on each intermediate byte check',()=>{
 const f=fixture();let reads=0;const o=createVerifiedHistoryObservation({snapshot:f.snapshot,read:()=>{reads++;return{entries:[1]};}});
 for(let i=0;i<20;i++)o.verify();assert.equal(reads,1);o.finish();assert.equal(reads,2);assert.throws(o.verify,/closed/);assert.throws(o.finish,/closed/);
 assert.throws(()=>createVerifiedHistoryObservation({snapshot:f.snapshot,read:()=>{throw Error('original_semantic_guard');}}),/original_semantic_guard/);
});
test('mutation during initial validation and semantic drift at final validation cannot pass',()=>{
 const f=fixture();assert.throws(()=>createVerifiedHistoryObservation({snapshot:f.snapshot,read:()=>{f.nodes.get(roots[0]+'.head.json').ctimeNs++;return{};}}),/changed_during_validation/);
 let reads=0;const o=createVerifiedHistoryObservation({snapshot:f.snapshot,read:()=>({sequence:++reads})});assert.throws(o.finish,/history_changed/);assert.throws(o.verify,/closed/);
});
test('six fresh proof checks do not repeat six expensive semantic parses inside the unchanged 30-second budget',async()=>{
 let clock=0,reads=0,checks=0;const o=createVerifiedHistoryObservation({snapshot:()=>{clock+=20;return ['all-bytes-and-identities'];},read:()=>{clock+=5400;reads++;return{entries:49};}});
 const started=clock;
 const proof=await proveRecoveryTargets({origins:['https://one.invalid','https://two.invalid'],target:'a'.repeat(40),operationId:'10000000-0000-4000-8000-000000000001',
  verify:()=>{checks++;o.verify();},deadlineAtMs:started+30000,now:()=>clock,fetchImpl:async()=>new Response(JSON.stringify({ok:true,buildId:'a'.repeat(40)}))});
 assert.equal(proof.length,2);assert.equal(checks,5);assert.equal(reads,1);assert.ok(clock-started<30000);o.finish();assert.equal(reads,2);
});
