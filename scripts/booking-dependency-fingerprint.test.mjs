import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {BOOKING_DEPENDENCY_MODE_SHA256 as MODE,assertBookingDependencyBinding} from './booking-dependency-fingerprint.mjs';
import {BOOKING_BUILT_SMOKE_PINS as P} from './booking-built-smoke-repair-policy.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C} from './booking-handoff-policy.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),need=(v,c)=>{if(!v)throw Error(c);},same=(a,b)=>need(isDeepStrictEqual(a,b),'changed');
function extract(source,name,context){const ast=ts.createSourceFile('x.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(n,name);return runInNewContext(n.getText(ast).replace(/^export /,'')+'\n'+name,context);}
function fixture(failure){
 const nodes=new Map([['/root',{type:'directory',mode:0o40755}],['/root/dir',{type:'directory',mode:0o40755}],
 ['/root/dir/a',{type:'file',mode:0o100644,bytes:Buffer.from('fixture')}],['/root/bin',{type:'link',mode:0o120777,target:'dir/a'}]]);
 if(failure==='owner')nodes.get('/root/dir/a').uid=1;
 if(failure==='writable')nodes.get('/root/dir/a').mode=0o100666;
 if(failure==='type')nodes.get('/root/dir/a').type='socket';
 if(failure==='mode-only')nodes.get('/root/dir/a').mode=0o100600;
 if(failure==='content')nodes.get('/root/dir/a').bytes=Buffer.from('changed');
 let mutated=false,nextFd=10;const fds=new Map();
 const stat=f=>{const n=nodes.get(f);if(!n)throw Error('missing');return {dev:1,ino:[...nodes.keys()].indexOf(f)+1,uid:n.uid??0,mode:n.mode,nlink:1,size:n.bytes?.length??0,mtimeMs:mutated?2:1,ctimeMs:1,isFile:()=>n.type==='file',isDirectory:()=>n.type==='directory',isSymbolicLink:()=>n.type==='link'};};
 const io={constants,lstatSync:stat,fstatSync:fd=>stat(fds.get(fd).file),
 readdirSync:d=>[...nodes.keys()].filter(f=>path.posix.dirname(f)===d&&f!==d).map(f=>path.posix.basename(f)),
 readlinkSync:f=>nodes.get(f).target,realpathSync:()=>failure==='escape'?'/outside/a':'/root/dir/a',
 openSync:f=>{const fd=nextFd++;fds.set(fd,{file:f,offset:0});return fd;},closeSync:fd=>fds.delete(fd),
 readFileSync:f=>nodes.get(f).bytes,
 readSync:(fd,buffer,offset,length)=>{const cursor=fds.get(fd),bytes=nodes.get(cursor.file).bytes,n=bytes.copy(buffer,offset,cursor.offset,cursor.offset+length);cursor.offset+=n;if(failure==='changed')mutated=true;return n;}};
 const context={fs:io,path:path.posix,createHash,Buffer,need,same,identity:s=>['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>s[k]),assertOnlineToolOwnedPath:()=>{}};
 const actual=extract(readFileSync(new URL('./booking-dependency-fingerprint.mjs',import.meta.url),'utf8'),'bookingModeAwareDependencies',context);
 const original=extract(readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8'),'bookingResumeDependencies',{
  ...io,createHash,hash,bookingResumeOwnedPath:()=>{},fail:c=>{throw Error(c);}});
 return {actual,original,fds};
}
test('bounded streamed serialization equals the ACTUAL original mode-aware stage algorithm, not the independent tree algorithm',()=>{
 const f=fixture();assert.equal(f.actual('/root'),f.original('/root'));assert.equal(f.fds.size,0);
 for(const change of ['mode-only','content']){const a=fixture(change);assert.equal(a.actual('/root'),a.original('/root'));assert.notEqual(a.actual('/root'),f.actual('/root'));}
 for(const change of ['owner','writable','type','escape','changed']){const a=fixture(change);assert.throws(()=>a.actual('/root'),undefined,change);assert.equal(a.fds.size,0);}
});
test('BOTH exact immutable targets require mode AND streamed seals; saved digest semantics never accept either-algorithm fallback',()=>{
 for(const pin of P.pair){
  const valid={target:pin.target,savedDigest:pin.target===C?MODE:pin.dependencies.sha256,modeAwareDigest:MODE,streamedTree:{...pin.dependencies}};
  assert.equal(assertBookingDependencyBinding(valid),true);
  for(const patch of [{target:'a'.repeat(40)},{modeAwareDigest:'a'.repeat(64)},{savedDigest:'a'.repeat(64)},
   {savedDigest:pin.target===C?pin.dependencies.sha256:MODE},{streamedTree:{...pin.dependencies,files:1}},{streamedTree:{...pin.dependencies,bytes:1}},
   {streamedTree:{...pin.dependencies,sha256:'a'.repeat(64)}},{streamedTree:{...pin.dependencies,extra:true}}])
    assert.throws(()=>assertBookingDependencyBinding({...valid,...patch}));
 }
});
