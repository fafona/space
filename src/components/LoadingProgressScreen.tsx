"use client";

type LoadingProgressScreenProps = {
  message?: string;
  locale?: string | null;
  statusTitle?: string;
  statusDescription?: string;
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
    <main className="flex min-h-screen items-center justify-center overflow-hidden bg-[#081121]">
      <picture className="block h-screen w-screen">
        <source media="(max-width: 768px)" srcSet={mobileSrc} />
        <img
          src={desktopSrc}
          alt={alt}
          draggable={false}
          className="h-full w-full select-none object-contain"
        />
      </picture>
    </main>
  );
}
