// Actual export/print controls with typed synthetic report sources only.
// HTTP responses are supplied by the loopback browser runner, never production.
import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import TimesheetExport from "../../src/components/enterprise/MerchantAttendanceTimesheetExport";
import UnifiedExport from "../../src/components/enterprise/MerchantAttendanceUnifiedExport";
import { timesheetExportCommand, timesheetExportWire } from "./attendance-timesheet-export-model";
import { unifiedExportWire } from "./attendance-unified-export-model";
import { timesheetId as id } from "./attendance-timesheet-model";
import { parseTimesheetExportSource } from "../../src/lib/merchantAttendanceTimesheetExport";
import { parseUnifiedExportSource } from "../../src/lib/merchantAttendanceUnifiedExport";
import { ATTENDANCE_REPORT_SOURCE_VERSION } from "../../src/lib/merchantAttendanceTimesheet";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";

type Access = "owner" | "self" | "manager";

function Harness() {
  const [kind, setKind] = useState<"timesheet" | "unified">("timesheet");
  const [access, setAccess] = useState<Access>("owner"), [identity, setIdentity] = useState(0);
  const [mounted, setMounted] = useState(true), [denials, setDenials] = useState(0), [stale, setStale] = useState(0);
  const reports = useMemo(() => {
    const command = timesheetExportCommand(access), wire = timesheetExportWire(command);
    wire.report.sourceVersion = ATTENDANCE_REPORT_SOURCE_VERSION;
    return {
      timesheet: parseTimesheetExportSource(wire, command, ATTENDANCE_REPORT_SOURCE_VERSION).report!,
      unified: parseUnifiedExportSource(unifiedExportWire(command), command).report!,
    };
  }, [access]);
  const apiFetch = useCallback<AttendanceApiFetch>((url, init) => fetch(url, init), []);
  const onDenied = useCallback(() => { setDenials(value => value + 1); setMounted(false); }, []);
  const onStale = useCallback(() => { setStale(value => value + 1); setMounted(false); }, []);
  const actorId = id((access === "owner" ? 1 : access === "self" ? 2 : 90) + identity);
  const visibility = (value: "hidden" | "visible") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value });
    Object.defineProperty(document, "hidden", { configurable: true, value: value === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  return <>
    <header className="qa-toolbar">
      <h1>隔离打印验收 · 实际导出控件 · 合成来源与 HTTP · 不调用实体打印机</h1>
      <div className="qa-controls">
        <label>验收报表类型<select aria-label="验收报表类型" value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
          <option value="timesheet">普通工时</option><option value="unified">含整段申报</option>
        </select></label>
        <label>验收访问视角<select aria-label="验收访问视角" value={access} onChange={event => setAccess(event.target.value as Access)}>
          <option>owner</option><option>self</option><option>manager</option>
        </select></label>
        <button type="button" onClick={() => setIdentity(value => value + 1)}>切换验收身份</button>
        <button type="button" onClick={() => visibility("hidden")}>隐藏验收文档</button>
        <button type="button" onClick={() => visibility("visible")}>显示验收文档</button>
        <button type="button" onClick={() => setMounted(false)}>卸载验收导出</button>
        <button type="button" onClick={() => setMounted(true)}>重挂验收导出</button>
      </div>
      <output aria-label="验收父级清理">{JSON.stringify({ denials, stale })}</output>
    </header>
    <main className="qa-main">
      {mounted ? kind === "timesheet"
        ? <TimesheetExport report={reports.timesheet} actorId={actorId} apiFetch={apiFetch} onDenied={onDenied} enabled={true} printEnabled={true}/>
        : <UnifiedExport report={reports.unified} actorId={actorId} apiFetch={apiFetch} onDenied={onDenied} onStale={onStale} enabled={true} printEnabled={true}/>
        : <p role="status">已清除工时资料</p>}
    </main>
  </>;
}

createRoot(document.getElementById("qa-root")!).render(<Harness/>);
