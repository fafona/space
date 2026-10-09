import React from "react";
import {createRoot} from "react-dom/client";
import PinLauncher from "../../src/components/enterprise/MerchantAttendancePinLauncher";
import PinVerify from "../../src/components/enterprise/MerchantAttendancePinVerify";
const apiFetch=(url:string,init?:RequestInit)=>{const headers=new Headers(init?.headers);headers.set("x-attendance-test-actor","owner");return fetch(url,{...init,headers});};
createRoot(document.getElementById("qa-root")!).render(<><header className="qa-toolbar">隔离合成 PIN 验收 · 实际组件／处理器／SQL · 禁止生产访问 · 不产生打卡</header>
  {location.hash==="#device"?<PinVerify/>:<main className="qa-main"><PinLauncher siteId="99990001" apiFetch={apiFetch}/></main>}</>);
