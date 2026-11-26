// Root is used ONLY to provision fresh /tmp test directories and launch child
// UIDs in a disposable hosted runner. No accounts, host configuration, formal
// credentials, application processes, backend connections or service installs.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,chown,lstat,realpath,readFile,writeFile} from 'node:fs/promises';
import {createHmac,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertIsolatedCi,safeError} from './member-checkout-real-auth-support.mjs';
import {loadCredentialRenewalRevision} from './member-checkout-credential-renewal-revision.mjs';
const owned=assertIsolatedCi();assert.equal(owned.profileName,'current-auth');assert.equal(process.env.FAOLLA_CHECKOUT_CREDENTIAL_RENEWAL_ACCEPTANCE,'1');assert.equal(process.getuid(),0);
const writerUid=Number(process.env.FAOLLA_OWNED_WRITER_UID),writerGid=Number(process.env.FAOLLA_OWNED_WRITER_GID);
for(const id of [writerUid,writerGid])assert.ok(Number.isInteger(id)&&id>=1000&&id<65533);
assert.equal(await realpath(process.cwd()),await realpath(process.env.GITHUB_WORKSPACE));assert.equal((await lstat(process.cwd())).uid,writerUid);
assert.equal(await realpath('/tmp'),'/tmp');assert.equal((await lstat('/tmp')).uid,0);
const evidence=path.join(process.env.RUNNER_TEMP,'faolla-credential-renewal-evidence');await mkdir(evidence,{mode:0o700});assert.equal(await realpath(evidence),evidence);await chown(evidence,writerUid,writerGid);
const report={version:1,commit:process.env.GITHUB_SHA,scope:'owned-ci-automatic-renewal-distinct-uid-component',checks:[],passed:false,cleanupPassed:false,failure:null};
const children=[],events=[];let root;report.stage='source-binding';
const check=(name,fn)=>{fn();report.checks.push({name,passed:true});};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,timeout=60000){const end=performance.now()+timeout;while(!test()){assert.ok(performance.now()<end,'owned_renewal_observation_timeout');assert.ok(!events.some(v=>v.kind==='worker-failed'),'owned_renewal_worker_failed');await wait(25);}}
async function launch(role){
 const setup={role,root,writerUid,writerGid};const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/member-checkout-renewal-worker.mjs',import.meta.url)),Buffer.from(JSON.stringify(setup)).toString('base64url')],{
  cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:root,TMPDIR:root,TEMP:root,TMP:root,TSX_DISABLE_CACHE:'1',FAOLLA_CHECKOUT_OWNED_RENEWAL_CHILD:'1'},stdio:['ignore','pipe','pipe','ipc']});
 const entry={role,child,exit:null,logs:'',forced:false,requested:false};children.push(entry);
 child.on('message',v=>{assert.ok(v&&typeof v==='object'&&!/jwt|secret|signature|eyJ/.test(JSON.stringify(v)));events.push({...v,role});});
 for(const stream of [child.stdout,child.stderr])stream.on('data',v=>{if(entry.logs.length+v.length<32768)entry.logs+=v.toString();else{entry.forced=true;child.kill('SIGKILL');}});
 child.on('error',()=>events.push({role,kind:'worker-failed'}));child.on('exit',(code,signal)=>{entry.exit={code,signal};});return entry;
}
try{
 report.revision=await loadCredentialRenewalRevision();report.application=report.revision.material.frozenApplication;
 report.stage='owned-directory-setup';
 root=await mkdtemp('/tmp/faolla-checkout-renewal-');assert.match(root,/^\/tmp\/faolla-checkout-renewal-[A-Za-z0-9]+$/);assert.equal(await realpath(root),root);await chown(root,writerUid,writerGid);
 // mkdtemp's 0700 root is intentional during setup; change ONLY this newly
 // created test root to 0750, never a workspace, existing directory or host path.
 const {chmod}=await import('node:fs/promises');await chmod(root,0o750);
 for(const [name,mode]of[['delivery',0o750],['signer',0o700]]){const target=path.join(root,name);await mkdir(target,{mode});assert.equal(await realpath(target),target);await chown(target,writerUid,writerGid);}
 report.stage='writer-first-publication';const writer=await launch('writer');await until(()=>events.some(v=>v.kind==='published'),15000);
 report.stage='reader-and-outsider-start';
 const reader=await launch('reader'),outsider=await launch('outsider');await until(()=>events.some(v=>v.kind==='reader-boundary')&&events.some(v=>v.kind==='outsider-denied'),15000);
 check('actual non-root writer and different-UID group reader; outsider lacks read access',()=>{
  const r=events.find(v=>v.kind==='reader-boundary'),o=events.find(v=>v.kind==='outsider-denied');assert.equal(r.uid,65534);assert.equal(r.gid,writerGid);assert.notEqual(r.uid,writerUid);assert.equal(o.uid,65533);assert.equal(o.gid,65533);assert.equal(r.fileWriteDenied,true);assert.equal(r.directoryWriteDenied,true);assert.equal(r.keyReadDenied,true);
 });
 report.stage='three-early-generations';await until(()=>events.filter(v=>v.kind==='published').length>=3&&events.filter(v=>v.kind==='read-generation').length>=3,30000);
 check('automatic early renewal reaches three whole generations in one read-only process without an availability gap',()=>{
  const issued=events.filter(v=>v.kind==='published'),reads=events.filter(v=>v.kind==='read-generation');assert.equal(issued.length,3);assert.deepEqual(reads.map(v=>v.generation),issued.map(v=>v.generation));assert.equal(events.some(v=>v.kind==='reader-closed'),false);
  for(let i=1;i<issued.length;i++){assert.ok(issued[i].at<issued[i-1].expiresAt-14000);assert.ok(issued[i].at>issued[i-1].at);}
  assert.equal(reader.exit,null);assert.equal(writer.exit,null);
 });
 const before=await readFile(path.join(root,'delivery/runtime.json')),key=await readFile(path.join(root,'signer/key.private')),value=JSON.parse(before.toString('utf8')),parts=value.jwt.split('.');
 check('owned signature independently validates against the private signing-boundary key',()=>{assert.equal(timingSafeEqual(createHmac('sha256',key).update(parts[0]+'.'+parts[1]).digest(),Buffer.from(parts[2],'base64url')),true);});key.fill(0);
 report.stage='issuer-failure-and-expiry-margin';writer.child.send('fail-issuer');await until(()=>events.some(v=>v.kind==='issuer-failed'),15000);await until(()=>events.some(v=>v.kind==='reader-closed'),45000);
 check('issuer failure retains original bytes; reader refuses once original dispatch safety margin is exhausted',()=>{
  const closed=events.find(v=>v.kind==='reader-closed'),last=events.filter(v=>v.kind==='published').at(-1);assert.equal(closed.generation,last.generation);assert.ok(closed.at>=last.expiresAt-14000);assert.equal(events.filter(v=>v.kind==='published').length,3);
 });
 assert.deepEqual(await readFile(path.join(root,'delivery/runtime.json')),before);
 const dirs=await Promise.all(['delivery','signer'].map(name=>lstat(path.join(root,name))));const token=await lstat(path.join(root,'delivery/runtime.json')),privateKey=await lstat(path.join(root,'signer/key.private'));
 check('exact 0750/0640 delivery and 0700/0600 signing ownership retained after renewal and failure',()=>{assert.deepEqual(dirs.map(v=>v.mode&0o777),[0o750,0o700]);assert.equal(token.mode&0o777,0o640);assert.equal(privateKey.mode&0o777,0o600);for(const s of [...dirs,token,privateKey]){assert.equal(s.uid,writerUid);assert.equal(s.gid,writerGid);}assert.equal(token.nlink,1);assert.equal(privateKey.nlink,1);});
 report.boundary={rootSetupOnly:true,writerUid,readerUid:65534,readerGroup:writerGid,outsiderUid:65533,supplementaryGroupsDropped:true,readerSigningKeyReadDenied:true,readerFileWriteDenied:true,readerDirectoryWriteDenied:true,
  automaticEarlyGenerations:3,wallClock:'actual',sameReaderProcess:true,continuousReadDuringSuccessfulRenewal:true,issuerFailureOriginalFileRetained:true,expiredDispatchMarginRefused:true,signatureCheck:'owned-supervisor-hmac-only',actualNextProcess:false,realPostgrestValidated:false,kongValidated:false,
  formalSigningKeysRead:false,formalIssuerProvisioned:false,productionReadPerformed:false,productionAuthorized:false,deploymentReady:false};
 assert.deepEqual(await loadCredentialRenewalRevision(),report.revision);report.generations=events.filter(v=>v.kind==='published');report.stage='completed';report.passed=true;
}catch(error){report.failure=safeError(error);process.exitCode=1;}finally{
 for(const entry of children){if(entry.exit===null&&entry.child.connected){entry.requested=true;entry.child.send('stop');}}
 const deadline=performance.now()+5000;while(children.some(v=>v.exit===null)&&performance.now()<deadline)await wait(25);
 for(const entry of children){if(entry.exit===null){entry.forced=true;entry.child.kill('SIGKILL');}}
 const killDeadline=performance.now()+3000;while(children.some(v=>v.exit===null)&&performance.now()<killDeadline)await wait(25);
 report.processes=children.map(v=>({role:v.role,requested:v.requested,forced:v.forced,...v.exit}));
 report.workerFailures=events.filter(v=>v.kind==='worker-failed');
 report.startupDiagnostic=children.map(v=>({role:v.role,errorCodes:[...new Set(v.logs.match(/\b(?:EACCES|EPERM|ENOENT|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|ERR_ASSERTION|ERR_UNKNOWN_FILE_EXTENSION)\b/g)??[])],component: v.logs.includes('/esbuild/')?'esbuild':v.logs.includes('/tsx/')?'tsx':null}));
 report.cleanupPassed=children.length===3&&children.every(v=>v.exit?.code===0&&v.exit?.signal===null&&!v.forced)&&children.filter(v=>v.role!=='outsider').every(v=>v.requested&&events.some(e=>e.role===v.role&&e.kind==='stopped'));
 if(!report.cleanupPassed){report.passed=false;process.exitCode=1;}
 for(const entry of children)await writeFile(path.join(evidence,entry.role+'.private.log'),entry.logs,{flag:'wx',mode:0o600});
 // Report is the sole artifact. Tokens, keys, raw child output and fixture stay private.
 const file=path.join(evidence,'report.json');await writeFile(file,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});await chown(file,writerUid,writerGid);
}
