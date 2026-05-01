"use client";

type FaollaPullRefreshIndicatorProps = {
  pullDistance: number;
  readyToRefresh: boolean;
  refreshing: boolean;
};

export default function FaollaPullRefreshIndicator({
  pullDistance,
  readyToRefresh,
  refreshing,
}: FaollaPullRefreshIndicatorProps) {
  const distance = refreshing ? 72 : Math.max(0, Math.min(104, pullDistance));
  if (!refreshing && distance <= 0) return null;

  const iconOffset = Math.max(10, Math.min(58, distance * 0.62));
  const opacity = refreshing ? 1 : Math.min(1, distance / 42);
  const rotation = refreshing ? undefined : `rotate(${readyToRefresh ? 180 : Math.min(180, distance * 2.4)}deg)`;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-[2147483100] flex justify-center"
    >
      <div
        className="mt-2 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white/95 text-slate-700 shadow-[0_12px_30px_rgba(15,23,42,0.18)] backdrop-blur"
        style={{
          opacity,
          transform: `translateY(${iconOffset}px)`,
          transition: refreshing ? "transform 160ms ease-out, opacity 120ms ease-out" : "none",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
          style={{
            transform: rotation,
            transition: refreshing ? undefined : "transform 120ms ease-out",
          }}
        >
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v6h-6" />
        </svg>
      </div>
    </div>
  );
}
