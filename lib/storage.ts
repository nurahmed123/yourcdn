import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type R2Credentials } from "./credentials";
export function client(credentials: R2Credentials) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 2,
  });
}
export function storageFor(c: R2Credentials) {
  const s3 = client(c);
  return {
    async putStream(
      key: string,
      type: string,
      body: Readable,
      signal: AbortSignal,
    ) {
      const upload = new Upload({
        client: s3,
        params: { Bucket: c.bucket, Key: key, Body: body, ContentType: type },
        queueSize: 2,
        partSize: 5 * 1024 * 1024,
        leavePartsOnError: false,
      });
      const abort = () => {
        void upload.abort();
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        if (signal.aborted) throw new Error("Upload cancelled.");
        return await upload.done();
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
    put: (
      key: string,
      type: string,
      size: number,
      body: Readable,
      signal?: AbortSignal,
    ) =>
      s3.send(
        new PutObjectCommand({
          Bucket: c.bucket,
          Key: key,
          Body: body,
          ContentType: type,
          ContentLength: size,
        }),
        { abortSignal: signal },
      ),
    uploadUrl: (key: string, type: string, size: number) =>
      getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: c.bucket,
          Key: key,
          ContentType: type,
          ContentLength: size,
        }),
        { expiresIn: 300 },
      ),
    head: (key: string) =>
      s3.send(new HeadObjectCommand({ Bucket: c.bucket, Key: key })),
    promote: (
      staging: string,
      final: string,
      name: string,
      type: string,
      etag: string,
    ) =>
      s3.send(
        new CopyObjectCommand({
          Bucket: c.bucket,
          Key: final,
          CopySource: `${c.bucket}/${staging.split("/").map(encodeURIComponent).join("/")}`,
          CopySourceIfMatch: etag,
          MetadataDirective: "REPLACE",
          ContentType: type,
          ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          CacheControl: "private, no-store",
        }),
      ),
    remove: (key: string) =>
      s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: key })),
    downloadUrl: (key: string) =>
      getSignedUrl(s3, new GetObjectCommand({ Bucket: c.bucket, Key: key }), {
        expiresIn: 60,
      }),
    read: (key: string, range?: string) =>
      s3.send(
        new GetObjectCommand({ Bucket: c.bucket, Key: key, Range: range }),
      ),
  };
}
export async function verifyStorage(c: R2Credentials) {
  const s3 = client(c);
  const key = `arionys-verification/${randomUUID()}`;
  const copy = `${key}-copy`;
  let written = false;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: c.bucket }));
    await s3.send(
      new PutObjectCommand({
        Bucket: c.bucket,
        Key: key,
        Body: "Arionys connection verification",
        ContentType: "text/plain",
      }),
    );
    written = true;
    await s3.send(new HeadObjectCommand({ Bucket: c.bucket, Key: key }));
    await s3.send(
      new CopyObjectCommand({
        Bucket: c.bucket,
        Key: copy,
        CopySource: `${c.bucket}/${key}`,
      }),
    );
    const object = await s3.send(
      new GetObjectCommand({ Bucket: c.bucket, Key: copy }),
    );
    await object.Body?.transformToByteArray();
  } finally {
    if (written)
      await Promise.all(
        [key, copy].map((Key) =>
          s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key })),
        ),
      );
  }
}
