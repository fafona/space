"use client";

import { useEffect, useRef } from "react";
import type { PlatformAdminBackupRestorePreview } from "@/lib/platformAdminBackupRestorePreview";
import { PLATFORM_ADMIN_DATA_BACKUP_SCOPE } from "@/lib/platformAdminDataBackupScope";

export type PlatformAdminBackupRestoreDialogProps = {
  preview: PlatformAdminBackupRestorePreview;
  confirmEmpty: boolean;
  submitting: boolean;
  onConfirmEmptyChange: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function PlatformAdminBackupRestoreDialog({ preview, confirmEmpty, submitting,
  onConfirmEmptyChange, onConfirm, onCancel }: PlatformAdminBackupRestoreDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    cancelRef.current?.focus();
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, [preview.backupId, preview.scope]);
  return (
    <div className="fixed inset-0 z-[2147483500] flex items-center justify-center bg-black/50 p-3">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="backup-restore-preview-title"
        aria-describedby="backup-restore-preview-warning" aria-busy={submitting}
        className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-white p-5 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !submitting) { event.preventDefault(); onCancel(); }
          if (event.key !== "Tab") return;
          const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
          ) ?? []);
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}>
        <h2 id="backup-restore-preview-title" className="text-lg font-semibold">恢复预览：{PLATFORM_ADMIN_DATA_BACKUP_SCOPE.restoreScopes[preview.scope].label}</h2>
        <p className="mt-1 break-all text-xs text-slate-500">快照时间 {preview.backupAt} · 编号 {preview.backupId}</p>
        <p id="backup-restore-preview-warning" className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{preview.warning}</p>
        <div className="mt-4 overflow-x-auto rounded border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">当前已读取内容与快照内容数量对比，不是最终写入结果</caption>
            <thead className="bg-slate-50"><tr><th className="p-2">内容</th><th className="p-2">当前已读数量</th><th className="p-2">快照内容数量</th></tr></thead>
            <tbody>{preview.counts.map((item) => <tr key={item.key} className="border-t">
              <th scope="row" className="p-2 font-medium">{item.label}</th>
              <td className="p-2">{item.current === null ? <span className="text-slate-500">未核对（浏览器）</span> : item.current}</td>
              <td className={`p-2 font-semibold ${preview.emptyKeys.includes(item.key) ? "text-rose-700" : "text-slate-900"}`}>{item.target}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-slate-600"><p className="font-semibold">不包含 / 不能恢复（不是数据库灾备）</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">{preview.excluded.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        {preview.requiresEmptyConfirmation ? <div className="mt-4 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
          <p className="font-semibold">空内容需要单独确认</p>
          <p className="mt-1">{preview.counts.filter((item) => preview.emptyKeys.includes(item.key)).map((item) => item.label).join("、")}</p>
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" checked={confirmEmpty} disabled={submitting} className="mt-1"
              onChange={(event) => onConfirmEmptyChange(event.target.checked)} />
            <span>我已核对以上空内容，确认按该快照继续恢复；已有内容可能被清空或按既有规则合并。</span>
          </label>
        </div> : null}
        <p className="mt-3 text-xs text-slate-500">{preview.receiptProtocol === 1
          ? "确认只对本次身份与预览有效。服务器所选范围将与提交凭据一起保存；浏览器应用另行核对。结果未知时仅可只读查询，不会自动重试恢复。"
          : "确认只对本次预览有效；内容变化必须重新预览。恢复分步执行，不保证原子性，也不会自动重试。"}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancelRef} type="button" disabled={submitting} onClick={onCancel}
            className="rounded border px-4 py-2 text-sm disabled:opacity-50">取消，不恢复</button>
          <button type="button" onClick={onConfirm} disabled={submitting || (preview.requiresEmptyConfirmation && !confirmEmpty)}
            className="rounded bg-rose-700 px-4 py-2 text-sm text-white disabled:opacity-50">
            {submitting ? "正在执行一次恢复…" : "确认按预览恢复"}
          </button>
        </div>
      </div>
    </div>
  );
}
