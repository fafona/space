import type { BusinessCardQrAppearance } from "./merchantBusinessCardQr";

export type BusinessCardQrPreview = {
  key: string;
  scope: string;
  target: string;
  appearance: BusinessCardQrAppearance;
  url: string;
};

// A previous render is only a visual placeholder, never a save/export source.
export function selectBusinessCardQrPreview(
  preview: BusinessCardQrPreview | null,
  key: string,
  target: string,
  scope: string,
  enabled: boolean,
) {
  const display = enabled && preview?.scope === scope && preview.target === target ? preview : null;
  return { display, currentUrl: display?.key === key ? display.url : "" };
}

export async function decodeBusinessCardQrPreview(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  await image.decode();
}
