import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('full interruption signals only a directly spawned and birth/source-bound controller, not a caller PID or process name',()=>{
 const source=readFileSync(new URL('./release-toolchain-full-interrupt.mjs',import.meta.url),'utf8');
 for(const token of ["spawn('/usr/bin/node',[FILE]","same(fact(child.pid),expected)","process.kill(expected.pid,'SIGTERM')",'watchdog-armed.json','signal-intent.json','assertStopped(report)','validateIsolationContainer','owned-process-'])assert.ok(source.includes(token),token);
 const completion=source.slice(source.indexOf("diagnosticStage='verify-stopped'")),stopped=completion.indexOf('assertStopped(report)'),originalErrors=completion.indexOf('activeInterruptionErrorFiles('),sealed=completion.indexOf("seal(root+'/verified.json',report)"),verified=completion.indexOf('return verifyFullInterruptionReport(root)');
 assert.ok(stopped>=0&&originalErrors>stopped&&sealed>originalErrors&&verified>sealed,'actual stopped proof and original-error verification must both precede sealing and independent revalidation');
 assert.doesNotMatch(source,/SIGKILL|pm2.*(?:restart|kill|stop)|process\.argv\[2\]|unlinkSync|rmSync/);
 assert.match(source,/clearTimeout\(timer\)/);assert.match(source,/captureToolchainProductionSnapshot\(\),formal/);
});
test('interruption keeps its original strict guards and preserves safe stage diagnostics before final cleanup',()=>{const source=readFileSync(new URL('./release-toolchain-full-interrupt.mjs',import.meta.url),'utf8');for(const token of ['spawned.json','failure.json','cleanup-unconfirmed.json','stageFailureDiagnostic','diagnosticStage','syntax_error','automaticRetryAllowed:false'])assert.ok(source.includes(token),token);assert.doesNotMatch(source,/\.stderr\s*\)|error\.message\s*[,}]|error\.stack\s*[,}]/);});
