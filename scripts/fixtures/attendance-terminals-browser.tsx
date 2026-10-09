import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import AdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import Device from "../../src/components/enterprise/MerchantAttendanceTerminalDevice";
const apiFetch=(url:string,init?:RequestInit)=>{const headers=new Headers(init?.headers);headers.set("x-attendance-test-actor","owner");return fetch(url,{...init,headers});};
function App(){
  const [device,setDevice]=useState(false);
  return <><header className="qa-toolbar">隔离合成终端验收 · 实际 UI／HTTP 处理器／SQL · 合成负责人身份，不是生产登录
    <div className="qa-controls"><button onClick={()=>setDevice(false)}>合成负责人界面</button><button onClick={()=>setDevice(true)}>门店设备界面</button></div>
    </header>{device?<Device/>:<main className="qa-main"><AdminPanel siteId="99990001" ownerId="00000000-0000-4000-8000-000000000099" apiFetch={apiFetch}/></main>}</>;
}
createRoot(document.getElementById("qa-root")!).render(<App/>);
