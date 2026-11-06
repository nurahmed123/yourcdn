import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { ApiError, required } from "./security";
export const r2Schema = z.object({
  accountId: z.string().regex(/^[a-f0-9]{32}$/i),
  accessKeyId: z.string().min(16).max(128),
  secretAccessKey: z.string().min(24).max(256),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
});
export type R2Credentials = z.infer<typeof r2Schema>;
export type EncryptedCredentials = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};
function encryptionKey() {
  const value = required("R2_ENCRYPTION_KEY");
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new ApiError(
      503,
      "Credential encryption is unavailable. Contact support.",
    );
  return Buffer.from(value, "hex");
}
export function encryptCredentials(
  workspaceId: string,
  credentials: R2Credentials,
): EncryptedCredentials {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`arionys:r2:v1:${workspaceId}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(r2Schema.parse(credentials)), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
export function decryptCredentials(
  workspaceId: string,
  encrypted: EncryptedCredentials,
): R2Credentials {
  try {
    if (encrypted.version !== 1) throw new Error("Invalid encryption version");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(encrypted.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(`arionys:r2:v1:${workspaceId}`));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    return r2Schema.parse(
      JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
          decipher.final(),
        ]).toString("utf8"),
      ),
    );
  } catch {
    throw new ApiError(
      503,
      "Workspace storage credentials could not be unlocked. Contact support.",
    );
  }
}
