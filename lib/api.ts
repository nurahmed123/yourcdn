import { singleUpload } from "./single-upload";
import { reserveUpload, cancelUpload } from "./uploads";
import { UPLOAD_TTL_MS, FAILED_UPLOAD_TTL_MS } from "./upload-policy";
import { uploadContent } from "./upload-content";
import {
  storageDetails,
  beginStorageChange,
  finishStorageChange,
} from "./storage-settings";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { collection, event, limit } from "./db";
import {
  identity,
  profile,
  beginPasswordChange,
  finishPasswordChange,
  authenticate,
  admin,
  beginAuth,
  verify,
  logout,
  type Principal,
} from "./auth";
import {
  keyExpiryFilter,
  ApiError,
  assertOrigin,
  required,
  token,
  hash,
  scopes,
  cleanName,
  fileFilter,
  canWrite,
} from "./security";
import {
  me,
  listWorkspaces,
  createWorkspace,
  switchWorkspace,
  configureStorage,
  workspaceStorage,
  inviteMember,
  acceptInvitation,
} from "./workspaces";
import {
  createFolder,
  listFolders,
  renameFolder,
  deleteFolder,
  resolveFolder,
  folderFor,
} from "./folders";
import { sendMail } from "./mail";
const idSchema = z.string().uuid();
async function json(req: Request) {
  if (!req.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "Use application/json.");
  if (Number(req.headers.get("content-length") || 0) > 16384)
    throw new ApiError(413, "Request body is too large.");
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "Request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new ApiError(413, "Request body is too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new ApiError(400, "Invalid JSON body.");
  }
}
function publicKey(k: any) {
  return {
    id: k._id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    expiresAt: k.expiresAt,
    requests: k.requests,
    maxRequests: k.maxRequests,
    maxUploadBytes: k.maxUploadBytes,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
    createdAt: k.createdAt,
  };
}
function publicFile(f: any) {
  return {
    id: f._id,
    name: f.name,
    size: f.size,
    contentType: f.contentType,
    visibility: f.visibility,
    url: f.url,
    createdAt: f.createdAt,
    source: f.apiKeyId ? "API" : "Dashboard",
    folderId: f.folderId || null,
  };
}
async function fileFor(id: string, p: Principal) {
  idSchema.parse(id);
  const file = await (
    await collection("files")
  ).findOne({ _id: id, status: "ready", ...fileFilter(p) });
  if (!file) throw new ApiError(404, "File not found.");
  return file;
}
export async function dispatch(req: Request, path: string[]) {
  const route = path.join("/");
  const method = req.method;
  const url = new URL(req.url);
  if (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    (!req.headers.has("authorization") || path[0] !== "v1")
  )
    assertOrigin(req);
  if (method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: { Allow: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
    });
  if (route === "status" && method === "GET") return { signupAvailable: true };
  if (["auth/login", "auth/signup"].includes(route) && method === "POST")
    return beginAuth(path[1], await json(req));
  if (route === "auth/verify" && method === "POST")
    return verify(await json(req));
  if (route === "auth/logout" && method === "POST") {
    await identity(req);
    return logout();
  }
  if (route === "auth/invite" && method === "GET") {
    await limit("invite-lookup", 100, 60);
    const invitation = await (
      await collection("invitations")
    ).findOne({
      tokenHash: hash(
        z.string().min(32).max(128).parse(url.searchParams.get("token")),
      ),
      used: false,
      expiresAt: { $gt: new Date() },
    });
    if (!invitation)
      throw new ApiError(404, "Invitation is unavailable or expired.");
    const workspace = await (
      await collection("workspaces")
    ).findOne({ _id: invitation.workspaceId, status: "ready" });
    if (!workspace) throw new ApiError(404, "Workspace is unavailable.");
    return { email: invitation.email, workspaceName: workspace.name };
  }
  if (route === "me" && method === "GET") return me(req);
  if (route === "profile" && method === "PATCH")
    return profile(req, await json(req));
  if (route === "profile/password" && method === "POST")
    return beginPasswordChange(req, await json(req));
  if (route === "profile/password/verify" && method === "POST")
    return finishPasswordChange(req, await json(req));
  if (route === "workspaces" && method === "GET")
    return listWorkspaces(await identity(req));
  if (route === "workspaces" && method === "POST")
    return createWorkspace(req, await json(req));
  if (
    path[0] === "workspaces" &&
    path.length === 3 &&
    path[2] === "switch" &&
    method === "POST"
  )
    return switchWorkspace(req, path[1]);
  if (
    path[0] === "workspaces" &&
    path.length === 3 &&
    path[2] === "storage" &&
    method === "POST"
  )
    return configureStorage(req, path[1], await json(req));
  if (
    path[0] === "workspaces" &&
    path.length === 3 &&
    path[2] === "storage" &&
    method === "GET"
  )
    return storageDetails(req, path[1]);
  if (
    path[0] === "workspaces" &&
    path.length === 4 &&
    path[2] === "storage" &&
    path[3] === "change" &&
    method === "POST"
  )
    return beginStorageChange(req, path[1], await json(req));
  if (
    path[0] === "workspaces" &&
    path.length === 4 &&
    path[2] === "storage" &&
    path[3] === "verify" &&
    method === "POST"
  )
    return finishStorageChange(req, path[1], await json(req));
  if (
    path[0] === "v1" &&
    path[1] === "uploads" &&
    path.length === 4 &&
    path[3] === "content" &&
    method === "PUT"
  )
    return uploadContent(req, path[2]);
  if (route === "invitations/accept" && method === "POST")
    return acceptInvitation(req, await json(req));
  if (path[0] === "v1" && path[1] === "content" && method === "GET") {
    if (path.length !== 3) throw new ApiError(404, "Endpoint not found.");
    const id = idSchema.parse(path[2]);
    const file = await (
      await collection("files")
    ).findOne({ _id: id, status: "ready" });
    if (!file) throw new ApiError(404, "File not found.");
    if (file.visibility !== "public") {
      const principal = await authenticate(req, "files:read");
      if (
        principal.workspaceId !== file.workspaceId ||
        (principal.keyId && file.apiKeyId !== principal.keyId)
      )
        throw new ApiError(404, "File not found.");
    }
    const range = req.headers.get("range") || undefined;
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))
      throw new ApiError(416, "Unsupported range.");
    const storage = await workspaceStorage(
      file.workspaceId,
      file.storageVersion || 1,
    );
    const object = await storage.read(file.objectKey, range);
    const headers: Record<string, string> = {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Content-Length": String(object.ContentLength || 0),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control":
        file.visibility === "public"
          ? "public, max-age=60, s-maxage=60"
          : "private, no-store",
      "Accept-Ranges": "bytes",
    };
    if (object.ContentRange) headers["Content-Range"] = object.ContentRange;
    return new Response(object.Body!.transformToWebStream(), {
      status: range ? 206 : 200,
      headers,
    });
  }
  if (route === "stats" && method === "GET") {
    const p = await authenticate(req, undefined, true);
    const files = await collection("files");
    const [totals, types, recent, keys, team] = await Promise.all([
      files
        .aggregate([
          { $match: { status: "ready", workspaceId: p.workspaceId } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              bytes: { $sum: "$size" },
              public: {
                $sum: { $cond: [{ $eq: ["$visibility", "public"] }, 1, 0] },
              },
            },
          },
        ])
        .toArray(),
      files
        .aggregate([
          { $match: { status: "ready", workspaceId: p.workspaceId } },
          {
            $group: {
              _id: { $arrayElemAt: [{ $split: ["$contentType", "/"] }, 0] },
              bytes: { $sum: "$size" },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      files
        .aggregate([
          {
            $match: {
              status: "ready",
              workspaceId: p.workspaceId,
              createdAt: { $gte: new Date(Date.now() - 7 * 86400000) },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
              },
              count: { $sum: 1 },
              bytes: { $sum: "$size" },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      (await collection("apiKeys")).countDocuments({
        revokedAt: null,
        workspaceId: p.workspaceId,
        ...keyExpiryFilter(),
      }),
      (await collection("memberships")).countDocuments({
        workspaceId: p.workspaceId,
        disabledAt: null,
      }),
    ]);
    return {
      totals: totals[0] || { count: 0, bytes: 0, public: 0 },
      types,
      recent,
      keys,
      team,
    };
  }
  if (route === "activity" && method === "GET") {
    const p = await authenticate(req, undefined, true);
    return await (
      await collection("events")
    )
      .find(
        { workspaceId: p.workspaceId },
        { projection: { _id: 0, workspaceId: 0 } },
      )
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray();
  }
  if (path[0] === "keys") {
    const p = await authenticate(req, undefined, true);
    const c = await collection("apiKeys");
    if (method === "GET" && path.length === 1)
      return (
        await c
          .find({ userId: p.userId, workspaceId: p.workspaceId })
          .sort({ createdAt: -1 })
          .toArray()
      ).map(publicKey);
    if (method === "POST" && path.length === 1) {
      if (!canWrite(p.role))
        throw new ApiError(
          403,
          "Editor access is required to create API keys.",
        );
      await limit(`create-key:${p.userId}`, 20, 3600);
      const b = z
        .object({
          name: z.string().trim().min(1).max(80),
          scopes: z.array(z.enum(scopes)).min(1).max(3),
          expiresInDays: z.number().int().min(1).max(365).nullable(),
          maxRequests: z.number().int().min(1).max(10000000),
          maxUploadBytes: z
            .number()
            .int()
            .min(1)
            .max(Number(process.env.MAX_UPLOAD_BYTES || 104857600)),
        })
        .parse(await json(req));
      const secret = `acdn_${token()}`;
      const key = {
        _id: randomUUID(),
        ...b,
        userId: p.userId,
        workspaceId: p.workspaceId,
        tokenHash: hash(secret),
        prefix: secret.slice(0, 13),
        expiresAt:
          b.expiresInDays === null
            ? null
            : new Date(Date.now() + b.expiresInDays * 86400000),
        requests: 0,
        revokedAt: null,
        createdAt: new Date(),
      };
      await c.insertOne(key);
      await event(p.email, "Created API key", b.name, p.workspaceId);
      return { ...publicKey(key), secret };
    }
    if (method === "DELETE" && path.length === 2) {
      idSchema.parse(path[1]);
      const key = await c.findOneAndUpdate(
        {
          _id: path[1],
          userId: p.userId,
          workspaceId: p.workspaceId,
          revokedAt: null,
        },
        { $set: { revokedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (!key) throw new ApiError(404, "API key not found.");
      await event(p.email, "Revoked API key", key.name, p.workspaceId);
      return { success: true };
    }
  }
  if (path[0] === "team") {
    const p = await authenticate(req, undefined, true);
    admin(p);
    if (method === "GET" && path.length === 1) {
      const memberships = await (
        await collection("memberships")
      )
        .find({ workspaceId: p.workspaceId })
        .sort({ createdAt: 1 })
        .toArray();
      const users = await (
        await collection("users")
      )
        .find(
          { _id: { $in: memberships.map((m) => m.userId) } },
          { projection: { email: 1, name: 1 } },
        )
        .toArray();
      const pending = await (
        await collection("invitations")
      )
        .find(
          {
            workspaceId: p.workspaceId,
            used: false,
            expiresAt: { $gt: new Date() },
          },
          { projection: { email: 1, role: 1, expiresAt: 1 } },
        )
        .toArray();
      return {
        members: memberships.map((m) => ({
          id: m.userId,
          email:
            users.find((u) => u._id === m.userId)?.email ||
            "Unavailable account",
          name: users.find((u) => u._id === m.userId)?.name,
          role: m.role,
          disabledAt: m.disabledAt,
        })),
        pending: pending.map((i) => ({
          id: i._id,
          email: i.email,
          role: i.role,
          expiresAt: i.expiresAt,
        })),
      };
    }
    if (method === "POST" && path.length === 1)
      return inviteMember(p, await json(req));
    if (method === "DELETE" && path.length === 2) {
      const member = await (
        await collection("memberships")
      ).findOne({
        workspaceId: p.workspaceId,
        userId: path[1],
        disabledAt: null,
      });
      if (!member) throw new ApiError(404, "Member not found.");
      if (member.role === "owner" || member.userId === p.userId)
        throw new ApiError(
          403,
          "The owner and your own membership cannot be removed.",
        );
      if (member.role === "admin" && p.role !== "owner")
        throw new ApiError(403, "Only the owner can remove administrators.");
      const removed = await (
        await collection("memberships")
      ).updateOne(
        {
          _id: member._id,
          workspaceId: p.workspaceId,
          disabledAt: null,
          role: member.role,
        },
        { $set: { disabledAt: new Date() } },
      );
      if (!removed.modifiedCount)
        throw new ApiError(409, "Membership changed. Refresh and try again.");
      await (
        await collection("apiKeys")
      ).updateMany(
        { workspaceId: p.workspaceId, userId: member.userId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      await (
        await collection("invitations")
      ).updateMany(
        { workspaceId: p.workspaceId, createdBy: member.userId, used: false },
        { $set: { used: true } },
      );
      await event(p.email, "Removed workspace member", path[1], p.workspaceId);
      return { success: true };
    }
  }
  if (path[0] === "v1" && path[1] === "folders") {
    const p = await authenticate(
      req,
      method === "GET"
        ? "files:read"
        : method === "DELETE"
          ? "files:delete"
          : "files:upload",
    );
    if (path.length === 2 && method === "GET")
      return listFolders(p, url.searchParams.get("parentId"));
    if (path.length === 2 && method === "POST")
      return createFolder(p, await json(req));
    if (path.length === 3 && method === "PATCH")
      return renameFolder(p, idSchema.parse(path[2]), await json(req));
    if (path.length === 3 && method === "DELETE")
      return deleteFolder(p, idSchema.parse(path[2]));
  }
  if (route === "v1/files" && method === "GET") {
    const p = await authenticate(req, "files:read");
    const q = (url.searchParams.get("q") || "").slice(0, 100);
    const type = url.searchParams.get("type");
    const filter: any = { status: "ready", ...fileFilter(p) };
    const folderId = url.searchParams.get("folderId");
    await folderFor(folderId, p);
    filter.folderId = folderId;
    if (q)
      filter.name = {
        $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    if (
      type &&
      ["image", "video", "audio", "application", "text"].includes(type)
    )
      filter.contentType = { $regex: `^${type}/` };
    const cursor = url.searchParams.get("cursor");
    if (cursor) {
      if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))
        throw new ApiError(400, "Invalid file cursor.");
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
      } catch {
        throw new ApiError(400, "Invalid file cursor.");
      }
      const parsed = z
        .object({ date: z.string().datetime(), id: z.string().uuid() })
        .parse(decoded);
      filter.$or = [
        { createdAt: { $lt: new Date(parsed.date) } },
        { createdAt: new Date(parsed.date), _id: { $lt: parsed.id } },
      ];
    }
    const rows = await (
      await collection("files")
    )
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(51)
      .toArray();
    const hasMore = rows.length > 50;
    const page = rows.slice(0, 50);
    const last = page.at(-1);
    return {
      files: page.map(publicFile),
      nextCursor: hasMore
        ? Buffer.from(
            JSON.stringify({
              date: last!.createdAt.toISOString(),
              id: last!._id,
            }),
          ).toString("base64url")
        : null,
    };
  }
  if (route === "v1/upload" && method === "POST") return singleUpload(req);
  if (route === "v1/uploads" && method === "POST")
    return reserveUpload(
      await authenticate(req, "files:upload"),
      await json(req),
    );
  if (
    path[0] === "v1" &&
    path[1] === "uploads" &&
    path.length === 3 &&
    method === "DELETE"
  )
    return cancelUpload(await authenticate(req, "files:upload"), path[2]);
  if (
    path[0] === "v1" &&
    path[1] === "uploads" &&
    path[3] === "complete" &&
    path.length === 4 &&
    method === "POST"
  ) {
    const p = await authenticate(req, "files:upload");
    const id = idSchema.parse(path[2]);
    const uploads = await collection("uploads");
    const ownership = {
      _id: id,
      userId: p.userId,
      workspaceId: p.workspaceId,
      apiKeyId: p.keyId || null,
      expiresAt: { $gt: new Date() },
    };
    const existing = await (
      await collection("files")
    ).findOne({
      _id: id,
      userId: p.userId,
      workspaceId: p.workspaceId,
      apiKeyId: p.keyId || null,
      status: "ready",
    });
    if (existing) return publicFile(existing);
    const upload = await uploads.findOneAndUpdate(
      {
        ...ownership,
        $or: [
          { state: { $in: ["pending", "uploaded"] } },
          { state: "finalizing", lockUntil: { $lt: new Date() } },
        ],
      },
      {
        $set: {
          state: "finalizing",
          lockUntil: new Date(Date.now() + 60000),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
        },
      },
      { returnDocument: "after" },
    );
    if (!upload)
      throw new ApiError(
        409,
        "Upload is unavailable or being finalized. Try again shortly.",
      );
    const storage = await workspaceStorage(
      p.workspaceId,
      upload.storageVersion || 1,
    );
    try {
      const object = await storage.head(upload.stagingKey);
      if (
        object.ContentLength !== upload.size ||
        object.ContentType !== upload.contentType
      )
        throw new ApiError(
          400,
          "Uploaded file does not match the declared size or content type.",
        );
      const finalKey = `files/${id}/${randomUUID()}/${upload.name}`;
      await storage.promote(
        upload.stagingKey,
        finalKey,
        upload.name,
        upload.contentType,
        object.ETag!,
      );
      const copied = await storage.head(finalKey);
      if (
        copied.ContentLength !== upload.size ||
        copied.ContentType !== upload.contentType
      ) {
        await storage.remove(finalKey);
        throw new ApiError(
          400,
          "File changed during verification. Please upload again.",
        );
      }
      const file = {
        _id: id,
        requestId: upload.requestId,
        requestFingerprint: upload.requestFingerprint,
        userId: p.userId,
        workspaceId: p.workspaceId,
        apiKeyId: p.keyId || null,
        folderId: upload.folderId || null,
        storageVersion: upload.storageVersion || 1,
        name: upload.name,
        size: upload.size,
        contentType: upload.contentType,
        visibility: upload.visibility,
        objectKey: finalKey,
        url: `${required("APP_URL").replace(/\/$/, "")}/api/v1/content/${id}`,
        status: "ready",
        createdAt: new Date(),
      };
      await (
        await collection("files")
      ).updateOne({ _id: id }, { $setOnInsert: file }, { upsert: true });
      const saved = await (
        await collection("files")
      ).findOne({ _id: id, status: "ready" });
      if (saved!.objectKey !== finalKey)
        await storage.remove(finalKey).catch(() => undefined);
      await uploads.deleteOne({ _id: id });
      await storage.remove(upload.stagingKey).catch(() => undefined);
      await event(p.email, "Uploaded file", file.name, p.workspaceId);
      return publicFile(saved);
    } catch (e) {
      await uploads.updateOne(
        { _id: id, state: "finalizing" },
        {
          $set: {
            state: "pending",
            updatedAt: new Date(),
            expiresAt: new Date(Date.now() + FAILED_UPLOAD_TTL_MS),
          },
          $unset: { lockUntil: 1 },
        },
      );
      throw e;
    }
  }
  if (path[0] === "v1" && path[1] === "files" && path.length >= 3) {
    const p = await authenticate(
      req,
      method === "DELETE"
        ? "files:delete"
        : method === "PATCH"
          ? "files:upload"
          : "files:read",
    );
    if (method === "DELETE" && path.length === 3) {
      idSchema.parse(path[2]);
      const files = await collection("files");
      const now = new Date();
      const deleteLock = randomUUID();
      const file = await files.findOneAndUpdate(
        {
          _id: path[2],
          ...fileFilter(p),
          $or: [
            { status: "ready" },
            { status: "deleting", deleteLockUntil: { $lt: now } },
          ],
        },
        {
          $set: {
            status: "deleting",
            deleteLock,
            deleteLockUntil: new Date(now.getTime() + 60000),
          },
        },
        { returnDocument: "after" },
      );
      if (!file)
        throw new ApiError(404, "File not found or deletion is in progress.");
      try {
        const storage = await workspaceStorage(
          p.workspaceId,
          file.storageVersion || 1,
        );
        await storage.remove(file.objectKey);
      } catch (error) {
        await files.updateOne(
          { _id: file._id, status: "deleting", deleteLock },
          { $set: { deleteLockUntil: new Date(0) } },
        );
        throw error;
      }
      const deleted = await files.deleteOne({
        _id: file._id,
        status: "deleting",
        deleteLock,
      });
      if (!deleted.deletedCount)
        throw new ApiError(409, "File deletion changed. Try again.");
      await event(p.email, "Deleted file", file.name, p.workspaceId).catch(
        () => undefined,
      );
      return { success: true };
    }
    const file = await fileFor(path[2], p);
    const storage = await workspaceStorage(
      p.workspaceId,
      file.storageVersion || 1,
    );
    if (method === "PATCH" && path.length === 3) {
      const b = z
        .object({ folderId: z.string().uuid().nullable() })
        .parse(await json(req));
      await folderFor(b.folderId, p);
      await (
        await collection("files")
      ).updateOne(
        { _id: file._id, workspaceId: p.workspaceId },
        { $set: { folderId: b.folderId } },
      );
      await event(p.email, "Moved file", file.name, p.workspaceId);
      return { ...publicFile(file), folderId: b.folderId };
    }
    if (method === "GET" && path[3] === "download" && path.length === 4)
      return new Response(null, {
        status: 302,
        headers: {
          Location: await storage.downloadUrl(file.objectKey),
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
  }
  throw new ApiError(404, "Endpoint not found.");
}
