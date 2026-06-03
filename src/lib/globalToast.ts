export const GLOBAL_TOAST_EVENT = "faolla:global-toast";
export const GLOBAL_TOAST_DURATION_MS = 3000;

export type GlobalToastTone = "default" | "success" | "error";

export type GlobalToastPayload = {
  message: string;
  tone?: GlobalToastTone;
};

export function showGlobalToast(message: string, options: { tone?: GlobalToastTone } = {}) {
  const text = String(message ?? "").trim();
  if (!text || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<GlobalToastPayload>(GLOBAL_TOAST_EVENT, {
      detail: {
        message: text,
        tone: options.tone ?? "default",
      },
    }),
  );
}
