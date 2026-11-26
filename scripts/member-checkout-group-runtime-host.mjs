// Unprivileged owned-CI host. No production root, keys or application changes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,lstat,realpath,readdir,chmod,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {applicationFingerprint} from './member-checkout-compatibility-check.mjs';
import {assertCredentialCandidateCi,loadCredentialCandidateSources} from './member-checkout-credential-candidate.mjs';
export function assertGroupRuntimeCi(){const owned=assertCredentialCandidateCi();assert.equal(process.env.FAOLLA_CHECKOUT_GROUP_NEXT_ACCEPTANCE,'1');assert.ok(process.getuid()>0&&process.getuid()<65533);assert.ok(process.getgid()>=1000&&process.getgid()<65533);return owned;}
const within=(root,target)=>{const r=path.relative(root,target);return !!r&&!r.startsWith('..')&&!path.isAbsolute(r);};

export async function shareOwnedBuiltCandidate(fixture){
 assertGroupRuntimeCi();const {revision}=await loadCredentialCandidateSources();
 assert.equal(await realpath(fixture.root),await realpath(process.cwd()));assert.equal(await realpath(fixture.evidence),fixture.evidence);assert.equal(await realpath(fixture.app),fixture.app);
 assert.ok(within(await realpath(tmpdir()),fixture.evidence));assert.match(path.basename(fixture.evidence),/^faolla-checkout-build-[A-Za-z0-9]+$/);assert.equal(fixture.app,path.join(fixture.evidence,'app'));
 assert.deepEqual(await applicationFingerprint(fixture.app),revision.material.application);assert.ok((await lstat(path.join(fixture.app,'.next/BUILD_ID'))).isFile());
 assert.ok(!(await readdir(fixture.app)).some(v=>v.startsWith('.env')));
 const entries=[],uid=process.getuid(),gid=process.getgid(),dependencies=await realpath(path.join(fixture.root,'node_modules'));
 const add=async file=>{const s=await lstat(file);assert.equal(s.uid,uid);assert.equal(s.gid,gid);if(s.isSymbolicLink()){const target=await realpath(file);assert.ok(within(dependencies,target)||within(fixture.app,target));return;}
  assert.ok(s.isDirectory()||s.isFile());if(s.isFile())assert.equal(s.nlink,1);entries.push({file,dev:s.dev,ino:s.ino,mode:s.isDirectory()||s.mode&0o111?0o750:0o640});if(s.isDirectory())for(const name of await readdir(file))await add(path.join(file,name));};
 // Validate the WHOLE owned tree before changing any mode. Never follow or
 // chmod a dependency link, workspace, old build, private log or signing file.
 await add(fixture.app);for(const name of ['tls-cert.pem','tls-key.pem'])await add(path.join(fixture.evidence,name));
 const root=await lstat(fixture.evidence);assert.equal(root.uid,uid);assert.equal(root.gid,gid);assert.equal(root.isDirectory(),true);entries.push({file:fixture.evidence,dev:root.dev,ino:root.ino,mode:0o750});
 for(const e of entries){const current=await lstat(e.file);assert.equal(current.dev,e.dev);assert.equal(current.ino,e.ino);assert.equal(current.isSymbolicLink(),false);await chmod(e.file,e.mode);}
 assert.deepEqual(await applicationFingerprint(fixture.app),revision.material.application);assert.deepEqual(await applicationFingerprint(fixture.root),revision.material.baseApplication);
 return{ownedEntries:entries.length,externalLinksModified:0,applicationBytesChanged:false};
}

export async function startOwnedGroupRuntime(input){
 assertGroupRuntimeCi();const {fixture,environment,secret,signal}=input;assert.equal(typeof secret,'string');assert.ok(secret.length>=48&&secret.length<128);assert.equal(JSON.stringify(environment).includes(secret),false);signal.throwIfAborted();
 const sharing=await shareOwnedBuiltCandidate(fixture),root=await mkdtemp('/tmp/faolla-checkout-group-');assert.equal(await realpath(root),root);await chmod(root,0o750);
 await mkdir(path.join(root,'signer'),{mode:0o700});await mkdir(path.join(root,'delivery'),{mode:0o750});await mkdir(path.join(root,'logs'),{mode:0o700});
 await writeFile(path.join(root,'signer/key.private'),secret,{flag:'wx',mode:0o600});
 const policy={directory:path.join(root,'delivery'),ownerUid:process.getuid(),ownerGid:process.getgid(),access:'group',algorithm:'HS256',issuer:'group-owned-issuer',audience:'group-owned-audience'};
 const appEnv={...environment,FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_SOURCE:'file',FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_DIRECTORY:policy.directory,FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_OWNER_UID:String(policy.ownerUid),FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_OWNER_GID:String(policy.ownerGid),FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ACCESS:'group',FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ALGORITHM:policy.algorithm,FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ISSUER:policy.issuer,FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_AUDIENCE:policy.audience};
 assert.equal(Object.keys(appEnv).some(k=>/SECRET|SIGNING|PRIVATE_KEY/.test(k)),false);assert.equal(JSON.stringify(appEnv).includes(secret),false);
 const request=path.join(root,'request.private.json');await writeFile(request,JSON.stringify({version:1,root,app:fixture.app,writerUid:policy.ownerUid,writerGid:policy.ownerGid,environment:appEnv}),{flag:'wx',mode:0o600});
 const envKeys=['PATH','GITHUB_ACTIONS','RUNNER_ENVIRONMENT','GITHUB_REPOSITORY','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_SHA','GITHUB_WORKSPACE','RUNNER_TEMP'];
 const args=['-n','/usr/bin/env','-i',...envKeys.map(k=>k+'='+process.env[k]),'FAOLLA_CHECKOUT_REAL_AUTH_ACCEPTANCE=1','FAOLLA_CHECKOUT_AUTH_TEST_PROFILE=current-auth','FAOLLA_CHECKOUT_GROUP_NEXT_ACCEPTANCE=1',process.execPath,fileURLToPath(new URL('./member-checkout-group-runtime-supervisor.mjs',import.meta.url)),request];
 const child=spawn('/usr/bin/sudo',args,{cwd:process.cwd(),env:{PATH:process.env.PATH},stdio:['pipe','pipe','pipe']});
 const events=[],closed=once(child,'exit').then(([code,exitSignal])=>({code,signal:exitSignal}),()=>({code:-1,signal:null}));let output='',errors='',parseFailure=false;
 child.stdout.on('data',v=>{output+=v.toString();if(output.length>16384){parseFailure=true;child.stdin.end();return;}let i;while((i=output.indexOf('\n'))>=0){const line=output.slice(0,i);output=output.slice(i+1);try{const event=JSON.parse(line);assert.ok(event&&typeof event==='object'&&!/eyJ[A-Za-z0-9_-]+\.|"jwt"|"secret"/.test(line));assert.ok(events.length<512);events.push(event);}catch{parseFailure=true;child.stdin.end();}}});
 child.stderr.on('data',v=>{if(errors.length+v.length<16384)errors+=v.toString();else{parseFailure=true;child.stdin.end();}});
 child.stdin.on('error',()=>{parseFailure=true;});
 const command=op=>{assert.ok(['start-issuer','fail-issuer','resume-issuer','audit-next','stop'].includes(op));assert.equal(child.exitCode,null);assert.ok(child.stdin.writable);child.stdin.write(JSON.stringify({op})+'\n');};
 const abort=()=>{if(child.stdin.writable)child.stdin.end();};signal.addEventListener('abort',abort,{once:true});
 const waitFor=async(predicate,timeout=45000)=>{const end=performance.now()+timeout;while(!predicate(events)){signal.throwIfAborted();assert.equal(parseFailure,false);assert.equal(child.exitCode,null,'owned_group_supervisor_exited');assert.ok(!events.some(v=>['supervisor-failed','worker-failed','startup-failed','child-exit'].includes(v.type)),'owned_group_runtime_failed');assert.ok(performance.now()<end,'owned_group_event_timeout');await new Promise(r=>setTimeout(r,25));}return events;};
 async function stop(){if(child.exitCode===null&&child.signalCode===null&&child.stdin.writable)command('stop');const result=await Promise.race([closed,new Promise(r=>setTimeout(()=>r(null),15000))]);signal.removeEventListener('abort',abort);await writeFile(path.join(root,'supervisor.private.log'),errors,{flag:'wx',mode:0o600});assert.ok(result,'owned_group_supervisor_stop_timeout');assert.equal(parseFailure,false);assert.equal(output,'');const complete=events.find(v=>v.type==='supervisor-stopped');return{...result,complete:complete??null};}
 return{root,directory:policy.directory,policy,sharing,events,command,waitFor,stop,child,readCredential:async()=>JSON.parse(await readFile(path.join(policy.directory,'runtime.json'),'utf8'))};
}
