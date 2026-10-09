// Real selector, login SDK, portal, employee workspace and enterprise manager.
// Auth/outer bootstrap are synthetic adapters; attendance reaches real SQL.
import {createRoot} from "react-dom/client";
import Selector from "../../src/app/enterprise/EnterpriseSelectorClient";
import Portal from "../../src/app/enterprise/[siteId]/EnterprisePortalClient";
const match=/^\/enterprise\/(99990001|99990002)$/.exec(location.pathname);
createRoot(document.getElementById("qa-root")!).render(<>
  <div className="qa-toolbar">两企业考勤入口联验 · 合成认证／真实页面与考勤 SQL · 不连接生产</div>
  {match?<Portal siteId={match[1]}/>:<Selector/>}
</>);
