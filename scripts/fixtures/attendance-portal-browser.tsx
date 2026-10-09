// Actual employee selector -> portal -> workspace -> enterprise manager. API
// and Auth responses are intercepted by the isolated browser test, not production.
import {createRoot} from "react-dom/client";
import EnterpriseSelectorClient from "../../src/app/enterprise/EnterpriseSelectorClient";
import EnterprisePortalClient from "../../src/app/enterprise/[siteId]/EnterprisePortalClient";
import {merchantEnterpriseSupabase} from "../../src/lib/merchantEnterpriseSupabase";
const pathname=window.location.pathname;
createRoot(document.getElementById("qa-root")!).render(<>
  <div className="qa-toolbar" role="note">隔离考勤入口验收 · 真实页面与 SDK · 合成认证及业务数据 · 无生产连接
    <button onClick={()=>void merchantEnterpriseSupabase.auth.refreshSession()}>验收 SDK 刷新会话</button>
  </div>
  {pathname==="/enterprise"?<EnterpriseSelectorClient />:<EnterprisePortalClient siteId="99990001" />}
</>);
