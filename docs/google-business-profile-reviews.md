# Google Business Profile Reviews

The Google reviews block can use the official Google Business Profile APIs. The editor keeps the latest successful review snapshot in the published block, so a temporary Google outage does not blank the public page.

## Google Cloud setup

1. Use a Google Cloud project that has been approved for Google Business Profile API access.
2. Enable My Business Account Management API, My Business Business Information API, and Google My Business API.
3. Configure the OAuth consent screen.
4. Create a Web application OAuth client.
5. Add the exact production redirect URI:

   `https://www.faolla.com/api/google-business-profile/callback`

6. Make sure the Google account granting access manages a verified Business Profile location. Google only exposes reviews for verified locations.

Official references:

- https://developers.google.com/my-business/content/basic-setup
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list
- https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list
- https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list

## Server environment

Configure these values in every production instance:

```dotenv
GOOGLE_BUSINESS_PROFILE_CLIENT_ID=...
GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET=...
GOOGLE_BUSINESS_PROFILE_TOKEN_KEY=...
GOOGLE_BUSINESS_PROFILE_REDIRECT_URI=https://www.faolla.com/api/google-business-profile/callback
GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS=900000
```

`GOOGLE_BUSINESS_PROFILE_TOKEN_KEY` must be a long random secret and must remain stable across deployments. Changing it makes stored Google tokens unreadable and requires merchants to reconnect. The service-role key is accepted as a compatibility fallback, but a dedicated token key is strongly recommended.

Do not put the client secret or token key in a `NEXT_PUBLIC_` variable.

The production GitHub Actions workflow reads the same five names from repository Actions secrets. Add them under **Settings > Secrets and variables > Actions** before deploying. The redirect URI and sync interval may also be stored as Actions secrets so the existing deploy command can pass them without hard-coding production values.

## Editor workflow

1. Add or select a Google reviews block.
2. Select **Connect Google Business Profile**.
3. Grant access with the Google account that manages the location.
4. Select the review source location.
5. Select **Sync now**, then publish the website.

The first successful sync writes reviews, aggregate rating, total count, Maps URL, write-review URL, location identity, and sync time into the block. Manual reviews remain available as a fallback.

## Runtime behavior

- Access and refresh tokens are encrypted with AES-256-GCM and are only read server-side.
- OAuth state is signed, expires after ten minutes, and is tied to the eight-digit merchant ID.
- Admin routes require the matching merchant session; mutations also require a trusted same-origin request.
- Public pages only receive the review snapshot and public location links. Tokens, account details, and integration errors are never returned.
- Public refreshes are limited by `GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS` (minimum five minutes). A failed refresh serves the last successful snapshot when one exists.
- Disconnecting revokes the Google grant when possible and deletes the encrypted server integration. The already published snapshot remains visible until the editor removes or replaces it.

## Troubleshooting

- **Not configured:** verify all server environment variables and restart/redeploy the application.
- **Access denied (403):** verify project approval, enabled APIs, OAuth scope, and that the granting account manages the location.
- **No locations:** verify the profile is verified and the granting account has access to it.
- **Authorization expired:** disconnect and reconnect in the editor.
- **Redirect mismatch:** the Google OAuth client redirect URI must exactly match `GOOGLE_BUSINESS_PROFILE_REDIRECT_URI`, including scheme, host, and path.
