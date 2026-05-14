import Link from "next/link";
import FaollaNumericEntryShellMemory from "./FaollaNumericEntryShellMemory";

type FaollaNumericEntryShellProps = {
  merchantEntry: string;
  initialFrameHref: string;
  hasExplicitEntryHref: boolean;
};

const FAOLLA_HOME_SOURCE_HREF = "https://faolla.com/";
const FAOLLA_FRAME_ID = "faolla-numeric-entry-frame";

export default function FaollaNumericEntryShell({
  merchantEntry,
  initialFrameHref,
  hasExplicitEntryHref,
}: FaollaNumericEntryShellProps) {
  const encodedMerchantEntry = encodeURIComponent(merchantEntry);
  const faollaHomeHref = `/${encodedMerchantEntry}?section=faolla&faollaUrl=${encodeURIComponent(FAOLLA_HOME_SOURCE_HREF)}`;
  const navItems = [
    { key: "conversations", label: "会话", href: `/${encodedMerchantEntry}` },
    { key: "business", label: "生意", href: `/${encodedMerchantEntry}?section=business` },
    { key: "faolla", label: "Faolla", href: faollaHomeHref },
    { key: "self", label: "自己", href: `/${encodedMerchantEntry}?section=self` },
  ];

  return (
    <main className="fixed inset-0 overflow-hidden bg-white">
      <iframe
        id={FAOLLA_FRAME_ID}
        title="Faolla.com"
        src={initialFrameHref}
        className="absolute inset-0 h-full w-full border-0 bg-white"
      />
      <div className="pointer-events-none absolute left-4 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10">
        <Link
          href={faollaHomeHref}
          aria-label="Faolla 首页"
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/92 text-base font-black text-slate-950 shadow-[0_8px_26px_rgba(15,23,42,0.18)] backdrop-blur"
        >
          F
        </Link>
      </div>
      <nav className="pointer-events-none fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 px-3 pb-[calc(env(safe-area-inset-bottom)+0.45rem)]">
        <div className="pointer-events-auto grid grid-cols-4 gap-1 rounded-[22px] border border-slate-200/80 bg-white/94 p-1.5 shadow-[0_-10px_32px_rgba(15,23,42,0.16)] backdrop-blur">
          {navItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={
                item.key === "faolla"
                  ? "rounded-[16px] bg-slate-950 px-2 py-2 text-center text-xs font-semibold text-white"
                  : "rounded-[16px] px-2 py-2 text-center text-xs font-semibold text-slate-600 hover:bg-slate-100"
              }
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
      <FaollaNumericEntryShellMemory frameId={FAOLLA_FRAME_ID} hasExplicitEntryHref={hasExplicitEntryHref} />
    </main>
  );
}
