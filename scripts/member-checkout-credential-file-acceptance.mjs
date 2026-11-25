// Only owned Linux CI files + loopback unit peer. NO database, Auth, formal
// signer/keys, Next process, production credentials or deployment authority.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {assertIsolatedCi,safeError} from './member-checkout-real-auth-support.mjs';
import {loadCredentialDeliveryRevision} from './member-checkout-credential-delivery-revision.mjs';
const owned=assertIsolatedCi();assert.equal(owned.profileName,'current-auth');assert.equal(process.env.FAOLLA_CHECKOUT_CREDENTIAL_FILE_ACCEPTANCE,'1');
const evidence=path.join(process.env.RUNNER_TEMP,'faolla-credential-file-evidence');await mkdir(evidence,{mode:0o700});
const report={version:1,commit:process.env.GITHUB_SHA,scope:'owned-ci-file-delivery-component-not-next-or-gateway',checks:[],passed:false,cleanupPassed:false,failure:null};let child;
try{
 report.revision=await loadCredentialDeliveryRevision();report.application=report.revision.material.frozenApplication;
 child=spawn(process.execPath,['--import','tsx','--test','--test-reporter=tap','scripts/member-checkout-credential-file.test.ts','src/lib/merchantCheckoutRuntime.server.test.ts'],{
  cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:evidence,TMPDIR:evidence,TEMP:evidence,TMP:evidence},stdio:['ignore','pipe','pipe']});
 let output='',errors='',overflow=false;
 child.stdout.on('data',chunk=>{if(output.length+chunk.length>1024*1024){overflow=true;child.kill('SIGTERM');}else output+=chunk.toString();});
 child.stderr.on('data',chunk=>{if(errors.length+chunk.length>16384){overflow=true;child.kill('SIGTERM');}else errors+=chunk.toString();});
 const timer=setTimeout(()=>child.kill('SIGKILL'),60000);let code,signal;
 try{[code,signal]=await once(child,'exit');}finally{clearTimeout(timer);}
 // Raw diagnostic output remains private and is never an uploaded artifact.
 await writeFile(path.join(evidence,'tests.private.log'),output+'\n'+errors,{flag:'wx',mode:0o600});
 report.checks=output.split('\n').filter(line=>/^(?:not )?ok \d+ - /.test(line)).map(line=>({name:line.replace(/^(?:not )?ok \d+ - /,'').slice(0,256),passed:line.startsWith('ok ')}));
 report.testSummary={exitCode:code,signal,tests:Number(output.match(/# tests (\d+)\b/)?.[1]??-1),passed:Number(output.match(/# pass (\d+)\b/)?.[1]??-1),failed:Number(output.match(/# fail (\d+)\b/)?.[1]??-1),skipped:Number(output.match(/# skipped (\d+)\b/)?.[1]??-1)};
 assert.equal(overflow,false);assert.equal(code,0);assert.equal(signal,null);assert.equal(errors,'');assert.match(output,/# tests 26\b/);assert.match(output,/# pass 26\b/);assert.match(output,/# fail 0\b/);assert.match(output,/# skipped 0\b/);
 assert.equal(report.checks.length,26);assert.ok(report.checks.every(v=>v.passed));
 report.transport={sameProcessClientGenerations:3,clock:'controlled-test-clock',atomicFileHandoffTested:true,timeoutAndCancellationNoLateDispatch:true,envFallback:false,financialPostRetries:0,
  signatureCheck:'owned-unit-http-peer-only',realPostgrestValidated:false,nextApplicationIntegrated:false,distinctUidGroupReadValidated:false,formalSigningKeysRead:false,productionAuthorized:false,deploymentReady:false};
 report.passed=true;report.cleanupPassed=true;
}catch(error){report.failure=safeError(error);throw error;}finally{
 if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;report.cleanupPassed=false;}
 await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
}
