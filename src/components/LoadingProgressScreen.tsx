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
  return (locale ?? "").trim().toLowerCase().startsWith("zh");
}

export default function LoadingProgressScreen(props: LoadingProgressScreenProps) {
  const isChinese = isChineseLocale(props.locale);
  const desktopSrc = isChinese ? "/loading-progress-desktop-zh.webp" : "/loading-progress-desktop-en.webp";
  const mobileSrc = isChinese ? "/loading-progress-mobile-zh.webp" : "/loading-progress-mobile-en.webp";
  const alt = isChinese
    ? "FAOLLA 商户后台欢迎海报"
    : "FAOLLA merchant workspace welcome poster";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#081121]">
      <picture className="block h-screen w-screen">
        <source media="(max-width: 768px)" srcSet={mobileSrc} />
        <img
          src={desktopSrc}
          alt={alt}
          draggable={false}
          className="h-full w-full select-none object-cover"
        />
      </picture>
      {props.children ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          <div className="pointer-events-auto w-full max-w-md">{props.children}</div>
        </div>
      ) : null}
    </main>
  );
}
