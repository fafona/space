// Actual owner/self launcher. Auth and transport are explicitly synthetic.
import { useLayoutEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import OutageLauncher from "../../src/components/enterprise/MerchantAttendanceOutageLauncher";
type Config = { access: "owner" | "self"; printEnabled: boolean; other: boolean };
declare global { interface Window {
  __outagePrintSeed: { siteId: string; owner: string; self: string; other: string; workerId: string };
  __outagePrintHarness: { configure(value: Partial<Config>): void; visibility(hidden: boolean): void };
} }
function Harness() {
  const seed = window.__outagePrintSeed;
  const [config, setConfig] = useState<Config>({ access: "owner", printEnabled: true, other: false });
  useLayoutEffect(() => { window.__outagePrintHarness = {
    configure: value => flushSync(() => setConfig(current => ({ ...current, ...value }))),
    visibility: hidden => {
      Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
      Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    },
  }; }, []);
  const actor = config.other ? seed.other : config.access === "owner" ? seed.owner : seed.self;
  const apiFetch = useMemo(() => async (url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "omit",
    headers: { ...init?.headers, "x-outage-print-qa-actor": actor } }), [actor]);
  return <main className="qa-main"><p className="qa-notice">实际故障父工作区；合成身份／API，无数据库或真实登录。仅记录打印调用，不调用实体打印机，不代表出纸。</p>
    <OutageLauncher siteId={seed.siteId} access={config.access} actorId={actor} workerId={config.access === "owner" ? seed.workerId : null}
      apiFetch={apiFetch} enabled={true} printEnabled={config.printEnabled}/></main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
