// CI-owned teardown observation only. Never used as a production identity proof.
export function observeCiProcessAlive(fact, io) {
  if (!fact || !Number.isSafeInteger(fact.pid) || fact.pid <= 0 || fact.pid > 2147483647 ||
      typeof fact.startTicks !== 'string' || !/^[1-9][0-9]{0,24}$/.test(fact.startTicks) ||
      typeof io?.readStat !== 'function' || typeof io?.capture !== 'function') {
    throw Error('ci_process_exit_identity_invalid');
  }
  const exited = raw => {
    if (typeof raw !== 'string' || raw.length > 65536 || /[\0\r]/.test(raw) ||
        raw.replace(/\n$/, '').includes('\n') || !raw.startsWith(fact.pid + ' (')) {
      throw Error('ci_process_exit_stat_invalid');
    }
    const close = raw.lastIndexOf(')');
    const fields = close >= 0 && raw[close + 1] === ' ' ? raw.slice(close + 2).trim().split(/\s+/) : [];
    if (fields.length < 20 || !/^[RSDTtZXxKWPI]$/.test(fields[0]) ||
        !/^[0-9]+$/.test(fields[1]) || !/^[1-9][0-9]{0,24}$/.test(fields[19])) {
      throw Error('ci_process_exit_stat_invalid');
    }
    // A reused PID is not the original owned process. Never capture or signal it.
    return fields[19] !== fact.startTicks || fields[0] === 'Z' || fields[0] === 'X' || fields[0] === 'x';
  };
  try {
    if (exited(io.readStat(fact.pid))) return false;
    try {
      const current = io.capture(fact.pid);
      return ['pid', 'startTicks', 'uid', 'executable', 'cwd'].every(key => current[key] === fact[key]);
    } catch (error) {
      // The process can exit between stat and the strict observer's first read.
      // Confirm that transition afresh; never blanket-suppress invalid_proc_stat.
      if (error.message === 'invalid_proc_stat' && exited(io.readStat(fact.pid))) return false;
      throw error;
    }
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) return false;
    throw error;
  }
}
