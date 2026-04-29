"use client";

import dynamic from "next/dynamic";
import type { AdminClientProps } from "./AdminClient";

const AdminClient = dynamic(() => import("./AdminClient"), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-sky-400" />
          </div>
          <div className="mt-4 text-sm font-semibold tracking-wide text-white">Loading admin...</div>
          <div className="mt-2 text-xs leading-5 text-slate-300">Preparing the merchant workspace.</div>
        </div>
      </div>
    </main>
  ),
});

export default function AdminClientLoader(props: AdminClientProps) {
  return <AdminClient {...props} />;
}
