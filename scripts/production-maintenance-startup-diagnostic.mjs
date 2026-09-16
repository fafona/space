const STAGES = new Set(["controller_ingress", "controller_stopped", "controller_start", "controller_verify", "controller_save", "controller_accept",
  "runtime_disk", "runtime_stopped", "runtime_launch", "runtime_settle", "launch_identity", "launch_supervision", "candidate_capture", "launch_confirm"]);
export function createStartupDiagnostic({ now = Date.now, write = line => process.stderr.write(line) } = {}) {
  return async (stage, callback) => {
    if (!STAGES.has(stage) || typeof callback !== "function") throw new Error("maintenance_start_diagnostic_invalid");
    const started = now();
    const emit = code => {
      const elapsed = Math.floor((now() - started) / 1000);
      if (Number.isSafeInteger(elapsed) && elapsed >= 0 && elapsed <= 86400) {
        try { write(`[deploy] maintenance_start_diagnostic stage=${stage} code=${code} elapsed_seconds=${elapsed}\n`); } catch { /* diagnostics never grant authority */ }
      }
    };
    emit("start");
    try { const result = await callback(); emit("passed"); return result; }
    catch (error) { emit("failed"); throw error; }
  };
}
export const startupDiagnostic = createStartupDiagnostic();
