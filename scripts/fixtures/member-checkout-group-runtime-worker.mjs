// Root bootstrap contains builtins only; keys and Next/tsx load after UID drop.
import assert from 'node:assert/strict';
import {readFile,open} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.env.FAOLLA_CHECKOUT_GROUP_CHILD,'1');
const c=JSON.parse(Buffer.from(process.argv[2],'base64url').toString('utf8'));assert.ok(['issuer','next'].includes(c.role));assert.match(c.root,/^\/tmp\/faolla-checkout-group-[A-Za-z0-9]+$/);assert.match(c.app,/^\/tmp\/faolla-checkout-build-[A-Za-z0-9]+\/app$/);for(const n of[c.writerUid,c.writerGid])assert.ok(Number.isInteger(n)&&n>=1000&&n<65533);
const uid=c.role==='next'?65534:c.writerUid;process.setgroups([]);process.setgid(c.writerGid);process.setuid(uid);process.umask(0o027);assert.equal(process.getuid(),uid);assert.equal(process.geteuid(),uid);assert.equal(process.getgid(),c.writerGid);assert.deepEqual(process.getgroups(),[c.writerGid]);
const send=v=>process.send?.(v);send({type:'identity',uid,gid:process.getgid(),groups:process.getgroups(),pid:process.pid});
let stage='initial',unregister,controller,key;const deny=async fn=>{let refused=false;try{const h=await fn();await h?.close?.();}catch(error){assert.ok(['EACCES','EPERM'].includes(error.code));refused=true;}assert.equal(refused,true);};
try{
 if(c.role==='next'){
  process.on('message',m=>{if(m==='audit-next')void(async()=>{try{await deny(()=>open(path.join(c.root,'delivery/runtime.json'),'r+'));await deny(()=>open(path.join(c.root,'delivery/next-created.tmp'),'wx',0o600));await deny(()=>readFile(path.join(c.root,'signer/key.private')));await deny(()=>readFile(path.join(c.root,'request.private.json')));send({type:'reader-audit',fileWriteDenied:true,directoryWriteDenied:true,signingKeyReadDenied:true,requestReadDenied:true});}catch{send({type:'worker-failed',stage:'reader-audit'});}})();});
  stage='next-launch';const launcher=new URL('./member-checkout-rollback-local-server.mjs',import.meta.url);process.argv=[process.execPath,launcher.pathname,c.app];await import(launcher.href);
 }else{
  stage='issuer-loader';const {register}=await import('tsx/esm/api');unregister=register({tsconfig:false});const {createCredentialRenewalController}=await import('../member-checkout-credential-renewal.mjs');const files=await import('./merchant-checkout-credential-file.ts'),publish=(files.default??files).publishCredentialFile;
  stage='issuer-key';key=await readFile(path.join(c.root,'signer/key.private'));const p={directory:path.join(c.root,'delivery'),ownerUid:c.writerUid,ownerGid:c.writerGid,access:'group',algorithm:'HS256',issuer:'group-owned-issuer',audience:'group-owned-audience'};let fail=false,running;
  controller=createCredentialRenewalController({filePolicy:p,ttlSeconds:30,renewAheadMs:24000,pollMs:100,issueTimeoutMs:1000},{sign:async wire=>{if(fail)throw Error('owned issuer temporarily unavailable');return createHmac('sha256',key).update(wire).digest();},publish:async(policy,value,now)=>{const ack=await publish(policy,value,now),payload=JSON.parse(Buffer.from(value.jwt.split('.')[1],'base64url'));send({type:'published',generation:value.generation,expiresAt:payload.exp*1000,at:Date.now()});return ack;}});
  stage='issuer-ready';send({type:'issuer-ready'});let stopping=false,reportedFailures=0;const monitor=setInterval(()=>{const s=controller.snapshot();if(s.failures>reportedFailures){reportedFailures=s.failures;if(s.failures===1)send({type:'issuer-failed',published:s.published,reason:s.reason});}},100);const stop=async()=>{if(stopping)return;stopping=true;clearInterval(monitor);await controller.stop();await running;key.fill(0);await unregister();send({type:'issuer-stopped',published:controller.snapshot().published,failures:controller.snapshot().failures});process.disconnect();};
  process.on('message',m=>{if(m==='start-issuer'){if(running){send({type:'worker-failed',stage:'duplicate-issuer-start'});return;}running=controller.run();}if(m==='fail-issuer'){fail=true;send({type:'issuer-paused'});}if(m==='resume-issuer'){fail=false;send({type:'issuer-resumed'});}if(m==='stop')void stop();});process.on('disconnect',()=>void stop());
 }
}catch(error){send({type:'worker-failed',stage,code:/^[A-Z0-9_]{1,40}$/.test(error?.code??'')?error.code:null});await controller?.stop();key?.fill(0);await unregister?.();process.exit(1);}
