import { createReadStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  UploadPartCommand,
  type CompletedPart,
  type PutObjectCommandInput,
  type S3Client,
} from "@aws-sdk/client-s3";

// R2 requires equal-sized non-final parts. Spill large parts to one reusable
// temporary file so the maximum object size does not require huge RAM buffers.
export async function spoolUpload(
  client: S3Client,
  params: Omit<PutObjectCommandInput, "Body" | "ContentLength">,
  body: Readable,
  partSize: number,
  signal: AbortSignal,
) {
  const dir = await mkdtemp(join(tmpdir(), "yourcdn-r2-"));
  const path = join(dir, "part");
  const { Bucket, Key } = params;
  const object = { Bucket, Key };
  const options = { abortSignal: signal };
  let uploadId: string | undefined;
  let completed = false;
  const parts: CompletedPart[] = [];
  let size = 0;
  const sendPart = async (final: boolean) => {
    signal.throwIfAborted();
    const stream = createReadStream(path, { start: 0, end: size - 1 });
    try {
      if (!uploadId && final) {
        await client.send(
          new PutObjectCommand({
            ...params,
            Body: stream,
            ContentLength: size,
          }),
          options,
        );
        return;
      }
      if (!uploadId) {
        const result = await client.send(
          new CreateMultipartUploadCommand(params),
          options,
        );
        uploadId = result.UploadId;
        if (!uploadId) throw new Error("Missing multipart upload ID.");
      }
      const part = parts.length + 1;
      const result = await client.send(
        new UploadPartCommand({
          ...object,
          UploadId: uploadId,
          PartNumber: part,
          ContentLength: size,
          Body: stream,
        }),
        options,
      );
      if (!result.ETag) throw new Error("Missing multipart ETag.");
      parts.push({ ETag: result.ETag, PartNumber: part });
    } finally {
      stream.destroy();
    }
  };
  try {
    const fd = await open(path, "wx+", 0o600);
    try {
      for await (const value of body) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        let offset = 0;
        while (offset < chunk.length) {
          signal.throwIfAborted();
          const length = Math.min(chunk.length - offset, partSize - size);
          const { bytesWritten } = await fd.write(chunk, offset, length, size);
          if (!bytesWritten) throw new Error("Could not spool upload part.");
          offset += bytesWritten;
          size += bytesWritten;
          if (size === partSize) {
            await sendPart(false);
            await fd.truncate(0);
            size = 0;
          }
        }
      }
      if (size) await sendPart(true);
      if (uploadId) {
        await client.send(
          new CompleteMultipartUploadCommand({
            ...object,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts },
          }),
          options,
        );
      }
      completed = true;
    } finally {
      await fd.close();
    }
  } finally {
    if (uploadId && !completed) {
      await client
        .send(
          new AbortMultipartUploadCommand({ ...object, UploadId: uploadId }),
        )
        .catch(() => undefined);
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
