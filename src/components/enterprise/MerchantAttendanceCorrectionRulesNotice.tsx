import { CORRECTION_RULE_LABELS, type CorrectionRules } from "@/lib/merchantAttendanceCorrectionRules";
export default function MerchantAttendanceCorrectionRulesNotice({rules}:{rules:CorrectionRules|undefined}) {
  if(!rules)return <p className="rounded-xl bg-amber-50 p-3 text-sm">尚未读取申请规则，请重新读取；不能据此提交新申请。</p>;
  const p=rules.policy;
  const deadline=p&&rules.deadlineAt?new Intl.DateTimeFormat("zh-CN",{timeZone:p.timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",timeZoneName:"shortOffset"}).format(new Date(rules.deadlineAt)):null;
  return <section aria-label="申请规则核对" className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
    <h4 className="font-bold">{rules.binding==="preparation"?"本次申请规则":"提交时规则与当前周期核对"}</h4>
    {p&&<><p>规则版本 {p.revision} · 原始上班日后 {p.submissionWindowDays} 个自然日（0 为当日）· {p.timeZone}</p>
      {deadline&&<p>须在 {deadline} 之前提交，不包含该时刻。<span className="block break-all text-xs">精确截止 UTC：{rules.deadlineAt}</span></p>}</>}
    {rules.issues.length>0&&<ul className="list-disc space-y-1 pl-5 text-amber-950">{rules.issues.map(i=><li key={i}>{CORRECTION_RULE_LABELS[i]}</li>)}</ul>}
    <p className="text-xs text-slate-600">{rules.binding==="preparation"?"这里先核对原班次；提交时还会核对填写的完整声明。规则更新需重新确认，不自动换版本。":"旧申请期限按原提交时刻核对，后来修改期限不会追溯改变；锁定状态按本次读取重新检查。"} 以上不是批准凭证，不改变原始打卡或实际工时。</p>
  </section>;
}
