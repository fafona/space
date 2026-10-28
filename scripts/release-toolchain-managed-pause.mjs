// New reviewed SIGINT completion path; the original exit-0 guard is unchanged.
// Neither this validator nor a serialized witness can authorize a restart.
import{assertBookingLegacyTaskTransition,assertBookingLegacyEnvironmentTransition,assertBookingLegacyRuntimeEnvironmentTransition,BOOKING_HANDOFF_PM2_PROVENANCE,assertBookingHandoffWindow}from'./booking-handoff-policy.mjs';
import{assertManagedPauseEnvironmentTransition}from'./release-toolchain-pm2-transition.mjs';
export function assertProvenBookingLegacyTransition(value,terminationEvidence){
 if(value.afterPmDerived?.exitCode===0){if(terminationEvidence!==undefined)throw Error('booking_handoff_termination_unexpected');return assertBookingLegacyRuntimeEnvironmentTransition(value);}
 assertBookingLegacyTaskTransition(value.legacyBefore,value.legacyAfter);assertBookingLegacyEnvironmentTransition(value.beforeConfigured,value.afterConfigured);
 const expected=['beforeRaw','afterRaw','beforeConfigured','afterConfigured','legacyBefore','legacyAfter','beforePmUptime','afterPmUptime','beforePmDerived','afterPmDerived','framework','window','observedAt'];
 if(JSON.stringify(Object.keys(value).sort())!==JSON.stringify(expected.sort()))throw Error('booking_handoff_runtime_environment_shape');
 return assertManagedPauseEnvironmentTransition(value,{framework:BOOKING_HANDOFF_PM2_PROVENANCE,assertWindow:assertBookingHandoffWindow,expectedExitCode:130,terminationEvidence,logFile:'/root/.pm2/pm2.log'});
}
