import test from 'node:test';import assert from 'node:assert/strict';
import {parseToolchainArguments,toolchainMain} from './release-toolchain.mjs';import {parseSyntheticHttp,rehearseToolchainIngress,remainingOwnedLabProcesses,priorLabProcessIdentities} from './release-toolchain-rehearsal.mjs';
test('CLI exposes doctor, verification, journal inspection and isolated rehearsal, no production mutator',()=>{
 assert.deepEqual(parseToolchainArguments(['doctor']),{command:'host'});assert.equal(parseToolchainArguments(['rehearse','/usr/sbin/nginx','3']).runs,3);
 for(const args of [[],['apply'],['deploy','main'],['doctor','--force','x'],['rehearse','/bin/sh','--skip'],['rehearse','/usr/sbin/nginx','0'],['rehearse','/usr/sbin/nginx','11'],['rehearse','/usr/sbin/nginx','3garbage']])assert.throws(()=>parseToolchainArguments(args));
});
test('host-only doctor clearly requires release evidence and never says ready/deployed',async()=>{
 const output=[];assert.equal(await toolchainMain(['doctor'],v=>output.push(v)),0);assert.equal(output[0].publicationAuthority,false);assert.equal(output[0].releaseEvidenceRequired,true);assert.equal(Object.hasOwn(output[0],'ready'),false);
});
test('synthetic response parser returns only bounded status and fixed process/gate metadata',()=>{
 assert.deepEqual(parseSyntheticHttp('HTTP/1.1 200 OK\r\nX-Faolla-Lab-Worker: 123\r\nX-Faolla-Lab-Gate: open\r\n\r\nsecret body'),{status:200,workerPid:123,gate:'open'});
 for(const text of ['', 'garbage','HTTP/1.1 200 OK\r\n\r\n','x'.repeat(65537)])assert.throws(()=>parseSyntheticHttp(text));
});
test('rehearsal refuses arbitrary commands, unsupported platforms and unbounded runs before allocating resources',async()=>{
 for(const input of [{nginx:'/bin/sh',runs:1},{nginx:'/usr/sbin/nginx',runs:100},{nginx:'/usr/sbin/nginx',runs:0}])await assert.rejects(rehearseToolchainIngress(input));
});
test('non-root cleanup does not inspect foreign-UID proc details or treat a foreign daemon as owned',()=>{
 const reads=[],context={directory:'/tmp/new-owned-case',binary:'/usr/sbin/nginx',uid:1001,pids:['1','2','3','4'],ownerOf:pid=>pid===1?0:1001,
  readFact:pid=>{reads.push(pid);if(pid===1)throw Object.assign(Error('permission denied'),{code:'EACCES'});return {pid,state:pid===4?'Z':'S',cwd:pid===3?'/foreign':'/tmp/new-owned-case',executable:'/usr/sbin/nginx'};}};
 assert.deepEqual(remainingOwnedLabProcesses(context),[2]);assert.deepEqual(reads,[2,3,4]);
});
test('unreadable SAME-UID ownership remains a blocker; only vanished processes can be ignored',()=>{
 const context={directory:'/tmp/new-owned-case',binary:'/usr/sbin/nginx',uid:1001,pids:['2'],ownerOf:()=>1001};
 assert.throws(()=>remainingOwnedLabProcesses({...context,readFact:()=>{throw Object.assign(Error('denied'),{code:'EACCES'});}}));
 assert.deepEqual(remainingOwnedLabProcesses({...context,readFact:()=>{throw Object.assign(Error('gone'),{code:'ENOENT'});}}),[]);
});
test('pre-fixture birth identities exclude already-existing protected processes, never a recycled PID',()=>{
 const prior=priorLabProcessIdentities({uid:1001,pids:['1','2'],ownerOf:pid=>pid===1?0:1001,startTicks:()=> '100'});assert.deepEqual([...prior],[[2,'100']]);
 const context={directory:'/tmp/case',binary:'/usr/sbin/nginx',uid:1001,pids:['2'],ownerOf:()=>1001,priorProcesses:prior,
  readFact:()=>{throw Object.assign(Error('protected'),{code:'EACCES'});}};
 assert.deepEqual(remainingOwnedLabProcesses({...context,startTicks:()=> '100'}),[]);
 assert.throws(()=>remainingOwnedLabProcesses({...context,startTicks:()=> '200'}));
 assert.deepEqual(remainingOwnedLabProcesses({...context,startTicks:()=> '200',readFact:()=>({pid:2,state:'S',cwd:'/tmp/case',executable:'/usr/sbin/nginx'})}),[2]);
});
