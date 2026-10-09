// Actual parent/component/client; only transport identity and one-position
// device are synthetic. Every business response is the real handler/SQL.
import { useCallback } from "react";
import { createRoot } from "react-dom/client";
import LocationClockPanel from "../../src/components/enterprise/MerchantAttendanceLocationClockPanel";
import type { AttendanceLocationEnvironment } from "../../src/lib/merchantAttendanceLocationCheckClient";

declare global { interface Window {
  __locationScheduleSeed: { siteId: string; employeeId: string; workerId: string };
  __locationScheduleProbe: { gps: number; csp: string[]; unexpectedStorage: string[] };
} }
const environment: AttendanceLocationEnvironment = {
  isSecureContext: () => true, isVisible: () => !document.hidden,
  geolocation: () => ({ getCurrentPosition: (success: PositionCallback) => {
    window.__locationScheduleProbe.gps++;
    queueMicrotask(() => success({ timestamp: Date.now(), coords: { latitude: 37.3, longitude: -5.9, accuracy: 10 } } as GeolocationPosition));
  } } as Geolocation),
};
function Harness() {
  const seed = window.__locationScheduleSeed;
  const apiFetch = useCallback((url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "omit" }), []);
  return <><header className="qa-toolbar">定位选班隔离验收 · 实际父组件／处理器／SQL · 合成认证与定位设备 · 非生产</header>
    <main className="qa-main"><LocationClockPanel siteId={seed.siteId} employeeId={seed.employeeId} workerId={seed.workerId}
      canClock apiFetch={apiFetch} environment={environment}/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
