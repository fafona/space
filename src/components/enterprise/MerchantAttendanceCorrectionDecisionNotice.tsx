import type {CorrectionDecisionRecord} from "@/lib/merchantAttendanceCorrectionDecisionRecord";
export default function MerchantAttendanceCorrectionDecisionNotice({decision:d}:{decision:CorrectionDecisionRecord|null|undefined}){
  if(!d)return null;
  return <section aria-label="补正审批决定" className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
    <h4 className="font-bold">{d.action==="approve"?"已批准 · 独立核定修订":"已驳回 · 原申请保留"}</h4>
    <p className="break-words">决定说明：{d.reason}</p><p className="break-all text-xs">决定 UTC：{d.recordedAt}<br/>决定编号：{d.operationId}</p>
    <p>{d.action==="approve"?"核定声明独立保存，原始打卡及网页／终端来源不变。此处展示本次决定；当前有效核定和再次修订请通过已开放的对应入口查看，不代表工资结算。":"本申请不能再撤回或编辑。如需重新申报，请重新读取原班次与当前规则；是否仍可提交取决于新申请时的期限、权限和锁定状态。"}</p>
  </section>;
}
