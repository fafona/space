# Contact-card website navigation correction

## Root cause

The website-address change reached the editor, stored share contact payload and
legacy `/share/business-card` page, but the QR short route `/card/[card]` renders
its own HTML. Its website action always used `buildFastMerchantSiteUrl` (or the
assigned merchant target), ignoring `contact.websiteUrl`. Thus a valid custom
website still opened the old merchant site. This is not a DNS failure.

Both short-page snapshot reconstruction and short-route vCard snapshot fallback
also rebuilt `contact.websiteUrl` from `targetUrl`, dropping `websiteAddress`.

Live candidate validation additionally reproduced a late legacy manifest overriding
the saved custom website: the actual card snapshot contained the custom URL but
the manifest still held the assigned Faolla URL. Short-card and vCard rendering
now prefer the current owner's explicit saved website (including a blank reset).
The HTML cache key includes that effective website, so manifest revalidation cannot
reuse a page with a different button target. This correction does not rewrite the
saved card or its share manifest.

## Scope

- Pass the contact website into the actual short-card HTML renderer. Use it for
  both the anchor and the WeChat click target.
- Keep the fast merchant route for legacy/default addresses, comparing normalized
  URLs so a trailing slash does not change the default behavior.
- Preserve custom paths, query strings and fragments, including on the assigned
  host. Reject invalid explicit navigation targets.
- Read `websiteAddress` in both snapshot fallbacks.
- Do not change merchant identity, service checks, QR short keys, media links,
  card visibility, cache policy or any saved production data.
- The editor's contact-card surface remains a non-navigating visual preview;
  its website button already displays the draft destination in its title.

## Verification

`merchantBusinessCardWebsiteRoute.test.ts` executes the actual route rendering
and snapshot functions in an isolated VM, with real normalizers and without
database, storage writes or remote requests. It covers custom/default websites,
browser/WeChat attributes, unsafe URLs, hidden actions, independent image links,
snapshot fallback, merchant identity and exported vCard URL. Combined with
destination, sharing and storage tests: 61 passed.

Deployment is not performed as part of this local correction.
