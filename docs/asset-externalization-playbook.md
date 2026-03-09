# Asset Externalization Playbook

## Purpose

This project should not persist large inline `data:image/*` or `data:audio/*` payloads inside page JSON or platform state.
Static/media assets belong in Supabase Storage. Page data should only keep public URLs.

## Operational commands

Audit remote page data for inline assets:

```bash
npm run audit:inline-assets
```

Migrate remote page data from inline media to Storage URLs:

```bash
npm run migrate:inline-images
```

Verify the app after migration:

```bash
npm run lint
npm test
npm run build
```

## Current enforcement

- Admin editor uploads page background, block background, gallery images, and music assets to Storage first.
- Publish is blocked if any inline image/audio payload still remains in `blocks`.
- Super admin merchant card images are uploaded to Storage before config save.

## Recommended release checklist

1. Run `npm run audit:inline-assets`.
2. If any rows are reported, run `npm run migrate:inline-images`.
3. Run `npm run build`.
4. Open `/super-admin/editor` and `/admin` once to verify the editors load without fallback timeout banners.

## Data model direction

The current `pages.blocks` blob is still a coarse storage shape. To keep scaling predictable, the next step is:

1. Keep `blocks` as lightweight structure only.
2. Store media in Storage and reference URLs only.
3. Split publish output from edit-state data.
4. Move from "one large page blob" toward page/section level persistence.
5. Add a published JSON artifact or cache layer for frontend reads.

This lets the site grow in assets and layout complexity without forcing editor startup to download large base64 payloads.
