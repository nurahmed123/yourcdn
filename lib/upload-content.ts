import {
  UPLOAD_TTL_MS,
  FAILED_UPLOAD_TTL_MS,
  proxyUploadLimit,
} from "./upload-policy";
import { Readable } from "node:stream";
import { z } from "zod";
import { authenticate } from "./auth";
import { collection } from "./db";
import { ApiError } from "./security";
import { workspaceStorage } from "./workspaces";
export async function uploadContent(req: Request, id: string) {
  const p = await authenticate(req, "files:upload");
  z.string().uuid().parse(id);
  const uploads = await collection("uploads");
  const filter = {
    _id: id,
    workspaceId: p.workspaceId,
    userId: p.userId,
    apiKeyId: p.keyId || null,
  };
  const existing = await uploads.findOne(filter);
  if (!existing || existing.expiresAt <= new Date())
    throw new ApiError(404, "Upload not found or expired.");
  if (existing.size > proxyUploadLimit())
    throw new ApiError(
      413,
      "This file requires a direct R2 upload. Configure bucket CORS for your application origin.",
    );
  if (req.headers.get("content-type") !== existing.contentType)
    throw new ApiError(400, "File type does not match the upload reservation.");
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) !== existing.size)
    throw new ApiError(400, "File size does not match the upload reservation.");
  if (!req.body) throw new ApiError(400, "File bytes are required.");
  const lock = new Date(Date.now() + 15 * 60000);
  const upload = await uploads.findOneAndUpdate(
    {
      ...filter,
      $or: [
        { state: "pending" },
        { state: "receiving", lockUntil: { $lt: new Date() } },
      ],
    },
    {
      $set: {
        state: "receiving",
        lockUntil: lock,
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
      },
    },
    { returnDocument: "after" },
  );
  if (!upload)
    throw new ApiError(409, "This upload is already in progress or completed.");
  const storage = await workspaceStorage(
    p.workspaceId,
    upload.storageVersion || 1,
  );
  let received = 0;
  async function* chunks() {
    const reader = req.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > upload!.size)
          throw new ApiError(413, "File exceeds its reserved size.");
        yield value;
      }
      if (received !== upload!.size)
        throw new ApiError(400, "Upload ended before all bytes arrived.");
    } finally {
      reader.releaseLock();
    }
  }
  try {
    await storage.put(
      upload.stagingKey,
      upload.contentType,
      upload.size,
      Readable.from(chunks()),
      req.signal,
    );
    if (received !== upload.size)
      throw new ApiError(400, "Upload was incomplete.");
    await uploads.updateOne(
      { ...filter, state: "receiving", lockUntil: lock },
      {
        $set: {
          state: "uploaded",
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
        },
        $unset: { lockUntil: 1 },
      },
    );
    return { success: true, bytes: received };
  } catch (error) {
    await storage.remove(upload.stagingKey).catch(() => {});
    await uploads.updateOne(
      { ...filter, state: "receiving", lockUntil: lock },
      {
        $set: {
          state: "pending",
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + FAILED_UPLOAD_TTL_MS),
        },
        $unset: { lockUntil: 1 },
      },
    );
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      "Storage could not receive the file. Please retry the upload.",
    );
  }
}
