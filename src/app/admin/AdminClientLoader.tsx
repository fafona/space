"use client";

import dynamic from "next/dynamic";
import type { AdminClientProps } from "./AdminClient";

const AdminClient = dynamic(() => import("./AdminClient"), {
  ssr: false,
  loading: () => null,
});

export default function AdminClientLoader(props: AdminClientProps) {
  return <AdminClient {...props} />;
}
