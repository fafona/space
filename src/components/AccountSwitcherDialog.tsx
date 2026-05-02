import type { AccountSwitchEntry } from "@/lib/accountSwitching";

type AccountSwitcherDialogProps = {
  open: boolean;
  entries: AccountSwitchEntry[];
  currentKey: string;
  busyKey: string;
  error: string;
  onClose: () => void;
  onSwitch: (entry: AccountSwitchEntry) => void;
  onRemove: (key: string) => void;
  onAddAccount: () => void;
};

function getAccountTypeLabel(entry: AccountSwitchEntry) {
  return entry.accountType === "personal" ? "个人用户" : "商家用户";
}

function getAvatarLabel(entry: AccountSwitchEntry) {
  const source = entry.displayName || entry.email || entry.accountId || entry.merchantId || "账";
  return Array.from(source)[0] ?? "账";
}

export default function AccountSwitcherDialog({
  open,
  entries,
  currentKey,
  busyKey,
  error,
  onClose,
  onSwitch,
  onRemove,
  onAddAccount,
}: AccountSwitcherDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2147483600] flex items-end justify-center bg-slate-950/45 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-8 backdrop-blur-sm md:items-center md:pb-8"
      role="dialog"
      aria-modal="true"
      data-mobile-swipe-back-ignore
    >
      <div className="w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-base font-semibold text-slate-950">切换账号</div>
            <div className="mt-1 text-xs text-slate-500">选择已保存的账号可直接登录。</div>
          </div>
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            aria-label="关闭"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="max-h-[58vh] overflow-y-auto px-4 py-4">
          {entries.length ? (
            <div className="space-y-2">
              {entries.map((entry) => {
                const current = entry.key === currentKey;
                const busy = busyKey === entry.key;
                return (
                  <div key={entry.key} className="flex items-center gap-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
                      {getAvatarLabel(entry)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-950">{entry.displayName || entry.email || entry.accountId}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {getAccountTypeLabel(entry)} · {entry.accountType === "merchant" ? entry.merchantId || entry.accountId : entry.accountId}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        current
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-950 text-white hover:bg-slate-800 disabled:bg-slate-300"
                      }`}
                      onClick={() => onSwitch(entry)}
                      disabled={current || Boolean(busyKey)}
                    >
                      {current ? "当前" : busy ? "登录中" : "登录"}
                    </button>
                    <button
                      type="button"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-rose-600"
                      onClick={() => onRemove(entry.key)}
                      disabled={Boolean(busyKey)}
                      aria-label="移除账号"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                        <path d="M6 7h12M10 11v5M14 11v5M9 7l.5-2h5l.5 2M8 7l.5 12h7L16 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              还没有保存的账号。点“添加账号”登录一次后会出现在这里。
            </div>
          )}
          {error ? <div className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div> : null}
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={onClose}
            disabled={Boolean(busyKey)}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-300"
            onClick={onAddAccount}
            disabled={Boolean(busyKey)}
          >
            添加账号
          </button>
        </div>
      </div>
    </div>
  );
}
