import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export const scopes = ["files:read", "files:upload", "files:delete"] as const;
export type Scope = (typeof scopes)[number];
export type Role = "owner" | "admin" | "editor" | "viewer";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function required(name: string) {
  const value = process.env[name];
  if (!value)
    throw new ApiError(
      503,
      "Service configuration is incomplete. Contact your administrator.",
    );
  return value;
}
export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function token() {
  return randomBytes(32).toString("base64url");
}
export function otpHash(id: string, code: string) {
  const secret = required("AUTH_SECRET");
  if (secret.length < 32)
    throw new ApiError(503, "Authentication configuration is incomplete.");
  return createHmac("sha256", secret).update(`${id}:${code}`).digest("hex");
}
export function constantEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function cleanName(name: string) {
  return name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 180) || "file";
}
export function canWrite(role: Role) {
  return ["owner", "admin", "editor"].includes(role);
}
export function isAdmin(role: Role) {
  return role === "owner" || role === "admin";
}
export function assertOrigin(req: Request) {
  if (req.headers.get("origin") !== new URL(required("APP_URL")).origin)
    throw new ApiError(403, "This action must be made from the application.");
}
export function fileFilter(principal: { workspaceId: string; keyId?: string }) {
  return {
    workspaceId: principal.workspaceId,
    ...(principal.keyId ? { apiKeyId: principal.keyId } : {}),
  };
}

export function keyExpiryFilter(now = new Date()) {
  return {
    $or: [
      { expiresAt: { $gt: now } },
      { expiresAt: { $eq: null, $exists: true } },
    ],
  };
}
