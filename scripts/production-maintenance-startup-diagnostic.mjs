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

// Diagnostics are not the control result. Accept only bounded, fixed successful
// progress records; exit status and the exact stdout control proof remain gates.
export function validateSuccessfulStartupDiagnostics(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 262144) throw new Error("maintenance_diagnostics_invalid");
  if (value === "") return true;
  if (!value.endsWith("\n")) throw new Error("maintenance_diagnostics_invalid");
  for (const line of value.slice(0, -1).split("\n")) {
    const match = /^\[deploy\] maintenance_start_diagnostic stage=([a-z_]+) code=(start|passed) elapsed_seconds=(0|[1-9][0-9]{0,4})$/.exec(line);
    if (!match || !STAGES.has(match[1]) || Number(match[3]) > 86400) throw new Error("maintenance_diagnostics_invalid");
  }
  return true;
}
