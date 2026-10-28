import {BOOKING_HANDOFF_NATIVE_SOURCES} from './booking-handoff-policy.mjs';
// An explicit runtime-resource closure, supplemented by the whole committed
// source inventory in the native report. No caller can shrink the closure.
export const FULL_REHEARSAL_SOURCES=Object.freeze([...BOOKING_HANDOFF_NATIVE_SOURCES,
 'release-toolchain-full-rehearsal.mjs','release-toolchain-isolation.mjs','release-toolchain-authority.mjs',
 'release-toolchain-source.mjs','release-toolchain-profiles.mjs','release-toolchain-native-inventory.mjs',
 'release-toolchain-booking-profile.mjs','release-toolchain-booking-admission.mjs','release-toolchain-admission-context.mjs','release-toolchain-release.mjs','release-toolchain-backup-producer.mjs',
 'release-toolchain-worker.mjs','release-toolchain-worker-contract.mjs','release-toolchain-pm2-worker.py','release-toolchain-booking-compatibility.mjs','release-toolchain-full-interrupt.mjs']);
