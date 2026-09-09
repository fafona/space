"use client";

import React from "react";
import type { PlatformAdminBackupRestoreInspectionResult } from "@/lib/platformAdminBackupRestoreInspectionClient";

export type PlatformAdminBackupRestoreInspectionPanelProps = {
  result: PlatformAdminBackupRestoreInspectionResult | null;
  inspecting: boolean;
  disabled?: boolean;
  error?: boolean;
  onInspect: () => void;
};

/** Read-only presentation: never clear a record, apply data or offer an unlock. */
export default function PlatformAdminBackupRestoreInspectionPanel({ result, inspecting, disabled = false, error = false,
  onInspect }: PlatformAdminBackupRestoreInspectionPanelProps) {
  const observed = result?.outcome === "committed" ? result.inspection : null;
  const matches = observed?.targetState === "matches_commit";
  return <section aria-label="当前恢复范围核对" aria-busy={inspecting}
    className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold text-slate-950">当前恢复范围核对</h3>
      <button type="button" onClick={onInspect} disabled={disabled || inspecting}
        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
        {inspecting ? "正在只读核对…" : "只读核对当前数据"}
      </button>
    </div>
    <div role="status" className={`rounded-lg border p-3 ${observed ? matches
      ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"
      : "border-slate-200 bg-slate-50"}`}>
      <p className="font-semibold">{observed ? matches ? "本次核对时与提交结果一致" : "本次核对时与提交结果不同"
        : result ? "未查到匹配的提交凭据，当前数据未核对" : "尚未进行当前数据核对"}</p>
      {observed ? <>
        <p className="mt-2 text-xs">观察时间：<time dateTime={observed.observedAt}>{observed.observedAt}</time></p>
        <p className="mt-2 text-xs">{matches
          ? "仅表示所选范围的完整存储行在本次观察时一致，不代表页面已正确应用，也不保证之后未再变化。"
          : "不同可能来自后续正常修改，不能直接认定恢复失败。请核对变更记录；系统不会自动覆盖或回滚。"}</p>
      </> : <p className="mt-2 text-xs">{result
        ? "缺少凭据不等于未执行；不会据此重发恢复或解除保护。"
        : "此操作只读取提交凭据及当前选定范围，不修改业务数据。"}</p>}
    </div>
    <p className="text-xs leading-relaxed text-slate-600">
      核对包含该范围的存储内容、历史和行版本，不涵盖备份目录、浏览器状态、其他业务模块或迟到写入。
      结果只代表本次观察；无论一致、不同或未知，都不会清除操作记录、自动恢复数据或解除现有保护。
    </p>
    {error ? <p role="alert" className="text-xs text-rose-700">本次核对未获得可靠结果，或身份/操作记录已变化。现有保护保持，请先核对登录状态。</p> : null}
  </section>;
}
