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

// Cloudflare's R2 object limit is 5 GiB below 5 TiB.
export const R2_MAX_OBJECT_BYTES = 5 * 1024 ** 4 - 5 * 1024 ** 3;
export const R2_MAX_PARTS = 10_000;
export const R2_MIN_PART_BYTES = 5 * 1024 ** 2;

export function singleUploadLimit() {
  const hostLimit =
    process.env.VERCEL === "1" ? 4 * 1024 ** 2 : R2_MAX_OBJECT_BYTES;
  const configured = Number(process.env.MAX_PROXY_UPLOAD_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, hostLimit)
    : hostLimit;
}
