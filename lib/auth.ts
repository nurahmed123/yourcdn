import { compare, hash as passwordHash, hashSync } from "bcryptjs";
import { randomInt, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { collection, limit, event } from "./db";
import {
  keyExpiryFilter,
  ApiError,
  hash,
  token,
  otpHash,
  constantEqual,
  canWrite,
  isAdmin,
  type Role,
  type Scope,
} from "./security";
import { sendMail, otpEmail } from "./mail";
export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const passwordSchema = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (v) => Buffer.byteLength(v, "utf8") <= 72,
    "Password must be at most 72 UTF-8 bytes.",
  );
const dummyHash = hashSync("unavailable-account-timing-padding", 12);
export const COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-arionys" : "arionys_session";
export type Identity = {
  userId: string;
  email: string;
  name: string;
  sessionId: string;
  activeWorkspaceId: string | null;
};
export type Principal = Identity & {
  workspaceId: string;
  role: Role;
  keyId?: string;
  maxUploadBytes?: number;
};
export function sessionToken(req: Request) {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}
export async function identity(req: Request): Promise<Identity> {
  if (req.headers.has("authorization"))
    throw new ApiError(401, "A verified account session is required.");
  const raw = sessionToken(req);
  if (!raw) throw new ApiError(401, "Please sign in to continue.");
  const session = await (
    await collection("sessions")
  ).findOne({ tokenHash: hash(raw), expiresAt: { $gt: new Date() } });
  if (!session)
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  const user = await (
    await collection("users")
  ).findOne({ _id: session.userId, disabledAt: null });
  if (!user || (session.passwordVersion || 0) !== (user.passwordVersion || 0))
    throw new ApiError(401, "This account is unavailable.");
  return {
    userId: user._id,
    email: user.email,
    name: user.name || user.email.split("@")[0],
    sessionId: session._id,
    activeWorkspaceId: session.activeWorkspaceId || null,
  };
}
export async function authenticate(
  req: Request,
  scope?: Scope,
  sessionOnly = false,
): Promise<Principal> {
  const bearer = req.headers.get("authorization");
  let who: Identity;
  let key: any;
  if (bearer) {
    if (
      sessionOnly ||
      !scope ||
      !bearer.startsWith("Bearer acdn_") ||
      bearer.length > 200
    )
      throw new ApiError(401, "A verified account session is required.");
    key = await (
      await collection("apiKeys")
    ).findOneAndUpdate(
      {
        tokenHash: hash(bearer.slice(7)),
        revokedAt: null,
        ...keyExpiryFilter(),
        scopes: scope,
        $expr: {
          $or: [
            { $eq: [{ $type: "$maxRequests" }, "null"] },
            {
              $and: [
                { $isNumber: "$maxRequests" },
                { $lt: ["$requests", "$maxRequests"] },
              ],
            },
          ],
        },
      },
      { $inc: { requests: 1 }, $set: { lastUsedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!key)
      throw new ApiError(
        401,
        "API key is invalid, expired, exhausted, or missing permission.",
      );
    const user = await (
      await collection("users")
    ).findOne({ _id: key.userId, disabledAt: null });
    if (!user) throw new ApiError(401, "This account is unavailable.");
    who = {
      userId: user._id,
      email: user.email,
      name: user.name || user.email.split("@")[0],
      sessionId: "",
      activeWorkspaceId: key.workspaceId,
    };
  } else who = await identity(req);
  if (!who.activeWorkspaceId)
    throw new ApiError(409, "Create or join a workspace to continue.");
  const membership = await (
    await collection("memberships")
  ).findOne({
    workspaceId: who.activeWorkspaceId,
    userId: who.userId,
    disabledAt: null,
  });
  const workspace = await (
    await collection("workspaces")
  ).findOne({ _id: who.activeWorkspaceId, status: "ready" });
  if (!membership || !workspace)
    throw new ApiError(
      403,
      "This workspace is unavailable or needs onboarding.",
    );
  if (scope && scope !== "files:read" && !canWrite(membership.role))
    throw new ApiError(403, "You need editor access for this action.");
  await limit(
    `${key ? "key" : "user"}:${key ? key._id : who.userId}`,
    key ? 120 : 240,
    60,
  );
  return {
    ...who,
    workspaceId: workspace._id,
    role: membership.role,
    ...(key
      ? { keyId: key._id, maxUploadBytes: key.maxUploadBytes ?? undefined }
      : {}),
  };
}
export function admin(p: Principal) {
  if (!isAdmin(p.role))
    throw new ApiError(403, "Administrator access is required.");
}
export async function issueChallenge(payload: Record<string, unknown>) {
  const id = randomUUID(),
    code = String(randomInt(100000, 1000000));
  const c = await collection("challenges");
  await c.insertOne({
    _id: id,
    ...payload,
    codeHash: otpHash(id, code),
    attempts: 0,
    used: false,
    expiresAt: new Date(Date.now() + 600000),
  });
  try {
    await sendMail(
      payload.email as string,
      "Your YourCDN verification code",
      otpEmail(
        code,
        payload.kind === "storage-change"
          ? "Confirm your storage change"
          : payload.kind === "password-change"
            ? "Confirm your password change"
            : "Verify your sign-in",
      ),
    );
  } catch (e) {
    await c.deleteOne({ _id: id });
    throw e;
  }
  return { challengeId: id, email: payload.email, expiresIn: 600 };
}
export async function beginAuth(action: string, body: unknown) {
  await limit("auth-global", 100, 60);
  const b = z
    .object({
      email: emailSchema,
      password: passwordSchema,
      name: z.string().trim().min(1).max(80).optional(),
    })
    .parse(body);
  await limit(`email:${hash(b.email)}`, 5, 900);
  const users = await collection("users");
  if (action === "signup") {
    if (await users.findOne({ email: b.email }))
      throw new ApiError(
        409,
        "An account with this email already exists. Please sign in.",
      );
    return issueChallenge({
      kind: "signup",
      email: b.email,
      name: b.name || b.email.split("@")[0],
      passwordHash: await passwordHash(b.password, 12),
    });
  }
  if (action !== "login") throw new ApiError(404, "Endpoint not found.");
  const user = await users.findOne({ email: b.email, disabledAt: null });
  const valid = await compare(b.password, user?.passwordHash || dummyHash);
  if (!user || !valid)
    throw new ApiError(401, "Email or password is incorrect.");
  return issueChallenge({
    kind: "login",
    email: user.email,
    userId: user._id,
    passwordVersion: user.passwordVersion || 0,
  });
}
export async function consumeChallenge(
  body: unknown,
  kind?: string,
  userId?: string,
) {
  const b = z
    .object({
      challengeId: z.string().uuid(),
      code: z.string().regex(/^\d{6}$/),
    })
    .parse(body);
  await limit("verify-global", 300, 60);
  const c = await collection("challenges");
  const challenge = await c.findOneAndUpdate(
    {
      _id: b.challengeId,
      used: false,
      attempts: { $lt: 5 },
      expiresAt: { $gt: new Date() },
      ...(kind ? { kind } : {}),
      ...(userId ? { userId } : {}),
    },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );
  if (
    !challenge ||
    !constantEqual(challenge.codeHash, otpHash(b.challengeId, b.code))
  )
    throw new ApiError(
      401,
      "Code is incorrect or expired. Request a new verification code.",
    );
  if (
    !(
      await c.updateOne(
        { _id: b.challengeId, used: false },
        { $set: { used: true }, $unset: { passwordHash: 1, codeHash: 1 } },
      )
    ).modifiedCount
  )
    throw new ApiError(401, "This verification code has already been used.");
  return challenge;
}
export async function verifyIdentity(body: unknown) {
  // Login verification must never consume a password-change challenge.
  const parsed = z
    .object({ challengeId: z.string().uuid() })
    .passthrough()
    .parse(body);
  const peek = await (
    await collection("challenges")
  ).findOne({ _id: parsed.challengeId, kind: { $in: ["signup", "login"] } });
  if (!peek) throw new ApiError(401, "Verification is unavailable.");
  const challenge = await consumeChallenge(body, peek.kind);
  const users = await collection("users");
  let userId = challenge.userId;
  if (challenge.kind === "signup") {
    userId = randomUUID();
    try {
      await users.insertOne({
        _id: userId,
        email: challenge.email,
        name: challenge.name,
        passwordHash: challenge.passwordHash,
        passwordVersion: 0,
        disabledAt: null,
        createdAt: new Date(),
        emailVerifiedAt: new Date(),
      });
    } catch (e: any) {
      if (e.code === 11000)
        throw new ApiError(409, "This account already exists. Please sign in.");
      throw e;
    }
  }
  const user = await users.findOne({ _id: userId, disabledAt: null });
  if (
    !user ||
    (challenge.kind === "login" &&
      (user.passwordVersion || 0) !== challenge.passwordVersion)
  )
    throw new ApiError(401, "This sign-in is no longer valid. Start again.");
  const membership = await (
    await collection("memberships")
  ).findOne({ userId, disabledAt: null }, { sort: { createdAt: 1 } });
  const raw = token(),
    expiresAt = new Date(Date.now() + 12 * 3600000);
  await (
    await collection("sessions")
  ).insertOne({
    _id: randomUUID(),
    tokenHash: hash(raw),
    userId,
    activeWorkspaceId: membership?.workspaceId || null,
    passwordVersion: user.passwordVersion || 0,
    createdAt: new Date(),
    expiresAt,
  });
  return {
    email: user.email,
    name: user.name,
    sessionToken: raw,
    expiresAt,
    next: membership ? "/dashboard" : "/onboarding",
  };
}
export async function verify(body: unknown) {
  const result = await verifyIdentity(body);
  (await cookies()).set(COOKIE, result.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: result.expiresAt,
  });
  return { email: result.email, name: result.name, next: result.next };
}
export async function logout() {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw)
    await (await collection("sessions")).deleteOne({ tokenHash: hash(raw) });
  jar.delete(COOKIE);
  return { success: true };
}
export async function profile(req: Request, body: unknown) {
  const p = await identity(req);
  const b = z.object({ name: z.string().trim().min(1).max(80) }).parse(body);
  await (
    await collection("users")
  ).updateOne(
    { _id: p.userId },
    { $set: { name: b.name, updatedAt: new Date() } },
  );
  return { name: b.name, email: p.email };
}
export async function beginPasswordChange(req: Request, body: unknown) {
  const p = await identity(req);
  await limit(`password:${p.userId}`, 5, 900);
  const b = z
    .object({ currentPassword: passwordSchema, newPassword: passwordSchema })
    .parse(body);
  if (b.currentPassword === b.newPassword)
    throw new ApiError(400, "Choose a different new password.");
  const user = await (
    await collection("users")
  ).findOne({ _id: p.userId, disabledAt: null });
  if (!user || !(await compare(b.currentPassword, user.passwordHash)))
    throw new ApiError(401, "Current password is incorrect.");
  return issueChallenge({
    kind: "password-change",
    email: p.email,
    userId: p.userId,
    passwordHash: await passwordHash(b.newPassword, 12),
    passwordVersion: user.passwordVersion || 0,
  });
}
export async function finishPasswordChange(req: Request, body: unknown) {
  const p = await identity(req);
  const c = await consumeChallenge(body, "password-change", p.userId);
  const result = await (
    await collection("users")
  ).updateOne(
    {
      _id: p.userId,
      $or: [
        { passwordVersion: c.passwordVersion },
        ...(c.passwordVersion === 0
          ? [{ passwordVersion: { $exists: false } }]
          : []),
      ],
    },
    {
      $set: { passwordHash: c.passwordHash, updatedAt: new Date() },
      $inc: { passwordVersion: 1 },
    },
  );
  if (!result.modifiedCount)
    throw new ApiError(409, "Your password changed. Start again.");
  await (await collection("sessions")).deleteMany({ userId: p.userId });
  await (await collection("challenges")).deleteMany({ userId: p.userId });
  return { success: true, next: "/login" };
}
