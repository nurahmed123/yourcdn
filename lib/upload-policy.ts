export const UPLOAD_TTL_MS = 30 * 60000;
export const FAILED_UPLOAD_TTL_MS = 5 * 60000;
export function proxyUploadLimit() {
  return Math.min(
    Number(process.env.MAX_UPLOAD_BYTES || 104857600),
    Number(
      process.env.MAX_PROXY_UPLOAD_BYTES ||
        (process.env.VERCEL === "1" ? 4194304 : 104857600),
    ),
  );
}
