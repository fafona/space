// Actual enterprise manager and its external navigation contract. This does NOT
// render AdminClient or the merchant login page. A synthetic owner cookie is
// installed by the browser check; real request identity parsing remains in use.
import {createRoot} from "react-dom/client";
import {useRef,useState} from "react";
import MerchantEnterpriseManager,{type MerchantEnterpriseView} from "../../src/components/admin/MerchantEnterpriseManager";
function Fixture(){
  const [view,setView]=useState<MerchantEnterpriseView>("attendanceAdmin"),[views,setViews]=useState<readonly MerchantEnterpriseView[]>([]);
  const [todoCount,setTodoCount]=useState(0),[rerenders,setRerenders]=useState(0);
  const leaveGuard=useRef<(() => boolean)|null>(null),viewGuard=useRef<((view:MerchantEnterpriseView|null) => boolean)|null>(null);
  const [guards,setGuards]=useState("");
  return <><header className="qa-toolbar">隔离负责人企业入口 · 合成已登录会话 · 不代表完整商户登录验收</header>
    <button onClick={()=>setRerenders(value=>value+1)}>重绘外层 {rerenders}</button><output aria-label="外层待办数">{todoCount}</output>
    <button onClick={()=>setGuards(`${Boolean(leaveGuard.current)} / ${Boolean(viewGuard.current)}`)}>读取导航防护</button><output aria-label="外层导航防护">{guards}</output>
    <nav aria-label="验收外层企业导航" className="qa-controls">{([{key:"attendanceAdmin",label:"进入考勤配置"},{key:"attendance",label:"进入员工本人考勤"},{key:"roles",label:"进入角色管理"},{key:"tasks",label:"进入任务管理"}] as const).filter(item=>views.includes(item.key)).map(item=><button key={item.key} onClick={()=>setView(item.key)}>{item.label}</button>)}</nav>
    <main className="qa-main"><MerchantEnterpriseManager siteId="99990001" siteName="合成企业" standalone onTodoCountChange={setTodoCount} registerLeaveGuard={guard=>{leaveGuard.current=guard;}} navigation={{mode:"external",activeView:view,onViewChange:setView,onAvailableViewsChange:setViews,registerViewChangeGuard:guard=>{viewGuard.current=guard;}}}/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Fixture/>);
