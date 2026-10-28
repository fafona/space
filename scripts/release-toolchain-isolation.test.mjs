import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateIsolationContainer,ISOLATION_IMAGE,verifyIsolatedArchiveBytes} from './release-toolchain-isolation.mjs';
import {fingerprint} from './release-toolchain-contracts.mjs';
test('the actual restore input guard rejects changed bytes and a wrong fingerprint scheme before any restore',()=>{
 const bytes=Buffer.alloc(512,42),expected=fingerprint('backup-archive',bytes);assert.equal(verifyIsolatedArchiveBytes(bytes,expected),bytes);
 const changed=Buffer.from(bytes);changed[250]^=1;assert.throws(()=>verifyIsolatedArchiveBytes(changed,expected),/fingerprint_mismatch/);
 assert.throws(()=>verifyIsolatedArchiveBytes(bytes,fingerprint('evidence',bytes)));assert.throws(()=>verifyIsolatedArchiveBytes(Buffer.alloc(1),expected));
});
const owner={root:'/var/lib/faolla-release-toolchain-isolation-abcdef',id:'12345678-1234-1234-1234-123456789abc',containerId:'a'.repeat(64)};
const actual=()=>({Id:owner.containerId,Name:'/faolla-release-toolchain-'+owner.id,Image:ISOLATION_IMAGE,Config:{User:'postgres',Labels:{'io.faolla.release-toolchain.owner':owner.id,'io.faolla.release-toolchain.root':owner.root}},HostConfig:{NetworkMode:'none',Privileged:false,PortBindings:{},CapDrop:['ALL'],SecurityOpt:['no-new-privileges']},Mounts:[{Type:'bind',Source:owner.root+'/database',Destination:'/fixture',RW:true}],State:{Running:true}});
test('only the new exact owned network-none unprivileged fixture is admitted',()=>{assert.equal(validateIsolationContainer(actual(),owner,{running:true}),true);
 for(const change of [v=>v.Id='b'.repeat(64),v=>v.Name='/supabase-db',v=>v.Image='sha256:'+'b'.repeat(64),v=>v.Config.User='root',v=>v.Config.Labels['io.faolla.release-toolchain.owner']='other',v=>v.HostConfig.NetworkMode='bridge',v=>v.HostConfig.Privileged=true,v=>v.HostConfig.PortBindings={'5432/tcp':[{}]},v=>v.HostConfig.CapDrop=[],v=>v.HostConfig.SecurityOpt=[],v=>v.Mounts[0].Source='/opt/supabase/docker/volumes/db/data',v=>v.Mounts.push({...v.Mounts[0]}),v=>v.State.Running=false]){const v=actual();change(v);assert.throws(()=>validateIsolationContainer(v,owner,{running:true}));}
});
test('a formal container ID is denied even with caller-supplied fixture labels',()=>{const fake={...owner,containerId:'0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416'},v=actual();v.Id=fake.containerId;assert.throws(()=>validateIsolationContainer(v,fake));});
