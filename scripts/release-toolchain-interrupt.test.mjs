import test from 'node:test';import assert from 'node:assert/strict';import {realpathSync,readFileSync} from 'node:fs';
import {assertLabControllerIdentity} from './release-toolchain-interrupt-acceptance.mjs';
test('interruption can signal only the exact directly spawned controller identity, birth and arguments',()=>{
 const scope={entry:'/new/bundle/scripts/release-toolchain.mjs',binary:'/usr/sbin/nginx',cwd:'/synthetic',uid:1234};
 const before={pid:123,ticks:'100'},current={...before,uid:1234,exe:realpathSync(process.execPath),cwd:scope.cwd,
  args:[process.execPath,scope.entry,'rehearse',scope.binary,'10']};
 assert.equal(assertLabControllerIdentity(before,current,scope),true);
 for(const patch of [{pid:124},{ticks:'101'},{uid:0},{exe:'/foreign'},{cwd:'/foreign'},
 {args:[process.execPath,scope.entry,'doctor']},{args:[...current.args,'extra']}])assert.throws(()=>assertLabControllerIdentity(before,{...current,...patch},scope));
});
test('native interruption acceptance requires actual mid-case failure, all-owned cleanup and no false green report',()=>{
 const source=readFileSync(new URL('./release-toolchain-interrupt-acceptance.mjs',import.meta.url),'utf8');
 for(const value of ['verifyToolchainBundle(bundle)','assertLabControllerIdentity(before,fact(child.pid),identity)',"child.kill('SIGTERM')",
 "assert.equal(interrupted.outcome,'failed')","assert.equal(result.allOwnedStopped,true)","'report.json'","flag:'wx'"])assert.ok(source.includes(value));
 assert.doesNotMatch(source,/pkill|killall|pm2|process\.kill|SIGKILL/);
});
