// Actual Manager and its real AttendanceAdmin child. Auth transport is supplied
// by the owned native fixture; no external application session is used.
import { useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Manager, { type MerchantEnterpriseView } from "../../src/components/admin/MerchantEnterpriseManager";
declare global { interface Window { __accountSuspensionSeed: { site: string; owner: string } } }
function Harness() {
  const seed = window.__accountSuspensionSeed, [view, setView] = useState<MerchantEnterpriseView>("employees"), [enabled, setEnabled] = useState(false);
  const guard = useRef<((view: MerchantEnterpriseView | null) => boolean) | null>(null);
  const register = useCallback((value: ((view: MerchantEnterpriseView | null) => boolean) | null) => { guard.current = value; }, []);
  const navigation = useMemo(() => ({ mode: "external" as const, activeView: view, onViewChange: setView, registerViewChangeGuard: register }), [view, register]);
  const change = (next: MerchantEnterpriseView) => { if (!guard.current || guard.current(next)) setView(next); };
  return <><header className="qa-toolbar"><p>本地合成认证；真实员工管理父页、负责人考勤配置与真实处理器／SQL。不会连接生产。</p>
    <div className="qa-controls"><button data-testid="employees" onClick={() => change("employees")}>员工账号页</button><button data-testid="attendance-admin" onClick={() => change("attendanceAdmin")}>考勤配置页</button>
      <button data-testid="feature-on" onClick={() => setEnabled(true)}>启用新状态流</button><button data-testid="feature-off" onClick={() => setEnabled(false)}>关闭新状态流</button></div></header>
    <main data-qa-view={view} data-qa-enabled={String(enabled)} className="qa-main"><Manager siteId={seed.site} siteName="合成隔离企业" standalone navigation={navigation}
      collaborationRefreshIntervalMs={3600000} accountSuspensionEnabled={enabled}/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
