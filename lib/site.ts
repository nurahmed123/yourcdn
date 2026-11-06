export const SITE_NAME = "YourCDN";
export const SITE_DESCRIPTION =
  "Upload, organize, and deliver files from your own Cloudflare R2 bucket with shared workspaces and a single-request upload API.";

export const siteOrigin = (() => {
  try {
    const url = new URL(process.env.APP_URL ?? "");
    if (
      url.protocol !== "https:" ||
      !url.hostname.includes(".") ||
      /^(?:\d+\.){3}\d+$|\.(?:localhost|local|test|invalid|example|internal)$/i.test(
        url.hostname,
      )
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
})();
