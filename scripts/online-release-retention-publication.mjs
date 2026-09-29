// Run only AFTER the application has passed public checks and its active state
// has been persisted. Failure here is deferred housekeeping, never a reason to
// restore an otherwise healthy application or repeat a process-stop attempt.
export async function completePublicationRetention(state, operations) {
  const pending = reason => ({status: 'pending', reason});
  try {
    if (state?.status !== 'active') return pending('application_not_active');
    const before = operations.history(), prior = before.entries.at(-1);
    if (!prior) return {status: 'not-enabled'};
    if (prior.active.target !== state.target) {
      await operations.run({kind: 'converge', activeTarget: state.target, victimTarget: null});
    }
    const history = operations.history(), window = operations.window(history);
    if (window.phase !== 'stable' || window.active.target !== state.target) return pending('publication_window_changed');
    if (window.converged) return {status: 'completed', retired: null};
    // Normal publication adds one process. Historic excess processes need an
    // explicitly inspected convergence batch, not an unbounded stop loop here.
    if (window.extraOnlineWebProcesses.length !== 1) return pending('historic_excess_requires_inspection');
    const name = window.extraOnlineWebProcesses[0];
    const victim = [prior.active, prior.rollback].find(a => a.name === name);
    if (!victim || [window.active.name, window.stableRollback.name].includes(name)) return pending('unexpected_excess_process');
    await operations.run({kind: 'retire', activeTarget: state.target, victimTarget: victim.target});
    const final = operations.window(operations.history());
    if (!final.converged || final.active.target !== state.target) return pending('retention_not_converged');
    return {status: 'completed', retired: victim.target};
  } catch (error) {
    return pending(/^online_retention_[a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'retention_check_failed');
  }
}
