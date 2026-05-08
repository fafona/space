"use client";

import type { ReactNode } from "react";

type LoadingProgressScreenProps = {
  message?: string;
  locale?: string | null;
  statusTitle?: string;
  statusDescription?: string;
  children?: ReactNode;
};

function isChineseLocale(locale?: string | null) {
  const normalized = (locale ?? "").trim().toLowerCase();
  return normalized === "zh" || normalized.startsWith("zh-");
}

export default function LoadingProgressScreen(props: LoadingProgressScreenProps) {
  const useChineseCopy = isChineseLocale(props.locale);
  const title = props.statusTitle || props.message || (useChineseCopy ? "\u6b63\u5728\u8fdb\u5165 Faolla" : "Opening Faolla");
  const description =
    props.statusDescription || (useChineseCopy ? "\u6b63\u5728\u52a0\u8f7d\uff0c\u8bf7\u7a0d\u5019\u3002" : "Loading. Please wait.");

  return (
    <main className="faolla-loading-progress-screen relative grid min-h-screen place-items-center overflow-hidden bg-[#081121] px-6 text-white">
      <div className="faolla-loading-progress-card relative z-10 flex w-full max-w-sm flex-col items-center text-center">
        <div className="faolla-launch-solar-loader" aria-hidden="true">
          <span>F</span>
        </div>
        <div className="mt-7 text-3xl font-black tracking-normal">Faolla</div>
        <div className="mt-6 text-base font-semibold text-white/90">{title}</div>
        <div className="mt-2 text-sm leading-6 text-white/60">{description}</div>
      </div>

      {props.children ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          <div className="pointer-events-auto w-full max-w-md">{props.children}</div>
        </div>
      ) : null}
    </main>
  );
}
