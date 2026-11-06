import { compare } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  authenticate,
  consumeChallenge,
  issueChallenge,
  passwordSchema,
} from "./auth";
import { collection, event, limit } from "./db";
import { ApiError, hash } from "./security";
import {
  encryptCredentials,
  decryptCredentials,
  r2Schema,
} from "./credentials";
import { verifyStorage } from "./storage";
async function owner(req: Request, id: string) {
  const p = await authenticate(req, undefined, true);
  if (p.workspaceId !== id || p.role !== "owner")
    throw new ApiError(
      403,
      "Only the owner of this workspace can manage its storage.",
    );
  return p;
}
export async function storageDetails(req: Request, id: string) {
  await owner(req, id);
  const w = await (
    await collection("workspaces")
  ).findOne({ _id: id, status: "ready" });
  const c = decryptCredentials(id, w!.r2);
  return {
    accountId: c.accountId,
    bucket: c.bucket,
    storageVersion: w!.storageVersion || 1,
    updatedAt: w!.storageUpdatedAt || w!.onboardedAt,
  };
}
export async function beginStorageChange(
  req: Request,
  id: string,
  body: unknown,
) {
  const p = await owner(req, id);
  await limit(`storage-change:${p.userId}`, 5, 900);
  const b = z
    .object({
      currentPassword: passwordSchema,
      credentials: r2Schema,
      privateBucketConfirmed: z.literal(true),
    })
    .parse(body);
  const user = await (
    await collection("users")
  ).findOne({ _id: p.userId, disabledAt: null });
  if (!user || !(await compare(b.currentPassword, user.passwordHash)))
    throw new ApiError(401, "Current password is incorrect.");
  const encrypted = encryptCredentials(id, b.credentials);
  try {
    await verifyStorage(b.credentials);
  } catch {
    throw new ApiError(
      400,
      "Could not verify the new bucket. Check its account ID and Object Read & Write credentials.",
    );
  }
  const workspace = await (
    await collection("workspaces")
  ).findOne({ _id: id, status: "ready" });
  return issueChallenge({
    kind: "storage-change",
    email: p.email,
    userId: p.userId,
    workspaceId: id,
    encryptedCredentials: encrypted,
    baseStorageVersion: workspace!.storageVersion || 1,
    passwordVersion: user.passwordVersion || 0,
  });
}
export async function finishStorageChange(
  req: Request,
  id: string,
  body: unknown,
) {
  const p = await owner(req, id);
  const peek = z
    .object({ challengeId: z.string().uuid() })
    .passthrough()
    .parse(body);
  const valid = await (
    await collection("challenges")
  ).findOne({
    _id: peek.challengeId,
    kind: "storage-change",
    workspaceId: id,
    userId: p.userId,
  });
  if (!valid)
    throw new ApiError(
      401,
      "Storage verification is unavailable for this workspace.",
    );
  const c = await consumeChallenge(body, "storage-change", p.userId);
  const user = await (
    await collection("users")
  ).findOne({ _id: p.userId, disabledAt: null });
  if (!user || (user.passwordVersion || 0) !== c.passwordVersion)
    throw new ApiError(401, "Account security changed. Start again.");
  const workspaces = await collection("workspaces");
  const w = await workspaces.findOne({ _id: id, status: "ready" });
  if ((w!.storageVersion || 1) !== c.baseStorageVersion)
    throw new ApiError(409, "Storage changed in another session. Start again.");
  const previousCredentials = decryptCredentials(id, w!.r2);
  await (
    await collection("storageConnections")
  ).updateOne(
    { workspaceId: id, version: c.baseStorageVersion },
    {
      $set: {
        bucketFingerprint: hash(
          `${previousCredentials.accountId}:${previousCredentials.bucket}`,
        ),
      },
      $setOnInsert: {
        _id: randomUUID(),
        workspaceId: id,
        version: c.baseStorageVersion,
        r2: w!.r2,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
  const changed = await workspaces.updateOne(
    { _id: id, storageVersion: c.baseStorageVersion, status: "ready" },
    {
      $set: {
        r2: c.encryptedCredentials,
        storageVersion: c.baseStorageVersion + 1,
        storageUpdatedAt: new Date(),
      },
    },
  );
  if (!changed.modifiedCount)
    throw new ApiError(409, "Storage changed in another session. Start again.");
  await event(p.email, "Updated storage connection", w!.name, id);
  return { success: true, storageVersion: c.baseStorageVersion + 1 };
}
