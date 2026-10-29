import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {verifyActiveBookingIncidentPreparation,verifyClosedActiveBookingPreparation} from './release-toolchain-active-generation-profile.mjs';
test('active preparation rejects a caller-selected source revision before observing or writing anything',async()=>{await assert.rejects(verifyActiveBookingIncidentPreparation('a'.repeat(40)));});
test('closed preparation is separate and cannot consume a caller source or a green receipt',async()=>{await assert.rejects(verifyClosedActiveBookingPreparation('a'.repeat(40),'b'.repeat(40)));});
test('new active preparation verifies both immutable builds and real incident rather than relaxing the inactive rules',()=>{
 const active=readFileSync(new URL('./release-toolchain-active-generation-profile.mjs',import.meta.url),'utf8'),inactive=readFileSync(new URL('./release-toolchain-booking-profile.mjs',import.meta.url),'utf8');
 for(const token of ['inspectPinnedExecutionSource','await inspectActiveBookingIncident({window})','observeBookingReadyApplication()','databaseAlreadyActive:true','activationReplayAllowed:false','legacyRestartAllowed:false'])assert.ok(active.includes(token),token);
 assert.doesNotMatch(active,/bookingHostSql|renameSync|writeFile|process\.kill|verifyBookingPreparation\(/);
 assert.ok(inactive.includes("['worker-enabled.json','watchdog-lease.json','preflight.json']"));assert.ok(inactive.includes('assertBookingReadyPreserved()'));
});
