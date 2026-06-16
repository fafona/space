# Faolla public cache rules

Goal: reduce origin hits for public, anonymous Faolla entry points without caching admin, auth, order, coupon mutation, or personal data paths.

Cloudflare references:

- Cache Rules: https://developers.cloudflare.com/cache/how-to/cache-rules/
- Cache Rule settings and Edge TTL: https://developers.cloudflare.com/cache/how-to/cache-rules/settings/
- Ruleset fields, including `http.request.uri.path` and `http.host`: https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/
- Cache Everything warning for HTML: https://developers.cloudflare.com/cache/how-to/cache-rules/examples/cache-everything/

Use this order. Earlier rules should win.

## 1. Bypass private and mutating paths

Expression:

```txt
starts_with(http.request.uri.path, "/admin")
or starts_with(http.request.uri.path, "/super-admin")
or starts_with(http.request.uri.path, "/me")
or starts_with(http.request.uri.path, "/login")
or starts_with(http.request.uri.path, "/launch")
or starts_with(http.request.uri.path, "/api/auth")
or starts_with(http.request.uri.path, "/api/merchant")
or starts_with(http.request.uri.path, "/api/orders")
or starts_with(http.request.uri.path, "/api/publish")
or starts_with(http.request.uri.path, "/api/super-admin")
or starts_with(http.request.uri.path, "/api/coupons/claim")
or starts_with(http.request.uri.path, "/api/coupons/redeem")
or starts_with(http.request.uri.path, "/coupon/claim")
or http.cookie contains "merchant-space-merchant-auth"
or http.cookie contains "merchant-space-merchant-refresh"
```

Settings:

- Cache eligibility: Bypass cache

## 2. Cache public site JSON

Expression:

```txt
(http.request.uri.path eq "/api/site-published" and http.request.uri.args["siteId"][0] ne "")
or (http.request.uri.path eq "/api/site-resolve" and http.request.uri.args["prefix"][0] ne "")
or http.request.uri.path eq "/api/platform-published"
```

Settings:

- Cache eligibility: Eligible for cache
- Edge TTL: Use cache-control header if present
- Browser TTL: Respect origin
- Cache key: include full query string

The app currently emits:

- `/api/site-published`: `public, max-age=15, s-maxage=30, stale-while-revalidate=120`
- `/api/site-resolve`: `public, max-age=15, s-maxage=60, stale-while-revalidate=120`

## 3. Cache public business-card HTML

Expression:

```txt
starts_with(http.request.uri.path, "/card/")
and not ends_with(http.request.uri.path, "/contact")
and not ends_with(http.request.uri.path, "/image")
```

Settings:

- Cache eligibility: Eligible for cache
- Edge TTL: Override origin, 15 seconds
- Browser TTL: Respect origin
- Cache key: include full query string

Notes:

- `/card/{key}/contact` returns a generated vCard and stays `no-store`.
- `/card/{key}/image` is a redirect helper and has its own cache header.
- Keep the TTL short because the route still honors revocation and merchant service state at origin.

## 4. Cache public site pages opened from cards

Expression:

```txt
starts_with(http.request.uri.path, "/site/")
and http.request.uri.args["entry"][0] eq "card"
```

Settings:

- Cache eligibility: Eligible for cache
- Edge TTL: Override origin, 15 seconds
- Browser TTL: Respect origin
- Cache key: include full query string

## 5. Cache merchant subdomain root pages briefly

Expression:

```txt
ends_with(http.host, ".faolla.com")
and http.host ne "www.faolla.com"
and http.request.uri.path eq "/"
```

Settings:

- Cache eligibility: Eligible for cache
- Edge TTL: Override origin, 15 seconds
- Browser TTL: Respect origin

## Verification

After rules are active, check:

```powershell
curl.exe -I -L "https://www.faolla.com/card/felix-phzzdt"
curl.exe -I -L "https://www.faolla.com/api/site-published?siteId=10000000"
curl.exe -I -L "https://www.faolla.com/site/10000000?entry=card"
curl.exe -I -L "https://fafona.faolla.com/"
```

Expected headers after the first warmup request:

- `cf-cache-status: HIT` or `cf-cache-status: STALE`
- `server-timing` present from origin responses; it may be absent on Cloudflare HIT responses because the origin is not contacted.

