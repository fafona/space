// CI fixture projection only. Production process capture remains authoritative.
export const STARTUP_PROCESS_FACT_KEYS = Object.freeze([
  "pid", "parentPid", "startTicks", "processIdentity", "uid", "cwd",
  "cwdIdentity", "executable", "executableIdentity", "commandLineDigest",
]);

export function captureStartupFixtureProcessFact(pid, captureProcessFact) {
  // A logical fact must never combine fields from different process captures.
  // Let every capture failure propagate; no retry or cached fallback is safe here.
  const snapshot = captureProcessFact(pid);
  return Object.fromEntries(
    STARTUP_PROCESS_FACT_KEYS.map((key) => [key, snapshot[key]]),
  );
}
