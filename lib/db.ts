import { MongoClient } from "mongodb";
import { required } from "./security";
const globalDb = globalThis as unknown as {
  mongo?: Promise<MongoClient>;
  indexes?: Promise<void>;
};
export async function db() {
  if (!globalDb.mongo)
    globalDb.mongo = new MongoClient(required("MONGODB_URI"), {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    })
      .connect()
      .catch((e) => {
        globalDb.mongo = undefined;
        throw e;
      });
  const database = (await globalDb.mongo).db(
    process.env.MONGODB_DATABASE || "arionys_cdn",
  );
  if (!globalDb.indexes)
    globalDb.indexes = Promise.all([
      database.collection("users").createIndex({ email: 1 }, { unique: true }),
      database
        .collection("uploads")
        .createIndex(
          { workspaceId: 1, userId: 1, apiKeyId: 1, requestId: 1 },
          {
            unique: true,
            partialFilterExpression: { requestId: { $type: "string" } },
          },
        ),
      database
        .collection("files")
        .createIndex(
          { workspaceId: 1, userId: 1, apiKeyId: 1, requestId: 1 },
          {
            unique: true,
            partialFilterExpression: { requestId: { $type: "string" } },
          },
        ),
      database
        .collection("storageConnections")
        .createIndex({ workspaceId: 1, bucketFingerprint: 1, version: -1 }),
      database
        .collection("storageConnections")
        .createIndex({ workspaceId: 1, version: 1 }, { unique: true }),
      database
        .collection("sessions")
        .createIndex({ tokenHash: 1 }, { unique: true }),
      database
        .collection("sessions")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      database
        .collection("challenges")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      database
        .collection("invitations")
        .createIndex({ tokenHash: 1 }, { unique: true }),
      database
        .collection("invitations")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      database
        .collection("rateLimits")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      database
        .collection("apiKeys")
        .createIndex({ tokenHash: 1 }, { unique: true }),
      database.collection("files").createIndex({ createdAt: -1, _id: -1 }),
      database.collection("files").createIndex({ apiKeyId: 1, status: 1 }),
      database
        .collection("uploads")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      database
        .collection("events")
        .createIndex({ workspaceId: 1, createdAt: -1 }),
      database
        .collection("memberships")
        .createIndex({ workspaceId: 1, userId: 1 }, { unique: true }),
      database
        .collection("memberships")
        .createIndex({ userId: 1, disabledAt: 1 }),
      database
        .collection("folders")
        .createIndex(
          { workspaceId: 1, parentId: 1, name: 1 },
          { unique: true },
        ),
      database
        .collection("files")
        .createIndex({ workspaceId: 1, folderId: 1, createdAt: -1 }),
    ])
      .then(() => undefined)
      .catch((e) => {
        globalDb.indexes = undefined;
        throw e;
      });
  await globalDb.indexes;
  return database;
}
// String UUID primary keys keep identifiers stable across the API and object storage.
export async function collection(name: string) {
  return (await db()).collection<any>(name);
}
export async function limit(key: string, maximum: number, seconds: number) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const c = await collection("rateLimits");
  const result = await c.findOneAndUpdate(
    { _id: `${key}:${bucket}` },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date((bucket + 2) * seconds * 1000) },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (result!.count > maximum) {
    const { ApiError } = await import("./security");
    throw new ApiError(429, "Too many requests. Please try again later.");
  }
}
export async function event(
  actor: string,
  action: string,
  target: string,
  workspaceId: string,
) {
  await (
    await collection("events")
  ).insertOne({ actor, action, target, workspaceId, createdAt: new Date() });
}
