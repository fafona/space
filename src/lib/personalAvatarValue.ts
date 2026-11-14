// Guest avatars are local images, not uploaded anonymously. Keep a bounded
// raster data URL intact instead of truncating it as if it were a remote URL.
// The existing generic-image endpoint has a minimum configured limit of 50 KiB.
// Stay below it so an avatar also works for accounts with the smallest quota.
export const PERSONAL_AVATAR_MAX_BYTES = 48 * 1024;
export function boundedPersonalAvatarDataUrl(value: string) {
  return value.length <= 90_000 && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value) ? value : "";
}
