"use client";

type LoadingProgressScreenProps = {
  message?: string;
};

export default function LoadingProgressScreen(props: LoadingProgressScreenProps) {
  const message = (props.message ?? "").trim() || "正在加载页面...";
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#081121_0%,#101b33_58%,#eaf1ff_100%)] p-6 text-white">
      <div className="mx-auto max-w-4xl rounded-[28px] border border-white/12 bg-white/8 p-6 shadow-[0_24px_60px_rgba(8,17,33,0.22)] backdrop-blur">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-50/90">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300" />
          Faolla.com
        </div>
        <div className="mt-4 text-sm text-slate-200">{message}</div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-white/10">
          <div className="h-full w-2/3 animate-pulse rounded bg-cyan-300" />
        </div>
      </div>
    </main>
  );
}

