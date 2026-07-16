"use client";

import dynamic from "next/dynamic";
import { useI18n } from "@/components/I18nProvider";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import type { AdminClientProps } from "./AdminClient";

function AdminClientLoading() {
  const { locale } = useI18n();
  return <LoadingProgressScreen locale={locale} />;
}

const AdminClient = dynamic(() => import("./AdminClient"), {
  ssr: false,
  loading: () => <AdminClientLoading />,
});

export default function AdminClientLoader(props: AdminClientProps) {
  return <AdminClient {...props} />;
}
