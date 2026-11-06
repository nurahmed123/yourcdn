import { randomUUID } from "node:crypto";
import { z } from "zod";
import { collection, limit } from "./db";
import { type Principal } from "./auth";
import { ApiError, cleanName, hash } from "./security";
import { resolveFolder } from "./folders";
import { workspaceStorage } from "./workspaces";
import {
  proxyUploadLimit,
  UPLOAD_TTL_MS,
  FAILED_UPLOAD_TTL_MS,
} from "./upload-policy";
export function uploadOwner(p: Principal) {
  return {
    workspaceId: p.workspaceId,
    userId: p.userId,
    apiKeyId: p.keyId || null,
  };
}
export async function reserveUpload(p: Principal, body: unknown) {
  const maximum = Math.min(
    Number(process.env.MAX_UPLOAD_BYTES || 104857600),
    p.maxUploadBytes || Infinity,
  );
  const b = z
    .object({
      requestId: z.string().uuid().optional(),
      name: z.string().min(1).max(255),
      size: z.number().int().min(1).max(maximum),
      contentType: z
        .string()
        .regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/)
        .max(120),
      visibility: z.enum(["public", "private"]).default("private"),
      folderId: z.string().uuid().nullable().optional(),
      folderPath: z.string().max(3000).optional(),
    })
    .parse(body);
  const requestId = b.requestId || randomUUID();
  const name = cleanName(b.name);
  const fingerprint = hash(
    JSON.stringify({
      name,
      size: b.size,
      contentType: b.contentType,
      visibility: b.visibility,
      folderId: b.folderId ?? null,
      folderPath: b.folderPath ?? null,
    }),
  );
  const owner = uploadOwner(p);
  const completed = await (
    await collection("files")
  ).findOne({ ...owner, requestId, status: "ready" });
  if (completed) {
    if (completed.requestFingerprint !== fingerprint)
      throw new ApiError(
        409,
        "This upload request ID was already used for a different file.",
      );
    return { id: completed._id, completed: true };
  }
  await limit(`uploads:${p.keyId || p.userId}`, 100, 3600);
  const uploads = await collection("uploads");
  let upload = await uploads.findOne({ ...owner, requestId });
  if (!upload) {
    const storage = await workspaceStorage(p.workspaceId);
    const folderId = await resolveFolder(p, b);
    const id = randomUUID();
    const document = {
      _id: id,
      ...owner,
      requestId,
      requestFingerprint: fingerprint,
      name,
      size: b.size,
      contentType: b.contentType,
      visibility: b.visibility,
      folderId,
      stagingKey: `staging/${id}`,
      storageVersion: storage.storageVersion,
      state: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
    };
    try {
      await uploads.insertOne(document);
      upload = document;
    } catch (e: any) {
      if (e.code !== 11000) throw e;
      upload = await uploads.findOne({ ...owner, requestId });
    }
  }
  if (!upload)
    throw new ApiError(409, "Upload is being prepared. Please retry.");
  if (upload.requestFingerprint !== fingerprint)
    throw new ApiError(
      409,
      "This upload request ID was already used for a different file.",
    );
  if (upload.expiresAt <= new Date())
    throw new ApiError(
      410,
      "Upload expired. Remove the file from the queue and add it again.",
    );
  if (!["pending", "uploaded"].includes(upload.state))
    throw new ApiError(
      409,
      "This upload is already in progress. Try again shortly.",
    );
  const lease = await uploads.updateOne(
    {
      _id: upload._id,
      ...owner,
      state: { $in: ["pending", "uploaded"] },
      expiresAt: { $gt: new Date() },
    },
    {
      $set: {
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
      },
    },
  );
  if (!lease.matchedCount)
    throw new ApiError(409, "Upload is already in progress.");
  const storage = await workspaceStorage(
    p.workspaceId,
    upload.storageVersion || 1,
  );
  return {
    id: upload._id,
    completed: false,
    uploaded: upload.state === "uploaded",
    uploadUrl: await storage.uploadUrl(
      upload.stagingKey,
      upload.contentType,
      upload.size,
    ),
    proxyUploadUrl:
      upload.size <= proxyUploadLimit()
        ? `/api/v1/uploads/${upload._id}/content`
        : null,
    method: "PUT",
    expiresIn: 300,
    headers: { "Content-Type": upload.contentType },
  };
}
export async function cancelUpload(p: Principal, id: string) {
  z.string().uuid().parse(id);
  const owner = uploadOwner(p);
  const completed = await (
    await collection("files")
  ).findOne({ _id: id, ...owner, status: "ready" });
  if (completed) return { success: true, completed: true };
  const uploads = await collection("uploads");
  const now = new Date();
  const upload = await uploads.findOneAndUpdate(
    {
      _id: id,
      ...owner,
      $or: [
        { state: { $in: ["pending", "uploaded", "failed"] } },
        {
          state: { $in: ["receiving", "finalizing", "cancelling"] },
          lockUntil: { $lt: now },
        },
      ],
    },
    {
      $set: {
        state: "cancelling",
        lockUntil: new Date(Date.now() + 60000),
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!upload) {
    if (await uploads.findOne({ _id: id, ...owner }))
      throw new ApiError(
        409,
        "Upload is still active. Try again after it finishes.",
      );
    return { success: true, completed: false };
  }
  try {
    const storage = await workspaceStorage(
      p.workspaceId,
      upload.storageVersion || 1,
    );
    await storage.remove(upload.stagingKey);
    await uploads.deleteOne({ _id: id, ...owner, state: "cancelling" });
    return { success: true, completed: false };
  } catch {
    await uploads.updateOne(
      { _id: id, ...owner, state: "cancelling" },
      {
        $set: {
          state: "failed",
          expiresAt: new Date(Date.now() + FAILED_UPLOAD_TTL_MS),
        },
        $unset: { lockUntil: 1 },
      },
    );
    throw new ApiError(
      502,
      "Temporary storage cleanup will be retried. Please try again.",
    );
  }
}
