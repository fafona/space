import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {ACTIVE_ROUTING_NATIVE_CASES,runOwnedActiveRoutingChild,acceptOwnedActiveRouting,rehearseOwnedActiveRoutingInterruption} from './release-toolchain-active-generation-routing-native.mjs';
test('native active-route scope cannot be selected with a serialized green receipt, formal path or caller PID',async()=>{
 await assert.rejects(runOwnedActiveRoutingChild('controller','/tmp/not-owned'));await assert.rejects(runOwnedActiveRoutingChild('supervisor','/var/lib/faolla-booking-handoff/forged'));
 if(process.platform!=='linux'){await assert.rejects(acceptOwnedActiveRouting());await assert.rejects(rehearseOwnedActiveRoutingInterruption());}assert.deepEqual(ACTIVE_ROUTING_NATIVE_CASES,['normal','death-before-route','death-mid-route','death-after-route']);
});
test('owner cancellation is source/birth-bound and fails only after real process, flock and stopped-cluster verification',()=>{
 const value=readFileSync(new URL('./release-toolchain-active-generation-routing-native.mjs',import.meta.url),'utf8');for(const token of ['process.on(\'SIGTERM\',cancel)','process.removeListener(\'SIGTERM\',cancel)','owned-process-','same(captureProcessFact(expected.pid),expected)',"process.kill(expected.pid,'SIGTERM')",'actualOwnedMidCase:true','validateIsolationContainer','running:false','active_routing_native_interrupted'])assert.ok(value.includes(token),token);
});
test('native acceptance shares the actual active-route and recovery algorithms with real bounded owned IO and never claims a formal certificate',()=>{
 const value=readFileSync(new URL('./release-toolchain-active-generation-routing-native.mjs',import.meta.url),'utf8');
 for(const token of ['executeActiveBookingRoutingPhase','executeActiveBookingRecovery','executeBookingIngressDrain','runBookingWatchdogSequence','BOOKING_RECOVERY_BARRIER_SQL','createOwnedIsolation','stopOwnedIsolation',"process.kill(process.pid,'SIGKILL')",'FLOCK\\s+ADVISORY\\s+WRITE','assertActiveBookingRoutingCurrent','retentionCertificateNotMinted:true','formalPublicationAccepted:false','workerGateNotOpened:true','componentAcceptanceOnly:true','captureActiveToolchainProductionSnapshot'])assert.ok(value.includes(token),token);
 assert.doesNotMatch(value,/guardedProductionBookingRepairActivationSql|activation-attempt\.json|pauseOriginalOnce|pm2.*jlist|process\.env\.[A-Z_]*PID/);
 const workflow=readFileSync(new URL('../.github/workflows/release-toolchain.yml',import.meta.url),'utf8');assert.ok(workflow.includes('Already Active Routing And Real Controller Death Recovery'));assert.ok(workflow.includes('/var/lib/faolla-active-routing-native-*'));
});
