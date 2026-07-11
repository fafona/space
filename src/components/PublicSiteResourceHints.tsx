import type { Block } from "@/data/homeBlocks";
import { collectPublicSiteImageResourceHints } from "@/lib/publicSiteResourceHints";

export default function PublicSiteResourceHints({
  blocks,
  preferredOrigin,
}: {
  blocks?: Block[] | null;
  preferredOrigin?: string;
}) {
  const hints = collectPublicSiteImageResourceHints(blocks, { preferredOrigin });
  if (hints.imageUrls.length === 0 && hints.preconnectOrigins.length === 0) return null;

  return (
    <>
      {hints.preconnectOrigins.map((origin) => (
        <link key={`preconnect:${origin}`} rel="preconnect" href={origin} crossOrigin="anonymous" />
      ))}
      {hints.imageUrls.map((imageUrl) => (
        <link key={`preload:${imageUrl}`} rel="preload" as="image" href={imageUrl} />
      ))}
    </>
  );
}
