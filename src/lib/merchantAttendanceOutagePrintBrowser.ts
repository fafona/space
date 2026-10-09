export type OutagePrintDelivery = {
  kind: "blank" | "handoff";
  html: string;
  signal: AbortSignal;
  authorized: () => boolean;
  remainingMs: () => number;
};

//Only the controller's explicit, already-authorized print action calls this.
//Success means print() returned, not that paper was produced or a dialog accepted.
//There is no parent-page printing, popup, download or automatic retry.
export function deliverOutagePrint(input: OutagePrintDelivery): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame: HTMLIFrameElement | null = null, printWindow: Window | null = null;
    let dispatched = false, settled = false, removed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = () => {
      try {
        if (input.signal.aborted || !input.authorized()) throw Error();
        const remaining = input.remainingMs();
        //Never hand NaN, Infinity, zero or a negative value to a browser timer.
        if (!Number.isFinite(remaining) || remaining <= 0) throw Error();
        if (input.signal.aborted || !input.authorized()) throw Error();
        return remaining;
      } catch { throw Error("outage_print_expired"); }
    };
    const cleanup = () => {
      if (removed) return;
      removed = true; clearTimeout(timer);
      input.signal.removeEventListener("abort", abort);
      frame?.removeEventListener("load", loaded);
      printWindow?.removeEventListener("afterprint", afterPrint);
      frame?.remove(); printWindow = null;
    };
    const fail = (code: "outage_print_expired" | "outage_print_unavailable" | "outage_print_uncertain") => {
      cleanup();
      if (!settled) { settled = true; reject(Error(code)); }
    };
    const abort = () => fail(dispatched ? "outage_print_uncertain" : "outage_print_expired");
    const afterPrint = () => cleanup();
    const loaded = () => {
      if (removed || dispatched) return;
      try {
        budget();
        if (!frame?.isConnected) { fail("outage_print_expired"); return; }
        const content = frame.contentDocument, target = frame.contentWindow;
        const marker = content?.body?.getAttribute("data-attendance-outage-print-document");
        //A preliminary empty iframe document is not the delivered srcdoc.
        if (content?.URL === "about:blank" && marker == null) return;
        if (marker !== input.kind) { fail("outage_print_unavailable"); return; }
        const print = target?.print;
        if (!target || typeof print !== "function") { fail("outage_print_unavailable"); return; }
        //Inspection may synchronously invalidate the controller. Do not attach
        //a new listener to a window whose earlier abort already cleaned up.
        budget();
        if (removed || !frame.isConnected) { fail("outage_print_expired"); return; }
        printWindow = target;
        target.addEventListener("afterprint", afterPrint, { once: true });
        budget();
        if (removed || !frame.isConnected) { fail("outage_print_expired"); return; }
        //Once invoked, a thrown error or lost authorization cannot prove that
        //printing did not start. Preserve that uncertainty instead of retrying.
        dispatched = true;
        print.call(target);
        if (settled) return;
        const remaining = budget();
        settled = true; resolve();
        //Some browsers return before afterprint; others never dispatch it.
        //Keep only this transient document until afterprint, abort or timeout.
        if (!removed) { clearTimeout(timer); timer = setTimeout(cleanup, Math.min(60000, remaining)); }
      } catch (error) {
        fail(dispatched ? "outage_print_uncertain" : error instanceof Error && error.message === "outage_print_expired"
          ? "outage_print_expired" : "outage_print_unavailable");
      }
    };
    try {
      budget();
      if (!["blank", "handoff"].includes(input.kind) || typeof input.html !== "string") { fail("outage_print_unavailable"); return; }
      frame = document.createElement("iframe");
      frame.title = input.kind === "blank" ? "故障备用登记空白表" : "故障恢复交接打印";
      frame.setAttribute("sandbox", "allow-same-origin allow-modals");
      frame.setAttribute("aria-hidden", "true"); frame.tabIndex = -1;
      frame.style.cssText = "position:fixed;left:-12000px;top:0;width:794px;height:1123px;border:0;pointer-events:none;";
      input.signal.addEventListener("abort", abort, { once: true });
      frame.addEventListener("load", loaded);
      frame.srcdoc = input.html;
      const remaining = budget();
      if (removed) return;
      timer = setTimeout(() => fail(dispatched ? "outage_print_uncertain" : "outage_print_expired"), Math.min(30000, remaining));
      document.body.appendChild(frame);
      //An authorization change during attachment must not leave private HTML
      //waiting for a later load before it is removed.
      budget();
      if (input.signal.aborted) abort();
    } catch (error) {
      fail(dispatched ? "outage_print_uncertain" : error instanceof Error && error.message === "outage_print_expired"
        ? "outage_print_expired" : "outage_print_unavailable");
    }
  });
}
