// Exact independent candidate, normal five production stages, owned CI only.
// No application patching after binding, credential injection into the build,
// real backend, deployment, source-pin refresh or production process handling.
import assert from 'node:assert/strict';
import {cp,readFile,readdir,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {applicationFingerprint} from './member-checkout-compatibility-check.mjs';
import {assertCredentialCandidateCi,loadCredentialCandidateSources} from './member-checkout-credential-candidate.mjs';
export async function buildOwnedCredentialCandidate(fixture,signal,evidence){
 assertCredentialCandidateCi();const {revision}=await loadCredentialCandidateSources();assert.equal(revision.sha256,'b089e6595e8ed06e5e0a38da0edfb701a264be571878e4a5ac0bfee8b5b77603');
 const expected=revision.material.application;assert.deepEqual(await applicationFingerprint(fixture.app),expected);
 for(const name of ['public','scripts'])await cp(path.join(fixture.root,name),path.join(fixture.app,name),{recursive:true,force:false,errorOnExist:true});
 const pkg=JSON.parse(await readFile(path.join(fixture.app,'package.json'),'utf8'));
 assert.equal(pkg.scripts.build,'npm run check:env:strict && npm run check:v1-deploy-config && node scripts/prepare-next-wasm.mjs && next build --webpack && npm run check:bundle:admin');
 let backendRequests=0;const backend=http.createServer((_req,res)=>{backendRequests++;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"owned_build_has_no_backend"}');});
 await new Promise((resolve,reject)=>{backend.once('error',reject);backend.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${backend.address().port}`;
 const environment={PATH:process.env.PATH,HOME:fixture.evidence,TMPDIR:fixture.evidence,TEMP:fixture.evidence,TMP:fixture.evidence,NODE_ENV:'production',
  NODE_OPTIONS:'--max-old-space-size=3072 --import='+pathToFileURL(path.join(process.cwd(),'scripts/fixtures/member-checkout-build-network.mjs')).href,
  NEXT_TELEMETRY_DISABLED:'1',FAOLLA_BUILD_SINGLE_WORKER:'1',FAOLLA_CHECKOUT_BUILD_LOCAL:'1',FAOLLA_CHECKOUT_BUILD_EVIDENCE_DIR:fixture.evidence,FAOLLA_CHECKOUT_BUILD_ORIGIN:origin,
  NEXT_PUBLIC_SUPABASE_URL:origin,SUPABASE_INTERNAL_URL:origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:'isolated-build-public-placeholder',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_BOOKING_AUTOMATION_WORKER_ENABLED:'false'};
 const steps=evidence.steps=[];
 try{
  // The original 12 tests run against the actual replaced entry in this copy;
  // source=undefined must still delegate to its byte-identical ENV implementation.
  const stages=[['retained-env-tests',['--import','tsx','--test','--test-reporter=tap','src/lib/merchantCheckoutRuntime.server.test.ts']],
   ['environment',['scripts/check-env.mjs','--strict']],['deployment-config',['--import','tsx','scripts/check-v1-deploy-config.ts']],['pinned-wasm',['scripts/prepare-next-wasm.mjs']],
   ['production-build',['node_modules/next/dist/bin/next','build','--webpack']],['admin-bundle-budget',['scripts/check-admin-bundle-budget.mjs']]];
  for(const [name,args] of stages){
   signal.throwIfAborted();const log=createWriteStream(path.join(fixture.evidence,name+'.private.log'),{flags:'wx',mode:0o600});
   const child=spawn(process.execPath,args,{cwd:fixture.app,env:environment,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
   const stop=()=>child.kill('SIGTERM'),timer=setTimeout(stop,name==='production-build'?600000:30000);timer.unref();signal.addEventListener('abort',stop,{once:true});let code,exitSignal;
   try{[code,exitSignal]=await once(child,'exit');}finally{clearTimeout(timer);signal.removeEventListener('abort',stop);await new Promise(resolve=>log.end(resolve));}
   steps.push({name,code,signal:exitSignal});assert.equal(code,0,'credential_candidate_build_'+name);assert.equal(exitSignal,null);
   if(name==='retained-env-tests'){const text=await readFile(path.join(fixture.evidence,name+'.private.log'),'utf8');for(const [label,count] of [['tests',12],['pass',12],['fail',0],['skipped',0]])assert.match(text,new RegExp('# '+label+' '+count+'\\b'));}
  }
  let network=[];try{network=(await readFile(path.join(fixture.evidence,'network.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(v=>JSON.parse(v));}catch(error){if(error.code!=='ENOENT')throw error;}
  assert.ok(network.every(v=>['framework-version-refused','owned-tsx-ipc-refused'].includes(v.kind)));assert.equal(backendRequests,0);await stat(path.join(fixture.app,'.next/BUILD_ID'));
  let clientFiles=0;const inspect=async directory=>{for(const item of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())await inspect(file);else if(/\.(?:js|json)$/.test(item.name)){const bytes=await readFile(file);for(const value of ['FAOLLA_CHECKOUT_RUNTIME_JWT','FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_'])assert.equal(bytes.includes(Buffer.from(value)),false,'credential_configuration_in_browser');clientFiles++;}}};await inspect(path.join(fixture.app,'.next/static'));assert.ok(clientFiles>0);
  assert.deepEqual(await applicationFingerprint(fixture.app),expected);assert.deepEqual(await applicationFingerprint(fixture.root),revision.material.baseApplication);
  Object.assign(evidence,{backendRequests,networkKinds:network.map(v=>v.kind),clientFiles,retainedEnvTests:12,buildIdSha256:createHash('sha256').update(await readFile(path.join(fixture.app,'.next/BUILD_ID'))).digest('hex')});return evidence;
 }finally{evidence.backendRequests=backendRequests;backend.closeAllConnections();if(backend.listening)await new Promise(resolve=>backend.close(resolve));}
}
