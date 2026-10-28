import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('full interruption signals only a directly spawned and birth/source-bound controller, not a caller PID or process name',()=>{
 const source=readFileSync(new URL('./release-toolchain-full-interrupt.mjs',import.meta.url),'utf8');
 for(const token of ["spawn('/usr/bin/node',[FILE]","same(fact(child.pid),expected)","process.kill(expected.pid,'SIGTERM')",'watchdog-armed.json','signal-intent.json','assertStopped(report);seal','validateIsolationContainer','owned-process-'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/SIGKILL|pm2.*(?:restart|kill|stop)|process\.argv\[2\]|unlinkSync|rmSync/);
 assert.match(source,/clearTimeout\(timer\)/);assert.match(source,/captureToolchainProductionSnapshot\(\),formal/);
});
