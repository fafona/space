import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {activeNativeFailureDiagnostic} from './release-toolchain-full-rehearsal.mjs';
import {ToolchainError} from './release-toolchain-contracts.mjs';
const revision='a'.repeat(40);
test('original active startup failures retain their phase and fixed code without raw exception text or application data',()=>{
 const syntax=activeNativeFailureDiagnostic(new SyntaxError('private customer data'),{phase:'case-seed:normal',toolRevision:revision});
 assert.equal(syntax.errorType,'syntax_error');assert.equal(syntax.phase,'case-seed:normal');assert.equal(syntax.publicationAuthority,false);assert.equal(syntax.observationOnly,true);assert.match(syntax.diagnostic.exceptionMessageSha256,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(syntax),/private customer/);
 const identity=activeNativeFailureDiagnostic(new ToolchainError('database_identity_mismatch'),{phase:'isolation-create',toolRevision:revision});assert.equal(identity.diagnostic.code,'database_identity_mismatch');
 assert.throws(()=>activeNativeFailureDiagnostic(Error('x'),{phase:'arbitrary text',toolRevision:revision}));
});
test('active diagnostics preserve original case, outer failure and cleanup failure separately without changing inactive acceptance or signals',()=>{
 const runner=readFileSync(new URL('./release-toolchain-full-rehearsal.mjs',import.meta.url),'utf8'),observer=readFileSync(new URL('./release-toolchain-full-interrupt.mjs',import.meta.url),'utf8');
 assert.ok(runner.includes("const recordFailure=(file,error)=>{if(activeProfile)try{"));assert.ok(runner.includes("recordFailure('active-case-failure-'+name+'.json',error);throw error"));assert.ok(runner.includes("recordFailure('active-profile-failure.json',error);throw error"));assert.ok(runner.includes("recordFailure('active-profile-cleanup-failure.json',error);throw error"));
 assert.ok(observer.includes("if(activeProfile)try{seal(root+'/controller-exit-observed.json'"));assert.ok(observer.includes('if(exitObservationError)throw exitObservationError'));assert.ok(observer.includes("process.kill(expected.pid,'SIGTERM')"));assert.doesNotMatch(observer,/process\.exit\(|continue-on-error|skip/);
});
