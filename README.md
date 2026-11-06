# Arionys CDN

A Next.js application with verified email/password accounts, separate workspace memberships, per-workspace Cloudflare R2 storage, encrypted credentials, logical folders, API keys, and personal profile settings.

## Run locally

Use Node.js 22+ (24 recommended).

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and set MongoDB URI, APP_URL, mail API token, and independent authentication/encryption secrets. Existing `.env` values also load. Never commit secrets.
3. Generate AUTH_SECRET with `openssl rand -base64 48`. Generate R2_ENCRYPTION_KEY with `openssl rand -hex 32`. For an existing database, restore the original R2_ENCRYPTION_KEY from a secure backup so stored workspace credentials remain readable.
4. Start `npm run dev` and open the exact origin configured in APP_URL. If port 3000 is occupied, choose a port and change APP_URL to match before starting.
5. Create an account at `/signup`, verify the email code, name a workspace, and connect that workspace’s private R2 bucket. Everyone can sign up. Accounts are independent of workspace roles.

The email provider is the supplied `https://mailapi.arionys.com/api/send` service. Set its bearer token in MAIL_API_TOKEN. Because the original token was pasted into chat, rotate it before production use.

## User journeys and route protection

`/` redirects to `/login` for visitors and `/dashboard` for signed-in accounts. `/login` and `/signup` have their own pages. Every `/dashboard`, `/files`, `/api-keys`, `/team`, `/activity`, `/settings`, and `/docs` page checks the actual server-side session and active membership before rendering. Signed-in users without a ready workspace go to `/onboarding`. Team page additionally requires workspace owner/admin access. Database errors fail closed.

Onboarding supports creating multiple workspaces. Each has its own R2 credentials, memberships, files, folders, API keys, and audit events. The workspace picker switches the active workspace in the current session, then reloads the interface to clear the previous workspace’s client state. Tabs sharing a session share its workspace selection. API keys stay bound to their original workspace.

An invitation opens `/invite?token=...`. The recipient logs in or signs up using the invited email, completes email verification, and explicitly accepts. Joining uses the invited workspace’s existing storage. The recipient needs no personal R2 bucket. Existing memberships and accounts in other workspaces are preserved when a membership is removed.

Profile settings edit the display name and change the password using current-password verification plus a fresh, single-use email code. Completing a password change revokes all sessions and pending challenges. Workspace infrastructure credentials are never shown on the settings page.

## R2 setup per workspace

Use the Cloudflare account ID, bucket name, and S3-compatible access/secret pair. Scope the token to Object Read & Write on the intended bucket. During onboarding, the app checks bucket access and writes, reads, copies, and deletes tiny verification objects under `arionys-verification/`.

Keep the bucket private: disable public r2.dev access and public custom domains. The app cannot determine all public-domain configuration from an S3 token; onboarding requires the owner to confirm this. Publication is controlled by file visibility through `/api/v1/content/:id`.

Configure R2 CORS with the exact application origin (and any approved additional deployment origins):

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add an R2 lifecycle rule to expire objects under `staging/` after one day. Abandoned upload reservations expire from MongoDB after 30 minutes (failed attempts after 5 minutes); staged bytes are cleaned by that R2 lifecycle rule. Completed objects have immutable IDs. Folder names and hierarchy live in MongoDB, so file moves and folder renames keep existing delivery URLs working. Root and child folders, breadcrumbs, folder creation/rename, nonempty-delete protection, and file movement are supported. API uploads can provide folderId or a folderPath such as `products/summer/photos`.

See [Cloudflare CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/) and [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

## Security and data model

- `users`: verified account, display name, password hash, password version. Workspace roles are not global user privileges.
- `memberships`: unique `(workspaceId, userId)` record with owner/admin/editor/viewer role and revocation state.
- `workspaces`: owner, name, onboarding state, versioned encrypted R2 credentials.
- `sessions`: hashed opaque token, user, active workspace, password version, expiry.
- `challenges`: keyed OTP hashes, purpose, expiry, attempts, and atomic consumption state. Login challenges cannot authorize password changes or vice versa.
- `folders`, `files`, `uploads`, `apiKeys`, `events`: every workspace resource is partitioned by workspaceId. API keys also restrict file access to the issuing key.
- `invitations`: workspace, intended email, role, inviter, hashed token, expiry, and acceptance state.
- `rateLimits`: shared atomic counters with expiry indexes.

R2 credentials use AES-256-GCM with fresh 96-bit IVs and the workspace ID as authenticated additional data. Credentials are encrypted together; ciphertext copied to another workspace fails authentication. The 256-bit encryption key lives only in the server environment. MongoDB backups alone cannot decrypt credentials. Running server processes with this key can decrypt them to sign R2 requests; this is server-side encryption at rest, not end-to-end encryption. Protect server access and back up the key separately. Losing it makes existing encrypted credentials unrecoverable. Changing it requires an explicit decrypt/re-encrypt migration, not simply replacing the environment variable.

Passwords use bcrypt. OTPs expire after 10 minutes and lock after 5 attempts. Sessions expire after 12 hours, are checked against the database, and use HttpOnly/SameSite cookies (Secure + __Host prefix in production). Membership and role are checked on every API request. Mutations with session cookies require the configured Origin. Keys have scopes, expiry, upload size limits, total request limits, per-minute throttling, and immediate revocation.

Public file URLs intentionally grant public read access. Private file delivery requires active membership in the correct workspace. Bucket credentials never appear in profile/workspace/list responses or audit logs. Never expose API keys in external applications’ browser code.

## Validation

- `npm run typecheck`
- `npm run test` — isolated temporary MongoDB; email and S3 are mocked. Does not use production data or send real emails.
- `npm run build`

The regression suite covers OTP requirements, replay/expiry/attempt limits, concurrent request limits, encryption tampering/workspace binding, workspace isolation, onboarding, shared invitations, folder isolation, upload verification, scoped API keys, profile editing, and password session revocation. These checks do not replace live email/R2 end-to-end testing or an independent production security review.

[API contract](docs/API.md) describes account, workspace, folder, file, team, and API-key requests.

## Deploy and operate

Deploy the Node.js application with HTTPS and the same MongoDB/auth/mail/encryption environment settings on all application instances. APP_URL must be the real public origin. Keep the encryption key persistent across releases. Each workspace supplies its storage through onboarding; global R2 environment values are ignored.

Use a private MongoDB deployment with least-privilege application credentials, TLS, controlled network access, and backups. Configure front-door request/body/connection limits. Use signed download URLs for large private downloads; check your host’s streaming/response limits before routing large public assets through the content gateway. Consider dedicated delivery infrastructure for high-volume public traffic.

Legacy records from the original single-workspace prototype without workspaceId are deliberately excluded from workspace queries. They are not deleted or silently assigned to another tenant. If existing production records need importing, perform an explicit owner-approved migration into a verified workspace with matching bucket credentials; never enable a global fallback that mixes tenant data.

## Upload relay and updating storage

The browser uses the authenticated same-origin upload relay for small files and can retry through it when direct R2 uploads fail. File bodies stream to R2 without being buffered into a full in-memory file. The relay checks issuer, workspace, declared length/type, actual bytes and reservation state. It does not bypass file verification or publication controls. Vercel defaults to a 4 MiB relay cap due to platform request limits; other Node hosts use MAX_UPLOAD_BYTES. Set MAX_PROXY_UPLOAD_BYTES when your host needs a lower cap. Direct uploads still require the bucket's CORS policy.

Workspace owners have a separate `/workspace/storage` page for changing R2 account, bucket and access keys. Changes require the current account password, a verified storage connection and an email OTP. Previous credentials remain encrypted in `storageConnections`, uniquely identified by workspaceId/version. Each file and upload reservation pins its original version. Switching to another bucket preserves old files through the old connection; it does not migrate them. Keep the old bucket and credentials available. Rotating keys on the same bucket automatically uses the new keys for existing files.

API keys can use a Never expiration (`expiresInDays:null`). Request quotas, scopes, workspace permissions and revocation still apply. The slim purple top bar tracks navigation, concurrent API calls and uploads. Sensitive forms use POST even before hydration; login/signup redirects strip accidental password query parameters.

## Keeping temporary uploads small

Browser retries keep a stable requestId rather than creating another reservation. Completed uploads delete their temporary record immediately, while permanent file metadata remains in files. Known failures cancel their reservation and delete staged bytes. If cleanup is interrupted, expiry bounds temporary record retention; MongoDB TTL cleanup is asynchronous. Configure R2 staging lifecycle expiry for abandoned bytes as described above. API clients should use a stable UUID requestId for retries and DELETE /api/v1/uploads/:id when abandoning a transfer.

## One-call upload

Use `POST /api/v1/upload` with a scoped Bearer key and multipart `file`. Optional `visibility=public` exposes the returned URL; default is private. Success returns exactly `{url,name,size}`. Use a UUID `requestId` for safe retries. Dashboard uploads and the working `/docs` progress demo use this endpoint. See [API contract](docs/API.md) for limits, progress integration, and compatibility endpoints.
