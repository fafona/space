# Google account confirmation: isolated code-only release

Approved 2026-10-23. Live baseline `518d32cdf8088b285ed174833ac2ed7fe8e38282`.
The reviewed pre-existing tool-only main is `5447e076c66eeda5ef61833f2d2e7ac511041eb2`.

The application change is only the Google OAuth query: always request
`prompt=select_account`, including installed/PWA windows, and omit `login_hint`.
Existing callback, entry type, PKCE, state retry, session recovery, authorization,
password login and WeChat restriction are unchanged. Credentials are entered on
Google's page, never collected by Faolla. Google controls password/passkey/2FA;
this change requests confirmation, not a password challenge on every login.

The dedicated lane pins the complete login page and manifest bytes, requires the
actual-handler/real-SDK tests, binds every changed file, and pins the inherited
tool-only files to reviewed main. No SQL, lockfile, workflow, API, employee,
booking-email or other unfinished application changes are admitted.

All required CI must pass for the exact merged current-main SHA before staging.
Stage requires at least 6 GiB available RAM and 20 GiB disk. The unchanged build
sandbox enforces 4 GiB memory, 3072 MiB Node heap, one CPU, 128 tasks, no swap,
private network and 20 minutes. There is no automatic budget increase or service
stop. Full inherited environment/feature settings, owned baseline process,
dependency tree and lockfile, source cleanliness, build evidence, maintenance
state and all proxy before/after hashes are checked before activation.

Candidate and public smoke retain contact/vCard/WeChat guidance, attendance
authorization, hidden harnesses, super-admin denial, session-denial and assets.
They create no users, sessions, bookings or records. Activation is graceful and
failure restores only owned proxy bytes. This lane denies every database action.
Retention only converges the active/rollback window; no process retirement,
artifact deletion, pilot/Studio stop or legacy-worker change is authorized here.
