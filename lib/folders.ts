import { randomUUID } from "node:crypto";
import { z } from "zod";
import { collection, event } from "./db";
import { type Principal } from "./auth";
import { ApiError, canWrite } from "./security";
export const folderName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (v) => !/[\\/\x00-\x1f\x7f]/.test(v) && v !== "." && v !== "..",
    "Folder names cannot contain slashes or traversal segments.",
  );
export async function folderFor(id: string | null, p: Principal) {
  if (id === null) return null;
  z.string().uuid().parse(id);
  const f = await (
    await collection("folders")
  ).findOne({ _id: id, workspaceId: p.workspaceId });
  if (!f) throw new ApiError(404, "Folder not found.");
  return f;
}
export async function folderPath(id: string | null, p: Principal) {
  const path: any[] = [];
  let current = id;
  while (current) {
    if (path.length >= 32)
      throw new ApiError(400, "Maximum folder depth exceeded.");
    const f = await folderFor(current, p);
    path.unshift({ id: f!._id, name: f!.name });
    current = f!.parentId;
  }
  return path;
}
export async function createFolder(p: Principal, body: unknown) {
  if (!canWrite(p.role)) throw new ApiError(403, "Editor access is required.");
  const b = z
    .object({
      name: folderName,
      parentId: z.string().uuid().nullable().default(null),
    })
    .parse(body);
  await folderFor(b.parentId, p);
  if ((await folderPath(b.parentId, p)).length >= 31)
    throw new ApiError(400, "Maximum folder depth exceeded.");
  const folder = {
    _id: randomUUID(),
    workspaceId: p.workspaceId,
    parentId: b.parentId,
    name: b.name,
    createdBy: p.userId,
    createdAt: new Date(),
  };
  try {
    await (await collection("folders")).insertOne(folder);
  } catch (e: any) {
    if (e.code === 11000)
      throw new ApiError(409, "A folder with this name already exists here.");
    throw e;
  }
  await event(p.email, "Created folder", folder.name, p.workspaceId);
  return { id: folder._id, name: folder.name, parentId: folder.parentId };
}
export async function resolveFolder(
  p: Principal,
  body: { folderId?: string | null; folderPath?: string },
) {
  if (body.folderPath !== undefined && body.folderId !== undefined)
    throw new ApiError(400, "Use folderId or folderPath, not both.");
  if (body.folderPath !== undefined) {
    const segments = body.folderPath.split("/");
    if (segments.length > 31 || segments.some((s) => !s))
      throw new ApiError(
        400,
        "Use a relative folder path with no empty segments.",
      );
    let parentId: string | null = null;
    for (const raw of segments) {
      const name = folderName.parse(raw);
      const folders = await collection("folders");
      const folder: any = await folders.findOne({
        workspaceId: p.workspaceId,
        parentId,
        name,
      });
      if (folder) {
        parentId = folder._id;
        continue;
      }
      try {
        const created = await createFolder(p, { name, parentId });
        parentId = created.id;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const existing = await folders.findOne({
            workspaceId: p.workspaceId,
            parentId,
            name,
          });
          if (!existing) throw e;
          parentId = existing._id;
        } else throw e;
      }
    }
    return parentId;
  }
  const id = body.folderId || null;
  await folderFor(id, p);
  return id;
}
export async function listFolders(p: Principal, parentId: string | null) {
  await folderFor(parentId, p);
  const folders = await (
    await collection("folders")
  )
    .find({ workspaceId: p.workspaceId, parentId })
    .sort({ name: 1 })
    .limit(500)
    .toArray();
  return {
    folders: folders.map((f) => ({
      id: f._id,
      name: f.name,
      parentId: f.parentId,
    })),
    breadcrumbs: await folderPath(parentId, p),
  };
}
export async function renameFolder(p: Principal, id: string, body: unknown) {
  if (!canWrite(p.role)) throw new ApiError(403, "Editor access is required.");
  const f = await folderFor(id, p);
  const b = z.object({ name: folderName }).parse(body);
  try {
    await (
      await collection("folders")
    ).updateOne(
      { _id: id, workspaceId: p.workspaceId },
      { $set: { name: b.name } },
    );
  } catch (e: any) {
    if (e.code === 11000)
      throw new ApiError(409, "A folder with this name already exists here.");
    throw e;
  }
  await event(p.email, "Renamed folder", f!.name, p.workspaceId);
  return { success: true };
}
export async function deleteFolder(p: Principal, id: string) {
  if (!canWrite(p.role)) throw new ApiError(403, "Editor access is required.");
  const f = await folderFor(id, p);
  const [children, files, uploads] = await Promise.all([
    (await collection("folders")).countDocuments({
      workspaceId: p.workspaceId,
      parentId: id,
    }),
    (await collection("files")).countDocuments({
      workspaceId: p.workspaceId,
      folderId: id,
    }),
    (await collection("uploads")).countDocuments({
      workspaceId: p.workspaceId,
      folderId: id,
      state: { $ne: "complete" },
      expiresAt: { $gt: new Date() },
    }),
  ]);
  if (children || files || uploads)
    throw new ApiError(
      409,
      "Move or delete the contents before deleting this folder.",
    );
  await (
    await collection("folders")
  ).deleteOne({ _id: id, workspaceId: p.workspaceId });
  await event(p.email, "Deleted folder", f!.name, p.workspaceId);
  return { success: true };
}
