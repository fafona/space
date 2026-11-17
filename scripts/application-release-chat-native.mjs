// Disposable real-filesystem acceptance only, never a formal host override.
import * as fs from 'node:fs';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {snapshotRetentionProofFiles,createVerifiedHistoryObservation} from './application-release-history-observation.mjs';
import {CHAT_BASELINE,executeChatScopeClosure} from './application-release-chat-policy.mjs';
const need=v=>{if(!v)throw Error('chat_native_invocation');};
need(process.platform==='linux'&&process.getuid?.()===0&&['/var/lib/faolla-online-release/active.json','/root/.pm2/pm2.pid','/www/wwwroot/merchant-space.current'].every(p=>!fs.existsSync(p)));
const root=fs.mkdtempSync('/var/lib/faolla-chat-native-');fs.chmodSync(root,0o700);
const roots=['history','rolling','legacy'].map(n=>root+'/'+n);roots.forEach(p=>fs.mkdirSync(p,{mode:0o700}));
for(const p of [...roots.map(p=>p+'/proof.json'),roots[0]+'.head.json'])fs.writeFileSync(p,'{"proof":"original"}',{mode:0o600});
let reads=0;const observe=()=>createVerifiedHistoryObservation({snapshot:()=>snapshotRetentionProofFiles(fs,roots),read:()=>{reads++;return{entries:49};}});
try{
 const o=observe();for(let i=0;i<6;i++)o.verify();assert.equal(reads,1);o.finish();assert.equal(reads,2);
 const changed=observe(),file=roots[2]+'/proof.json';fs.writeFileSync(file,'{"proof":"modified"}');assert.throws(changed.verify,/raw_proofs_changed/);
 const replaced=observe();fs.renameSync(file,file+'.old');fs.writeFileSync(file,'{"proof":"modified"}',{mode:0o600});assert.throws(replaced.verify,/raw_proofs_changed/);
 const permission=observe();fs.chmodSync(file,0o644);assert.throws(permission.verify,/unsafe_path/);fs.chmodSync(file,0o600);
 const moduleUrl=new URL('./application-release-cli-lifetime.mjs',import.meta.url).href;
 const r=spawnSync('/usr/bin/node',['--input-type=module','-e',`import{withApplicationCliLifetime}from ${JSON.stringify(moduleUrl)};await withApplicationCliLifetime(()=>new Promise(r=>setTimeout(()=>r('closed'),30).unref())).then(console.log);`],{encoding:'utf8',timeout:3000});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'closed');
 const lock=root+'/deploy.lock',operation=root+'/operation.lock',archived=root+'/archived.operation';fs.writeFileSync(lock,'',{mode:0o600});fs.mkdirSync(operation,{mode:0o700});const fd=fs.openSync(lock,fs.constants.O_RDWR),inode=fs.lstatSync(operation,{bigint:true}).ino;
 try{
  assert.equal(spawnSync('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',fd]}).status,0);
  const other=spawnSync('flock',['--nonblock',lock,'true']);assert.notEqual(other.status,0);
  await executeChatScopeClosure({verify:()=>assert.equal(fs.lstatSync(operation,{bigint:true}).ino,inode),seal:value=>{const f=fs.openSync(root+'/closed.json',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);try{fs.writeFileSync(f,JSON.stringify(value));fs.fsyncSync(f);}finally{fs.closeSync(f);}},archive:()=>{fs.renameSync(operation,archived);assert.equal(fs.lstatSync(archived,{bigint:true}).ino,inode);}},async()=>({actualTarget:CHAT_BASELINE,restored:true,publicProof:['https://faolla.com','https://launch.faolla.com'].map(origin=>({origin,status:200,buildId:CHAT_BASELINE}))}));
  assert.ok(fs.existsSync(archived)&&!fs.existsSync(operation));
 }finally{fs.closeSync(fd);}
 console.log(JSON.stringify({kind:'chat-continuation-native-verified',realFilesystem:true,originalSemanticValidationRetained:true,allProofGenerationsWitnessed:true,realCliLifetime:true,realKernelLockAndOriginalInodeArchive:true,businessDataWritten:false}));
}finally{
 // Only the exact new disposable test directory is recoverably irrelevant;
 // verify its resolved scope before recursive cleanup. No formal paths exist.
 need(fs.realpathSync(root)===root&&root.startsWith('/var/lib/faolla-chat-native-'));fs.rmSync(root,{recursive:true});
}
