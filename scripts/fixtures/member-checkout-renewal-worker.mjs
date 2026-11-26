// Owned hosted-CI child only. Drop all root/supplementary identity before any
// TypeScript loader, component, signing material or writable fixture is opened.
import assert from 'node:assert/strict';
import {readFile,writeFile,open} from 'node:fs/promises';
import {createHmac,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.env.FAOLLA_CHECKOUT_OWNED_RENEWAL_CHILD,'1');
const setup=JSON.parse(Buffer.from(process.argv[2],'base64url').toString('utf8'));
assert.ok(['writer','reader','outsider'].includes(setup.role));assert.match(setup.root,/^\/tmp\/faolla-checkout-renewal-[A-Za-z0-9]+$/);
assert.ok(Number.isInteger(setup.writerUid)&&setup.writerUid>=1000&&setup.writerUid<65533);assert.ok(Number.isInteger(setup.writerGid)&&setup.writerGid>=1000&&setup.writerGid<65533);
const identity=setup.role==='writer'?{uid:setup.writerUid,gid:setup.writerGid}:setup.role==='reader'?{uid:65534,gid:setup.writerGid}:{uid:65533,gid:65533};
process.setgroups([]);process.setgid(identity.gid);process.setuid(identity.uid);
assert.equal(process.getuid(),identity.uid);assert.equal(process.geteuid(),identity.uid);assert.equal(process.getgid(),identity.gid);assert.deepEqual(process.getgroups(),[identity.gid]);
process.umask(0o027);
const p={directory:path.join(setup.root,'delivery'),ownerUid:setup.writerUid,ownerGid:setup.writerGid,access:'group',algorithm:'HS256',issuer:'owned-renewal',audience:'authenticated'};
const send=v=>process.send?.(v);let stop=false,controller,failed=false,stage='identity-ready',unregister;
process.on('message',v=>{if(v==='fail-issuer'&&setup.role==='writer'){failed=true;send({kind:'issuer-failure-enabled'});}if(v==='stop')stop=true;});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const denied=async fn=>{let passed=false;try{const handle=await fn();await handle?.close?.();}catch(e){assert.ok(['EACCES','EPERM'].includes(e.code));passed=true;}assert.equal(passed,true);};
try{
 if(setup.role==='outsider'){
  // This identity is deliberately outside the runner's group, so it also
  // cannot load that group's npm tree. Test kernel denial with builtins first;
  // do not grant it dependency/workspace access merely to exercise rejection.
  stage='outsider-access';assert.notEqual(process.getuid(),p.ownerUid);assert.equal(process.getgroups().includes(p.ownerGid),false);
  await denied(()=>readFile(path.join(p.directory,'runtime.json')));send({kind:'outsider-denied',uid:identity.uid,gid:identity.gid});
 }else{
 stage='loader-registration';const {register}=await import('tsx/esm/api');unregister=register({tsconfig:false});
 stage='component-import';const imported=await import('./merchant-checkout-credential-file.ts');
 const {publishCredentialFile,createCredentialFileReader}=imported.default??imported;
 if(setup.role==='writer'){
  stage='writer-key';
  const key=randomBytes(48);await writeFile(path.join(setup.root,'signer','key.private'),key,{flag:'wx',mode:0o600});
  stage='writer-component';const {createCredentialRenewalController}=await import('../member-checkout-credential-renewal.mjs');
  controller=createCredentialRenewalController({filePolicy:p,ttlSeconds:30,renewAheadMs:24000,pollMs:100,issueTimeoutMs:1000},{sign:async wire=>{if(failed)throw Error('owned issuer temporarily unavailable');return createHmac('sha256',key).update(wire).digest();},publish:async(policy,value,now)=>{
   const result=await publishCredentialFile(policy,value,now),claims=JSON.parse(Buffer.from(value.jwt.split('.')[1],'base64url'));
   send({kind:'published',generation:value.generation,at:Date.now(),expiresAt:claims.exp*1000});return result;
  }});
  stage='writer-renewal';const running=controller.run();while(!stop){const s=controller.snapshot();if(s.failures>0){send({kind:'issuer-failed',published:s.published});break;}await wait(25);}
  while(!stop)await wait(25);await controller.stop();await running;send({kind:'stopped',published:controller.snapshot().published});key.fill(0);
 }else if(setup.role==='reader'){
  stage='reader-access-boundary';
  await denied(()=>open(path.join(p.directory,'runtime.json'),'r+'));
  await denied(()=>open(path.join(p.directory,'reader-created.tmp'),'wx',0o600));
  await denied(()=>readFile(path.join(setup.root,'signer','key.private')));
  stage='reader-component';const reader=createCredentialFileReader(p);send({kind:'reader-boundary',uid:identity.uid,gid:identity.gid,fileWriteDenied:true,directoryWriteDenied:true,keyReadDenied:true});
  let last=null,closed=false;
  while(!stop){
   try{const value=await reader.read(AbortSignal.timeout(1000),Date.now,Date.now()+12000);const claims=JSON.parse(Buffer.from(value.jwt.split('.')[1],'base64url'));
    if(last!==value.generation){send({kind:'read-generation',generation:value.generation,at:Date.now(),expiresAt:claims.exp*1000});last=value.generation;}
    if(closed){send({kind:'worker-failed'});throw Error('reader_resumed_without_new_credential');}
   }catch{if(!closed){closed=true;send({kind:'reader-closed',at:Date.now(),generation:last});}}
   await wait(100);
  }send({kind:'stopped'});
 }
 }
}catch(error){send({kind:'worker-failed',stage,code:/^[A-Z0-9_]{1,40}$/.test(error?.code??'')?error.code:null,syscall:['open','mkdir','read','write','connect','stat','lstat','access'].includes(error?.syscall)?error.syscall:null});process.exitCode=1;}finally{await controller?.stop();await unregister?.();process.disconnect();}
