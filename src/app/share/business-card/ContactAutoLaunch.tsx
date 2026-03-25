"use client";

import { useEffect } from "react";

type ContactAutoLaunchProps = {
  contactUrl: string;
};

const AUTO_LAUNCH_SESSION_PREFIX = "merchant-space:auto-contact-launch:";

function looksLikeMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile|micromessenger|wechat/i.test(navigator.userAgent);
}

export default function ContactAutoLaunch({ contactUrl }: ContactAutoLaunchProps) {
  useEffect(() => {
    if (typeof window === "undefined" || !contactUrl || !looksLikeMobileBrowser()) {
      return;
    }

    const sessionKey = `${AUTO_LAUNCH_SESSION_PREFIX}${contactUrl}`;
    try {
      if (window.sessionStorage.getItem(sessionKey) === "1") {
        return;
      }
      window.sessionStorage.setItem(sessionKey, "1");
    } catch {
      // Ignore session storage failures and continue with a one-time attempt.
    }

    const timer = window.setTimeout(() => {
      window.location.assign(contactUrl);
    }, 320);

    return () => window.clearTimeout(timer);
  }, [contactUrl]);

  return null;
}
