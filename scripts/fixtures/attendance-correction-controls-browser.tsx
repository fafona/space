import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Panel from "../../src/components/enterprise/MerchantAttendanceCorrectionControlsPanel";
import { createCorrectionControlsFixture, controlOwner, controlSite } from "./attendance-correction-controls-model";
const model=createCorrectionControlsFixture();
function App(){const [key,setKey]=useState(0),[open,setOpen]=useState(true);return <><div className="qa-toolbar">隔离合成规则与锁定配置 · 禁止生产连接 · 不产生真实审批
  <div className="qa-controls"><select onChange={e=>model.mode(e.target.value)}>{["normal","lost","unsent","denied","offline"].map(m=><option key={m}>{m}</option>)}</select>
    <button onClick={()=>{setKey(k=>k+1);setOpen(true);}}>重新挂载</button><button onClick={()=>model.enabled(false)}>暂停新写入</button><button onClick={()=>model.enabled(true)}>恢复合成写入</button></div></div>
  <main className="qa-main">{open&&<Panel key={key} siteId={controlSite} ownerId={controlOwner} apiFetch={model.apiFetch} onClose={()=>setOpen(false)}/>}</main></>;}
createRoot(document.getElementById("qa-root")!).render(<App/>);
