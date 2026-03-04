"use client";

type LoadingProgressScreenProps = {
  message?: string;
};

export default function LoadingProgressScreen(props: LoadingProgressScreenProps) {
  const message = (props.message ?? "").trim() || "正在加载页面...";
  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl rounded-xl border bg-white p-6 shadow-sm">
        <div className="text-sm text-slate-600">{message}</div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-slate-200">
          <div className="h-full w-2/3 rounded bg-slate-800 animate-pulse" />
        </div>
      </div>
    </main>
  );
}

