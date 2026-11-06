import { randomUUID } from "node:crypto";
import { z } from "zod";
import { collection, event, limit } from "./db";
import { identity, type Identity, type Principal } from "./auth";
import { ApiError, hash, token, required, isAdmin } from "./security";
import {
  encryptCredentials,
  decryptCredentials,
  r2Schema,
} from "./credentials";
import { verifyStorage, storageFor } from "./storage";
import { sendMail } from "./mail";
export function publicWorkspace(w: any, role: string) {
  return {
    id: w._id,
    name: w.name,
    status: w.status,
    role,
    createdAt: w.createdAt,
  };
}
export async function listWorkspaces(who: Identity) {
  const memberships = await (
    await collection("memberships")
  )
    .find({ userId: who.userId, disabledAt: null })
    .toArray();
  const workspaces = await (
    await collection("workspaces")
  )
    .find({
      _id: { $in: memberships.map((m) => m.workspaceId) },
      status: { $ne: "deleted" },
    })
    .toArray();
  return workspaces.map((w) =>
    publicWorkspace(w, memberships.find((m) => m.workspaceId === w._id)!.role),
  );
}
export async function me(req: Request) {
  const who = await identity(req);
  const workspaces = await listWorkspaces(who);
  const activeWorkspace =
    workspaces.find((w) => w.id === who.activeWorkspaceId) || null;
  return {
    userId: who.userId,
    email: who.email,
    name: who.name,
    role: activeWorkspace?.role || "viewer",
    activeWorkspace,
    workspaces,
  };
}
export async function createWorkspace(req: Request, body: unknown) {
  const who = await identity(req);
  await limit(`workspace-create:${who.userId}`, 10, 3600);
  const b = z.object({ name: z.string().trim().min(2).max(80) }).parse(body);
  const id = randomUUID();
  await (
    await collection("workspaces")
  ).insertOne({
    _id: id,
    name: b.name,
    ownerId: who.userId,
    status: "pending",
    storageVersion: 0,
    createdAt: new Date(),
  });
  try {
    await (
      await collection("memberships")
    ).insertOne({
      _id: randomUUID(),
      workspaceId: id,
      userId: who.userId,
      role: "owner",
      disabledAt: null,
      createdAt: new Date(),
    });
  } catch (e) {
    await (await collection("workspaces")).deleteOne({ _id: id });
    throw e;
  }
  await (
    await collection("sessions")
  ).updateOne({ _id: who.sessionId }, { $set: { activeWorkspaceId: id } });
  return { id, name: b.name, status: "pending", role: "owner" };
}
export async function switchWorkspace(req: Request, workspaceId: string) {
  const who = await identity(req);
  z.string().uuid().parse(workspaceId);
  const membership = await (
    await collection("memberships")
  ).findOne({ workspaceId, userId: who.userId, disabledAt: null });
  const workspace = await (
    await collection("workspaces")
  ).findOne({ _id: workspaceId, status: { $ne: "deleted" } });
  if (!membership || !workspace)
    throw new ApiError(404, "Workspace not found.");
  await (
    await collection("sessions")
  ).updateOne(
    { _id: who.sessionId },
    { $set: { activeWorkspaceId: workspaceId } },
  );
  return { next: workspace.status === "ready" ? "/dashboard" : "/onboarding" };
}
export async function configureStorage(
  req: Request,
  id: string,
  body: unknown,
) {
  const who = await identity(req);
  z.string().uuid().parse(id);
  const membership = await (
    await collection("memberships")
  ).findOne({
    workspaceId: id,
    userId: who.userId,
    role: "owner",
    disabledAt: null,
  });
  const workspace = await (
    await collection("workspaces")
  ).findOne({ _id: id, ownerId: who.userId, status: "pending" });
  if (!membership || !workspace)
    throw new ApiError(
      403,
      "Only the owner can configure an unfinished workspace.",
    );
  await limit(`storage-setup:${who.userId}`, 10, 900);
  const b = z
    .object({ credentials: r2Schema, privateBucketConfirmed: z.literal(true) })
    .parse(body);
  const encrypted = encryptCredentials(id, b.credentials);
  try {
    await verifyStorage(b.credentials);
  } catch {
    throw new ApiError(
      400,
      "Could not verify bucket permissions. Check the account ID, bucket name, and Object Read & Write credentials.",
    );
  }
  const changed = await (
    await collection("workspaces")
  ).updateOne(
    { _id: id, status: "pending" },
    {
      $set: {
        r2: encrypted,
        status: "ready",
        storageVersion: 1,
        onboardedAt: new Date(),
      },
    },
  );
  if (!changed.modifiedCount)
    throw new ApiError(409, "Workspace setup already completed.");
  await event(who.email, "Created workspace", workspace.name, id);
  return { next: "/dashboard" };
}
export async function workspaceStorage(workspaceId: string, version?: number) {
  const w = await (
    await collection("workspaces")
  ).findOne({ _id: workspaceId, status: "ready" });
  if (!w?.r2) throw new ApiError(409, "Workspace storage is not configured.");
  const currentVersion = w.storageVersion || 1;
  const current = decryptCredentials(workspaceId, w.r2);
  let credentials = current;
  if (version !== undefined && version !== currentVersion) {
    const saved = await (
      await collection("storageConnections")
    ).findOne({ workspaceId, version });
    if (!saved)
      throw new ApiError(
        409,
        "The original storage connection is unavailable. Contact the workspace owner.",
      );
    const previous = decryptCredentials(workspaceId, saved.r2);
    if (
      previous.accountId !== current.accountId ||
      previous.bucket !== current.bucket
    ) {
      const latest = await (
        await collection("storageConnections")
      ).findOne(
        {
          workspaceId,
          bucketFingerprint: hash(`${previous.accountId}:${previous.bucket}`),
        },
        { sort: { version: -1 } },
      );
      credentials = latest
        ? decryptCredentials(workspaceId, latest.r2)
        : previous;
    }
  }
  return {
    ...storageFor(credentials),
    storageVersion: version || currentVersion,
  };
}
export async function inviteMember(p: Principal, body: unknown) {
  if (!isAdmin(p.role))
    throw new ApiError(403, "Administrator access is required.");
  await limit(`invite:${p.userId}`, 20, 3600);
  const b = z
    .object({
      email: z
        .string()
        .trim()
        .email()
        .max(254)
        .transform((v) => v.toLowerCase()),
      role: z.enum(["admin", "editor", "viewer"]),
    })
    .parse(body);
  if (p.role !== "owner" && b.role === "admin")
    throw new ApiError(
      403,
      "Only the workspace owner can invite administrators.",
    );
  const existing = await (
    await collection("users")
  ).findOne({ email: b.email });
  if (
    existing &&
    (await (
      await collection("memberships")
    ).findOne({
      workspaceId: p.workspaceId,
      userId: existing._id,
      disabledAt: null,
    }))
  )
    throw new ApiError(409, "This person is already a workspace member.");
  const raw = token(),
    id = randomUUID();
  const link = new URL("/invite", required("APP_URL"));
  link.searchParams.set("token", raw);
  await (
    await collection("invitations")
  ).insertOne({
    _id: id,
    workspaceId: p.workspaceId,
    email: b.email,
    role: b.role,
    tokenHash: hash(raw),
    used: false,
    createdBy: p.userId,
    expiresAt: new Date(Date.now() + 7 * 86400000),
  });
  try {
    await sendMail(
      b.email,
      "You are invited to YourCDN",
      `<h2>YourCDN</h2><p>You have been invited to a shared workspace.</p><p><a href="${link.href.replace(/&/g, "&amp;")}">Accept invitation</a></p><p>Sign in or create an account with this email address. You do not need your own R2 bucket to join.</p>`,
    );
  } catch (e) {
    await (await collection("invitations")).deleteOne({ _id: id });
    throw e;
  }
  await event(p.email, "Invited team member", b.email, p.workspaceId);
  return { success: true };
}
export async function acceptInvitation(req: Request, body: unknown) {
  const who = await identity(req);
  const b = z.object({ token: z.string().min(32).max(128) }).parse(body);
  await limit(`invite-accept:${who.userId}`, 20, 900);
  const c = await collection("invitations");
  const invitation = await c.findOne({
    tokenHash: hash(b.token),
    email: who.email,
    used: false,
    expiresAt: { $gt: new Date() },
  });
  if (!invitation)
    throw new ApiError(
      404,
      "Invitation is unavailable or belongs to a different email address.",
    );
  const workspace = await (
    await collection("workspaces")
  ).findOne({ _id: invitation.workspaceId, status: "ready" });
  if (!workspace) throw new ApiError(404, "Workspace is unavailable.");
  const inviter = await (
    await collection("memberships")
  ).findOne({
    workspaceId: invitation.workspaceId,
    userId: invitation.createdBy,
    disabledAt: null,
    role: { $in: invitation.role === "admin" ? ["owner"] : ["owner", "admin"] },
  });
  if (!inviter)
    throw new ApiError(
      403,
      "The inviter no longer has permission. Request a new invitation.",
    );
  const accepted = await c.updateOne(
    { _id: invitation._id, used: false },
    { $set: { used: true, acceptedAt: new Date() } },
  );
  if (!accepted.modifiedCount)
    throw new ApiError(409, "Invitation already accepted.");
  await (
    await collection("memberships")
  ).updateOne(
    { workspaceId: invitation.workspaceId, userId: who.userId },
    {
      $setOnInsert: {
        _id: randomUUID(),
        role: invitation.role,
        disabledAt: null,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
  // A fresh owner/admin invitation can restore a removed member. Existing
  // active roles (especially ownership) are never overwritten by a stale invite.
  await (
    await collection("memberships")
  ).updateOne(
    {
      workspaceId: invitation.workspaceId,
      userId: who.userId,
      disabledAt: { $ne: null },
    },
    {
      $set: { role: invitation.role, disabledAt: null, rejoinedAt: new Date() },
    },
  );
  const member = await (
    await collection("memberships")
  ).findOne({
    workspaceId: invitation.workspaceId,
    userId: who.userId,
    disabledAt: null,
  });
  if (!member)
    throw new ApiError(
      403,
      "Your workspace membership has been disabled. Ask the owner to restore it.",
    );
  await (
    await collection("sessions")
  ).updateOne(
    { _id: who.sessionId },
    { $set: { activeWorkspaceId: invitation.workspaceId } },
  );
  await event(who.email, "Joined workspace", workspace.name, workspace._id);
  return { next: "/dashboard" };
}
