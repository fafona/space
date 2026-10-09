// Inert 194 entry. Root alone runs the isolated loopback browser callback.
// The Manager receives the real owned-fixture employee token through its public
// accessToken prop; its verified Auth still comes from the actual overview API.
import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Manager, { type MerchantEnterpriseView } from "../../src/components/admin/MerchantEnterpriseManager";
import EnterpriseSelectorClient from "../../src/app/enterprise/EnterpriseSelectorClient";
import RecoveryRoute from "../../src/app/enterprise/attendance-recovery/page";

declare global { interface Window { __accountStatusRecoverySeed: { site: string; auth: string; token: string; mode: string } } }
function EmployeeManager() {
  const seed = window.__accountStatusRecoverySeed;
  const [view, setView] = useState<MerchantEnterpriseView>("employees");
  const register = useCallback(() => {}, []);
  const navigation = useMemo(() => ({ mode: "external" as const, activeView: view, onViewChange: setView, registerViewChangeGuard: register }), [view, register]);
  return <main className="qa-manager"><Manager siteId={seed.site} siteName="合成隔离企业" accessToken={seed.token} standalone
    navigation={navigation} collaborationRefreshIntervalMs={3600000} accountSuspensionEnabled/></main>;
}
const pathname = window.location.pathname;
if (!["/qa-manager", "/enterprise", "/enterprise/attendance-recovery"].includes(pathname)) throw Error("unexpected_account_status_recovery_fixture_path");
createRoot(document.getElementById("qa-root")!).render(<>
  <aside className="qa-disclaimer">隔离验收：真实员工管理、企业选择与原号恢复页面；SDK 登录和企业列表初始化为合成，状态写入及原号读取走真实处理链。Next Link 使用原生同标签页链接。</aside>
  {pathname === "/qa-manager" ? <EmployeeManager/> : pathname === "/enterprise" ? <EnterpriseSelectorClient/> : <RecoveryRoute/>}
</>);
