import { Suspense } from "react";
import ConnectClient from "./ConnectClient";

export default function ConnectPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-950">
          <section className="w-full max-w-sm rounded-[28px] bg-white px-6 py-8 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-950 text-xl font-semibold text-white">FA</div>
            <h1 className="mt-5 text-xl font-semibold">Faolla 二维码</h1>
            <p className="mt-3 text-sm leading-6 text-slate-500">正在打开...</p>
          </section>
        </main>
      }
    >
      <ConnectClient />
    </Suspense>
  );
}
