// Component-only synthetic wire fixtures, parsed by the existing Sources parser.
// No authentication, API, database or full Admin lifecycle claim is made here.
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ScheduleEvidence from "../../src/components/enterprise/MerchantAttendanceScheduleEvidence";
import { parseScheduleEvidenceWire, scheduleEvidenceWire, scheduleEvidenceRow, scheduleEvidenceSlot,
  scheduleEvidenceMissing, scheduleEvidenceCorrection, scheduleEvidenceLeave, scheduleEvidenceCalendar, scheduleEvidenceId } from "./attendance-schedule-evidence-model";

export function scheduleEvidenceBrowserModel(mode: string) {
  const wire = scheduleEvidenceWire();
  if (mode === "rich") {
    wire.attendance.base.items[0].effect = scheduleEvidenceCorrection(wire.attendance.base.items[0], {
      startAt: "2026-09-02T09:00:00.000000Z", endAt: "2026-09-02T17:00:00.000000Z", breaks: [],
    });
    wire.attendance.base.items.push(scheduleEvidenceRow(2, "2026-09-03T18:00:00.000000Z", null));
    wire.attendance.missing = [scheduleEvidenceMissing(1, "2026-09-03T08:00:00.000000Z", "2026-09-03T12:00:00.000000Z")];
    wire.schedule.items = [scheduleEvidenceSlot(1, "2026-09-02T08:00:00.000Z", "2026-09-02T12:00:00.000Z", { locationName: "<img src=x onerror=alert(1)>" }),
      scheduleEvidenceSlot(2, "2026-09-02T09:00:00.000Z", "2026-09-02T10:00:00.000Z", { cancelled: true, cancelReason: "Synthetic cancellation" }),
      scheduleEvidenceSlot(3, "2026-09-02T12:00:00.000Z", "2026-09-02T18:00:00.000Z"),
      scheduleEvidenceSlot(4, "2026-09-03T08:00:00.000Z", "2026-09-03T12:00:00.000Z"),
      scheduleEvidenceSlot(5, "2026-09-03T18:00:00.000Z", "2026-09-03T20:00:00.000Z")];
    const partial = scheduleEvidenceLeave(1); partial.summary.startAt = "2026-09-02T09:00:00.000Z"; partial.summary.endAt = "2026-09-02T11:00:00.000Z";
    const changed = scheduleEvidenceLeave(2, "approved", { employeeId: scheduleEvidenceId(88) });
    wire.leave.items = [changed, partial];
    wire.calendar.items = [scheduleEvidenceCalendar(1, { title: "<img src=x onerror=alert(2)> 提示" })];
  } else if (mode === "pages") {
    wire.attendance.base.items = Array.from({ length: 11 }, (_, index) => {
      const hour = String(index).padStart(2, "0"); return scheduleEvidenceRow(index + 1, `2026-09-02T${hour}:00:00.000000Z`, `2026-09-02T${hour}:30:00.000000Z`);
    });
    wire.schedule.items = wire.attendance.base.items.map((row, index) => scheduleEvidenceSlot(index + 1, row.events[0].occurredAt.slice(0, 23) + "Z", row.events[1].occurredAt.slice(0, 23) + "Z"));
  } else if (mode === "many") {
    wire.attendance.base.items = [scheduleEvidenceRow(1, "2026-09-02T00:00:00.000000Z", "2026-09-02T12:00:00.000000Z")];
    wire.schedule.items = Array.from({ length: 12 }, (_, index) => scheduleEvidenceSlot(index + 1,
      `2026-09-02T${String(index).padStart(2, "0")}:00:00.000Z`, `2026-09-02T${String(index + 1).padStart(2, "0")}:00:00.000Z`));
  } else if (mode === "limited") {
    wire.schedule = { limited: true, items: [] }; wire.leave = { limited: true, items: [] }; wire.calendar = { limited: true, items: [] };
  }
  const result = parseScheduleEvidenceWire(wire);
  if (mode === "invalid") result.schedule.items[0].endAt = "not-an-instant";
  return result;
}

function Harness() {
  const [mode, setMode] = useState("rich"), [mounted, setMounted] = useState(true);
  const source = useMemo(() => scheduleEvidenceBrowserModel(mode), [mode]);
  return <main className="mx-auto min-w-0 max-w-6xl space-y-4 p-3">
    <header className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm">
      <p>仅合成组件验收：真实 Sources 解析器；没有 API、数据库或正式业务结论。</p>
      <label>验收场景<select aria-label="验收场景" className="ml-2 max-w-full rounded border p-2" value={mode} onChange={event => setMode(event.target.value)}>
        <option value="rich">原始、核定和注记</option><option value="pages">本地分页</option><option value="many">多候选分页</option>
        <option value="limited">来源不足</option><option value="invalid">子组件失效隔离</option>
      </select></label>
      <button type="button" className="ml-2 rounded border bg-white p-2" onClick={() => setMounted(value => !value)}>{mounted ? "移除当前结果" : "重新展示结果"}</button>
    </header>
    <p data-testid="other-evidence">已有原始资料展示不受子组件失败影响。</p>
    {mounted && <ScheduleEvidence key={mode} source={source}/>}
  </main>;
}

if (typeof document !== "undefined") createRoot(document.getElementById("root")!).render(<Harness/>);
