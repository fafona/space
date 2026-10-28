// Reviewed APPLICATION preparation is immutable data, not a moving tool SHA.
// Adopting another tool revision never rewrites this profile or old receipts.
import * as fs from 'node:fs';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_APPLICATION as A} from './booking-handoff-policy.mjs';
import {BOOKING_READY_RECEIPT,assertBookingReadyReceipt} from './booking-ready-policy.mjs';
import {assertBookingReadyPreserved} from './booking-ready-tool.mjs';
import {observeBookingReadyApplication} from './booking-ready-backup.mjs';
import {inspectPinnedExecutionSource} from './release-toolchain-source.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
export const BOOKING_PREPARATION_REVISION='38a3ba02a3f2b2165994043e2ac78ea1d90d0282';
export function verifyBookingPreparation(revision){
 need(revision===BOOKING_PREPARATION_REVISION,'source_changed');const source=inspectPinnedExecutionSource({revision,directory:'/var/lib/faolla-online-code/'+revision}),evidence=assertBookingReadyPreserved();
 const receipt=JSON.parse(bookingHostRead('/var/lib/faolla-online-release/'+C+'/'+BOOKING_READY_RECEIPT));assertBookingReadyReceipt(receipt,revision,evidence);
 const application=observeBookingReadyApplication();need(application[C]?.target===C&&application[A]?.target===A,'build_binding_mismatch');
 for(const name of ['worker-enabled.json','watchdog-lease.json','preflight.json'])need(!fs.existsSync('/var/lib/faolla-booking-handoff/'+C+'/'+name),'attempt_unknown');
 return {revision,inventorySha256:source.inventorySha256,receiptSha256:sha256(canonicalJson(receipt)),preservedSha256:evidence,application};
}
