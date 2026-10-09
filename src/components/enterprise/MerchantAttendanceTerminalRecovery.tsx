"use client";
import {useEffect, useState} from "react";
import {createTerminalRecoveryQr, parseTerminalRecoveryUrl} from "@/lib/merchantAttendanceTerminalRecovery";

/** Static help plus a generic phone handoff. No auth, attendance requests,
 * pending-storage reads, employee data, device secrets, or writes to the ledger. */
export default function MerchantAttendanceTerminalRecovery({url}: {url?: string | null}) {
  const [open, setOpen] = useState(false), [copyMessage, setCopyMessage] = useState("");
  const portalUrl = parseTerminalRecoveryUrl(url);
  return <details className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6" onToggle={e => {
    setOpen(e.currentTarget.open); if (!e.currentTarget.open) setCopyMessage("");
  }}>
    <summary className="cursor-pointer font-semibold">设备失效或打卡结果不确定？核对记录</summary>
    <div className="mt-4 space-y-4" role="region" aria-label="终端打卡核对指引">
      <p className="font-semibold">没收到成功提示、待确认记录丢失或历史暂时为空，都不等于打卡失败。不要换编号或换设备重复提交同一动作。</p>
      <section className="space-y-2"><h2 className="font-semibold">原设备仍有效、原标签页还在</h2>
        <p>保留原标签页和会话存储，重新输入本人工号和 PIN，先核对原操作。不要先清理浏览器、重新配对或改用他人工号。</p>
      </section>
      <section className="space-y-2"><h2 className="font-semibold">终端过期／被撤销，或原标签页与记录已丢失</h2>
        <p>请用自己的手机或电脑登录企业工作台，选择对应企业，再进入「我的考勤」→「查看本人历史打卡」。查询操作当天及必要的前后日期，选择门店时区，核对地点、动作、原始时间和记录编号。</p>
        <p>跨日班次要包含上班日；需要看新记录时重新查询首页。历史查询不是按待确认操作编号查收据；没看到记录时，请让负责人继续核实，不能据此立即重打。</p>
        <p className="font-semibold">公共终端不要登录员工或负责人账号。下面只提供本人设备上的登录入口，不会打卡、不自动登录，也不携带员工资料或终端凭证。</p>
        {portalUrl ? <div className="rounded-xl border border-amber-200 bg-white p-4">
          {open && <PhoneQr key={portalUrl} url={portalUrl}/>}
          <p className="mt-2 break-all font-mono text-xs" aria-label="企业工作台地址">{portalUrl}</p>
          <button type="button" className="mt-3 rounded-xl border border-slate-300 px-3 py-2" onClick={async () => {
            try { await navigator.clipboard.writeText(portalUrl); setCopyMessage("已复制登录地址。请在本人设备打开；这里不会登录或打卡。"); }
            catch { setCopyMessage("无法自动复制，请在本人设备手动输入上方地址。"); }
          }}>复制企业工作台地址</button>
          {copyMessage && <p aria-live="polite" className="mt-2 text-xs">{copyMessage}</p>}
        </div> : <p>当前未提供可用的安全登录地址。请向企业负责人确认本人设备上的企业工作台入口，不要发送密码或 PIN。</p>}
      </section>
      <section className="space-y-2"><h2 className="font-semibold">无法登录、没有查看权限，或仍不能确认</h2>
        <p>联系企业负责人，提供工号、门店、操作日期、约略时间和动作；不要提供 PIN、账号密码或配对码。负责人在自己的设备登录，在企业管理的「考勤明细」中核对。员工权限停用时，不通过终端绕过停权。</p>
        <p>确有缺漏时按现有补正／漏卡申请与审批流程处理，不修改原始打卡。终端重新启用由负责人处理；重新配对不会恢复旧标签页的待确认操作，也不会重传历史打卡。</p>
      </section>
    </div>
  </details>;
}
function PhoneQr({url}: {url: string}) {
  const [state, setState] = useState<{image: string | null; failed: boolean}>({image: null, failed: false});
  useEffect(() => { let active = true;
    void createTerminalRecoveryQr(url).then(image => { if (active) setState({image, failed: false}); }, () => { if (active) setState({image: null, failed: true}); });
    return () => { active = false; };
  }, [url]);
  return <div className="space-y-2"><p className="font-semibold">用本人手机扫码打开登录页（不是打卡码）</p>
    {/* Fixed, local data URL; no optimizer, external image request or analytics. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {state.image ? <img src={state.image} width={240} height={240} alt="企业工作台登录入口二维码，不是打卡码" className="h-auto max-w-full rounded-lg"/>
      : <p className="text-xs">{state.failed ? "二维码暂时无法显示，可手动输入下方地址。" : "正在本地生成登录入口二维码…"}</p>}
  </div>;
}
