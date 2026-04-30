"use client";

import dynamic from "next/dynamic";

const PwaBootstrap = dynamic(() => import("@/components/PwaBootstrap"), {
  loading: () => null,
  ssr: false,
});

export default function PwaBootstrapLoader() {
  return <PwaBootstrap />;
}
