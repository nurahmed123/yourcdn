# Arionys CDN API v2 — workspace isolation

Responses: `{data: ...}` or `{error: string}`, except the single-call upload endpoint, which returns a flat `{url,name,size}` object. JSON request limit: 16 KB. Account endpoints require verified HttpOnly session cookies; mutations require the exact configured APP_URL Origin. External application requests use Bearer API keys. API keys are bound to one workspace and never authorize account, team, workspace, or profile operations.

## Single-call upload (recommended)

`POST /api/v1/upload` accepts `multipart/form-data` with exactly one `file` part. Requires a Bearer key with `files:upload`, or a verified workspace session with the configured Origin. The server streams the file to the workspace's R2 connection, verifies it, and saves permanent metadata. No reservation or completion calls and no temporary MongoDB upload document are needed.

```sh
curl -X POST "$ARIONYS_URL/api/v1/upload" \
  -H "Authorization: Bearer $ARIONYS_API_KEY" \
  -F "file=@photo.jpg" \
  -F "visibility=public"
```

Success: **201**, exactly these fields (size in bytes):

```json
{
  "url": "https://cdn.example.com/api/v1/content/FILE_ID",
  "name": "photo.jpg",
  "size": 12345
}
```

Optional multipart fields: `visibility` (private default, or public), `folderPath` or `folderId` (mutually exclusive), `requestId` (UUID). Alternatively send `Idempotency-Key: UUID`; if both IDs are provided they must match. Retrying the same file and options with the same ID returns the original response with **200**. Different content/options with that ID returns **409**. IDs are scoped to workspace, user and API key. All upload attempts count against request limits. Legacy multi-step endpoints remain compatible.

File size is counted from streamed bytes and capped by API key and server limits. Default Node cap: 100 MiB. Vercel: 4 MiB file cap (allowing multipart overhead under its request body limit). Configure `MAX_PROXY_UPLOAD_BYTES` within your hosting limit. Empty files, extra files, unknown/duplicate fields, malformed bodies, and invalid destination folders are rejected. Stream buffers are bounded; failed R2 multipart transfers are aborted and staging objects removed on handled errors. Configure an R2 lifecycle rule to remove old `staging/` objects and incomplete multipart uploads after one day to cover process crashes or storage outages.

Use `XMLHttpRequest.upload.onprogress` for real client transfer percentage, then show **Processing** until the final JSON response arrives. Transfer progress measures bytes sent from the client, not final R2 verification. `/docs` includes animated progress, a real authenticated upload demo, browser code, and a streaming server forwarding example. Keep Bearer credentials on your own authenticated backend, not in browser JavaScript. Browser code calls that backend once; it forwards one multipart stream to Arionys.

Errors use `{ "error": "..." }` with 400 invalid input, 401 unauthenticated, 403 insufficient permissions, 404 unknown destination, 409 conflicting retry ID, 413 size limit, 415 unsupported content type, 429 quota, and 502/503 storage/service failure. Failed requests never create permanent file metadata or pending upload records.

## Account routes

- `POST /api/auth/signup` — name, email, password; open registration, sends OTP. Creates neither user nor session yet.
- `POST /api/auth/login` — email, password; sends OTP.
- `POST /api/auth/verify` — challengeId, code; consumes OTP once, creates session, returns `next` (/onboarding or /dashboard).
- `POST /api/auth/logout` — revokes this session.
- `GET /api/me` — profile, memberships, activeWorkspace; no storage credentials.
- `PATCH /api/profile` — name; updates the current account, independent of workspace roles.
- `POST /api/profile/password` — currentPassword, newPassword; sends a separate OTP challenge.
- `POST /api/profile/password/verify` — challengeId, code; changes password, increments password version, revokes all account sessions and pending challenges.

## Workspaces and invitations

- `GET /api/workspaces` — only workspaces where current user has active membership.
- `POST /api/workspaces` — name; creates pending workspace and owner membership, selects it in this session.
- `POST /api/workspaces/:id/storage` — `{credentials:{accountId, bucket, accessKeyId, secretAccessKey},privateBucketConfirmed:true}`. Pending workspace owner only. Checks read, write, copy and delete permissions before saving AES-256-GCM encrypted credentials and activating the workspace. Does not use global R2 environment variables.
- `POST /api/workspaces/:id/switch` — selects an existing membership for this session. API keys remain bound to their original workspace.
- `GET /api/auth/invite?token=...` — invitation target email and workspace name.
- `POST /api/invitations/accept` — token; requires verified session with the invited email. Adds membership without creating another workspace or R2 connection.
- `GET /api/team` — workspace membership list and pending invitations; admin/owner only.
- `POST /api/team` — email, role (viewer/editor/admin); sends workspace invitation. Only owners may invite administrators.
- `DELETE /api/team/:userId` — removes this workspace membership and revokes keys for this workspace; other memberships and the user account are preserved. Cannot remove the owner or self.

## Files and folders

Workspace session members share workspace files according to role. API keys additionally see only the files created by that key. Folder hierarchy belongs to the workspace and is shared by all workspace integrations.

- `GET /api/v1/folders?parentId=UUID` — immediate child folders and full breadcrumb chain; omit parentId for root. Requires files:read.
- `POST /api/v1/folders` — name, parentId (nullable); requires files:upload. Creates one folder.
- `PATCH /api/v1/folders/:id` — name; requires files:upload. Renaming does not change child IDs or file URLs.
- `DELETE /api/v1/folders/:id` — removes an empty folder. Requires files:delete. Nonempty folders and folders with pending uploads are rejected.
- `GET /api/v1/files?folderId=UUID&q=text&type=image&cursor=...` — current folder, 50 files per page. Omit folderId for root. Requires files:read.
- `POST /api/v1/uploads` — `{name,size,contentType,visibility,folderId?}` or `{...,folderPath:"website/images/heroes"}`. Requires files:upload. folderPath automatically creates missing subfolders; use either folderId or folderPath. Private by default. Returns id and short-lived signed PUT URL.
- `PUT uploadUrl` — send the exact binary bytes with the declared Content-Type and Content-Length; upload directly to the workspace’s R2 bucket.
- `POST /api/v1/uploads/:id/complete` — verifies size/type, copies with source ETag precondition to a new immutable object key, stores workspaceId, folderId, metadata and stable URL in MongoDB. Only the original user/key in the original workspace can complete the upload. Idempotent after completion.
- `PATCH /api/v1/files/:id` — folderId (nullable); requires files:upload. Moves file in logical hierarchy; stable URL is preserved.
- `DELETE /api/v1/files/:id` — requires files:delete. Permanently removes object and metadata.
- `GET /api/v1/files/:id/download` — requires files:read; redirects to a 60-second signed R2 GET URL.
- `GET /api/v1/content/:id` — controlled file gateway; public files can be read without login, private files require membership in the file’s workspace and appropriate key ownership. Single-range streaming supported. Private responses never cached.

## API keys

- `GET /api/keys` — list current user’s keys in active workspace; no raw key/hash returned.
- `POST /api/keys` — name, scopes, expiresInDays (1–365, or null for Never), maxRequests, maxUploadBytes. Editor/admin/owner session. Secret returned once.
- `DELETE /api/keys/:id` — revokes own key in active workspace.
- `GET /api/stats`, `GET /api/activity` — verified workspace session; all queries scoped by workspaceId.

All key requests count toward maxRequests, including downstream rejections. Membership is rechecked every request. Removed members lose API access even if a key has not expired. Browser-to-application requests are same-origin; keep API keys in external applications’ backends.

Folder names reject slashes, control characters, `.` and `..`. Hierarchy is limited to 31 levels. File URLs and physical R2 keys are immutable; folders are MongoDB-backed logical containers, so renaming/moving assets does not break delivery URLs. Each bucket must remain private. Configure its exact application origin in R2 CORS and a lifecycle cleanup for staging/.

A key with expiresAt: null never expires by time. Its request quota, scopes, size limit, workspace membership checks and manual revocation still apply. Records with a missing expiresAt are rejected.

## Browser uploads and storage changes

Upload reservations also return `proxyUploadUrl` when the file fits the hosting relay limit. `PUT /api/v1/uploads/:id/content` accepts raw bytes with the reserved Content-Type and Content-Length. It requires the same authenticated issuer and workspace as the reservation. The app streams the body to that workspace's R2 connection, enforces exact length, locks concurrent upload attempts, and removes incomplete objects on failure. Finalization remains required. This same-origin route works without browser-to-R2 CORS. On Vercel the default relay cap is 4 MiB; larger files require direct upload and bucket CORS. Other Node hosts default to the configured MAX_UPLOAD_BYTES, with optional MAX_PROXY_UPLOAD_BYTES override.

Workspace owner storage management:

- `GET /api/workspaces/:id/storage` returns account ID, bucket name and connection version only. Access keys are never returned.
- `POST /api/workspaces/:id/storage/change` accepts credentials, currentPassword and privateBucketConfirmed:true. Verifies owner/password and the new bucket permissions; stores only encrypted proposed credentials in an expiring, purpose-bound OTP challenge. The active connection is unchanged.
- `POST /api/workspaces/:id/storage/verify` accepts challengeId and code. Rechecks ownership and password version, consumes the OTP once, archives the old encrypted connection, and conditionally installs the new connection version. Concurrent stale changes are rejected.

Files and reservations pin their storage version. Switching buckets preserves the prior encrypted connection for old files; owners must keep that bucket and its credentials available. Same-account/same-bucket key rotation uses the current keys for old connection versions, allowing old keys to be retired. Files are not automatically migrated between buckets. Stable file URLs do not change.

## Temporary upload lifecycle

`POST /api/v1/uploads` accepts an optional UUID `requestId`. Keep it stable for retries of the same file and metadata. Concurrent retries reuse one reservation. Reusing that ID with different metadata returns 409. If the file already completed, the response is `{id,completed:true}`; do not upload it again. A relay upload already received returns `uploaded:true`, so callers can retry finalization without resending bytes.

`DELETE /api/v1/uploads/:id` cancels an inactive upload belonging to the same user/key/workspace, removes its staging object, then deletes the reservation. It never deletes a completed file. Active receiving/finalizing leases are protected. Browser-detected failures call cancellation automatically.

Successful finalization immediately removes the temporary reservation; permanent metadata stays in files. Pending reservations have a renewable 30-minute expiry, and failed attempts have a 5-minute expiry. MongoDB's TTL monitor removes abandoned expired documents asynchronously. R2 staging lifecycle cleanup is still required for tabs/processes that disappear without sending cancellation. Files are not deduplicated by name: a different requestId intentionally creates a new upload.
