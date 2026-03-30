"use client";

import { forwardRef, type InputHTMLAttributes, type MouseEvent, useState } from "react";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  wrapperClassName?: string;
  showLabel?: string;
  hideLabel?: string;
};

function joinClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

function EyeOpenIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeClosedIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="m3 3 18 18" />
      <path d="M10.6 10.7a3 3 0 0 0 4 4" />
      <path d="M9.9 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-3.2 3.9" />
      <path d="M6.2 6.3A18.2 18.2 0 0 0 2 12s3.6 7 10 7a10.4 10.4 0 0 0 5.2-1.3" />
    </svg>
  );
}

export function getPasswordToggleLabels(locale: string) {
  const normalizedLocale = String(locale ?? "").trim().toLowerCase();
  if (normalizedLocale.startsWith("zh-tw")) {
    return { show: "顯示密碼", hide: "隱藏密碼" };
  }
  if (normalizedLocale.startsWith("ja")) {
    return { show: "パスワードを表示", hide: "パスワードを隠す" };
  }
  if (normalizedLocale.startsWith("ko")) {
    return { show: "비밀번호 표시", hide: "비밀번호 숨기기" };
  }
  if (normalizedLocale.startsWith("zh")) {
    return { show: "显示密码", hide: "隐藏密码" };
  }
  return { show: "Show password", hide: "Hide password" };
}

const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { className, wrapperClassName, showLabel = "Show password", hideLabel = "Hide password", ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? hideLabel : showLabel;

  function handleMouseDown(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  return (
    <div className={joinClassNames("relative", wrapperClassName)}>
      <input {...props} ref={ref} type={visible ? "text" : "password"} className={joinClassNames(className, "pr-11")} />
      <button
        type="button"
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-pressed={visible}
        onMouseDown={handleMouseDown}
        onClick={() => setVisible((current) => !current)}
        disabled={props.disabled}
        className="absolute inset-y-0 right-2 flex items-center justify-center text-slate-400 transition hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {visible ? <EyeClosedIcon /> : <EyeOpenIcon />}
      </button>
    </div>
  );
});

export default PasswordField;
