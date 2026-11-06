import {
  beginStorageChange,
  finishStorageChange,
  storageDetails,
} from "../lib/storage-settings";
import { workspaceStorage } from "../lib/workspaces";
import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  HeadBucketCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { hashSync, compare } from "bcryptjs";
import { collection, db } from "../lib/db";
import {
  beginAuth,
  verifyIdentity,
  authenticate,
  identity,
  COOKIE,
  beginPasswordChange,
  finishPasswordChange,
} from "../lib/auth";
import { dispatch } from "../lib/api";
import { ApiError, hash, token, otpHash, constantEqual } from "../lib/security";
import {
  encryptCredentials,
  decryptCredentials,
  type R2Credentials,
} from "../lib/credentials";
import {
  me,
  createWorkspace,
  configureStorage,
  switchWorkspace,
  acceptInvitation,
  inviteMember,
} from "../lib/workspaces";
import {
  createFolder,
  resolveFolder,
  listFolders,
  deleteFolder,
  renameFolder,
} from "../lib/folders";
let mongo: MongoMemoryServer;
const sent: { html: string; to: string[] }[] = [];
const originalFetch = globalThis.fetch;
const s3 = mockClient(S3Client);
const password = "secure-password-for-tests";
const origin = "http://localhost:3000";
const credentials: R2Credentials = {
  accountId: "a".repeat(32),
  accessKeyId: "test-access-key-123456",
  secretAccessKey: "test-secret-access-key-123456789",
  bucket: "tenant-a-assets",
};
function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function otp() {
  return sent.at(-1)!.html.match(/>(\d{6})</)![1];
}
const status = (code: number) => (e: unknown) =>
  e instanceof ApiError && e.status === code;
async function user(email = "owner@example.com") {
  const id = randomUUID();
  await (
    await collection("users")
  ).insertOne({
    _id: id,
    email,
    name: email.split("@")[0],
    passwordHash: hashSync(password, 4),
    passwordVersion: 0,
    disabledAt: null,
    createdAt: new Date(),
  });
  return id;
}
async function workspace(ownerId: string, name = "Studio", r2 = credentials) {
  const id = randomUUID();
  await (
    await collection("workspaces")
  ).insertOne({
    _id: id,
    name,
    ownerId,
    status: "ready",
    r2: encryptCredentials(id, r2),
    storageVersion: 1,
    createdAt: new Date(),
  });
  await (
    await collection("memberships")
  ).insertOne({
    _id: randomUUID(),
    workspaceId: id,
    userId: ownerId,
    role: "owner",
    disabledAt: null,
    createdAt: new Date(),
  });
  return id;
}
async function session(userId: string, workspaceId: string | null) {
  const raw = token(),
    id = randomUUID();
  await (
    await collection("sessions")
  ).insertOne({
    _id: id,
    tokenHash: hash(raw),
    userId,
    activeWorkspaceId: workspaceId,
    passwordVersion: 0,
    expiresAt: new Date(Date.now() + 3600000),
  });
  return { Cookie: `${COOKIE}=${raw}` };
}
async function setup(role = "owner") {
  const userId = await user();
  const workspaceId = await workspace(userId);
  if (role !== "owner")
    await (
      await collection("memberships")
    ).updateOne({ workspaceId, userId }, { $set: { role } });
  const headers = await session(userId, workspaceId);
  return {
    userId,
    workspaceId,
    headers,
    req: request("me", "GET", undefined, headers),
  };
}
async function key(
  userId: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
) {
  const raw = `acdn_${token()}`,
    id = randomUUID();
  await (
    await collection("apiKeys")
  ).insertOne({
    _id: id,
    name: "Test key",
    userId,
    workspaceId,
    tokenHash: hash(raw),
    prefix: raw.slice(0, 13),
    scopes: ["files:read", "files:upload", "files:delete"],
    requests: 0,
    maxRequests: 100,
    maxUploadBytes: 1048576,
    expiresAt: new Date(Date.now() + 3600000),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  });
  return { id, headers: { Authorization: `Bearer ${raw}` } };
}
function mockStorage() {
  s3.on(HeadBucketCommand).resolves({});
  s3.on(PutObjectCommand).resolves({});
  s3.on(HeadObjectCommand).resolves({
    ContentLength: 5,
    ContentType: "image/jpeg",
    ETag: '"version-a"',
  });
  s3.on(CopyObjectCommand).resolves({});
  s3.on(DeleteObjectCommand).resolves({});
  s3.on(GetObjectCommand).resolves({
    Body: { transformToByteArray: async () => new Uint8Array([1]) } as any,
  });
}
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR ??= join(
    tmpdir(),
    "yourcdn-mongodb-binaries",
  );
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, {
    MONGODB_URI: mongo.getUri(),
    MONGODB_DATABASE: "arionys_test_v2",
    APP_URL: origin,
    AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
    R2_ENCRYPTION_KEY: "b".repeat(64),
    MAIL_API_TOKEN: "test-mail-token",
    R2_ACCOUNT_ID: "wrong-global-account",
    R2_BUCKET: "wrong-global-bucket",
  });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://mailapi.arionys.com/api/send");
    sent.push(JSON.parse(init!.body as string));
    return new Response("{}", { status: 202 });
  };
  await db();
});
beforeEach(async () => {
  for (const c of await (await db()).collections()) await c.deleteMany({});
  sent.length = 0;
  s3.reset();
});
after(async () => {
  globalThis.fetch = originalFetch;
  s3.restore();
  await (await (globalThis as any).mongo)?.close();
  await mongo?.stop();
});
test("cross-site mutations fail even with a fake Authorization header on account endpoints", async () => {
  await assert.rejects(
    () =>
      dispatch(
        new Request(`${origin}/api/auth/login`, {
          method: "POST",
          headers: {
            Origin: "https://attacker.test",
            Authorization: "Bearer fake",
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
        ["auth", "login"],
      ),
    status(403),
  );
});
test("public signup is available to multiple unrelated emails and creates no session before OTP", async () => {
  for (const email of ["alice@example.com", "bob@example.com"]) {
    const c = await beginAuth("signup", { email, password, name: "New user" });
    assert.equal(
      await (await collection("sessions")).countDocuments({ email }),
      0,
    );
    const result = await verifyIdentity({
      challengeId: c.challengeId,
      code: otp(),
    });
    assert.equal(result.next, "/onboarding");
  }
  assert.equal(await (await collection("users")).countDocuments(), 2);
  assert.equal(await (await collection("memberships")).countDocuments(), 0);
});
test("correct password still requires email OTP and consumed codes cannot be reused", async () => {
  const userId = await user();
  const c = await beginAuth("login", { email: "owner@example.com", password });
  assert.equal(await (await collection("sessions")).countDocuments(), 0);
  const code = otp();
  await verifyIdentity({ challengeId: c.challengeId, code });
  await assert.rejects(
    () => verifyIdentity({ challengeId: c.challengeId, code }),
    status(401),
  );
  assert.equal(
    await (await collection("sessions")).countDocuments({ userId }),
    1,
  );
});
test("five wrong codes lock out the correct code", async () => {
  await user();
  const c = await beginAuth("login", { email: "owner@example.com", password });
  const code = otp();
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      () =>
        verifyIdentity({
          challengeId: c.challengeId,
          code: code === "111111" ? "222222" : "111111",
        }),
      status(401),
    );
  await assert.rejects(
    () => verifyIdentity({ challengeId: c.challengeId, code }),
    status(401),
  );
});
test("expired OTPs fail before MongoDB TTL cleanup", async () => {
  await user();
  const c = await beginAuth("login", { email: "owner@example.com", password });
  await (
    await collection("challenges")
  ).updateOne(
    { _id: c.challengeId },
    { $set: { expiresAt: new Date(Date.now() - 1) } },
  );
  await assert.rejects(
    () => verifyIdentity({ challengeId: c.challengeId, code: otp() }),
    status(401),
  );
});
test("concurrent OTP verification issues exactly one session", async () => {
  await user();
  const c = await beginAuth("login", { email: "owner@example.com", password });
  const code = otp();
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      verifyIdentity({ challengeId: c.challengeId, code }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("credentials are randomized authenticated ciphertext, not readable JSON", () => {
  const id = randomUUID(),
    a = encryptCredentials(id, credentials),
    b = encryptCredentials(id, credentials);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.ok(!JSON.stringify(a).includes(credentials.secretAccessKey));
  assert.deepEqual(decryptCredentials(id, a), credentials);
});
test("ciphertext cannot be decrypted in a different workspace or after tampering", () => {
  const id = randomUUID(),
    encrypted = encryptCredentials(id, credentials);
  assert.throws(() => decryptCredentials(randomUUID(), encrypted), status(503));
  assert.throws(
    () =>
      decryptCredentials(id, {
        ...encrypted,
        tag: Buffer.alloc(16).toString("base64"),
      }),
    status(503),
  );
});
test("new accounts cannot access workspace APIs until onboarding completes", async () => {
  const userId = await user();
  const headers = await session(userId, null);
  await assert.rejects(
    () => dispatch(request("stats", "GET", undefined, headers), ["stats"]),
    status(409),
  );
});
test("workspace setup verifies read/write/copy/delete permissions and returns no credentials", async () => {
  const userId = await user();
  const headers = await session(userId, null),
    req = request("workspaces", "GET", undefined, headers);
  const w = await createWorkspace(req, { name: "My studio" });
  await assert.rejects(() => authenticate(req, undefined, true), status(403));
  mockStorage();
  await configureStorage(req, w.id, {
    credentials,
    privateBucketConfirmed: true,
  });
  const saved = await (await collection("workspaces")).findOne({ _id: w.id });
  assert.equal(saved!.status, "ready");
  assert.ok(saved!.r2.ciphertext);
  const response = await me(req);
  assert.ok(!JSON.stringify(response).includes(credentials.secretAccessKey));
  assert.ok(!JSON.stringify(response).includes("ciphertext"));
  assert.equal((await authenticate(req, undefined, true)).workspaceId, w.id);
  assert.equal(s3.commandCalls(DeleteObjectCommand).length, 2);
});
test("failed storage verification keeps the workspace unfinished and saves no secrets", async () => {
  const userId = await user();
  const headers = await session(userId, null),
    req = request("workspaces", "GET", undefined, headers);
  const w = await createWorkspace(req, { name: "My studio" });
  s3.on(HeadBucketCommand).rejects(new Error("Access denied"));
  await assert.rejects(
    () =>
      configureStorage(req, w.id, {
        credentials,
        privateBucketConfirmed: true,
      }),
    status(400),
  );
  const saved = await (await collection("workspaces")).findOne({ _id: w.id });
  assert.equal(saved!.status, "pending");
  assert.equal(saved!.r2, undefined);
});
test("another user cannot configure or switch into an unjoined workspace", async () => {
  const a = await setup();
  const bId = await user("other@example.com"),
    headers = await session(bId, null),
    req = request("workspaces", "GET", undefined, headers);
  await assert.rejects(
    () =>
      configureStorage(req, a.workspaceId, {
        credentials,
        privateBucketConfirmed: true,
      }),
    status(403),
  );
  await assert.rejects(() => switchWorkspace(req, a.workspaceId), status(404));
});
test("one person can switch between workspaces with different roles", async () => {
  const a = await setup();
  const ownerB = await user("other@example.com"),
    wB = await workspace(ownerB, "Other studio");
  await (
    await collection("memberships")
  ).insertOne({
    _id: randomUUID(),
    workspaceId: wB,
    userId: a.userId,
    role: "viewer",
    disabledAt: null,
    createdAt: new Date(),
  });
  assert.equal((await me(a.req)).workspaces.length, 2);
  await switchWorkspace(a.req, wB);
  const p = await authenticate(a.req, "files:read");
  assert.equal(p.workspaceId, wB);
  assert.equal(p.role, "viewer");
  await assert.rejects(() => authenticate(a.req, "files:upload"), status(403));
});
test("files, counts, and audit events are scoped to the active workspace", async () => {
  const a = await setup(),
    other = await workspace(a.userId, "Second");
  await (
    await collection("files")
  ).insertMany([
    {
      _id: randomUUID(),
      workspaceId: a.workspaceId,
      folderId: null,
      name: "mine.txt",
      size: 5,
      contentType: "text/plain",
      visibility: "private",
      status: "ready",
      createdAt: new Date(),
    },
    {
      _id: randomUUID(),
      workspaceId: other,
      folderId: null,
      name: "other.txt",
      size: 999,
      contentType: "text/plain",
      visibility: "private",
      status: "ready",
      createdAt: new Date(),
    },
  ]);
  await (
    await collection("events")
  ).insertMany([
    { workspaceId: a.workspaceId, action: "Mine", createdAt: new Date() },
    { workspaceId: other, action: "Other", createdAt: new Date() },
  ]);
  const files = (await dispatch(
    request("v1/files", "GET", undefined, a.headers),
    ["v1", "files"],
  )) as any;
  assert.equal(files.files.length, 1);
  assert.equal(files.files[0].name, "mine.txt");
  const stats = (await dispatch(request("stats", "GET", undefined, a.headers), [
    "stats",
  ])) as any;
  assert.equal(stats.totals.bytes, 5);
  const events = (await dispatch(
    request("activity", "GET", undefined, a.headers),
    ["activity"],
  )) as any;
  assert.equal(events.length, 1);
});
test("API keys stay bound to their workspace regardless of the owner’s session switch", async () => {
  const a = await setup(),
    other = await workspace(a.userId, "Second");
  const k = await key(a.userId, a.workspaceId);
  await switchWorkspace(a.req, other);
  assert.equal(
    (
      await authenticate(
        request("v1/files", "GET", undefined, k.headers),
        "files:read",
      )
    ).workspaceId,
    a.workspaceId,
  );
});
test("API key scopes and atomic request limits are enforced", async () => {
  const a = await setup(),
    k = await key(a.userId, a.workspaceId, {
      maxRequests: 5,
      scopes: ["files:read"],
    });
  await assert.rejects(
    () =>
      authenticate(
        request("keys", "GET", undefined, k.headers),
        undefined,
        true,
      ),
    status(401),
  );
  await assert.rejects(
    () =>
      authenticate(
        request("v1/uploads", "GET", undefined, k.headers),
        "files:upload",
      ),
    status(401),
  );
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      authenticate(
        request("v1/files", "GET", undefined, k.headers),
        "files:read",
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
});
test("expired and revoked API keys cannot authenticate", async () => {
  const a = await setup(),
    k = await key(a.userId, a.workspaceId, {
      expiresAt: new Date(Date.now() - 1),
    });
  await assert.rejects(
    () =>
      authenticate(
        request("v1/files", "GET", undefined, k.headers),
        "files:read",
      ),
    status(401),
  );
  await (
    await collection("apiKeys")
  ).updateOne(
    { _id: k.id },
    {
      $set: {
        expiresAt: new Date(Date.now() + 3600000),
        revokedAt: new Date(),
      },
    },
  );
  await assert.rejects(
    () =>
      authenticate(
        request("v1/files", "GET", undefined, k.headers),
        "files:read",
      ),
    status(401),
  );
});
test("removing a workspace member invalidates their API access without disabling their account", async () => {
  const a = await setup(),
    k = await key(a.userId, a.workspaceId);
  await (
    await collection("memberships")
  ).updateOne(
    { workspaceId: a.workspaceId, userId: a.userId },
    { $set: { disabledAt: new Date() } },
  );
  await assert.rejects(
    () =>
      authenticate(
        request("v1/files", "GET", undefined, k.headers),
        "files:read",
      ),
    status(403),
  );
  assert.ok(await identity(a.req));
});
test("private file downloads cannot cross workspace boundaries even for a common owner", async () => {
  const a = await setup(),
    other = await workspace(a.userId, "Second"),
    id = randomUUID();
  await (
    await collection("files")
  ).insertOne({
    _id: id,
    workspaceId: other,
    status: "ready",
    visibility: "private",
  });
  await assert.rejects(
    () =>
      dispatch(request(`v1/content/${id}`, "GET", undefined, a.headers), [
        "v1",
        "content",
        id,
      ]),
    status(404),
  );
  assert.equal(s3.calls().length, 0);
});
test("folders support nested paths, breadcrumbs, and duplicate sibling detection", async () => {
  const a = await setup(),
    p = await authenticate(a.req);
  const folderId = await resolveFolder(p, {
    folderPath: "website/images/heroes",
  });
  const listing = await listFolders(p, folderId);
  assert.deepEqual(
    listing.breadcrumbs.map((f) => f.name),
    ["website", "images", "heroes"],
  );
  assert.equal(
    await resolveFolder(p, { folderPath: "website/images/heroes" }),
    folderId,
  );
  await assert.rejects(
    () =>
      createFolder(p, { name: "heroes", parentId: listing.breadcrumbs[1].id }),
    status(409),
  );
});
test("folder IDs cannot be reused across workspaces; traversal paths fail", async () => {
  const a = await setup(),
    p = await authenticate(a.req);
  const f = await createFolder(p, { name: "Private assets" });
  const other = await workspace(a.userId, "Second");
  await switchWorkspace(a.req, other);
  const otherP = await authenticate(a.req);
  await assert.rejects(
    () => createFolder(otherP, { name: "Child", parentId: f.id }),
    status(404),
  );
  await assert.rejects(() => resolveFolder(p, { folderPath: "../secrets" }));
  await assert.rejects(
    () => resolveFolder(p, { folderPath: "images//icons" }),
    status(400),
  );
});
test("nonempty folders cannot be deleted and renaming preserves child IDs", async () => {
  const a = await setup(),
    p = await authenticate(a.req);
  const parent = await createFolder(p, { name: "Brand" }),
    child = await createFolder(p, { name: "Logos", parentId: parent.id });
  await assert.rejects(() => deleteFolder(p, parent.id), status(409));
  await renameFolder(p, parent.id, { name: "New brand" });
  assert.equal(
    (await listFolders(p, child.id)).breadcrumbs[0].name,
    "New brand",
  );
});
test("upload uses the workspace’s R2 credentials and automatically creates API folder paths", async () => {
  const a = await setup(),
    k = await key(a.userId, a.workspaceId);
  const reservation = (await dispatch(
    request(
      "v1/uploads",
      "POST",
      {
        name: "photo.jpg",
        size: 5,
        contentType: "image/jpeg",
        folderPath: "products/summer",
      },
      k.headers,
    ),
    ["v1", "uploads"],
  )) as any;
  assert.ok(
    reservation.uploadUrl.includes(
      `${credentials.accountId}.r2.cloudflarestorage.com`,
    ),
  );
  assert.ok(reservation.uploadUrl.includes(credentials.bucket));
  assert.ok(!reservation.uploadUrl.includes("wrong-global"));
  const upload = await (
    await collection("uploads")
  ).findOne({ _id: reservation.id });
  assert.ok(upload!.folderId);
  assert.equal(upload!.workspaceId, a.workspaceId);
});
test("file size mismatches cannot create published metadata", async () => {
  const a = await setup(),
    k = await key(a.userId, a.workspaceId);
  const r = (await dispatch(
    request(
      "v1/uploads",
      "POST",
      { name: "photo.jpg", size: 5, contentType: "image/jpeg" },
      k.headers,
    ),
    ["v1", "uploads"],
  )) as any;
  s3.on(HeadObjectCommand).resolves({
    ContentLength: 4,
    ContentType: "image/jpeg",
    ETag: '"a"',
  });
  await assert.rejects(
    () =>
      dispatch(request(`v1/uploads/${r.id}/complete`, "POST", {}, k.headers), [
        "v1",
        "uploads",
        r.id,
        "complete",
      ]),
    status(400),
  );
  assert.equal(await (await collection("files")).countDocuments(), 0);
});
test("finalization saves workspace and folder metadata, is idempotent, and protects source version", async () => {
  const a = await setup(),
    k = await key(a.userId, a.workspaceId);
  const r = (await dispatch(
    request(
      "v1/uploads",
      "POST",
      {
        name: "photo.jpg",
        size: 5,
        contentType: "image/jpeg",
        folderPath: "brand/photos",
      },
      k.headers,
    ),
    ["v1", "uploads"],
  )) as any;
  mockStorage();
  const f = (await dispatch(
    request(`v1/uploads/${r.id}/complete`, "POST", {}, k.headers),
    ["v1", "uploads", r.id, "complete"],
  )) as any;
  assert.ok(f.folderId);
  const saved = await (await collection("files")).findOne({ _id: f.id });
  assert.equal(saved!.workspaceId, a.workspaceId);
  assert.equal(
    s3.commandCalls(CopyObjectCommand)[0].args[0].input.CopySourceIfMatch,
    '"version-a"',
  );
  await dispatch(
    request(`v1/uploads/${r.id}/complete`, "POST", {}, k.headers),
    ["v1", "uploads", r.id, "complete"],
  );
  assert.equal(s3.commandCalls(CopyObjectCommand).length, 1);
});
test("failed file deletion hides the file and can be retried safely", async () => {
  const a = await setup();
  const id = randomUUID();
  await (
    await collection("files")
  ).insertOne({
    _id: id,
    workspaceId: a.workspaceId,
    name: "private.jpg",
    objectKey: `files/${id}/private.jpg`,
    storageVersion: 1,
    status: "ready",
    visibility: "private",
  });
  s3.on(DeleteObjectCommand).rejects(new Error("Storage unavailable"));
  await assert.rejects(() =>
    dispatch(request(`v1/files/${id}`, "DELETE", undefined, a.headers), [
      "v1",
      "files",
      id,
    ]),
  );
  assert.equal(
    (await (await collection("files")).findOne({ _id: id }))!.status,
    "deleting",
  );
  await assert.rejects(
    () =>
      dispatch(request(`v1/content/${id}`, "GET", undefined, a.headers), [
        "v1",
        "content",
        id,
      ]),
    status(404),
  );
  s3.on(DeleteObjectCommand).resolves({});
  assert.deepEqual(
    await dispatch(request(`v1/files/${id}`, "DELETE", undefined, a.headers), [
      "v1",
      "files",
      id,
    ]),
    { success: true },
  );
  assert.equal(
    await (await collection("files")).countDocuments({ _id: id }),
    0,
  );
});
test("malformed file cursors return a client error", async () => {
  const a = await setup();
  await assert.rejects(
    () =>
      dispatch(request("v1/files?cursor=%25", "GET", undefined, a.headers), [
        "v1",
        "files",
      ]),
    status(400),
  );
});
test("invitees join a shared workspace without creating their own bucket", async () => {
  const a = await setup(),
    p = await authenticate(a.req);
  await inviteMember(p, { email: "invitee@example.com", role: "editor" });
  const raw = new URL(
    sent
      .at(-1)!
      .html.match(/href="([^"]+)"/)![1]
      .replace(/&amp;/g, "&"),
  ).searchParams.get("token")!;
  const userId = await user("invitee@example.com"),
    headers = await session(userId, null),
    req = request("invitations/accept", "POST", undefined, headers);
  await acceptInvitation(req, { token: raw });
  const joined = await me(req);
  assert.equal(joined.activeWorkspace!.id, a.workspaceId);
  assert.equal(joined.role, "editor");
  assert.equal(
    await (await collection("workspaces")).countDocuments({ ownerId: userId }),
    0,
  );
  await assert.rejects(
    () => acceptInvitation(req, { token: raw }),
    status(404),
  );
});
test("invitations cannot be accepted by a different verified email", async () => {
  const a = await setup(),
    p = await authenticate(a.req);
  await inviteMember(p, { email: "intended@example.com", role: "viewer" });
  const raw = new URL(
    sent
      .at(-1)!
      .html.match(/href="([^"]+)"/)![1]
      .replace(/&amp;/g, "&"),
  ).searchParams.get("token")!;
  const userId = await user("attacker@example.com"),
    headers = await session(userId, null);
  await assert.rejects(
    () =>
      acceptInvitation(
        request("invitations/accept", "POST", undefined, headers),
        { token: raw },
      ),
    status(404),
  );
});
test("profile updates are personal; ordinary viewers cannot create keys or folders", async () => {
  const a = await setup("viewer");
  await dispatch(request("profile", "PATCH", { name: "New name" }, a.headers), [
    "profile",
  ]);
  assert.equal((await me(a.req)).name, "New name");
  await assert.rejects(
    () => dispatch(request("keys", "POST", {}, a.headers), ["keys"]),
    status(403),
  );
  const p = await authenticate(a.req);
  await assert.rejects(
    () => createFolder(p, { name: "Forbidden" }),
    status(403),
  );
});
test("password changes require current password and separate OTP, then revoke all sessions", async () => {
  const a = await setup();
  await session(a.userId, a.workspaceId);
  await assert.rejects(
    () =>
      beginPasswordChange(a.req, {
        currentPassword: "wrong-password-long",
        newPassword: "new-secure-password-test",
      }),
    status(401),
  );
  const c = await beginPasswordChange(a.req, {
    currentPassword: password,
    newPassword: "new-secure-password-test",
  });
  const code = otp();
  await assert.rejects(
    () => verifyIdentity({ challengeId: c.challengeId, code }),
    status(401),
  );
  assert.equal(
    await (await collection("sessions")).countDocuments({ userId: a.userId }),
    2,
  );
  await finishPasswordChange(a.req, { challengeId: c.challengeId, code });
  assert.equal(
    await (await collection("sessions")).countDocuments({ userId: a.userId }),
    0,
  );
  assert.ok(
    await compare(
      "new-secure-password-test",
      (await (await collection("users")).findOne({ _id: a.userId }))!
        .passwordHash,
    ),
  );
  await assert.rejects(() => identity(a.req), status(401));
});
test("pending login challenges are invalidated when the account password changes", async () => {
  const a = await setup();
  const login = await beginAuth("login", {
      email: "owner@example.com",
      password,
    }),
    loginCode = otp();
  const change = await beginPasswordChange(a.req, {
    currentPassword: password,
    newPassword: "new-secure-password-test",
  });
  await finishPasswordChange(a.req, {
    challengeId: change.challengeId,
    code: otp(),
  });
  await assert.rejects(
    () => verifyIdentity({ challengeId: login.challengeId, code: loginCode }),
    status(401),
  );
});
test("public status exposes no database or bucket configuration", async () => {
  assert.deepEqual(await dispatch(request("status"), ["status"]), {
    signupAvailable: true,
  });
});

test("API keys cannot read private files uploaded by another key in the same workspace", async () => {
  const a = await setup(),
    k = await key(a.userId, a.workspaceId),
    id = randomUUID();
  await (
    await collection("files")
  ).insertOne({
    _id: id,
    workspaceId: a.workspaceId,
    folderId: null,
    apiKeyId: "another-key",
    name: "private.jpg",
    size: 5,
    status: "ready",
    visibility: "private",
    contentType: "image/jpeg",
    createdAt: new Date(),
  });
  const result = (await dispatch(
    request("v1/files", "GET", undefined, k.headers),
    ["v1", "files"],
  )) as any;
  assert.equal(result.files.length, 0);
  await assert.rejects(
    () =>
      dispatch(request(`v1/content/${id}`, "GET", undefined, k.headers), [
        "v1",
        "content",
        id,
      ]),
    status(404),
  );
});
test("removing a teammate only revokes the membership and keys in this workspace", async () => {
  const a = await setup(),
    memberId = await user("member@example.com"),
    ownWorkspace = await workspace(memberId, "Personal"),
    memberHeaders = await session(memberId, ownWorkspace);
  await (
    await collection("memberships")
  ).insertOne({
    _id: randomUUID(),
    workspaceId: a.workspaceId,
    userId: memberId,
    role: "editor",
    disabledAt: null,
    createdAt: new Date(),
  });
  const sharedKey = await key(memberId, a.workspaceId),
    personalKey = await key(memberId, ownWorkspace);
  await dispatch(request(`team/${memberId}`, "DELETE", undefined, a.headers), [
    "team",
    memberId,
  ]);
  assert.equal(
    (await authenticate(request("me", "GET", undefined, memberHeaders)))
      .workspaceId,
    ownWorkspace,
  );
  await assert.rejects(
    () =>
      authenticate(
        request("v1/files", "GET", undefined, sharedKey.headers),
        "files:read",
      ),
    status(401),
  );
  assert.equal(
    (
      await authenticate(
        request("v1/files", "GET", undefined, personalKey.headers),
        "files:read",
      )
    ).workspaceId,
    ownWorkspace,
  );
});
test("a fresh invitation restores a removed member without granting a global role", async () => {
  const a = await setup(),
    p = await authenticate(a.req),
    memberId = await user("returning@example.com");
  await (
    await collection("memberships")
  ).insertOne({
    _id: randomUUID(),
    workspaceId: a.workspaceId,
    userId: memberId,
    role: "editor",
    disabledAt: new Date(),
    createdAt: new Date(),
  });
  await inviteMember(p, { email: "returning@example.com", role: "viewer" });
  const raw = new URL(
    sent
      .at(-1)!
      .html.match(/href="([^"]+)"/)![1]
      .replace(/&amp;/g, "&"),
  ).searchParams.get("token")!;
  const headers = await session(memberId, null);
  await acceptInvitation(
    request("invitations/accept", "POST", undefined, headers),
    { token: raw },
  );
  assert.equal(
    (await authenticate(request("me", "GET", undefined, headers))).role,
    "viewer",
  );
});

test("Never expiry is saved as null, counts as active, and still supports revocation", async () => {
  const a = await setup();
  const created = (await dispatch(
    request(
      "keys",
      "POST",
      {
        name: "Permanent integration",
        scopes: ["files:read"],
        expiresInDays: null,
        maxRequests: 100,
        maxUploadBytes: 1000,
      },
      a.headers,
    ),
    ["keys"],
  )) as any;
  assert.equal(created.expiresAt, null);
  const headers = { Authorization: `Bearer ${created.secret}` };
  assert.equal(
    (
      await authenticate(
        request("v1/files", "GET", undefined, headers),
        "files:read",
      )
    ).workspaceId,
    a.workspaceId,
  );
  const stats = (await dispatch(request("stats", "GET", undefined, a.headers), [
    "stats",
  ])) as any;
  assert.equal(stats.keys, 1);
  await dispatch(
    request(`keys/${created.id}`, "DELETE", undefined, a.headers),
    ["keys", created.id],
  );
  await assert.rejects(
    () =>
      authenticate(
        request("v1/files", "GET", undefined, headers),
        "files:read",
      ),
    status(401),
  );
});
test("Never expiry does not bypass request quotas, and a missing expiry remains invalid", async () => {
  const a = await setup();
  const k = await key(a.userId, a.workspaceId, {
    expiresAt: null,
    maxRequests: 1,
  });
  await authenticate(
    request("v1/files", "GET", undefined, k.headers),
    "files:read",
  );
  await assert.rejects(
    () =>
      authenticate(
        request("v1/files", "GET", undefined, k.headers),
        "files:read",
      ),
    status(401),
  );
  const malformed = await key(a.userId, a.workspaceId);
  await (
    await collection("apiKeys")
  ).updateOne({ _id: malformed.id }, { $unset: { expiresAt: 1 } });
  await assert.rejects(
    () =>
      authenticate(
        request("v1/files", "GET", undefined, malformed.headers),
        "files:read",
      ),
    status(401),
  );
});

test("Unlimited requests counts usage beyond the numeric cap while preserving key restrictions", async () => {
  const { headers } = await setup();
  const created = (await dispatch(
    request(
      "keys",
      "POST",
      {
        name: "Unlimited integration",
        scopes: ["files:read"],
        expiresInDays: 30,
        maxRequests: null,
        maxUploadBytes: 1000,
      },
      headers,
    ),
    ["keys"],
  )) as any;
  assert.equal(created.maxRequests, null);
  const keys = await collection("apiKeys");
  await keys.updateOne({ _id: created.id }, { $set: { requests: 10_000_000 } });
  const integration = request("v1/files", "GET", undefined, {
    Authorization: `Bearer ${created.secret}`,
  });
  await Promise.all([
    authenticate(integration, "files:read"),
    authenticate(integration, "files:read"),
  ]);
  assert.equal((await keys.findOne({ _id: created.id }))!.requests, 10_000_002);
  await assert.rejects(authenticate(integration, "files:upload"), status(401));
  await keys.updateOne({ _id: created.id }, { $unset: { maxRequests: 1 } });
  await assert.rejects(authenticate(integration, "files:read"), status(401));
  await keys.updateOne(
    { _id: created.id },
    { $set: { maxRequests: null, expiresAt: new Date(0) } },
  );
  await assert.rejects(authenticate(integration, "files:read"), status(401));
  await keys.updateOne({ _id: created.id }, { $set: { expiresAt: null } });
  await dispatch(request(`keys/${created.id}`, "DELETE", undefined, headers), [
    "keys",
    created.id,
  ]);
  await assert.rejects(authenticate(integration, "files:read"), status(401));
});

function binaryRequest(
  id: string,
  headers: Record<string, string>,
  bytes: Uint8Array,
  type = "image/jpeg",
  declaredSize = bytes.length,
) {
  return new Request(`${origin}/api/v1/uploads/${id}/content`, {
    method: "PUT",
    headers: {
      Origin: origin,
      "Content-Type": type,
      "Content-Length": String(declaredSize),
      ...headers,
    },
    body: bytes as BodyInit,
  });
}
function consumeStoragePut() {
  s3.on(PutObjectCommand).callsFake(async (input) => {
    let bytes = 0;
    for await (const chunk of input.Body) bytes += chunk.length;
    assert.equal(bytes, input.ContentLength);
    return {};
  });
  s3.on(DeleteObjectCommand).resolves({});
}
test("same-origin upload streams bytes to the tenant bucket without browser CORS", async () => {
  const a = await setup();
  const r = (await dispatch(
    request(
      "v1/uploads",
      "POST",
      { name: "small.jpg", size: 5, contentType: "image/jpeg" },
      a.headers,
    ),
    ["v1", "uploads"],
  )) as any;
  assert.equal(r.proxyUploadUrl, `/api/v1/uploads/${r.id}/content`);
  consumeStoragePut();
  const result = (await dispatch(
    binaryRequest(r.id, a.headers, new Uint8Array([1, 2, 3, 4, 5])),
    ["v1", "uploads", r.id, "content"],
  )) as any;
  assert.equal(result.bytes, 5);
  assert.equal(
    s3.commandCalls(PutObjectCommand)[0].args[0].input.Bucket,
    credentials.bucket,
  );
  assert.equal(
    (await (await collection("uploads")).findOne({ _id: r.id }))!.state,
    "uploaded",
  );
});
test("binary relay rejects another user and incorrect lengths before writing", async () => {
  const a = await setup();
  const r = (await dispatch(
    request(
      "v1/uploads",
      "POST",
      { name: "small.jpg", size: 5, contentType: "image/jpeg" },
      a.headers,
    ),
    ["v1", "uploads"],
  )) as any;
  await assert.rejects(
    () =>
      dispatch(binaryRequest(r.id, a.headers, new Uint8Array([1, 2, 3])), [
        "v1",
        "uploads",
        r.id,
        "content",
      ]),
    status(400),
  );
  const otherId = await user("intruder@example.com"),
    headers = await session(otherId, a.workspaceId);
  await (
    await collection("memberships")
  ).insertOne({
    _id: randomUUID(),
    workspaceId: a.workspaceId,
    userId: otherId,
    role: "editor",
    disabledAt: null,
    createdAt: new Date(),
  });
  await assert.rejects(
    () =>
      dispatch(binaryRequest(r.id, headers, new Uint8Array(5)), [
        "v1",
        "uploads",
        r.id,
        "content",
      ]),
    status(404),
  );
  assert.equal(s3.commandCalls(PutObjectCommand).length, 0);
});
test("a truncated streaming body is cleaned up and cannot be finalized as a valid upload", async () => {
  const a = await setup();
  const r = (await dispatch(
    request(
      "v1/uploads",
      "POST",
      { name: "small.jpg", size: 5, contentType: "image/jpeg" },
      a.headers,
    ),
    ["v1", "uploads"],
  )) as any;
  consumeStoragePut();
  await assert.rejects(
    () =>
      dispatch(
        binaryRequest(
          r.id,
          a.headers,
          new Uint8Array([1, 2, 3]),
          "image/jpeg",
          5,
        ),
        ["v1", "uploads", r.id, "content"],
      ),
    status(400),
  );
  assert.equal(s3.commandCalls(DeleteObjectCommand).length, 1);
  assert.equal(
    (await (await collection("uploads")).findOne({ _id: r.id }))!.state,
    "pending",
  );
});
test("relay applies hosting limits before receiving bytes", async () => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    const a = await setup();
    const r = (await dispatch(
      request(
        "v1/uploads",
        "POST",
        { name: "large.jpg", size: 5 * 1048576, contentType: "image/jpeg" },
        a.headers,
      ),
      ["v1", "uploads"],
    )) as any;
    assert.equal(r.proxyUploadUrl, null);
    await assert.rejects(
      () =>
        dispatch(
          binaryRequest(
            r.id,
            a.headers,
            new Uint8Array([1]),
            "image/jpeg",
            5 * 1048576,
          ),
          ["v1", "uploads", r.id, "content"],
        ),
      status(413),
    );
    assert.equal(s3.commandCalls(PutObjectCommand).length, 0);
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});
test("workspace storage changes require ownership and the current account password", async () => {
  const a = await setup("admin");
  await assert.rejects(
    () =>
      beginStorageChange(a.req, a.workspaceId, {
        credentials,
        currentPassword: password,
        privateBucketConfirmed: true,
      }),
    status(403),
  );
  await (
    await collection("memberships")
  ).updateOne(
    { workspaceId: a.workspaceId, userId: a.userId },
    { $set: { role: "owner" } },
  );
  await assert.rejects(
    () =>
      beginStorageChange(a.req, a.workspaceId, {
        credentials,
        currentPassword: "incorrect-long-password",
        privateBucketConfirmed: true,
      }),
    status(401),
  );
  assert.equal(sent.length, 0);
});
test("bucket changes are encrypted, OTP-confirmed, and preserve the original bucket for existing assets", async () => {
  const a = await setup();
  const oldFile = randomUUID();
  await (
    await collection("files")
  ).insertOne({
    _id: oldFile,
    workspaceId: a.workspaceId,
    storageVersion: 1,
    status: "ready",
    objectKey: "files/old/photo.jpg",
  });
  mockStorage();
  const changed = {
    ...credentials,
    bucket: "tenant-new-assets",
    secretAccessKey: "new-secret-access-key-123456789",
  };
  const c = await beginStorageChange(a.req, a.workspaceId, {
    credentials: changed,
    currentPassword: password,
    privateBucketConfirmed: true,
  });
  const code = otp();
  assert.equal(
    (await storageDetails(a.req, a.workspaceId)).bucket,
    credentials.bucket,
  );
  const record = await (
    await collection("challenges")
  ).findOne({ _id: c.challengeId });
  assert.ok(!JSON.stringify(record).includes(changed.secretAccessKey));
  await assert.rejects(
    () => verifyIdentity({ challengeId: c.challengeId, code }),
    status(401),
  );
  await finishStorageChange(a.req, a.workspaceId, {
    challengeId: c.challengeId,
    code,
  });
  const details = await storageDetails(a.req, a.workspaceId);
  assert.equal(details.bucket, changed.bucket);
  assert.equal(details.storageVersion, 2);
  assert.ok(!JSON.stringify(details).includes(changed.secretAccessKey));
  const current = await workspaceStorage(a.workspaceId);
  assert.ok(
    (await current.uploadUrl("staging/new", "image/jpeg", 5)).includes(
      changed.bucket,
    ),
  );
  const result = (await dispatch(
    request(`v1/files/${oldFile}/download`, "GET", undefined, a.headers),
    ["v1", "files", oldFile, "download"],
  )) as Response;
  assert.ok(result.headers.get("location")!.includes(credentials.bucket));
  await assert.rejects(
    () =>
      finishStorageChange(a.req, a.workspaceId, {
        challengeId: c.challengeId,
        code,
      }),
    status(401),
  );
});
test("same-bucket key rotation uses the new keys for existing connection versions", async () => {
  const a = await setup();
  mockStorage();
  const changed = {
    ...credentials,
    accessKeyId: "rotated-access-key-123456",
    secretAccessKey: "rotated-secret-key-123456789",
  };
  const c = await beginStorageChange(a.req, a.workspaceId, {
    credentials: changed,
    currentPassword: password,
    privateBucketConfirmed: true,
  });
  await finishStorageChange(a.req, a.workspaceId, {
    challengeId: c.challengeId,
    code: otp(),
  });
  const oldVersion = await workspaceStorage(a.workspaceId, 1);
  const signed = new URL(
    await oldVersion.uploadUrl("staging/old-version", "image/jpeg", 5),
  );
  assert.ok(
    signed.searchParams
      .get("X-Amz-Credential")!
      .startsWith(changed.accessKeyId),
  );
});
test("uploads reserved before a bucket change finish against their original storage connection", async () => {
  const a = await setup();
  const r = (await dispatch(
    request(
      "v1/uploads",
      "POST",
      { name: "old.jpg", size: 5, contentType: "image/jpeg" },
      a.headers,
    ),
    ["v1", "uploads"],
  )) as any;
  mockStorage();
  const c = await beginStorageChange(a.req, a.workspaceId, {
    credentials: { ...credentials, bucket: "brand-new-assets" },
    currentPassword: password,
    privateBucketConfirmed: true,
  });
  await finishStorageChange(a.req, a.workspaceId, {
    challengeId: c.challengeId,
    code: otp(),
  });
  s3.resetHistory();
  await dispatch(
    request(`v1/uploads/${r.id}/complete`, "POST", {}, a.headers),
    ["v1", "uploads", r.id, "complete"],
  );
  assert.equal(
    s3.commandCalls(CopyObjectCommand)[0].args[0].input.Bucket,
    credentials.bucket,
  );
  assert.equal(
    (await (await collection("files")).findOne({ _id: r.id }))!.storageVersion,
    1,
  );
});

test("old assets keep using the latest keys for their bucket after later bucket switches", async () => {
  const a = await setup();
  mockStorage();
  const rotated = {
    ...credentials,
    accessKeyId: "latest-bucket-a-key-12345",
    secretAccessKey: "latest-bucket-a-secret-123456789",
  };
  const first = await beginStorageChange(a.req, a.workspaceId, {
    credentials: rotated,
    currentPassword: password,
    privateBucketConfirmed: true,
  });
  await finishStorageChange(a.req, a.workspaceId, {
    challengeId: first.challengeId,
    code: otp(),
  });
  const second = await beginStorageChange(a.req, a.workspaceId, {
    credentials: { ...credentials, bucket: "different-bucket-b" },
    currentPassword: password,
    privateBucketConfirmed: true,
  });
  await finishStorageChange(a.req, a.workspaceId, {
    challengeId: second.challengeId,
    code: otp(),
  });
  const original = await workspaceStorage(a.workspaceId, 1);
  const url = new URL(await original.uploadUrl("staging/old", "image/jpeg", 5));
  assert.ok(url.href.includes(credentials.bucket));
  assert.ok(
    url.searchParams.get("X-Amz-Credential")!.startsWith(rotated.accessKeyId),
  );
});

test("repeated and concurrent reservation requests reuse one temporary document", async () => {
  const a = await setup();
  const body = {
    requestId: randomUUID(),
    name: "retry.jpg",
    size: 5,
    contentType: "image/jpeg",
  };
  const responses = (await Promise.all(
    Array.from({ length: 5 }, () =>
      dispatch(request("v1/uploads", "POST", body, a.headers), [
        "v1",
        "uploads",
      ]),
    ),
  )) as any[];
  assert.equal(new Set(responses.map((r) => r.id)).size, 1);
  assert.equal(await (await collection("uploads")).countDocuments(), 1);
  await assert.rejects(
    () =>
      dispatch(request("v1/uploads", "POST", { ...body, size: 6 }, a.headers), [
        "v1",
        "uploads",
      ]),
    status(409),
  );
});
test("completion removes temporary records and retries cannot create duplicate files", async () => {
  const a = await setup();
  const body = {
    requestId: randomUUID(),
    name: "complete.jpg",
    size: 5,
    contentType: "image/jpeg",
  };
  const r = (await dispatch(request("v1/uploads", "POST", body, a.headers), [
    "v1",
    "uploads",
  ])) as any;
  mockStorage();
  await dispatch(
    request(`v1/uploads/${r.id}/complete`, "POST", {}, a.headers),
    ["v1", "uploads", r.id, "complete"],
  );
  assert.equal(await (await collection("uploads")).countDocuments(), 0);
  assert.equal(await (await collection("files")).countDocuments(), 1);
  const retry = (await dispatch(
    request("v1/uploads", "POST", body, a.headers),
    ["v1", "uploads"],
  )) as any;
  assert.equal(retry.id, r.id);
  assert.equal(retry.completed, true);
  assert.equal(await (await collection("uploads")).countDocuments(), 0);
  const cancelled = (await dispatch(
    request(`v1/uploads/${r.id}`, "DELETE", undefined, a.headers),
    ["v1", "uploads", r.id],
  )) as any;
  assert.equal(cancelled.completed, true);
  assert.equal(await (await collection("files")).countDocuments(), 1);
});
test("cancelling failed uploads deletes staging bytes and the reservation, never another user’s upload", async () => {
  const a = await setup();
  const r = (await dispatch(
    request(
      "v1/uploads",
      "POST",
      { name: "cancel.jpg", size: 5, contentType: "image/jpeg" },
      a.headers,
    ),
    ["v1", "uploads"],
  )) as any;
  const other = await user("other-upload-owner@example.com"),
    headers = await session(other, a.workspaceId);
  await (
    await collection("memberships")
  ).insertOne({
    _id: randomUUID(),
    workspaceId: a.workspaceId,
    userId: other,
    role: "editor",
    disabledAt: null,
    createdAt: new Date(),
  });
  const denied = (await dispatch(
    request(`v1/uploads/${r.id}`, "DELETE", undefined, headers),
    ["v1", "uploads", r.id],
  )) as any;
  assert.equal(denied.completed, false);
  assert.equal(await (await collection("uploads")).countDocuments(), 1);
  s3.on(DeleteObjectCommand).resolves({});
  await dispatch(
    request(`v1/uploads/${r.id}`, "DELETE", undefined, a.headers),
    ["v1", "uploads", r.id],
  );
  assert.equal(await (await collection("uploads")).countDocuments(), 0);
  assert.equal(s3.commandCalls(DeleteObjectCommand).length, 1);
});
test("retry after a received relay upload skips retransmission and keeps one reservation", async () => {
  const a = await setup();
  const body = {
    requestId: randomUUID(),
    name: "received.jpg",
    size: 5,
    contentType: "image/jpeg",
  };
  const r = (await dispatch(request("v1/uploads", "POST", body, a.headers), [
    "v1",
    "uploads",
  ])) as any;
  consumeStoragePut();
  await dispatch(binaryRequest(r.id, a.headers, new Uint8Array(5)), [
    "v1",
    "uploads",
    r.id,
    "content",
  ]);
  const retry = (await dispatch(
    request("v1/uploads", "POST", body, a.headers),
    ["v1", "uploads"],
  )) as any;
  assert.equal(retry.id, r.id);
  assert.equal(retry.uploaded, true);
  assert.equal(await (await collection("uploads")).countDocuments(), 1);
  const doc = await (await collection("uploads")).findOne({ _id: r.id });
  assert.ok(doc!.expiresAt.getTime() - Date.now() <= 30 * 60000);
});
test("active transfers cannot be cancelled by a stale browser request", async () => {
  const a = await setup();
  const r = (await dispatch(
    request(
      "v1/uploads",
      "POST",
      { name: "active.jpg", size: 5, contentType: "image/jpeg" },
      a.headers,
    ),
    ["v1", "uploads"],
  )) as any;
  await (
    await collection("uploads")
  ).updateOne(
    { _id: r.id },
    { $set: { state: "receiving", lockUntil: new Date(Date.now() + 60000) } },
  );
  await assert.rejects(
    () =>
      dispatch(request(`v1/uploads/${r.id}`, "DELETE", undefined, a.headers), [
        "v1",
        "uploads",
        r.id,
      ]),
    status(409),
  );
  assert.equal(s3.commandCalls(DeleteObjectCommand).length, 0);
});

function multipart(
  headers: Record<string, string>,
  fields: Record<string, string> = {},
  bytes = "hello",
  count = 1,
) {
  const form = new FormData();
  for (let i = 0; i < count; i++)
    form.append("file", new Blob([bytes], { type: "image/jpeg" }), "photo.jpg");
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return new Request(`${origin}/api/v1/upload`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Length": String(Buffer.byteLength(bytes) * count + 1024),
      ...headers,
    },
    body: form,
  });
}
test("one-call upload returns only URL, name and actual size with no pending records", async () => {
  const { headers, workspaceId } = await setup();
  mockStorage();
  const response = (await dispatch(
    multipart(headers, { visibility: "public", folderPath: "website/images" }),
    ["v1", "upload"],
  )) as Response;
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ["name", "size", "url"]);
  assert.equal(result.size, 5);
  assert.equal(result.name, "photo.jpg");
  assert.match(result.url, /\/api\/v1\/content\//);
  assert.equal(await (await collection("uploads")).countDocuments(), 0);
  const file = await (await collection("files")).findOne({ workspaceId });
  assert.equal(file!.visibility, "public");
  assert.ok(file!.folderId);
  assert.equal(s3.commandCalls(DeleteObjectCommand).length, 0);
  assert.equal(s3.commandCalls(CopyObjectCommand).length, 0);
});
test("one-call upload retries reuse the result and reject changed contents", async () => {
  const { headers } = await setup();
  mockStorage();
  const fields = { requestId: randomUUID() };
  const first = await (
    (await dispatch(multipart(headers, fields), ["v1", "upload"])) as Response
  ).json();
  const replay = (await dispatch(multipart(headers, fields), [
    "v1",
    "upload",
  ])) as Response;
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), first);
  await assert.rejects(
    dispatch(multipart(headers, fields, "other"), ["v1", "upload"]),
    status(409),
  );
  assert.equal(await (await collection("files")).countDocuments(), 1);
  assert.equal(await (await collection("uploads")).countDocuments(), 0);
});
test("one-call upload validates file count, metadata and workspace folder ownership", async () => {
  const { headers } = await setup();
  mockStorage();
  await assert.rejects(
    dispatch(multipart(headers, {}, "hello", 2), ["v1", "upload"]),
    status(400),
  );
  await assert.rejects(
    dispatch(multipart(headers, { folderId: randomUUID() }), ["v1", "upload"]),
    status(404),
  );
  await assert.rejects(
    dispatch(multipart(headers, { unknown: "field" }), ["v1", "upload"]),
  );
  await assert.rejects(
    dispatch(multipart(headers, {}, "", 0), ["v1", "upload"]),
    status(400),
  );
  assert.equal(await (await collection("files")).countDocuments(), 0);
  assert.equal(await (await collection("uploads")).countDocuments(), 0);
});
test(
  "one-call upload enforces the byte limit and accepts its exact boundary",
  { timeout: 10000 },
  async () => {
    const { headers } = await setup();
    mockStorage();
    const previous = process.env.MAX_PROXY_UPLOAD_BYTES;
    process.env.MAX_PROXY_UPLOAD_BYTES = "5";
    try {
      const response = (await dispatch(multipart(headers), [
        "v1",
        "upload",
      ])) as Response;
      assert.equal(response.status, 201);
      await assert.rejects(
        dispatch(multipart(headers, {}, "toolong"), ["v1", "upload"]),
        status(413),
      );
    } finally {
      if (previous === undefined) delete process.env.MAX_PROXY_UPLOAD_BYTES;
      else process.env.MAX_PROXY_UPLOAD_BYTES = previous;
    }
  },
);
test("one-call upload rejects viewers before storing file bytes", async () => {
  const { headers } = await setup("viewer");
  mockStorage();
  await assert.rejects(
    dispatch(multipart(headers), ["v1", "upload"]),
    status(403),
  );
  assert.equal(s3.commandCalls(PutObjectCommand).length, 0);
});

test("single-call Bearer uploads respect key scope, quota and private defaults", async () => {
  const { userId, workspaceId } = await setup();
  mockStorage();
  const integration = await key(userId, workspaceId, {
    scopes: ["files:upload"],
    maxRequests: 1,
  });
  const response = (await dispatch(multipart(integration.headers), [
    "v1",
    "upload",
  ])) as Response;
  assert.equal(response.status, 201);
  const file = await (
    await collection("files")
  ).findOne({ apiKeyId: integration.id });
  assert.equal(file!.visibility, "private");
  await assert.rejects(
    dispatch(multipart(integration.headers), ["v1", "upload"]),
    status(401),
  );
  const readonly = await key(userId, workspaceId, { scopes: ["files:read"] });
  await assert.rejects(
    dispatch(multipart(readonly.headers), ["v1", "upload"]),
    status(401),
  );
});
test("single-call malformed and failed storage uploads leave no database garbage", async () => {
  const { headers } = await setup();
  mockStorage();
  s3.on(PutObjectCommand).rejects(new Error("Storage unavailable"));
  await assert.rejects(
    dispatch(multipart(headers), ["v1", "upload"]),
    status(502),
  );
  const broken = new Request(`${origin}/api/v1/upload`, {
    method: "POST",
    headers: {
      ...headers,
      Origin: origin,
      "Content-Type": "multipart/form-data; boundary=broken",
    },
    body: '--broken\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\ncut-off',
  });
  await assert.rejects(dispatch(broken, ["v1", "upload"]), status(400));
  assert.equal(await (await collection("uploads")).countDocuments(), 0);
  assert.equal(await (await collection("files")).countDocuments(), 0);
});
test("concurrent single-call retries publish one file and remove losing objects", async () => {
  const { headers } = await setup();
  mockStorage();
  const fields = { requestId: randomUUID() };
  const results = await Promise.all(
    Array.from({ length: 3 }, async () =>
      (
        (await dispatch(multipart(headers, fields), [
          "v1",
          "upload",
        ])) as Response
      ).json(),
    ),
  );
  assert.equal(new Set(results.map((r) => r.url)).size, 1);
  assert.equal(await (await collection("files")).countDocuments(), 1);
  assert.equal(await (await collection("uploads")).countDocuments(), 0);
});

test("single-call streams files across R2 multipart parts", async () => {
  const { headers } = await setup();
  mockStorage();
  const bytes = "a".repeat(6 * 1024 * 1024);
  s3.on(CreateMultipartUploadCommand).resolves({ UploadId: "test-multipart" });
  s3.on(UploadPartCommand).resolves({ ETag: '"part-etag"' });
  s3.on(CompleteMultipartUploadCommand).resolves({ ETag: '"complete-etag"' });
  s3.on(HeadObjectCommand).resolves({
    ContentLength: bytes.length,
    ContentType: "image/jpeg",
    ETag: '"stored-etag"',
  });
  const result = (await dispatch(multipart(headers, {}, bytes), [
    "v1",
    "upload",
  ])) as Response;
  assert.equal(result.status, 201);
  assert.equal((await result.json()).size, bytes.length);
  assert.equal(s3.commandCalls(UploadPartCommand).length, 2);
  assert.equal(s3.commandCalls(CompleteMultipartUploadCommand).length, 1);
  assert.equal(await (await collection("uploads")).countDocuments(), 0);
});

test("new keys can use the R2 size ceiling with disk-backed multipart uploads", async () => {
  const { headers } = await setup();
  mockStorage();
  const created = (await dispatch(
    request(
      "keys",
      "POST",
      {
        name: "Large file integration",
        scopes: ["files:upload"],
        expiresInDays: 30,
        maxRequests: null,
      },
      headers,
    ),
    ["keys"],
  )) as any;
  assert.equal(created.maxUploadBytes, null);

  const partLengths: number[] = [];
  s3.on(CreateMultipartUploadCommand).resolves({ UploadId: "disk-parts" });
  s3.on(UploadPartCommand).callsFake(async (input) => {
    let length = 0;
    for await (const chunk of input.Body as AsyncIterable<Buffer>) {
      length += chunk.length;
    }
    assert.equal(length, input.ContentLength);
    partLengths.push(length);
    return { ETag: '"disk-part"' };
  });
  s3.on(CompleteMultipartUploadCommand).resolves({ ETag: '"complete"' });
  const bytes = "a".repeat(6 * 1024 * 1024);
  s3.on(HeadObjectCommand).resolves({
    ContentLength: bytes.length,
    ContentType: "image/jpeg",
    ETag: '"complete"',
  });

  // Simulate the part planning for a large request without allocating its entire body.
  const declaredLength = 5 * 1024 * 1024 * 10_000 + 10_000;
  const response = (await dispatch(
    multipart(
      {
        Authorization: `Bearer ${created.secret}`,
        "Content-Length": String(declaredLength),
      },
      {},
      bytes,
    ),
    ["v1", "upload"],
  )) as Response;
  assert.equal(response.status, 201);
  assert.equal((await response.json()).size, bytes.length);
  assert.deepEqual(partLengths, [5 * 1024 * 1024 + 1, 1024 * 1024 - 1]);
  assert.equal(s3.commandCalls(CopyObjectCommand).length, 0);
});

test("file visibility changes keep the URL and recheck access on subsequent requests", async () => {
  const a = await setup();
  const id = randomUUID();
  const url = `${origin}/api/v1/content/${id}`;
  const objectKey = `files/${id}/photo.jpg`;
  const files = await collection("files");
  await files.insertOne({
    _id: id,
    workspaceId: a.workspaceId,
    name: "photo.jpg",
    visibility: "private",
    size: 5,
    contentType: "image/jpeg",
    status: "ready",
    folderId: null,
    objectKey,
    url,
    createdAt: new Date(),
  });
  s3.on(GetObjectCommand).callsFake(() => ({
    ContentLength: 5,
    Body: { transformToWebStream: () => new Response("hello").body! } as any,
  }));
  const patch = (visibility: string) =>
    dispatch(request(`v1/files/${id}`, "PATCH", { visibility }, a.headers), [
      "v1",
      "files",
      id,
    ]);
  const read = (headers: Record<string, string> = {}) =>
    dispatch(request(`v1/content/${id}`, "GET", undefined, headers), [
      "v1",
      "content",
      id,
    ]) as Promise<Response>;

  await assert.rejects(read(), status(401));
  assert.deepEqual(
    (({ visibility, url }) => ({ visibility, url }))(
      (await patch("public")) as any,
    ),
    { visibility: "public", url },
  );
  const published = await read();
  assert.equal(await published.text(), "hello");
  assert.match(published.headers.get("cache-control")!, /no-store/);

  const privateFile = (await patch("private")) as any;
  assert.equal(privateFile.visibility, "private");
  assert.equal(privateFile.url, url);
  await assert.rejects(read(), status(401));
  assert.equal(await (await read(a.headers)).text(), "hello");
  assert.equal((await files.findOne({ _id: id }))!.objectKey, objectKey);
  assert.equal(s3.commandCalls(CopyObjectCommand).length, 0);
});

test("visibility changes require editor access and stay within file ownership", async () => {
  const a = await setup();
  const id = randomUUID();
  const files = await collection("files");
  await files.insertOne({
    _id: id,
    workspaceId: a.workspaceId,
    apiKeyId: "original-key",
    visibility: "private",
    status: "ready",
  });
  const patch = (headers: Record<string, string>) =>
    dispatch(
      request(`v1/files/${id}`, "PATCH", { visibility: "public" }, headers),
      ["v1", "files", id],
    );
  const otherKey = await key(a.userId, a.workspaceId);
  await assert.rejects(patch(otherKey.headers), status(404));
  const otherWorkspace = await workspace(a.userId, "Other workspace");
  await assert.rejects(
    patch(await session(a.userId, otherWorkspace)),
    status(404),
  );
  await (
    await collection("memberships")
  ).updateOne(
    { workspaceId: a.workspaceId, userId: a.userId },
    { $set: { role: "viewer" } },
  );
  await assert.rejects(patch(a.headers), status(403));
  assert.equal((await files.findOne({ _id: id }))!.visibility, "private");
});
