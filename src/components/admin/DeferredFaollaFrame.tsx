"use client";

import { useState, type ComponentPropsWithRef } from "react";

type DeferredFaollaFrameProps = ComponentPropsWithRef<"iframe"> & { active: boolean };

// Mount on first use, then retain the same frame across menu switches so its
// history/scroll position survive. CSS hiding alone still loads the remote page.
export default function DeferredFaollaFrame({ active, ...frameProps }: DeferredFaollaFrameProps) {
  const [visited, setVisited] = useState(false);
  if (active && !visited) setVisited(true);
  return active || visited ? <iframe {...frameProps} /> : null;
}
