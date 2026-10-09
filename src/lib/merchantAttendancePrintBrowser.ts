import type { AttendancePrintDelivery } from "./merchantAttendancePrintClient";

// A user explicitly requested printing. This opens only the browser's own
// dialog, never a silent printer job, popup, permanent file or whole admin page.
export function deliverAttendancePrint(input: AttendancePrintDelivery): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!input.authorized() || input.signal.aborted) { reject(Error("attendance_print_expired")); return; }
    const frame = document.createElement("iframe");
    frame.title = "考勤打印明细";
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.setAttribute("aria-hidden", "true"); frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:-12000px;top:0;width:794px;height:1123px;border:0;pointer-events:none;";
    let dispatched = false, settled = false, removed = false, printWindow: Window | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (removed) return; removed = true;
      clearTimeout(timer); input.signal.removeEventListener("abort", abort);
      frame.removeEventListener("load", loaded); printWindow?.removeEventListener("afterprint", afterPrint);
      frame.remove(); printWindow = null;
    };
    const fail = (code: string) => { cleanup(); if (!settled) { settled = true; reject(Error(code)); } };
    const abort = () => fail("attendance_print_expired");
    const afterPrint = () => cleanup();
    const loaded = () => {
      if (removed || dispatched) return;
      if (!frame.isConnected || !input.authorized()) { fail("attendance_print_expired"); return; }
      try {
        const content = frame.contentDocument, target = frame.contentWindow;
        // Ignore a browser's preliminary about:blank load. Never dispatch twice.
        if (content?.body?.getAttribute("data-attendance-print-document") !== input.kind) return;
        if (!target || typeof target.print !== "function") { fail("attendance_print_unavailable"); return; }
        printWindow = target; target.addEventListener("afterprint", afterPrint, { once: true });
        if (!frame.isConnected || !input.authorized()) { fail("attendance_print_expired"); return; }
        dispatched = true;
        target.print();
        if (!settled) { settled = true; resolve(); }
        // Some browsers return before afterprint, and some never dispatch it.
        // Keep the frame bounded, while abort/hide/unmount can always remove it.
        if (!removed) { clearTimeout(timer); timer = setTimeout(cleanup, Math.min(60000, input.remainingMs())); }
      } catch { fail(dispatched ? "attendance_print_uncertain" : "attendance_print_unavailable"); }
    };
    input.signal.addEventListener("abort", abort, { once: true });
    frame.addEventListener("load", loaded);
    timer = setTimeout(() => fail("attendance_print_expired"), Math.min(30000, input.remainingMs()));
    try { frame.srcdoc = input.html; document.body.appendChild(frame); }
    catch { fail("attendance_print_unavailable"); }
  });
}
