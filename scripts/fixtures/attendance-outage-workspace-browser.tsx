// Actual 217 launcher/workspaces. Only the API and Auth identities are synthetic.
import { useLayoutEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import OutageLauncher from "../../src/components/enterprise/MerchantAttendanceOutageLauncher";
declare global { interface Window { __outageWorkspaceSeed: { siteId: string; owner: string; self: string; other: string; workerId: string };
  __outageWorkspaceHarness: { configure: (value: { access: "owner" | "self"; enabled: boolean; other?: boolean }) => void } } }
function Harness() {
  const seed = window.__outageWorkspaceSeed;
  const [config, setConfig] = useState({ access: "owner" as "owner" | "self", enabled: false, other: false });
  useLayoutEffect(() => { window.__outageWorkspaceHarness = { configure: value => flushSync(() => setConfig({ ...value, other: value.other ?? false })) }; }, []);
  const actorId = config.other ? seed.other : config.access === "owner" ? seed.owner : seed.self;
  const apiFetch = useMemo(() => async (url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "omit",
    headers: { ...init?.headers, "x-outage-qa-actor": actorId } }), [actorId]);
  return <main className="qa-main"><p className="qa-notice">隔离合成 API 验收：真实组件，非真实登录，未调用数据库，不是生产或完整 E2E。</p>
    <OutageLauncher siteId={seed.siteId} access={config.access} actorId={actorId} apiFetch={apiFetch} enabled={config.enabled}
      workerId={config.access === "owner" ? seed.workerId : null}/></main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
