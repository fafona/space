"use client";

import { useEffect } from "react";

type ShareBusinessCardRedirectProps = {
  targetUrl: string;
};

export default function ShareBusinessCardRedirect({ targetUrl }: ShareBusinessCardRedirectProps) {
  useEffect(() => {
    if (!targetUrl) return;
    window.location.replace(targetUrl);
  }, [targetUrl]);

  return null;
}
