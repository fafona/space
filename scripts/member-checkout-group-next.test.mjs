import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {loadGroupNextRevision} from './member-checkout-group-next-revision.mjs';

test('combined topology binds unchanged candidate and renewal sources without promoting application or production authority',async()=>{
 const r=await loadGroupNextRevision();assert.equal(r.material.application.files,2974);assert.equal(r.material.application.sha256,'e41ee7fe36bf7cae3e6640c0d249f9f3822cbdd56e0175e947ae79ad2f1d0e33');assert.equal(r.material.frozenApplication.files,2971);assert.equal(r.material.candidateRevisionSha256,'b089e6595e8ed06e5e0a38da0edfb701a264be571878e4a5ac0bfee8b5b77603');assert.equal(r.material.renewalRevisionSha256,'5a7381a219f5c6f2c359610b740dff40c861407c6d32fb899eebbbae026b2d3d');assert.equal(r.material.sources.length,6);for(const k of ['formalSigningKeysRead','formalIssuerProvisioned','productionAuthorized','deploymentReady'])assert.equal(r.material[k],false);
});
test('unprivileged host refuses before target selection, mode changes, private writes or sudo outside owned CI',()=>{
 const code=`import{shareOwnedBuiltCandidate,startOwnedGroupRuntime}from'./scripts/member-checkout-group-runtime-host.mjs';const f=new Proxy({},{get(){process.exit(3)}});for(const action of [()=>shareOwnedBuiltCandidate(f),()=>startOwnedGroupRuntime(f)]){try{await action();process.exit(2)}catch{}}`;
 const r=spawnSync(process.execPath,['--input-type=module','--eval',code],{cwd:process.cwd(),env:{},encoding:'utf8',timeout:15000});assert.ifError(r.error);assert.equal(r.status,0);assert.equal(r.stderr,'');
});
test('root supervisor cannot read its request or launch outside exact hosted opt-in',()=>{
 const r=spawnSync(process.execPath,['scripts/member-checkout-group-runtime-supervisor.mjs','/not-a-request'],{cwd:process.cwd(),env:{},encoding:'utf8',timeout:15000});assert.ifError(r.error);assert.equal(r.status,1);assert.match(r.stderr,/AssertionError/);assert.doesNotMatch(r.stderr,/ENOENT|EACCES/);
});
test('combined real harness cannot select tools or connect to any backend outside owned CI',()=>{
 const r=spawnSync(process.execPath,['--import','tsx','--test','scripts/member-checkout-group-next-acceptance.mjs'],{cwd:process.cwd(),env:{FAOLLA_CHECKOUT_GROUP_NEXT_ACCEPTANCE:'1'},encoding:'utf8',timeout:15000});assert.ifError(r.error);assert.equal(r.status,1);assert.match(r.stdout,/AssertionError/);assert.doesNotMatch(r.stdout+r.stderr,/ECONNREFUSED|ENOENT|permission denied/);
});
test('mode sharing validates the complete new owned tree before any chmod, does not follow dependency links or modify source bytes',async()=>{
 const s=await readFile('scripts/member-checkout-group-runtime-host.mjs','utf8');assert.match(s,/assertGroupRuntimeCi\(\);const \{revision\}/);assert.ok(s.indexOf('await add(fixture.app)')<s.indexOf('await chmod(e.file,e.mode)'));assert.match(s,/if\(s.isSymbolicLink\(\)\).*?return;/);assert.match(s,/applicationFingerprint\(fixture.app\),revision.material.application/);assert.match(s,/externalLinksModified:0/);assert.doesNotMatch(s,/recursive:\s*true|chown\(|rm\(|unlink\(|readdir\(fixture.root/);
});
test('both child identities drop root and supplementary groups before any external component, key or Next load',async()=>{
 const s=await readFile('scripts/fixtures/member-checkout-group-runtime-worker.mjs','utf8');assert.ok(s.indexOf('process.setgroups([])')<s.indexOf('await import('));assert.ok(s.indexOf('process.setuid(uid)')<s.indexOf('await import('));assert.match(s,/assert.deepEqual\(process.getgroups\(\),\[c.writerGid\]\)/);assert.match(s,/await deny\(\(\)=>readFile\(path.join\(c.root,'signer\/key.private'\)\)\)/);assert.match(s,/request.private.json/);assert.match(s,/member-checkout-rollback-local-server.mjs/);assert.match(s,/createCredentialRenewalController/);assert.doesNotMatch(s,/process\.env\.[A-Z_]*(?:SECRET|KEY)\s*=/);
});
test('supervisor uses a fixed environment/command allowlist and old IPC-close, never credentials in process arguments or output',async()=>{
 const s=await readFile('scripts/member-checkout-group-runtime-supervisor.mjs','utf8'),host=await readFile('scripts/member-checkout-group-runtime-host.mjs','utf8');assert.match(s,/allowed.includes\(k\)/);assert.match(s,/assert.equal\(e.NODE_OPTIONS,'--max-old-space-size=3072'\)/);assert.match(s,/row.requested=row.role==='next'\?'IPC-close':'stop'/);assert.match(s,/commandBytes>4096/);assert.match(s,/source:role,\.\.\.event/);assert.doesNotMatch(s,/chmod\(|SUPABASE_SERVICE_ROLE_KEY:\s*|console.log\(config|JSON.stringify\(config/);assert.match(host,/'-n','\/usr\/bin\/env','-i'/);assert.match(host,/fileURLToPath\(new URL\('\.\/member-checkout-group-runtime-supervisor.mjs',import.meta.url\)\),request/);
});
test('combined acceptance crosses three actual expirations with real 401, maintains one commit and recovers in the same Next and issuer',async()=>{
 const s=await readFile('scripts/member-checkout-group-next-acceptance.mjs','utf8');for(const marker of ['startOwnedGroupRuntime','installRealAuthCheckoutFixture','buildOwnedCredentialCandidate','last.expiresAt+31000','v.expiresAt+31000',"'fail-issuer'","'resume-issuer'",'financialCommitDispatches:1','differentUid:true','ordinaryServiceIdentityRetained:true','formalIssuerProvisioned:false','kongValidated:false'])assert.ok(s.includes(marker),marker);assert.match(s,/report.methods.filter\(v=>v==='faolla_member_checkout_submission_commit_v2'\).length,1/);assert.match(s,/assert.equal\(attempts.length,count\)/);assert.match(s,/ownedCleanupSucceeded\(owned.profileName,report.stopped,report.nextShutdown\)/);assert.doesNotMatch(s,/now:\s*\(\)=>|Date\.now\s*=|process\.env\.(SUPABASE|DATABASE|PG|STRIPE)\w*\s*=/);
});
test('new combined job is appended, keeps exact original jobs, tools and report-only upload without deploy permissions',async()=>{
 const s=await readFile('.github/workflows/member-checkout-047-real-auth.yml','utf8'),job=s.split('\n  credential-group-next:\n')[1];assert.ok(job);for(const marker of ['image: postgres:15.8','node-version: 20.20.1',"FAOLLA_CHECKOUT_GROUP_NEXT_ACCEPTANCE: '1'",'node --import tsx --test scripts/member-checkout-group-next-acceptance.mjs','faolla-group-next-evidence/report.json'])assert.ok(job.includes(marker));assert.match(job,/2683b9549e922d0644621129fdabd7edb8b78c35274e133e61a3280ad9675161/);assert.match(job,/ab5cc7e974d4940447991804588cfb8b3f7b2c57b691f0905df04d51ede69470/);assert.doesNotMatch(job,/secrets\.|ssh |scp |git merge|git push|deploy-production|id-token:/);
});
