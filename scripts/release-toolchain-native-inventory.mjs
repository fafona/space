import {BOOKING_HANDOFF_NATIVE_SOURCES} from './booking-handoff-policy.mjs';
// An explicit runtime-resource closure, supplemented by the whole committed
// source inventory in the native report. No caller can shrink the closure.
export const FULL_REHEARSAL_SOURCES=Object.freeze([...BOOKING_HANDOFF_NATIVE_SOURCES,
 'release-toolchain-full-rehearsal.mjs','release-toolchain-isolation.mjs','release-toolchain-authority.mjs',
 'release-toolchain-source.mjs','release-toolchain-profiles.mjs','release-toolchain-native-inventory.mjs',
 'release-toolchain-booking-profile.mjs','release-toolchain-booking-admission.mjs','release-toolchain-admission-context.mjs','release-toolchain-release.mjs','release-toolchain-backup-producer.mjs','release-toolchain-legacy-runtime.mjs','release-toolchain-diagnostics.mjs','release-toolchain-recovered-contract.mjs','release-toolchain-recovered-attempt.mjs',
 'release-toolchain-worker.mjs','release-toolchain-worker-contract.mjs','release-toolchain-pm2-worker.py','release-toolchain-booking-compatibility.mjs','release-toolchain-full-interrupt.mjs','release-toolchain-recovery-diagnostics.mjs','release-toolchain-recovery-probe.mjs',
 'release-toolchain-pm2-transition.mjs','release-toolchain-active-generation-contract.mjs','release-toolchain-active-generation-incident.mjs','release-toolchain-active-generation-preservation.mjs','release-toolchain-active-generation-profile.mjs','online-release-retention-writer.mjs',
 'production-maintenance-pm2-adapter.mjs','production-maintenance-pm2-control.py','production-maintenance-pm2-connection.py','production-maintenance-pm2-dump.py','release-toolchain-active-generation-metadata.mjs',
 'check-production-runtime-supervision.mjs','production-maintenance-trusted-python.mjs','production-maintenance-daemon-continuity.mjs','release-toolchain-pm2-observation.mjs','release-toolchain-active-generation-persistence.mjs',
 'release-toolchain-active-generation-owned-lab.mjs','release-toolchain-active-generation-reconciliation.mjs']);
