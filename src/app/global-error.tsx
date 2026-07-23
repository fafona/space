"use client";

import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ reset }: GlobalErrorProps) {
  useEffect(() => {
    document.documentElement.setAttribute("data-faolla-global-error", "true");
    return () => {
      document.documentElement.removeAttribute("data-faolla-global-error");
    };
  }, []);

  const reload = () => {
    window.location.reload();
  };

  return (
    <html lang="zh-CN" data-faolla-global-error="true">
      <body
        data-faolla-global-error="true"
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#081121",
          color: "#f8fafc",
          fontFamily: 'system-ui, "Segoe UI", sans-serif',
        }}
      >
        <main
          style={{
            width: "min(420px, calc(100vw - 32px))",
            padding: "32px",
            border: "1px solid rgba(148, 163, 184, 0.3)",
            borderRadius: "8px",
            background: "#111c2f",
            boxSizing: "border-box",
            boxShadow: "0 24px 70px rgba(0, 0, 0, 0.34)",
          }}
        >
          <div style={{ color: "#93c5fd", fontSize: "13px", fontWeight: 700 }}>FAOLLA</div>
          <h1 style={{ margin: "12px 0 0", fontSize: "24px", lineHeight: 1.3 }}>正在自动恢复页面</h1>
          <p style={{ margin: "12px 0 0", color: "#cbd5e1", fontSize: "14px", lineHeight: 1.75 }}>
            页面更新过程中出现了临时异常，系统会自动重新加载。
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "24px" }}>
            <button
              type="button"
              onClick={reload}
              style={{
                minHeight: "44px",
                border: 0,
                borderRadius: "6px",
                background: "#f8fafc",
                color: "#081121",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              立即重载
            </button>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: "44px",
                border: "1px solid rgba(148, 163, 184, 0.45)",
                borderRadius: "6px",
                background: "transparent",
                color: "#f8fafc",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              重试页面
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
