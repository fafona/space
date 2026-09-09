"use client";

import React from "react";

export type PlatformAdminBackupRestoreReceiptPanelProps = {
  operationId: string;
  backupId: string;
  scope: "user_manage" | "support_messages";
  status: "pending" | "committed" | "unknown" | "rejected";
  committedAt?: string;
  application: "unconfirmed" | "applied";
  querying: boolean;
  retained?: boolean;
  queryError?: string;
  onQuery: () => void;
};

const serverStatus = {
  pending: { label: "等待服务器响应", className: "border-sky-200 bg-sky-50 text-sky-950",
    notice: "本次请求正在等待结果，请勿重复发起恢复。" },
  committed: { label: "已确认历史提交", className: "border-emerald-200 bg-emerald-50 text-emerald-950",
    notice: "凭据仅确认这次历史提交，不代表当前服务器数据仍与当时一致，也不代表页面已完成应用。" },
  unknown: { label: "提交结果未知", className: "border-amber-200 bg-amber-50 text-amber-950",
    notice: "未知不等于未执行。服务器可能已提交，请先只读查询并核对，不要重复恢复。" },
  rejected: { label: "提交前已拒绝", className: "border-slate-200 bg-slate-50 text-slate-800",
    notice: "该请求在提交前已被拒绝，未开始本次恢复；其他不明写入仍需单独核对。" },
} as const;

/** Presentation only. It never stores an operation, changes a protection guard
 * or starts a restore; the caller owns authenticated, generation-bound lookup.
 */
export default function PlatformAdminBackupRestoreReceiptPanel({ operationId, backupId, scope, status,
  committedAt, application, querying, retained = false, queryError, onQuery }: PlatformAdminBackupRestoreReceiptPanelProps) {
  const server = serverStatus[status];
  const queryDisabled = querying || status === "pending" || status === "rejected";
  const showTime = status === "committed" && typeof committedAt === "string" && Number.isFinite(Date.parse(committedAt));
  return (
    <section aria-label="恢复提交凭据" aria-busy={querying}
      className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-950">恢复提交凭据</h3>
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
          {scope === "user_manage" ? "用户管理范围" : "客服消息范围"}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2" aria-live="polite">
        <div className={`rounded-lg border p-3 ${server.className}`}>
          <h4 className="text-xs font-semibold">服务器提交凭据</h4>
          <p className="mt-1 font-semibold">{server.label}</p>
          <p className="mt-2 text-xs leading-relaxed">{server.notice}</p>
          {showTime ? <p className="mt-2 text-xs">历史提交时间：<time dateTime={committedAt}>{committedAt}</time></p> : null}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h4 className="text-xs font-semibold">页面应用状态</h4>
          <p className="mt-1 font-semibold">{application === "applied" ? "页面已确认应用" : "页面应用尚未确认"}</p>
          <p className="mt-2 text-xs leading-relaxed">{application === "applied"
            ? "这是页面应用流程单独确认的结果，不由提交凭据查询推定。"
            : "即使服务器已提交，页面重读、浏览器缓存或其他同步仍可能未完成；不会根据凭据自动补写。"}</p>
        </div>
      </div>
      <dl className="space-y-1 text-xs">
        <div><dt className="inline text-slate-500">操作编号：</dt>{" "}<dd className="inline">
          <code className="select-all break-all rounded bg-slate-100 px-1 py-0.5">{operationId}</code>
        </dd></div>
        <div><dt className="inline text-slate-500">快照编号：</dt>{" "}<dd className="inline break-all">{backupId}</dd></div>
      </dl>
      <p className="text-xs leading-relaxed text-slate-600">
        {retained
          ? "本浏览器已保留待核对操作信息。刷新或重新打开同一站点后，需原登录身份核验才会显示；只支持查询，不会自动重发恢复或解除保护。清除浏览器数据或换设备无法接续。"
          : "此操作当前没有待核对的浏览器接续记录。请按需保存操作编号；刷新后不会从已清理记录推定服务器结果。"}
      </p>
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
        <button type="button" onClick={onQuery} disabled={queryDisabled}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
          {querying ? "正在只读查询…" : "只读查询提交结果"}
        </button>
        <p className="text-xs text-slate-600">查询不会重新恢复，也不会解除本页或其他未知写入的保护。</p>
      </div>
      {queryError ? <p role="alert" className="text-xs text-rose-700">
        查询未获得可靠结果，现有保护保持不变。请核对登录状态后再进行只读查询。
      </p> : null}
    </section>
  );
}
