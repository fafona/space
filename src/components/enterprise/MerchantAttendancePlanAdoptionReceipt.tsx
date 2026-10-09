import type { PlanAdoption } from "@/lib/merchantAttendancePlanAdoptionView";

const channels = { self: "普通网页", location: "定位", onsite: "现场扫码", pin: "工号 PIN" } as const;
const states = { adopted: "开班时已保存核准引用", not_approved: "开班时没有可采用的已核准版本", unselected: "开班时明确不关联排班", unverified: "原选择待核验，未采用核准引用" } as const;
const reasons: Readonly<Record<string, string>> = { approval_missing: "当时没有可采用的核准", publication_missing: "当时缺少发布身份依据", cancelled: "当时计划已取消", location_changed: "当时地点与原选择不一致", outside_window: "当时选择超出核验窗口" };

/** Display only the persisted reference returned beside the SAME authorized
 * old check/coverage. No current approval lookup, copied rule source or math. */
export default function MerchantAttendancePlanAdoptionReceipt({ startEventId, adoption }: { startEventId: string; adoption: PlanAdoption | null }) {
  return <section aria-label="开班时固定核准引用" data-plan-adoption-reference={startEventId} data-plan-adoption-status={adoption?.status ?? "missing"}
    className="min-w-0 space-y-2 rounded-xl border border-teal-200 bg-teal-50/30 p-3 text-sm">
    <h5 className="font-semibold">开班时固定核准引用</h5>
    <p>{adoption ? states[adoption.status] : "此原班次没有保存核准采用引用；不等于当时没有核准，不用当前核准补造历史。"}</p>
    {adoption?.reason && <p>{reasons[adoption.reason]}</p>}
    <p className="text-xs leading-6">仅核对保存的引用。原班次／核定时间、阈值提醒与计划覆盖继续使用原核查算法；本次没有新增迟到、早退、缺勤或工资判断。</p>
    <details className="space-y-1 break-all text-xs"><summary className="cursor-pointer font-semibold">核对固定引用与原始编号</summary>
      <p>原开班事件：{startEventId}</p>
      {adoption && <><p>通路：{channels[adoption.channel]} · 原打卡操作：{adoption.operationId}</p>
        <p>当时员工：{adoption.employeeId} · 当时绑定身份：{adoption.employeeAuthUserId}</p>
        <p>采用记录 UTC：{adoption.recordedAt} · 保存政策：{adoption.policy}</p>
        {adoption.approval && <><p>固定核准版本：{adoption.approval.revision} · 核准操作：{adoption.approval.operationId}</p>
          <p>来源编号：{adoption.approval.sourceId}</p><p>SHA-256：{adoption.approval.sourceSha256}</p><p>核准保存 UTC：{adoption.approval.recordedAt}</p></>}
      </>}
    </details>
  </section>;
}
