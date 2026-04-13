"use client";

import Image from "next/image";
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
  const useChinesePoster = isChineseLocale(props.locale);
  const desktopSrc = useChinesePoster
    ? "/loading-progress-desktop-zh.webp"
    : "/loading-progress-desktop-en.webp";
  const mobileSrc = useChinesePoster
    ? "/loading-progress-mobile-zh.webp"
    : "/loading-progress-mobile-en.webp";
  const posterAlt = useChinesePoster ? "FAOLLA 欢迎页" : "FAOLLA welcome screen";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#081121]">
      <div className="absolute inset-0 lg:hidden">
        <Image
          src={mobileSrc}
          alt={posterAlt}
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
      </div>
      <div className="absolute inset-0 hidden lg:block">
        <Image
          src={desktopSrc}
          alt={posterAlt}
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
      </div>

      {props.children ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          <div className="pointer-events-auto w-full max-w-md">{props.children}</div>
        </div>
      ) : null}
    </main>
  );
}
