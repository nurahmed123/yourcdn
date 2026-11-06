import Busboy from "busboy";
import { Readable } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticate } from "./auth";
import { collection, event, limit } from "./db";
import { ApiError, cleanName, hash, required } from "./security";
import { workspaceStorage } from "./workspaces";
import { resolveFolder } from "./folders";
import { uploadOwner } from "./uploads";
import {
  R2_MAX_PARTS,
  R2_MIN_PART_BYTES,
  singleUploadLimit,
} from "./upload-policy";

const fieldsSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    visibility: z.enum(["private", "public"]).default("private"),
    folderId: z.string().uuid().optional(),
    folderPath: z.string().max(3000).optional(),
  })
  .strict();

export async function singleUpload(req: Request) {
  const p = await authenticate(req, "files:upload");
  await limit(`uploads:${p.keyId || p.userId}`, 100, 3600);
  const maximum = Math.min(singleUploadLimit(), p.maxUploadBytes ?? Infinity);
  if (
    !req.body ||
    !req.headers.get("content-type")?.startsWith("multipart/form-data")
  )
    throw new ApiError(415, "Send multipart/form-data with one file field.");
  const requestLength = Number(req.headers.get("content-length"));
  if (requestLength > maximum + 65536)
    throw new ApiError(413, "File exceeds the upload size limit.");
  const upperBound =
    requestLength > 0 ? Math.min(maximum, requestLength) : maximum;
  const partSize = Math.max(
    R2_MIN_PART_BYTES,
    Math.ceil(upperBound / R2_MAX_PARTS),
  );
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: Object.fromEntries(req.headers),
      defParamCharset: "utf8",
      limits: {
        files: 1,
        fields: 4,
        parts: 5,
        fieldSize: 3000,
        fieldNameSize: 50,
        fileSize: maximum + 1,
      },
    });
  } catch {
    throw new ApiError(400, "Invalid multipart boundary.");
  }
  const storage = await workspaceStorage(p.workspaceId);
  const id = randomUUID();
  let finalKey: string | undefined;
  let committed = false;
  let size = 0,
    name = "",
    contentType = "";
  let failure: unknown;
  let task: Promise<unknown> | undefined;
  const fields: Record<string, string> = Object.create(null);
  const digest = createHash("sha256");
  const source = Readable.fromWeb(req.body as any);
  const abort = () => source.destroy(new ApiError(400, "Upload cancelled."));
  req.signal.addEventListener("abort", abort, { once: true });
  parser.on("field", (field, value, info) => {
    if (
      Object.hasOwn(fields, field) ||
      info.nameTruncated ||
      info.valueTruncated
    )
      failure = new ApiError(400, "Invalid or duplicate upload field.");
    fields[field] = value;
  });
  for (const eventName of ["filesLimit", "fieldsLimit", "partsLimit"] as const)
    parser.on(eventName, () => {
      failure = new ApiError(
        400,
        "Send one file and at most four upload options.",
      );
    });
  parser.on("file", (field, stream, info) => {
    // A malformed request can end while the disk-backed uploader is opening its spool.
    stream.on("error", () => undefined);
    if (field !== "file" || task) {
      failure = new ApiError(400, "Use exactly one file field named file.");
      stream.resume();
      return;
    }
    name = cleanName(info.filename || "file");
    contentType = info.mimeType;
    finalKey = `files/${id}/${randomUUID()}/${name}`;
    stream.on("limit", () => {
      failure = new ApiError(413, "File exceeds the upload size limit.");
      source.destroy(failure as Error);
    });
    const body = Readable.from(
      (async function* () {
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > maximum) {
            const error = new ApiError(
              413,
              "File exceeds the upload size limit.",
            );
            source.destroy(error);
            throw error;
          }
          digest.update(chunk);
          yield chunk;
        }
      })(),
    );
    task = storage
      .putStream(finalKey, contentType, body, req.signal, name, partSize)
      .catch((error) => {
        failure ||=
          error instanceof ApiError
            ? error
            : new ApiError(502, "Storage upload failed. Please retry.");
        source.destroy(failure as Error);
        body.destroy();
        stream.resume();
      });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      source.on("error", (error) => {
        parser.destroy(error);
      });
      parser.on("error", (error) =>
        reject(
          error instanceof ApiError
            ? error
            : new ApiError(400, "Upload body was interrupted or malformed."),
        ),
      );
      parser.on("close", resolve);
      source.pipe(parser);
      if (req.signal.aborted) abort();
    });
    await task;
    if (failure) throw failure;
    if (!task || !size || !finalKey)
      throw new ApiError(400, "Choose a non-empty file.");
    const b = fieldsSchema.parse(fields);
    const headerId = req.headers.get("idempotency-key");
    if (headerId && b.requestId && headerId !== b.requestId)
      throw new ApiError(400, "Conflicting upload request IDs.");
    const requestId = z
      .string()
      .uuid()
      .parse(headerId || b.requestId || randomUUID());
    const fingerprint = hash(
      JSON.stringify({
        name,
        size,
        contentType,
        ...b,
        requestId: undefined,
        digest: digest.digest("hex"),
      }),
    );
    const owner = uploadOwner(p);
    const files = await collection("files");
    const response = (file: any, status: number) => {
      if (file.requestFingerprint !== fingerprint)
        throw new ApiError(
          409,
          "This request ID was already used for a different file.",
        );
      return Response.json(
        { url: file.url, name: file.name, size: file.size },
        { status, headers: { "Cache-Control": "private, no-store" } },
      );
    };
    const existing = await files.findOne({
      ...owner,
      requestId,
      status: "ready",
    });
    if (existing) return response(existing, 200);
    const folderId = await resolveFolder(p, b);
    const object = await storage.head(finalKey);
    if (
      object.ContentLength !== size ||
      object.ContentType !== contentType ||
      !object.ETag
    )
      throw new ApiError(400, "Stored file verification failed. Please retry.");
    const file = {
      _id: id,
      ...owner,
      requestId,
      requestFingerprint: fingerprint,
      folderId,
      storageVersion: storage.storageVersion,
      name,
      size,
      contentType,
      visibility: b.visibility,
      objectKey: finalKey,
      url: `${required("APP_URL").replace(/\/$/, "")}/api/v1/content/${id}`,
      status: "ready",
      createdAt: new Date(),
    };
    try {
      await files.insertOne(file);
      committed = true;
    } catch (error: any) {
      if (error.code !== 11000) throw error;
      const winner = await files.findOne({
        ...owner,
        requestId,
        status: "ready",
      });
      if (!winner) throw error;
      return response(winner, 200);
    }
    await event(p.email, "Uploaded file", name, p.workspaceId).catch(
      () => undefined,
    );
    return response(file, 201);
  } finally {
    req.signal.removeEventListener("abort", abort);
    source.unpipe(parser);
    source.destroy();
    parser.destroy();
    await task;
    if (finalKey && !committed)
      await storage.remove(finalKey).catch(() => undefined);
  }
}
