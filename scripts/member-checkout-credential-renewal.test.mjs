import assert from 'node:assert/strict';
import test from 'node:test';
import {createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createCredentialRenewalController} from './member-checkout-credential-renewal.mjs';

const config=()=>({filePolicy:{directory:'/owned/checkout',ownerUid:1001,ownerGid:1001,access:'group',algorithm:'HS256',issuer:'owned-renewal',audience:'authenticated'},ttlSeconds:30,renewAheadMs:24000,pollMs:100,issueTimeoutMs:1000});
function fixture(extra={}){let now=1000000,mono=0;const values=[];const options={wallNow:()=>now,monotonicNow:()=>mono,sign:async wire=>createHmac('sha256',Buffer.alloc(32,7)).update(wire).digest(),publish:async(p,v)=>{values.push(v);return{published:true,generation:v.generation,productionAuthorized:false};},...extra};return{controller:createCredentialRenewalController(config(),options),values,advance(ms){now+=ms;mono+=ms;},wallOnly(ms){now+=ms;}};}
test('renewal owns exact claims and fixed role, bounds TTL and cannot accept caller claims or getter configuration',()=>{
 for(const change of [{ttlSeconds:301},{renewAheadMs:15000},{pollMs:0},{issueTimeoutMs:5001},{role:'service_role'},{filePolicy:{...config().filePolicy,role:'service_role'}}])assert.throws(()=>createCredentialRenewalController({...config(),...change},{sign:()=>{throw Error('not called');}}));
 let accessed=false;const c=config();Object.defineProperty(c,'ttlSeconds',{enumerable:true,get(){accessed=true;return 300;}});assert.throws(()=>createCredentialRenewalController(c,{}));assert.equal(accessed,false);
});
test('controller serializes simultaneous ticks and renews before expiry without exposing JWT in its state',async()=>{
 let release;const f=fixture({sign:async wire=>{await new Promise(r=>release=r);return createHmac('sha256',Buffer.alloc(32,7)).update(wire).digest();}});
 const first=f.controller.tick(),second=f.controller.tick();assert.equal(first,second);await Promise.resolve();release();await first;assert.equal(f.values.length,1);
 const claims=JSON.parse(Buffer.from(f.values[0].jwt.split('.')[1],'base64url'));assert.deepEqual(Object.keys(claims),['role','iss','aud','iat','exp','jti']);assert.equal(claims.role,'faolla_checkout_runtime');assert.equal(claims.exp-claims.iat,30);assert.equal(claims.jti,f.values[0].generation);
 f.advance(5999);await f.controller.tick();assert.equal(f.values.length,1);f.advance(1);const next=f.controller.tick();await Promise.resolve();release();await next;assert.equal(f.values.length,2);assert.notEqual(f.values[0].generation,f.values[1].generation);
 assert.doesNotMatch(JSON.stringify(f.controller.snapshot()),/jwt|secret|signature|eyJ/);await f.controller.stop();
});
test('signer failure leaves original file untouched and a later tick can restore renewal',async()=>{
 let reject=false;const f=fixture({sign:async wire=>{if(reject)throw Error('secret diagnostic must not escape');return Buffer.alloc(32,8);}});await f.controller.tick();f.advance(6000);reject=true;await f.controller.tick();assert.equal(f.values.length,1);assert.equal(f.controller.snapshot().reason,'RENEWAL_ISSUE_FAILED');assert.equal(f.controller.snapshot().published,1);reject=false;await f.controller.tick();assert.equal(f.values.length,2);await f.controller.stop();
});
test('late timeout signature is discarded, stops controller and never creates overlapping signing attempts',async()=>{
 let release,calls=0,published=0;const f=fixture({sign:()=>{calls++;return new Promise(r=>release=r);},publish:async()=>{published++;}});await f.controller.tick();assert.equal(f.controller.snapshot().stopped,true);assert.ok(['RENEWAL_ISSUER_TIMEOUT','RENEWAL_ISSUER_ABORTED'].includes(f.controller.snapshot().reason));release(Buffer.alloc(32,1));await Promise.resolve();await f.controller.tick();assert.equal(calls,1);assert.equal(published,0);await f.controller.stop();
});
test('stop discards pending signature and waits for an already started publication before acknowledging',async()=>{
 let release;const f=fixture({sign:()=>new Promise(r=>release=r)});const pending=f.controller.tick();await Promise.resolve();await f.controller.stop();release(Buffer.alloc(32,1));await pending;assert.equal(f.values.length,0);
 let acknowledge;const g=fixture({publish:async(p,v)=>{await new Promise(r=>acknowledge=r);return{published:true,generation:v.generation,productionAuthorized:false};}});const started=g.controller.tick();while(!acknowledge)await Promise.resolve();let stopped=false;const joined=g.controller.stop().then(()=>stopped=true);await Promise.resolve();assert.equal(stopped,false);acknowledge();await started;await joined;assert.equal(stopped,true);assert.equal(g.controller.snapshot().published,1);await g.controller.tick();assert.equal(g.controller.snapshot().published,1);
});
test('clock discontinuity, bad signature shape and missing publisher acknowledgement fail without fabricating a generation',async()=>{
 const f=fixture();await f.controller.tick();f.wallOnly(3000);await f.controller.tick();assert.equal(f.controller.snapshot().reason,'RENEWAL_CLOCK_REFUSED');assert.equal(f.values.length,1);assert.equal(f.controller.snapshot().stopped,true);
 const g=fixture({sign:async()=>Buffer.alloc(1)});await g.controller.tick();assert.equal(g.controller.snapshot().reason,'RENEWAL_SIGNATURE_REFUSED');assert.equal(g.values.length,0);
 const h=fixture({publish:async()=>({published:false})});await h.controller.tick();assert.equal(h.controller.snapshot().reason,'RENEWAL_PUBLICATION_UNCONFIRMED');assert.equal(h.controller.snapshot().published,0);
});
test('automatic loop runs once, stops cleanly, cannot restart or issue afterwards',async()=>{
 const f=fixture();const running=f.controller.run();await assert.rejects(async()=>f.controller.run(),/checkout_credential_renewal_unavailable/);while(f.controller.snapshot().published===0)await new Promise(r=>setTimeout(r,1));await f.controller.stop();await running;f.advance(6000);await f.controller.tick();assert.equal(f.values.length,1);assert.equal(f.controller.snapshot().running,false);assert.equal(f.controller.snapshot().stopped,true);
});
test('root-only distinct identity harness refuses local or mis-scoped invocation before creating fixtures',()=>{
 const r=spawnSync(process.execPath,['scripts/member-checkout-credential-renewal-acceptance.mjs'],{cwd:process.cwd(),env:{},encoding:'utf8',timeout:10000});assert.ifError(r.error);assert.equal(r.status,1);assert.doesNotMatch(r.stderr,/EACCES|ENOENT|permission denied/i);assert.match(r.stderr,/AssertionError/);
});
test('owned identity proof uses dropped supplementary groups, fixed identities and only a sanitized report artifact',async()=>{
 const worker=await readFile('scripts/fixtures/member-checkout-renewal-worker.mjs','utf8'),acceptance=await readFile('scripts/member-checkout-credential-renewal-acceptance.mjs','utf8');
 assert.ok(worker.indexOf('process.setgroups([])')<worker.indexOf('await import('));assert.ok(worker.indexOf('process.setuid(')<worker.indexOf('await import('));assert.match(worker,/assert\.deepEqual\(process.getgroups\(\),\[identity.gid\]\)/);
 const outsider=worker.split("if(setup.role==='outsider'){")[1].split(" }else{")[0];assert.match(outsider,/await denied\(\(\)=>readFile/);assert.match(outsider,/process.getgroups\(\).includes\(p.ownerGid\),false/);assert.doesNotMatch(outsider,/await import\(|chmod|chown|setgroups/);assert.ok(worker.indexOf("stage='outsider-access'")<worker.indexOf("stage='loader-registration'"));
 for(const v of ['rootSetupOnly:true','readerSigningKeyReadDenied:true','readerFileWriteDenied:true','readerDirectoryWriteDenied:true','actualNextProcess:false','realPostgrestValidated:false','productionAuthorized:false'])assert.ok(acceptance.includes(v));
 const workflow=await readFile('.github/workflows/member-checkout-047-real-auth.yml','utf8');const job=workflow.split('\n  credential-renewal-boundary:\n')[1];assert.ok(job);assert.match(job,/sudo -n \/usr\/bin\/env -i/);assert.match(job,/path: \$\{\{ runner.temp \}\}\/faolla-credential-renewal-evidence\/report.json/);assert.doesNotMatch(job,/secrets\.|ssh |scp |deploy-production|git merge/);
});
